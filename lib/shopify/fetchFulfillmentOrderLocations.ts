import type { AdminApiClient } from '@shopify/admin-api-client';

const FULFILLMENT_ORDER_LOCATIONS_QUERY = `
  query GetFulfillmentOrderLocations($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 20) {
        nodes {
          assignedLocation {
            location { id }
          }
          lineItems(first: 250) {
            nodes {
              lineItem { id }
            }
          }
        }
      }
    }
  }
`;

type FulfillmentOrderLocationsData = {
  order: {
    fulfillmentOrders: {
      nodes: Array<{
        assignedLocation: {
          location: { id: string } | null;
        } | null;
        lineItems: {
          nodes: Array<{
            lineItem: { id: string };
          }>;
        };
      }>;
    };
  } | null;
};

/**
 * Returns a map of Shopify LineItem GID → Shopify Location GID,
 * derived from the order's FulfillmentOrders.assignedLocation.
 * Line items without an assigned location are omitted from the map.
 */
export async function fetchFulfillmentOrderLocations(
  client: AdminApiClient,
  shopifyOrderGid: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  try {
    const { data, errors } = await client.request<FulfillmentOrderLocationsData>(
      FULFILLMENT_ORDER_LOCATIONS_QUERY,
      { variables: { orderId: shopifyOrderGid } },
    );

    if (errors || !data?.order) return result;

    for (const fo of data.order.fulfillmentOrders.nodes) {
      const locationId = fo.assignedLocation?.location?.id;
      if (!locationId) continue;
      for (const { lineItem } of fo.lineItems.nodes) {
        result.set(lineItem.id, locationId);
      }
    }
  } catch {
    // Non-fatal: location data is best-effort; sync continues without it
  }

  return result;
}
