import { Button } from '@/components/ui/button';
import { OrderBlock } from './OrderBlock';
import type { PreViewData, SeparatePoPayload, ShopifyOrderDraft } from '../types';

export type { SeparatePoPayload } from '../types';

type Props = {
  shopifyAdminStoreHandle?: string | null;
  viewData: PreViewData;
  /** Vancouver `YYYY-MM-DD` for Separate PO dialog + draft list context. */
  defaultExpectedYmd: string;
  inclusions?: Record<string, boolean[]>;
  onToggleInclude?: (orderId: string, itemIdx: number) => void;
  onSeparatePo?: (payload: SeparatePoPayload) => void;
  showArchived?: boolean;
  onUnarchiveShopifyOrder?: (shopifyOrderDbId: string) => void;
  /** When editing drafts under a PO tab, pass PO id for Shopify save + resync. */
  purchaseOrderId?: string | null;
  /** Selected supplier bucket id — scopes each order's "Add line" search to that supplier. */
  supplierId?: string | null;
  /** Per-line PO note drafts (same order/length as `order.lineItems`). */
  draftLineNotes?: Record<string, string[]>;
  onLineItemNoteChange?: (orderId: string, itemIdx: number, value: string) => void;
  /** When set with `onSeparatePo`, prefills editable PO number per order (Inbox default pattern). */
  defaultSeparatePoNumberForOrder?: (order: ShopifyOrderDraft) => string;
  /** Inbox: set every line’s “include in PO” on all listed orders. */
  onIncludeAllOrderLines?: () => void;
  onExcludeAllOrderLines?: () => void;
};

export function PrePoView({
  shopifyAdminStoreHandle,
  viewData,
  defaultExpectedYmd,
  inclusions,
  onToggleInclude,
  onSeparatePo,
  showArchived,
  onUnarchiveShopifyOrder,
  purchaseOrderId,
  supplierId,
  draftLineNotes,
  onLineItemNoteChange,
  defaultSeparatePoNumberForOrder,
  onIncludeAllOrderLines,
  onExcludeAllOrderLines,
}: Props) {
  const orders =
    showArchived === true
      ? viewData.shopifyOrderDrafts
      : viewData.shopifyOrderDrafts.filter((o) => !o.archivedAt);

  const lineCount = orders.reduce((n, o) => n + o.lineItems.length, 0);
  const showBulkInclude =
    onToggleInclude &&
    onIncludeAllOrderLines &&
    onExcludeAllOrderLines &&
    !showArchived &&
    orders.length > 0 &&
    lineCount > 0;

  return (
    <div>
      {showBulkInclude ? (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-border/80">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Include in PO
          </span>
          <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-7 text-[10px] rounded-[5px]"
              onClick={() => onIncludeAllOrderLines()}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-7 text-[10px] rounded-[5px]"
              onClick={() => onExcludeAllOrderLines()}
            >
              Clear all
            </Button>
          </div>
        </div>
      ) : null}
      {orders.map((order) => (
        <OrderBlock
          key={order.id}
          shopifyAdminStoreHandle={shopifyAdminStoreHandle}
          order={order}
          defaultExpectedYmd={defaultExpectedYmd}
          inclusions={inclusions?.[order.id]}
          onToggleInclude={onToggleInclude}
          onSeparatePo={showArchived ? undefined : onSeparatePo}
          defaultSeparatePoNumber={
            onSeparatePo && defaultSeparatePoNumberForOrder
              ? defaultSeparatePoNumberForOrder(order)
              : undefined
          }
          showArchived={showArchived}
          onUnarchiveShopifyOrder={onUnarchiveShopifyOrder}
          purchaseOrderId={purchaseOrderId ?? undefined}
          supplierId={supplierId ?? undefined}
          lineItemNotes={draftLineNotes?.[order.id]}
          onLineItemNoteChange={
            onLineItemNoteChange
              ? (idx, value) => onLineItemNoteChange(order.id, idx, value)
              : undefined
          }
        />
      ))}
    </div>
  );
}
