import { Injectable } from '@nestjs/common';
import type { Prisma, StockReason } from '../generated/prisma/client.js';
import { conflict, notFound } from '../common/app-error.js';

export interface StockLine {
  variantId: string;
  quantity: number;
  /** For a friendly OUT_OF_STOCK message. */
  label?: string;
}

export interface StockRef {
  refType: string;
  refId: string;
  actorId?: string | null;
}

// The ONLY code that changes ProductVariant.stockQty (ARCHITECTURE.md module
// boundaries). Every change also appends a StockMovement row, so "where did
// 5 units go?" always has an answer. Methods take the caller's transaction
// so stock moves commit or roll back together with the order.
@Injectable()
export class InventoryService {
  /**
   * Takes stock for an order. The conditional update is what prevents
   * overselling: if two checkouts race for the last unit, one updates 1 row
   * and the other updates 0 rows and fails — no read-then-write gap.
   */
  async decrement(tx: Prisma.TransactionClient, lines: StockLine[], ref: StockRef) {
    for (const line of lines) {
      const { count } = await tx.productVariant.updateMany({
        where: { id: line.variantId, isActive: true, stockQty: { gte: line.quantity } },
        data: { stockQty: { decrement: line.quantity } },
      });
      if (count === 0) {
        const variant = await tx.productVariant.findUnique({
          where: { id: line.variantId },
          select: { stockQty: true, isActive: true },
        });
        const left = variant?.isActive ? variant.stockQty : 0;
        const name = line.label ?? 'This item';
        throw conflict(
          'OUT_OF_STOCK',
          left > 0 ? `Only ${left} left of ${name}.` : `${name} is out of stock.`,
        );
      }
      await this.record(tx, line.variantId, -line.quantity, 'order', ref);
    }
  }

  /** Puts stock back (cancelled order, returned parcel, received return). */
  async restock(tx: Prisma.TransactionClient, lines: StockLine[], reason: StockReason, ref: StockRef) {
    for (const line of lines) {
      await tx.productVariant.update({
        where: { id: line.variantId },
        data: { stockQty: { increment: line.quantity } },
      });
      await this.record(tx, line.variantId, line.quantity, reason, ref);
    }
  }

  /**
   * Manual change by an admin (new delivery, stock count fix). Stock never
   * goes below zero — same conditional-update trick as decrement.
   */
  async adjust(
    tx: Prisma.TransactionClient,
    variantId: string,
    delta: number,
    reason: Extract<StockReason, 'restock' | 'adjustment'>,
    ref: StockRef,
  ): Promise<number> {
    const { count } = await tx.productVariant.updateMany({
      where: { id: variantId, ...(delta < 0 ? { stockQty: { gte: -delta } } : {}) },
      data: { stockQty: { increment: delta } },
    });
    if (count === 0) {
      const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { stockQty: true } });
      if (!variant) throw notFound('Variant not found');
      throw conflict('STOCK_NEGATIVE', `Only ${variant.stockQty} in stock; can't remove ${-delta}.`);
    }
    await this.record(tx, variantId, delta, reason, ref);
    const { stockQty } = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stockQty: true } });
    return stockQty;
  }

  private record(
    tx: Prisma.TransactionClient,
    variantId: string,
    delta: number,
    reason: StockReason,
    ref: StockRef,
  ) {
    return tx.stockMovement.create({
      data: { variantId, delta, reason, refType: ref.refType, refId: ref.refId, actorId: ref.actorId ?? null },
    });
  }
}
