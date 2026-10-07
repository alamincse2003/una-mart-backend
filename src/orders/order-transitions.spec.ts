import type { OrderStatus } from '../generated/prisma/client.js';
import { deliveryFee } from '../shipping/delivery-fee.js';
import { capQuantity } from '../cart/cart.service.js';
import { CUSTOMER_CANCELLABLE, ORDER_TRANSITIONS, RESTOCK_ON, canTransition } from './order-transitions.js';

const ALL = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

describe('order lifecycle (SYSTEM_DESIGN.md diagram)', () => {
  it.each([
    ['pending_confirmation', 'confirmed'],
    ['pending_confirmation', 'cancelled'],
    ['awaiting_payment', 'confirmed'],
    ['awaiting_payment', 'cancelled'],
    ['confirmed', 'processing'],
    ['confirmed', 'cancelled'],
    ['processing', 'shipped'],
    ['processing', 'cancelled'],
    ['shipped', 'delivered'],
    ['shipped', 'delivery_failed'],
    ['delivery_failed', 'returned_to_warehouse'],
  ] as [OrderStatus, OrderStatus][])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['pending_confirmation', 'shipped'],
    ['shipped', 'cancelled'],
    ['delivered', 'cancelled'],
    ['cancelled', 'confirmed'],
    ['confirmed', 'pending_confirmation'],
  ] as [OrderStatus, OrderStatus][])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('has no way out of terminal states', () => {
    for (const terminal of ['delivered', 'cancelled', 'returned_to_warehouse'] as OrderStatus[]) {
      expect(ALL.some((to) => canTransition(terminal, to))).toBe(false);
    }
  });

  it('customers can cancel only before packing, and cancellations restock', () => {
    expect(CUSTOMER_CANCELLABLE).toEqual(['pending_confirmation', 'awaiting_payment', 'confirmed']);
    expect(RESTOCK_ON.cancelled).toBe('cancel');
    expect(RESTOCK_ON.returned_to_warehouse).toBe('return');
  });
});

describe('deliveryFee', () => {
  it('waives the fee only when every item has free delivery', () => {
    expect(deliveryFee(12000, [{ freeDelivery: true }, { freeDelivery: true }])).toBe(0);
    expect(deliveryFee(12000, [{ freeDelivery: true }, { freeDelivery: false }])).toBe(12000);
    expect(deliveryFee(12000, [])).toBe(12000);
  });
});

describe('capQuantity', () => {
  it('never exceeds stock or the per-line limit', () => {
    expect(capQuantity(3, 10)).toBe(3);
    expect(capQuantity(12, 10)).toBe(10);
    expect(capQuantity(80, 500)).toBe(50);
    expect(capQuantity(2, 0)).toBe(0);
  });
});
