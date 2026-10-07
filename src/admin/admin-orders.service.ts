import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { notFound } from '../common/app-error.js';
import { pageOf, skipTake } from '../common/page.query.js';
import { ORDER_TRANSITIONS } from '../orders/order-transitions.js';
import type { AddressDto } from '../orders/orders.dto.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import type {
  AdminOrderDetailDto,
  AdminOrderPageDto,
  AdminOrderRowDto,
  AdminOrdersQuery,
  PhoneFlagDto,
  TransitionDto,
} from './dto/admin-orders.dto.js';

const rowInclude = {
  deliveryZone: { select: { code: true, name: true, etaText: true } },
  items: true,
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof rowInclude }>;

export function emptyFlag(phone: string): PhoneFlagDto {
  return { phone, codRefusedCount: 0, codDeliveredCount: 0, isBlocked: false, note: null, updatedAt: null };
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminOrdersQuery): Promise<AdminOrderPageDto> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.from || query.to
        ? {
            placedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const q = query.q?.trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      where.OR = [
        { orderNumber: { contains: q.toUpperCase() } },
        { customerName: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
      ];
    }

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ where, include: rowInclude, orderBy: { placedAt: 'desc' }, ...skipTake(query) }),
    ]);
    return pageOf(orders.map(toRow), total, query);
  }

  async detail(orderNumber: string): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber: orderNumber.trim().toUpperCase() },
      include: {
        ...rowInclude,
        events: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw notFound('Order not found');

    const actorIds = [...new Set(order.events.map((e) => e.actorId).filter((id): id is string => !!id))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, phone: true },
    });
    const actorName = new Map(actors.map((a) => [a.id, a.name ?? a.phone]));
    const flag = await this.prisma.phoneFlag.findUnique({ where: { phone: order.phone } });

    return {
      ...toRow(order),
      email: order.email,
      shippingAddress: order.shippingAddress as unknown as AddressDto,
      deliveryZoneDetail: order.deliveryZone,
      items: order.items.map((item) => ({
        variantId: item.variantId,
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
      customerNote: order.customerNote,
      adminNote: order.adminNote,
      timeline: order.events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType,
        actorName: e.actorId ? (actorName.get(e.actorId) ?? null) : null,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
      payments: order.payments.map((p) => ({
        provider: p.provider,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      phoneFlag: flag ? { ...flag, updatedAt: flag.updatedAt.toISOString() } : emptyFlag(order.phone),
      allowedTransitions: [...ORDER_TRANSITIONS[order.status]],
    };
  }

  async transition(orderNumber: string, input: TransitionDto, actorId: string) {
    const order = await this.findId(orderNumber);
    await this.prisma.$transaction(async (tx) => {
      await this.orders.transition(tx, order.id, input.to, { type: 'admin', id: actorId }, input.note?.trim() || undefined);
      await this.audit.log(tx, actorId, {
        action: 'order.transition',
        entityType: 'order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: input.to, note: input.note ?? null },
      });
    });
    return this.detail(orderNumber);
  }

  async updateNote(orderNumber: string, adminNote: string, actorId: string) {
    const order = await this.findId(orderNumber);
    const next = adminNote.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { adminNote: next } });
      await this.audit.log(tx, actorId, {
        action: 'order.note',
        entityType: 'order',
        entityId: order.id,
        before: { adminNote: order.adminNote },
        after: { adminNote: next },
      });
    });
    return this.detail(orderNumber);
  }

  private async findId(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber: orderNumber.trim().toUpperCase() },
      select: { id: true, status: true, adminNote: true },
    });
    if (!order) throw notFound('Order not found');
    return order;
  }
}

function toRow(order: OrderRow): AdminOrderRowDto {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    phone: order.phone,
    phoneVerified: order.phoneVerified,
    deliveryZone: order.deliveryZone.name,
    itemCount: order.items.reduce((n, item) => n + item.quantity, 0),
    total: order.total,
    placedAt: order.placedAt.toISOString(),
  };
}
