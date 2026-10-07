import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ActorType, OrderStatus, Prisma } from '../generated/prisma/client.js';
import { OtpService } from '../auth/otp.service.js';
import type { AuthUser } from '../auth/session.js';
import { AppError, conflict, notFound, unprocessable } from '../common/app-error.js';
import { normalizeBdPhone } from '../common/phone.js';
import { variantLabel } from '../common/variant-label.js';
import type { Env } from '../config/env.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deliveryFee } from '../shipping/delivery-fee.js';
import { codRisk } from './cod-risk.js';
import { CUSTOMER_CANCELLABLE, RESTOCK_ON, canTransition } from './order-transitions.js';
import type { AddressDto, CreateOrderDto, CustomerOrderDto, OrderSummaryPageDto } from './orders.dto.js';

const NOT_FOUND_MESSAGE = "We couldn't find an order with that number and phone.";

const customerOrderInclude = {
  items: true,
  events: { orderBy: { createdAt: 'asc' as const } },
  deliveryZone: { select: { code: true, name: true, etaText: true } },
} satisfies Prisma.OrderInclude;

type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof customerOrderInclude }>;

export interface Actor {
  type: ActorType;
  id?: string | null;
}

/** Orders a logged-in user may see: placed while logged in, or with their verified phone. */
function ownedBy(user: AuthUser): Prisma.OrderWhereInput {
  return { OR: [{ userId: user.id }, ...(user.phoneVerified ? [{ phone: user.phone }] : [])] };
}

