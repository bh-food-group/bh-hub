import { toVancouverYmd } from '@/features/order/office/utils/vancouver-datetime';

/** Vancouver calendar `YYYY-MM-DD` for when the Shopify order was placed (processedAt ?? shopifyCreatedAt). */
export function vancouverYmdFromShopifyOrderPlacement(order: {
  processedAt: Date | null;
  shopifyCreatedAt: Date | null;
}): string | null {
  const d = order.processedAt ?? order.shopifyCreatedAt;
  if (!d) return null;
  return toVancouverYmd(d);
}

/**
 * Minimum allowed PO **expected delivery** date (Vancouver `YYYY-MM-DD`): must be on or after
 * each linked order’s placement day ⇒ the latest placement day among linked orders.
 */
export function minExpectedDateYmdFromShopifyOrders(
  orders: {
    processedAt: Date | null;
    shopifyCreatedAt: Date | null;
    hubOnly?: boolean;
  }[],
): string | null {
  const ym = orders
    .filter((o) => !o.hubOnly)
    .map(vancouverYmdFromShopifyOrderPlacement)
    .filter((y): y is string => Boolean(y));
  if (ym.length === 0) return null;
  return ym.sort((a, b) => a.localeCompare(b)).at(-1)!;
}

export const EXPECTED_DATE_BEFORE_ORDER_CODE = 'EXPECTED_DATE_BEFORE_ORDER' as const;

export function expectedDateBeforeOrderMessage(): string {
  return '배송 예정일은 주문일(생성일) 이전으로 설정할 수 없습니다.';
}
