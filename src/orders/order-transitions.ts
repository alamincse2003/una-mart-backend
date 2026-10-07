import type { OrderStatus, StockReason } from '../generated/prisma/client.js';

// The order lifecycle from SYSTEM_DESIGN.md ("Order lifecycle" diagram).
// OrdersService.transition() is the only code allowed to change
// Order.status, and it rejects any move not listed here.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: ['confirmed', 'cancelled'],
  pending_confirmation: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'delivery_failed'],
  delivery_failed: ['returned_to_warehouse'],
  delivered: [],
  returned_to_warehouse: [],
  cancelled: [],
};

/** "Customers may cancel only while pending_confirmation, awaiting_payment or confirmed." */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  'pending_confirmation',
  'awaiting_payment',
  'confirmed',
];

/** Statuses that put the order's stock back, and why. */
export const RESTOCK_ON: Partial<Record<OrderStatus, StockReason>> = {
  cancelled: 'cancel',
  returned_to_warehouse: 'return',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
