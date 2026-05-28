export type FavoriteSupplier = {
  id: string;
  name: string;
  groupId: string | null;
};

export type SupplierGroupNav = {
  id: string;
  name: string;
};

export type LocationOrderLineItem = {
  id: string;
  sequence: number;
  productTitle: string | null;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  itemPrice: string | null;
  note: string | null;
};

export type LocationOrderPO = {
  id: string;
  poNumber: string;
  status: string;
  /** Earliest Shopify order processedAt among linked orders. */
  orderedAt: string | null;
  dateCreated: string | null;
  expectedDate: string | null;
  totalPrice: string | null;
  comment: string | null;
  lineItems: LocationOrderLineItem[];
  shopifyOrderNames: string[];
};

export type LocationOrderSupplierGroup = {
  supplierId: string | null;
  supplierName: string;
  purchaseOrders: LocationOrderPO[];
};
