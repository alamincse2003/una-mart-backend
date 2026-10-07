// Same rule as the storefront's lib/pricing.ts: the zone fee is waived when
// every item in the order has free delivery.
export function deliveryFee(zoneFee: number, items: { freeDelivery: boolean }[]): number {
  return items.length > 0 && items.every((item) => item.freeDelivery) ? 0 : zoneFee;
}