function isOwner(order: { userId: string | null; phone: string }, user: AuthUser | null) {
  return !!user && (order.userId === user.id || (user.phoneVerified && order.phone === user.phone));
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly otp: OtpService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * COD checkout (SYSTEM_DESIGN.md "Key flows"). Everything happens in one
   * transaction: re-price from the database, apply the COD risk rules, take
   * stock, create the order, its item snapshots, the COD payment and the
   * status events, then empty the cart. Any failure rolls all of it back.
   */
  async createOrder(cartId: string | null, input: CreateOrderDto, user: AuthUser | null): Promise<CustomerOrderDto> {
    const phone = normalizeBdPhone(input.phone);
    if (!phone) throw unprocessable('INVALID_PHONE', 'Enter an 11-digit mobile number, e.g. 01712345678.');
    if (input.paymentMethod !== 'cod') {
      throw unprocessable(
        'PAYMENT_METHOD_UNAVAILABLE',
        'Online payment is coming soon. Please choose Cash on Delivery for now.',
      );
    }
    const zone = await this.prisma.deliveryZone.findFirst({
      where: { code: input.deliveryZone, isActive: true },
    });
    if (!zone) throw unprocessable('INVALID_DELIVERY_ZONE', 'Please choose a delivery area.');
    if (!cartId) throw conflict('CART_EMPTY', 'Your cart is empty.');

    // A wrong code is rejected (and counted) before anything else happens.
    const otpId = input.otpCode ? await this.otp.check(phone, 'checkout', input.otpCode) : null;
    const sessionVerified = !!user?.phoneVerified && user.phone === phone;
    const phoneVerified = sessionVerified || otpId !== null;

    const orderId = await this.prisma.$transaction(async (tx) => {
      const cartItems = await tx.cartItem.findMany({
        where: { cartId },
        orderBy: { createdAt: 'asc' },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  name: true,
                  status: true,
                  freeDelivery: true,
                  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
                },
              },
            },
          },
        },
      });
      if (cartItems.length === 0) throw conflict('CART_EMPTY', 'Your cart is empty.');

      for (const { variant } of cartItems) {
        if (!variant.isActive || variant.product.status !== 'active') {
          throw conflict('ITEM_UNAVAILABLE', `${variant.product.name} is no longer available. Please remove it.`);
        }
      }

      const lines = cartItems.map(({ variant, quantity }) => {
        const label = variantLabel(variant.options);
        return {
          variantId: variant.id,
          productName: variant.product.name,
          variantLabel: label,
          sku: variant.sku,
          imageUrl: variant.product.images[0]?.url ?? null,
          unitPrice: variant.price,
          quantity,
          lineTotal: variant.price * quantity,
          freeDelivery: variant.product.freeDelivery,
        };
      });
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const fee = deliveryFee(zone.fee, lines);
      const total = subtotal + fee;

      const codMax = this.config.get('COD_MAX_ORDER_TOTAL', { infer: true });
      if (codMax !== null && total > codMax) {
        throw unprocessable(
          'COD_LIMIT_EXCEEDED',
          'This order is above our Cash on Delivery limit. Please contact us to complete it.',
        );
      }

      const flag = await tx.phoneFlag.findUnique({ where: { phone } });
      const risk = codRisk({
        isBlocked: flag?.isBlocked ?? false,
        codRefusedCount: flag?.codRefusedCount ?? 0,
        trustedOrderCount: await tx.order.count({
          where: { phone, OR: [{ phoneVerified: true }, { status: 'delivered' }] },
        }),
        total,
        otpThreshold: this.config.get('COD_OTP_THRESHOLD', { infer: true }),
      });
      if (risk.blocked) {
        throw unprocessable('COD_BLOCKED', 'Cash on Delivery is not available for this phone number.');
      }
      if (risk.otpReasons.length > 0 && !phoneVerified) {
        throw new AppError(
          HttpStatus.PRECONDITION_REQUIRED,
          'OTP_REQUIRED',
          'Please verify your phone number with the code we send by SMS.',
        );
      }
      if (otpId) await this.otp.consume(tx, otpId);

      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
      const orderNumber = `UM-${n}`;
      const address: AddressDto = {
        line1: input.address.line1.trim(),
        ...(input.address.area?.trim() ? { area: input.address.area.trim() } : {}),
        city: input.address.city.trim(),
      };

      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: user?.id ?? null,
          customerName: input.customerName.trim(),
          phone,
          phoneVerified,
          email: input.email?.trim() || null,
          shippingAddress: { ...address },
          deliveryZoneId: zone.id,
          status: 'pending_confirmation',
          paymentMethod: 'cod',
          paymentStatus: 'unpaid',
          subtotal,
          deliveryFee: fee,
          total,
          customerNote: input.note?.trim() || null,
          items: { create: lines.map(({ freeDelivery: _free, ...line }) => line) },
          events: { create: { toStatus: 'pending_confirmation', actorType: 'customer', actorId: user?.id ?? null } },
          payments: {
            create: { provider: 'cod', amount: total, status: 'pending', idempotencyKey: `cod:${orderNumber}` },
          },
        },
        select: { id: true },
      });

      // Takes stock with a conditional update — fails the whole order if
      // anyone else got the last units first (no overselling).
      await this.inventory.decrement(
        tx,
        lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, label: line.productName })),
        { refType: 'order', refId: order.id },
      );

      // Spec: OTP-verified COD orders are confirmed automatically; the rest
      // wait for a confirmation call from the team.
      if (phoneVerified) {
        await this.transition(tx, order.id, 'confirmed', { type: 'system' }, 'Phone verified by OTP');
      }

      await tx.cartItem.deleteMany({ where: { cartId } });
      // TODO(sms): send the order confirmation SMS once an SMS gateway exists.
      return order.id;
    });

    return this.toCustomerOrder(
      await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: customerOrderInclude }),
    );
  }

  /** Owner, or guest with the order's phone. Same 404 for any mismatch. */
  async findForCustomer(orderNumber: string, rawPhone: string | undefined, user: AuthUser | null) {
    return this.toCustomerOrder(await this.loadForCustomer(orderNumber, rawPhone, user));
  }

  async listMine(user: AuthUser, page: number, pageSize: number): Promise<OrderSummaryPageDto> {
    const where = ownedBy(user);
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: { select: { quantity: true, imageUrl: true } } },
      }),
    ]);
    return {
      items: orders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        placedAt: order.placedAt.toISOString(),
        itemCount: order.items.reduce((n, item) => n + item.quantity, 0),
        total: order.total,
        imageUrl: order.items[0]?.imageUrl ?? null,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async cancelByCustomer(orderNumber: string, rawPhone: string | undefined, user: AuthUser | null) {
    const order = await this.loadForCustomer(orderNumber, rawPhone, user);
    if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
      throw conflict(
        'INVALID_TRANSITION',
        "This order can't be cancelled online any more. Please contact support.",
      );
    }
    await this.prisma.$transaction((tx) =>
      this.transition(tx, order.id, 'cancelled', { type: 'customer', id: user?.id }, 'Cancelled by customer'),
    );
    return this.findForCustomer(orderNumber, rawPhone, user);
  }

  /**
   * The ONLY place order status changes. Rejects moves not in the lifecycle,
   * guards against concurrent changes, records an OrderStatusEvent, returns
   * stock on cancel/return, and keeps COD payments and phone flags in step.
   */
  async transition(
    tx: Prisma.TransactionClient,
    orderId: string,
    to: OrderStatus,
    actor: Actor,
    note?: string,
  ) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        phone: true,
        paymentMethod: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!canTransition(order.status, to)) {
      throw conflict('INVALID_TRANSITION', `An order that is ${order.status} can't become ${to}.`);
    }
    const isCod = order.paymentMethod === 'cod';

    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      // Cash collected at the door = paid.
      data: { status: to, ...(to === 'delivered' && isCod ? { paymentStatus: 'paid' as const } : {}) },
    });
    if (count === 0) throw conflict('CONCURRENT_UPDATE', 'This order was just changed. Please reload.');

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        actorType: actor.type,
        actorId: actor.id ?? null,
        note: note ?? null,
      },
    });

    const reason = RESTOCK_ON[to];
    if (reason) {
      await this.inventory.restock(tx, order.items, reason, {
        refType: 'order',
        refId: order.id,
        actorId: actor.id ?? null,
      });
    }

    if (to === 'cancelled') {
      await tx.payment.updateMany({
        where: { orderId: order.id, status: { in: ['initiated', 'pending'] } },
        data: { status: 'cancelled' },
      });
    }
    if (isCod && to === 'delivered') {
      await tx.payment.updateMany({
        where: { orderId: order.id, provider: 'cod', status: 'pending' },
        data: { status: 'succeeded' },
      });
      await tx.phoneFlag.upsert({
        where: { phone: order.phone },
        create: { phone: order.phone, codDeliveredCount: 1 },
        update: { codDeliveredCount: { increment: 1 } },
      });
    }
    if (isCod && to === 'delivery_failed') {
      // Feeds the "≥ 2 refused COD deliveries → OTP" rule.
      await tx.phoneFlag.upsert({
        where: { phone: order.phone },
        create: { phone: order.phone, codRefusedCount: 1 },
        update: { codRefusedCount: { increment: 1 } },
      });
    }
  }

  private async loadForCustomer(
    orderNumber: string,
    rawPhone: string | undefined,
    user: AuthUser | null,
  ): Promise<OrderWithDetails> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber: orderNumber.trim().toUpperCase() },
      include: customerOrderInclude,
    });
    const phone = rawPhone ? normalizeBdPhone(rawPhone) : null;
    if (!order || !(isOwner(order, user) || (phone !== null && order.phone === phone))) {
      throw notFound(NOT_FOUND_MESSAGE);
    }
    return order;
  }

  private toCustomerOrder(order: OrderWithDetails): CustomerOrderDto {
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      placedAt: order.placedAt.toISOString(),
      customerName: order.customerName,
      phone: order.phone,
      email: order.email,
      shippingAddress: order.shippingAddress as unknown as AddressDto,
      deliveryZone: order.deliveryZone,
      items: order.items.map((item) => ({
        productName: item.productName,
        variantLabel: item.variantLabel,
        sku: item.sku,
        imageUrl: item.imageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      timeline: order.events.map((event) => ({
        status: event.toStatus,
        at: event.createdAt.toISOString(),
        note: event.note,
      })),
      cancellable: CUSTOMER_CANCELLABLE.includes(order.status),
    };
  }
}
