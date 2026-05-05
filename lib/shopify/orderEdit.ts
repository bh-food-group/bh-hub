/**
 * Shopify Admin GraphQL order edits: begin → mutations → commit.
 * Requires `write_order_edits`. Catalog variant price updates use `productVariantsBulkUpdate`
 * (`write_products`). See https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/edit-orders
 */

import { createAdminApiClient } from '@shopify/admin-api-client';
import { AppError } from '@/lib/core/errors';
import { getShopifyAdminEnv } from '@/lib/shopify/env';
import type { ShopifyAdminCredentials } from '@/types/shopify';

type GraphqlUserError = { field?: string[] | null; message: string };

function formatUserErrors(errors: GraphqlUserError[]): string {
  return errors.map((e) => e.message).join('; ');
}

function graphqlErrorsMessage(errors: unknown): string | null {
  if (!errors) return null;
  const list = Array.isArray(errors) ? errors : [errors];
  return list
    .map((e) =>
      e && typeof e === 'object' && 'message' in e ? String((e as { message?: string }).message) : String(e),
    )
    .join('; ');
}

function adminClient(creds: ShopifyAdminCredentials) {
  return createAdminApiClient({
    storeDomain: creds.shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    apiVersion: creds.apiVersion,
    accessToken: creds.accessToken,
  });
}

/** `gid://shopify/LineItem/123` → `gid://shopify/CalculatedLineItem/123` (Order edit API convention). */
export function shopifyLineItemGidToCalculatedLineItemGid(lineItemGid: string): string {
  const m = lineItemGid.match(/^gid:\/\/shopify\/LineItem\/(.+)$/);
  if (!m) {
    throw new AppError(
      `Invalid Shopify line item GID: ${lineItemGid}`,
      'INVALID_LINE_ITEM_GID',
      undefined,
      400,
      'Invalid line item reference.',
    );
  }
  return `gid://shopify/CalculatedLineItem/${m[1]}`;
}

export type OrderEditSetQuantityOp = {
  type: 'setQuantity';
  shopifyLineItemGid: string;
  quantity: number;
  restock?: boolean;
};

export type OrderEditSetUnitPriceOp = {
  type: 'setUnitPrice';
  shopifyLineItemGid: string;
  unitPrice: number;
};

export type OrderEditAddVariantOp = {
  type: 'addVariant';
  variantGid: string;
  quantity: number;
  allowDuplicates?: boolean;
  /** When set, adjusts the new line (discount or surcharge) so discounted unit matches this. */
  unitPriceOverride?: number;
};

export type OrderEditAddCustomItemOp = {
  type: 'addCustomItem';
  title: string;
  unitPrice: number;
  quantity: number;
  taxable?: boolean;
  requiresShipping?: boolean;
};

export type OrderEditOperation =
  | OrderEditSetQuantityOp
  | OrderEditSetUnitPriceOp
  | OrderEditAddVariantOp
  | OrderEditAddCustomItemOp;

export type VariantCatalogPriceUpdate = {
  productGid: string;
  variantGid: string;
  /** Unit price as decimal string (Shopify `Money` amount). */
  price: string;
};

type MoneyBagNode = {
  discountedUnitPriceSet?: {
    shopMoney?: { amount: string; currencyCode?: string } | null;
  } | null;
};

type CalculatedLineItemNode = MoneyBagNode & {
  id: string;
  quantity: number;
  title: string;
};

