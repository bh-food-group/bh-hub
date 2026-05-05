/**
 * Returns true when the Shopify GID is a hub-only custom order (not synced from Shopify).
 * Custom orders use the `custom::` prefix to distinguish them from real Shopify GIDs.
 */
export function isHubOnlyShopifyOrderGid(gid: string): boolean {
  return gid.startsWith('custom::');
}
