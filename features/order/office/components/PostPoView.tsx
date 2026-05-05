import { Badge } from '@/components/ui/badge';
import { PoTable } from './PoTable';
import type { PostViewData } from '../types';
import type { EditPoFields, EditPoResult } from './MetaPanel';

type Props = {
  shopifyAdminStoreHandle?: string | null;
  viewData: PostViewData;
  selectedPoBlockId: string | null;
  lineItemsLoading?: boolean;
  onRetryLineItems?: () => void;
  onEditPo?: (
    poId: string,
    fields: EditPoFields,
  ) => Promise<EditPoResult>;
  /** Inbox customer key segment for split PO # defaults when order snapshot omits account code. */
  inboxCustomerPoSegment?: string;
};

export function PostPoView({
  shopifyAdminStoreHandle,
  viewData,
  selectedPoBlockId,
  lineItemsLoading,
  onRetryLineItems,
  onEditPo,
  inboxCustomerPoSegment,
}: Props) {
  const pos = viewData.purchaseOrders;
  const hasMulti = pos.length > 1;

  const visiblePos = hasMulti
    ? pos.filter((po) => po.id === (selectedPoBlockId ?? pos[0].id))
    : pos;

  return (
    <div>
      {(viewData.label || viewData.extraLabel) && (
        <div className="flex items-center gap-1.5 mb-2.5">
          {viewData.label && (
            <Badge variant="blue" className="rounded px-1.5 text-[10px]">
              {viewData.label}
            </Badge>
          )}
          {viewData.extraLabel && (
            <span className="text-[10px] text-muted-foreground">
              {viewData.extraLabel}
            </span>
          )}
        </div>
      )}
      {visiblePos.map((po) => (
        <PoTable
          key={po.id}
          shopifyAdminStoreHandle={shopifyAdminStoreHandle}
          purchaseOrder={po}
          lineItemsLoading={lineItemsLoading}
          onRetryLineItems={onRetryLineItems}
          onEditPo={onEditPo}
          inboxCustomerPoSegment={inboxCustomerPoSegment}
        />
      ))}
    </div>
  );
}