type BeginPayload = {
  orderEditBegin?: {
    calculatedOrder?: {
      id: string;
      lineItems: { edges: Array<{ node: CalculatedLineItemNode }> };
      originalOrder: {
        currencyCode: string;
        lineItems: { edges: Array<{ node: { id: string } }> };
      };
    } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

const ORDER_EDIT_BEGIN = `mutation OrderEditBegin($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder {
      id
      lineItems(first: 250) {
        edges {
          node {
            id
            quantity
            title
            discountedUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
      originalOrder {
        currencyCode
        lineItems(first: 250) {
          edges {
            node {
              id
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_EDIT_SET_QUANTITY = `mutation OrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!, $restock: Boolean) {
  orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: $restock) {
    calculatedOrder {
      id
      lineItems(first: 250) {
        edges {
          node {
            id
            quantity
            title
            discountedUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT = `mutation OrderEditAddLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
  orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
    calculatedOrder {
      id
      lineItems(first: 250) {
        edges {
          node {
            id
            quantity
            title
            discountedUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_EDIT_ADD_CUSTOM_ITEM = `mutation OrderEditAddCustomItem(
  $id: ID!
  $title: String!
  $quantity: Int!
  $price: MoneyInput!
  $taxable: Boolean
  $requiresShipping: Boolean
) {
  orderEditAddCustomItem(
    id: $id
    title: $title
    quantity: $quantity
    price: $price
    taxable: $taxable
    requiresShipping: $requiresShipping
  ) {
    calculatedOrder {
      id
      lineItems(first: 250) {
        edges {
          node {
            id
            quantity
            title
            discountedUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_EDIT_ADD_VARIANT = `mutation OrderEditAddVariant(
  $id: ID!
  $variantId: ID!
  $quantity: Int!
  $allowDuplicates: Boolean
) {
  orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: $allowDuplicates) {
    calculatedLineItem {
      id
      quantity
      title
      discountedUnitPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
    calculatedOrder {
      id
      lineItems(first: 250) {
        edges {
          node {
            id
            quantity
            title
            discountedUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const ORDER_EDIT_COMMIT = `mutation OrderEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
  orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
    order {
      id
    }
    userErrors {
      field
      message
    }
  }
}`;

const PRODUCT_VARIANTS_BULK_UPDATE = `mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
    }
    userErrors {
      field
      message
    }
  }
}`;

function parseUnit(node: MoneyBagNode): number {
  const raw = node.discountedUnitPriceSet?.shopMoney?.amount;
  if (raw == null || raw === '') return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): string {
  return n.toFixed(2);
}

function lineItemMapFromBegin(
  originalEdges: Array<{ node: { id: string } }>,
  calculatedEdges: Array<{ node: { id: string } }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < originalEdges.length; i++) {
    const orig = originalEdges[i]?.node.id;
    const calc = calculatedEdges[i]?.node.id;
    if (orig && calc) map.set(orig, calc);
  }
  return map;
}

function resolveCalculatedLineItemId(
  lineItemGid: string,
  zipMap: Map<string, string>,
): string {
  const fromZip = zipMap.get(lineItemGid);
  if (fromZip) return fromZip;
  return shopifyLineItemGidToCalculatedLineItemGid(lineItemGid);
}

function findLineInCalculatedOrder(
  calculatedEdges: Array<{ node: CalculatedLineItemNode }>,
  calculatedLineItemId: string,
): CalculatedLineItemNode | undefined {
  return calculatedEdges.find((e) => e.node.id === calculatedLineItemId)?.node;
}

type SetQtyPayload = {
  orderEditSetQuantity?: {
    calculatedOrder?: {
      id: string;
      lineItems: { edges: Array<{ node: CalculatedLineItemNode }> };
    } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

type DiscountPayload = {
  orderEditAddLineItemDiscount?: {
    calculatedOrder?: {
      id: string;
      lineItems: { edges: Array<{ node: CalculatedLineItemNode }> };
    } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

type CustomPayload = {
  orderEditAddCustomItem?: {
    calculatedOrder?: {
      id: string;
      lineItems: { edges: Array<{ node: CalculatedLineItemNode }> };
    } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

type AddVariantPayload = {
  orderEditAddVariant?: {
    calculatedLineItem?: CalculatedLineItemNode | null;
    calculatedOrder?: {
      id: string;
      lineItems: { edges: Array<{ node: CalculatedLineItemNode }> };
    } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

type CommitPayload = {
  orderEditCommit?: {
    order?: { id: string } | null;
    userErrors: GraphqlUserError[];
  } | null;
};

type BulkVariantPayload = {
  productVariantsBulkUpdate?: {
    userErrors: Array<{ field?: string[] | null; message: string }>;
  } | null;
};

export type ApplyOrderEditResult = {
  orderGid: string;
  calculatedOrderId: string;
};

/**
 * Apply staged order edits in Shopify, then commit. Mutations run in order.
 * Quantity changes run before unit-price adjustments so price math uses updated qty.
 */
export async function applyOrderEditAndCommit(
  creds: ShopifyAdminCredentials,
  orderGid: string,
  operations: OrderEditOperation[],
  options?: { notifyCustomer?: boolean; staffNote?: string | null },
): Promise<ApplyOrderEditResult> {
  if (operations.length === 0) {
    throw new AppError('No order edit operations', 'NO_OPERATIONS', undefined, 400, 'Nothing to save.');
  }

  const client = adminClient(creds);

  const { data: beginData, errors: beginErr } = await client.request<BeginPayload>(ORDER_EDIT_BEGIN, {
    variables: { id: orderGid },
  });
  const beginGraphQl = graphqlErrorsMessage(beginErr);
  if (beginGraphQl) {
    throw new AppError(
      `orderEditBegin failed: ${beginGraphQl}`,
      'SHOPIFY_GRAPHQL_ERROR',
      { orderGid },
      502,
      beginGraphQl,
    );
  }

  const begin = beginData?.orderEditBegin;
  const userErrBegin = begin?.userErrors ?? [];
  if (userErrBegin.length > 0) {
    const msg = formatUserErrors(userErrBegin);
    throw new AppError(
      `orderEditBegin: ${msg}`,
      'SHOPIFY_ORDER_EDIT',
      { orderGid, userErrors: userErrBegin },
      422,
      msg,
    );
  }

  const calculated = begin?.calculatedOrder;
  if (!calculated?.id || !calculated.originalOrder) {
    throw new AppError(
      'orderEditBegin returned no calculated order',
      'SHOPIFY_ORDER_EDIT',
      { orderGid },
      502,
      'Shopify did not start an order edit session.',
    );
  }

  const calculatedOrderId = calculated.id;
  const currencyCode = calculated.originalOrder.currencyCode;
  const origEdges = calculated.originalOrder.lineItems.edges;
  const zipMap = lineItemMapFromBegin(origEdges, calculated.lineItems.edges);

  let lastLineEdges = calculated.lineItems.edges;

  const qtyOps = operations.filter((o): o is OrderEditSetQuantityOp => o.type === 'setQuantity');
  const priceOps = operations.filter((o): o is OrderEditSetUnitPriceOp => o.type === 'setUnitPrice');
  const addVariantOps = operations.filter((o): o is OrderEditAddVariantOp => o.type === 'addVariant');
  const addCustomOps = operations.filter((o): o is OrderEditAddCustomItemOp => o.type === 'addCustomItem');

  for (const op of qtyOps) {
    const lineItemId = resolveCalculatedLineItemId(op.shopifyLineItemGid, zipMap);
    const { data, errors } = await client.request<SetQtyPayload>(ORDER_EDIT_SET_QUANTITY, {
      variables: {
        id: calculatedOrderId,
        lineItemId,
        quantity: op.quantity,
        restock: op.restock ?? false,
      },
    });
    const gqlMsg = graphqlErrorsMessage(errors);
    if (gqlMsg) {
      throw new AppError(
        `orderEditSetQuantity: ${gqlMsg}`,
        'SHOPIFY_GRAPHQL_ERROR',
        { orderGid },
        502,
        gqlMsg,
      );
    }
    const payload = data?.orderEditSetQuantity;
    const u = payload?.userErrors ?? [];
    if (u.length > 0) {
      const msg = formatUserErrors(u);
      throw new AppError(
        `orderEditSetQuantity: ${msg}`,
        'SHOPIFY_ORDER_EDIT',
        { shopifyLineItemGid: op.shopifyLineItemGid, userErrors: u },
        422,
        msg,
      );
    }
    if (payload?.calculatedOrder?.lineItems?.edges) {
      lastLineEdges = payload.calculatedOrder.lineItems.edges;
    }
  }

  const edgesByCalculatedId = () => {
    const m = new Map<string, CalculatedLineItemNode>();
    for (const e of lastLineEdges) m.set(e.node.id, e.node);
    return m;
  };

  for (const op of priceOps) {
    const lineItemId = resolveCalculatedLineItemId(op.shopifyLineItemGid, zipMap);
    const node =
      edgesByCalculatedId().get(lineItemId) ?? findLineInCalculatedOrder(lastLineEdges, lineItemId);
    if (!node) {
      throw new AppError(
        `Line item not found in calculated order: ${op.shopifyLineItemGid}`,
        'LINE_NOT_IN_EDIT_SESSION',
        undefined,
        400,
        'Could not update price for a removed or invalid line.',
      );
    }

    const qty = Math.max(0, node.quantity);
    if (qty <= 0) continue;
    const currentUnit = parseUnit(node);
    const target = op.unitPrice;
    const delta = target - currentUnit;
    if (Math.abs(delta) < 0.0001) continue;

    if (delta < 0) {
      const discountTotal = roundMoney(-delta * qty);
      const { data, errors } = await client.request<DiscountPayload>(ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT, {
        variables: {
          id: calculatedOrderId,
          lineItemId,
          discount: {
            description: 'Unit price adjustment',
            fixedValue: {
              amount: discountTotal,
              currencyCode,
            },
          },
        },
      });
      const gqlMsg = graphqlErrorsMessage(errors);
      if (gqlMsg) {
        throw new AppError(
          `orderEditAddLineItemDiscount: ${gqlMsg}`,
          'SHOPIFY_GRAPHQL_ERROR',
          { orderGid },
          502,
          gqlMsg,
        );
      }
      const u = data?.orderEditAddLineItemDiscount?.userErrors ?? [];
      if (u.length > 0) {
        const msg = formatUserErrors(u);
        throw new AppError(
          `orderEditAddLineItemDiscount: ${msg}`,
          'SHOPIFY_ORDER_EDIT',
          { shopifyLineItemGid: op.shopifyLineItemGid, userErrors: u },
          422,
          msg,
        );
      }
      if (data?.orderEditAddLineItemDiscount?.calculatedOrder?.lineItems?.edges) {
        lastLineEdges = data.orderEditAddLineItemDiscount.calculatedOrder.lineItems.edges;
      }
    } else {
      const surchargeUnit = roundMoney(delta);
      const { data, errors } = await client.request<CustomPayload>(ORDER_EDIT_ADD_CUSTOM_ITEM, {
        variables: {
          id: calculatedOrderId,
          title: `Price adjustment — ${node.title}`,
          quantity: qty,
          price: { amount: surchargeUnit, currencyCode },
          taxable: true,
          requiresShipping: false,
        },
      });
      const gqlMsg = graphqlErrorsMessage(errors);
      if (gqlMsg) {
        throw new AppError(
          `orderEditAddCustomItem (price adjustment): ${gqlMsg}`,
          'SHOPIFY_GRAPHQL_ERROR',
          { orderGid },
          502,
          gqlMsg,
        );
      }
      const u = data?.orderEditAddCustomItem?.userErrors ?? [];
      if (u.length > 0) {
        const msg = formatUserErrors(u);
        throw new AppError(
          `orderEditAddCustomItem: ${msg}`,
          'SHOPIFY_ORDER_EDIT',
          { userErrors: u },
          422,
          msg,
        );
      }
      if (data?.orderEditAddCustomItem?.calculatedOrder?.lineItems?.edges) {
        lastLineEdges = data.orderEditAddCustomItem.calculatedOrder.lineItems.edges;
      }
    }
  }

  for (const op of addVariantOps) {
    const { data, errors } = await client.request<AddVariantPayload>(ORDER_EDIT_ADD_VARIANT, {
      variables: {
        id: calculatedOrderId,
        variantId: op.variantGid,
        quantity: op.quantity,
        allowDuplicates: op.allowDuplicates ?? true,
      },
    });
    const gqlMsg = graphqlErrorsMessage(errors);
    if (gqlMsg) {
      throw new AppError(
        `orderEditAddVariant: ${gqlMsg}`,
        'SHOPIFY_GRAPHQL_ERROR',
        { orderGid },
        502,
        gqlMsg,
      );
    }
    const u = data?.orderEditAddVariant?.userErrors ?? [];
    if (u.length > 0) {
      const msg = formatUserErrors(u);
      throw new AppError(`orderEditAddVariant: ${msg}`, 'SHOPIFY_ORDER_EDIT', { userErrors: u }, 422, msg);
    }
    if (data?.orderEditAddVariant?.calculatedOrder?.lineItems?.edges) {
      lastLineEdges = data.orderEditAddVariant.calculatedOrder.lineItems.edges;
    }

    const edgesAfterAdd = data?.orderEditAddVariant?.calculatedOrder?.lineItems?.edges;
    const cliFromMutation = data?.orderEditAddVariant?.calculatedLineItem ?? null;
    const cliFallback =
      edgesAfterAdd && edgesAfterAdd.length > 0
        ? edgesAfterAdd[edgesAfterAdd.length - 1]?.node ?? null
        : null;
    const cli = cliFromMutation ?? cliFallback;

    if (op.unitPriceOverride != null && cli) {
      const currentUnit = parseUnit(cli);
      const target = op.unitPriceOverride;
      const delta = target - currentUnit;
      const q = Math.max(1, cli.quantity);
      if (Math.abs(delta) < 0.0001) continue;

      if (delta < 0) {
        const discountTotal = roundMoney(-delta * q);
        const { data: d2, errors: e2 } = await client.request<DiscountPayload>(
          ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT,
          {
            variables: {
              id: calculatedOrderId,
              lineItemId: cli.id,
              discount: {
                description: 'Catalog line price override',
                fixedValue: { amount: discountTotal, currencyCode },
              },
            },
          },
        );
        const g2 = graphqlErrorsMessage(e2);
        if (g2) {
          throw new AppError(
            `orderEditAddLineItemDiscount (new variant): ${g2}`,
            'SHOPIFY_GRAPHQL_ERROR',
            { orderGid },
            502,
            g2,
          );
        }
        const u2 = d2?.orderEditAddLineItemDiscount?.userErrors ?? [];
        if (u2.length > 0) {
          const msg = formatUserErrors(u2);
          throw new AppError(
            `orderEditAddLineItemDiscount: ${msg}`,
            'SHOPIFY_ORDER_EDIT',
            { userErrors: u2 },
            422,
            msg,
          );
        }
        if (d2?.orderEditAddLineItemDiscount?.calculatedOrder?.lineItems?.edges) {
          lastLineEdges = d2.orderEditAddLineItemDiscount.calculatedOrder.lineItems.edges;
        }
      } else {
        const { data: d2, errors: e2 } = await client.request<CustomPayload>(ORDER_EDIT_ADD_CUSTOM_ITEM, {
          variables: {
            id: calculatedOrderId,
            title: `Price adjustment — ${cli.title}`,
            quantity: q,
            price: { amount: roundMoney(delta), currencyCode },
            taxable: true,
            requiresShipping: false,
          },
        });
        const g2 = graphqlErrorsMessage(e2);
        if (g2) {
          throw new AppError(
            `orderEditAddCustomItem (new variant): ${g2}`,
            'SHOPIFY_GRAPHQL_ERROR',
            { orderGid },
            502,
            g2,
          );
        }
        const u2 = d2?.orderEditAddCustomItem?.userErrors ?? [];
        if (u2.length > 0) {
          const msg = formatUserErrors(u2);
          throw new AppError(
            `orderEditAddCustomItem: ${msg}`,
            'SHOPIFY_ORDER_EDIT',
            { userErrors: u2 },
            422,
            msg,
          );
        }
        if (d2?.orderEditAddCustomItem?.calculatedOrder?.lineItems?.edges) {
          lastLineEdges = d2.orderEditAddCustomItem.calculatedOrder.lineItems.edges;
        }
      }
    }
  }

  for (const op of addCustomOps) {
    const { data, errors } = await client.request<CustomPayload>(ORDER_EDIT_ADD_CUSTOM_ITEM, {
      variables: {
        id: calculatedOrderId,
        title: op.title,
        quantity: op.quantity,
        price: { amount: roundMoney(op.unitPrice), currencyCode },
        taxable: op.taxable ?? true,
        requiresShipping: op.requiresShipping ?? false,
      },
    });
    const gqlMsg = graphqlErrorsMessage(errors);
    if (gqlMsg) {
      throw new AppError(
        `orderEditAddCustomItem: ${gqlMsg}`,
        'SHOPIFY_GRAPHQL_ERROR',
        { orderGid },
        502,
        gqlMsg,
      );
    }
    const u = data?.orderEditAddCustomItem?.userErrors ?? [];
    if (u.length > 0) {
      const msg = formatUserErrors(u);
      throw new AppError(`orderEditAddCustomItem: ${msg}`, 'SHOPIFY_ORDER_EDIT', { userErrors: u }, 422, msg);
    }
    if (data?.orderEditAddCustomItem?.calculatedOrder?.lineItems?.edges) {
      lastLineEdges = data.orderEditAddCustomItem.calculatedOrder.lineItems.edges;
    }
  }

  const { data: commitData, errors: commitErr } = await client.request<CommitPayload>(ORDER_EDIT_COMMIT, {
    variables: {
      id: calculatedOrderId,
      notifyCustomer: options?.notifyCustomer ?? false,
      staffNote: options?.staffNote ?? undefined,
    },
  });
  const cMsg = graphqlErrorsMessage(commitErr);
  if (cMsg) {
    throw new AppError(
      `orderEditCommit: ${cMsg}`,
      'SHOPIFY_GRAPHQL_ERROR',
      { orderGid },
      502,
      cMsg,
    );
  }
  const commit = commitData?.orderEditCommit;
  const cu = commit?.userErrors ?? [];
  if (cu.length > 0) {
    const msg = formatUserErrors(cu);
    throw new AppError(
      `orderEditCommit: ${msg}`,
      'SHOPIFY_ORDER_EDIT',
      { orderGid, userErrors: cu },
      422,
      msg,
    );
  }

  const committedOrderGid = commit?.order?.id ?? orderGid;
  return { orderGid: committedOrderGid, calculatedOrderId };
}

/** Update catalog variant prices (`productVariantsBulkUpdate`), grouped by product. */
export async function applyVariantCatalogPriceUpdates(
  creds: ShopifyAdminCredentials,
  updates: VariantCatalogPriceUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  const client = adminClient(creds);

  const byProduct = new Map<string, VariantCatalogPriceUpdate[]>();
  for (const u of updates) {
    const list = byProduct.get(u.productGid) ?? [];
    list.push(u);
    byProduct.set(u.productGid, list);
  }

  await Promise.all(
    [...byProduct.entries()].map(async ([productId, list]) => {
      const { data, errors } = await client.request<BulkVariantPayload>(PRODUCT_VARIANTS_BULK_UPDATE, {
        variables: {
          productId,
          variants: list.map((v) => ({
            id: v.variantGid,
            price: v.price,
          })),
        },
      });
      const gqlMsg = graphqlErrorsMessage(errors);
      if (gqlMsg) {
        throw new AppError(
          `productVariantsBulkUpdate: ${gqlMsg}`,
          'SHOPIFY_GRAPHQL_ERROR',
          { productId },
          502,
          gqlMsg,
        );
      }
      const uErr = data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (uErr.length > 0) {
        const msg = uErr.map((e) => e.message).join('; ');
        throw new AppError(
          `productVariantsBulkUpdate: ${msg}`,
          'SHOPIFY_VARIANT_UPDATE',
          { productId, userErrors: uErr },
          422,
          msg,
        );
      }
    }),
  );
}

export function applyOrderEditAndCommitFromEnv(
  orderGid: string,
  operations: OrderEditOperation[],
  options?: { notifyCustomer?: boolean; staffNote?: string | null },
) {
  return applyOrderEditAndCommit(getShopifyAdminEnv(), orderGid, operations, options);
}

export function applyVariantCatalogPriceUpdatesFromEnv(updates: VariantCatalogPriceUpdate[]) {
  return applyVariantCatalogPriceUpdates(getShopifyAdminEnv(), updates);
}

// ─── Order cancel ─────────────────────────────────────────────────────────────

const ORDER_CANCEL = `mutation OrderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!, $notifyCustomer: Boolean) {
  orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock, notifyCustomer: $notifyCustomer) {
    job {
      id
    }
    orderCancelUserErrors {
      field
      message
    }
  }
}`;

type OrderCancelPayload = {
  orderCancel?: {
    job?: { id: string } | null;
    orderCancelUserErrors: { field?: string[] | null; message: string }[];
  } | null;
};

/**
 * Cancels a Shopify order via the Admin GraphQL API.
 * No refund, no restock, no customer notification — purely internal.
 * Shopify runs the cancel asynchronously (returns a Job); throws on GraphQL-level errors.
 */
export async function cancelShopifyOrder(
  creds: ShopifyAdminCredentials,
  orderGid: string,
): Promise<void> {
  const client = adminClient(creds);
  const { data, errors } = await client.request<OrderCancelPayload>(ORDER_CANCEL, {
    variables: {
      orderId: orderGid,
      reason: 'OTHER',
      refund: false,
      restock: false,
      notifyCustomer: false,
    },
  });
  const gqlMsg = graphqlErrorsMessage(errors);
  if (gqlMsg) {
    throw new AppError(`orderCancel: ${gqlMsg}`, 'SHOPIFY_GRAPHQL_ERROR', { orderGid }, 502, gqlMsg);
  }
  const userErrors = data?.orderCancel?.orderCancelUserErrors ?? [];
  if (userErrors.length > 0) {
    const msg = formatUserErrors(userErrors);
    throw new AppError(`orderCancel: ${msg}`, 'SHOPIFY_ORDER_CANCEL', { orderGid, userErrors }, 422, msg);
  }
}

export function cancelShopifyOrderFromEnv(orderGid: string): Promise<void> {
  return cancelShopifyOrder(getShopifyAdminEnv(), orderGid);
}
