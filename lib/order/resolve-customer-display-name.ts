/**
 * Resolves a customer's display name using the canonical inbox fallback order:
 *   displayNameOverride → company → displayName (Shopify) → email → fallback
 */
export function resolveCustomerDisplayName(
  customer: {
    displayNameOverride?: string | null;
    company?: string | null;
    displayName?: string | null;
    email?: string | null;
  } | null | undefined,
  fallback = 'Unknown',
): string {
  if (!customer) return fallback;
  return (
    customer.displayNameOverride?.trim() ||
    customer.company?.trim() ||
    customer.displayName?.trim() ||
    customer.email?.trim() ||
    fallback
  );
}
