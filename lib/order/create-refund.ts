import { prisma } from '@/lib/core/prisma';
import { applyOrderEditAndCommitFromEnv } from '@/lib/shopify/orderEdit';

export interface RefundLineItemInput {
  purchaseOrderLineItemId?: string | null;
  shopifyOrderId: string;
  shopifyLineItemGid: string;
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  unitPrice?: number | null;
}

export interface CreateRefundParams {
  purchaseOrderId: string;
  lineItems: RefundLineItemInput[];
  reasonCategory: string;
  reasonSubcategory: string;
  reasonNotes?: string | null;
  createdById?: string | null;
}

export async function createRefundRecords(params: CreateRefundParams) {
  const { purchaseOrderId, lineItems, reasonCategory, reasonSubcategory, reasonNotes, createdById } = params;

  // Look up Shopify GIDs for all referenced orders
  const shopifyOrderIds = [...new Set(lineItems.map((li) => li.shopifyOrderId))];
  const shopifyOrders = await prisma.shopifyOrder.findMany({
    where: { id: { in: shopifyOrderIds } },
    select: { id: true, shopifyGid: true },
  });
  const gidMap = new Map(shopifyOrders.map((o) => [o.id, o.shopifyGid]));

  // Group by Shopify order GID (one orderEdit session per order)
  const byOrderGid = new Map<string, RefundLineItemInput[]>();
  for (const li of lineItems) {
    const gid = gidMap.get(li.shopifyOrderId);
    if (!gid) continue;
    const arr = byOrderGid.get(gid) ?? [];
    arr.push(li);
    byOrderGid.set(gid, arr);
  }

  // Apply orderEdit to each Shopify order
  for (const [orderGid, items] of byOrderGid) {
    await applyOrderEditAndCommitFromEnv(
      orderGid,
      items.map((li) => ({
        type: 'setQuantity' as const,
        shopifyLineItemGid: li.shopifyLineItemGid,
        quantity: 0,
        restock: true,
      })),
      { staffNote: `Refund — ${reasonCategory}: ${reasonSubcategory}${reasonNotes ? ` (${reasonNotes})` : ''}` },
    );
  }

  // Persist records
  const records = await prisma.refundReplacementRecord.createManyAndReturn({
    data: lineItems.map((li) => ({
      type: 'refund',
      reasonCategory,
      reasonSubcategory,
      reasonNotes: reasonNotes ?? null,
      purchaseOrderId,
      purchaseOrderLineItemId: li.purchaseOrderLineItemId ?? null,
      shopifyOrderId: li.shopifyOrderId,
      shopifyLineItemGid: li.shopifyLineItemGid,
      productTitle: li.productTitle,
      variantTitle: li.variantTitle ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity,
      unitPrice: li.unitPrice ?? null,
      createdById: createdById ?? null,
    })),
  });

  return records;
}
