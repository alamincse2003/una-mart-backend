import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { conflict, notFound } from '../common/app-error.js';
import { variantLabel } from '../common/variant-label.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CartDto, CartLineDto } from './cart.dto.js';
import { MAX_LINE_QUANTITY } from './cart.dto.js';

/** Never more than what's in stock, never more than the per-line limit. */
export function capQuantity(requested: number, stockQty: number): number {
  return Math.max(0, Math.min(requested, stockQty, MAX_LINE_QUANTITY));
}

export const EMPTY_CART: CartDto = { items: [], itemCount: 0, subtotal: 0 };

const lineInclude = {
  variant: {
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          freeDelivery: true,
          images: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true } },
        },
      },
    },
  },
};

/** Whose cart: a logged-in user's, else the guest cookie's. */
export type CartOwner = { userId: string } | { guestToken: string };

// Guest carts are keyed by an opaque random token kept in an httpOnly
// cookie; logged-in users have one cart, and the guest cart is merged into it
// at login. Prices are always read from the database, never stored in the cart.
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  newToken() {
    return randomBytes(32).toString('base64url');
  }

  async findCartId(owner: CartOwner | null): Promise<string | null> {
    if (!owner) return null;
    const cart = await this.prisma.cart.findUnique({ where: owner, select: { id: true } });
    return cart?.id ?? null;
  }

  async getOrCreateCartId(owner: CartOwner): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: owner,
      create: owner,
      update: {},
      select: { id: true },
    });
    return cart.id;
  }

  /**
   * At login: moves the guest cart's lines into the user's cart (quantities
   * added, capped at stock), then deletes the guest cart.
   */
  async mergeGuestCart(guestToken: string, userId: string) {
    const guest = await this.prisma.cart.findUnique({
      where: { guestToken },
      include: { items: { include: { variant: { select: { stockQty: true } } } } },
    });
    if (!guest) return;
    if (guest.items.length > 0) {
      const userCartId = await this.getOrCreateCartId({ userId });
      await this.prisma.$transaction(async (tx) => {
        for (const item of guest.items) {
          const existing = await tx.cartItem.findUnique({
            where: { cartId_variantId: { cartId: userCartId, variantId: item.variantId } },
          });
          const quantity = capQuantity((existing?.quantity ?? 0) + item.quantity, item.variant.stockQty);
          if (quantity === 0) continue;
          await tx.cartItem.upsert({
            where: { cartId_variantId: { cartId: userCartId, variantId: item.variantId } },
            create: { cartId: userCartId, variantId: item.variantId, quantity },
            update: { quantity },
          });
        }
      });
    }
    await this.prisma.cart.delete({ where: { id: guest.id } });
  }

  async view(cartId: string | null): Promise<CartDto> {
    if (!cartId) return EMPTY_CART;
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      include: lineInclude,
      orderBy: { createdAt: 'asc' },
    });

    const lines = items.map((item): CartLineDto => {
      const { variant } = item;
      const { product } = variant;
      const available = variant.isActive && product.status === 'active' && variant.stockQty > 0;
      return {
        id: item.id,
        variantId: variant.id,
        productId: product.id,
        slug: product.slug,
        name: product.name,
        variantLabel: variantLabel(variant.options),
        imageUrl: product.images[0]?.url ?? null,
        unitPrice: variant.price,
        compareAtPrice: variant.compareAtPrice,
        quantity: item.quantity,
        lineTotal: variant.price * item.quantity,
        stockQty: variant.stockQty,
        freeDelivery: product.freeDelivery,
        issue: !available ? 'unavailable' : item.quantity > variant.stockQty ? 'insufficient_stock' : null,
      };
    });

    const orderable = lines.filter((line) => line.issue === null);
    return {
      items: lines,
      itemCount: lines.reduce((n, line) => n + line.quantity, 0),
      subtotal: orderable.reduce((sum, line) => sum + line.lineTotal, 0),
    };
  }

  private async orderableVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true, name: true } } },
    });
    if (!variant || !variant.isActive || variant.product.status !== 'active') {
      throw notFound('This product is no longer available.');
    }
    if (variant.stockQty <= 0) throw conflict('OUT_OF_STOCK', `${variant.product.name} is out of stock.`);
    return variant;
  }

  /** Adds to the line (or creates it), capped at stock. */
  async addItem(cartId: string, variantId: string, quantity: number) {
    const variant = await this.orderableVariant(variantId);
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    const next = capQuantity((existing?.quantity ?? 0) + quantity, variant.stockQty);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity: next },
      update: { quantity: next },
    });
    await this.touch(cartId);
  }

  async updateItem(cartId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cartId } });
    if (!item) throw notFound('That item is not in your cart.');
    const variant = await this.orderableVariant(item.variantId);
    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: capQuantity(quantity, variant.stockQty) },
    });
    await this.touch(cartId);
  }

  async removeItem(cartId: string, itemId: string) {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    if (count === 0) throw notFound('That item is not in your cart.');
    await this.touch(cartId);
  }

  private touch(cartId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  }
}
