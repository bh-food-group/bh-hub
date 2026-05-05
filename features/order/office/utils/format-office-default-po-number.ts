import type { LinkedShopifyOrder } from '../types/purchase-order';
import type { SidebarCustomerGroup, SupplierEntry } from '../types/sidebar';

/**
 * Customer segment for default PO #: **Office PO account code** when set; otherwise the
 * same field precedence as the inbox customer headline (Customer Settings “display” order):
 * override → company → Shopify display name → email → sidebar `name`.
 */
export function officeInboxCustomerPoSegment(
  group: Pick<
    SidebarCustomerGroup,
    | 'officePoAccountCode'
    | 'displayNameOverride'
    | 'company'
    | 'customerDisplayName'
    | 'email'
    | 'name'
  >,
): string {
  const code = group.officePoAccountCode?.trim();
  if (code) return code;
  const o = group.displayNameOverride?.trim();
  if (o) return o;
  const c = group.company?.trim();
  if (c) return c;
  const d = group.customerDisplayName?.trim();
  if (d) return d;
  const e = group.email?.trim();
  if (e) return e;
  return group.name?.trim() || '';
}

/**
 * Supplier segment: **Office PO supplier code** when set; otherwise supplier `company`
 * (never supplier **group** name or slug).
 */
export function officeInboxSupplierPoSegment(
  entry: Pick<SupplierEntry, 'officePoSupplierCode' | 'supplierCompany'>,
): string {
  return (
    entry.officePoSupplierCode?.trim() || entry.supplierCompany?.trim() || ''
  ).trim();
}

/**
 * Customer segment for split / internal PO # when the sidebar row is under a known customer group.
 * Tries each `::` segment of the key against `customerGroups.id` (works for `cust::supplier` and `supplier::cust`).
 */
export function inboxCustomerSegmentForSidebarKey(
  activeKey: string,
  customerGroups: readonly SidebarCustomerGroup[],
): string {
  const parts = activeKey.split('::').filter((s) => s.length > 0);
  for (const id of parts) {
    const g = customerGroups.find((c) => c.id === id);
    if (g) return officeInboxCustomerPoSegment(g);
  }
  return '';
}

/**
 * Customer headline beside a linked order badge — same precedence as sidebar customer
 * group label (alias before Shopify display name / email).
 */
export function linkedShopifyOrderCustomerHeadline(
  o: Pick<
    LinkedShopifyOrder,
    | 'displayNameOverride'
    | 'customerCompany'
    | 'customerDisplayName'
    | 'customerEmail'
    | 'customerName'
  >,
): string {
  const alias = o.displayNameOverride?.trim();
  if (alias) return alias;
  const c = o.customerCompany?.trim();
  if (c) return c;
  const d = o.customerDisplayName?.trim();
  if (d) return d;
  const e = o.customerEmail?.trim();
  if (e) return e;
  return o.customerName?.trim() || '';
}

/** PO # middle segment from a linked order’s customer — matches {@link officeInboxCustomerPoSegment}. */
export function internalHubPoSegmentFromLinkedCustomer(
  o: Pick<
    LinkedShopifyOrder,
    | 'officePoAccountCode'
    | 'displayNameOverride'
    | 'customerCompany'
    | 'customerDisplayName'
    | 'customerEmail'
    | 'customerName'
  >,
): string {
  const code = o.officePoAccountCode?.trim();
  if (code) return code;
  const alias = o.displayNameOverride?.trim();
  if (alias) return alias;
  const comp = o.customerCompany?.trim();
  if (comp) return comp;
  const d = o.customerDisplayName?.trim();
  if (d) return d;
  const e = o.customerEmail?.trim();
  if (e) return e;
  return o.customerName?.trim() || '';
}

/**
 * Inbox default PO number: `{Shopify order #} {주문자} - {공급사}` (e.g. `6107 MA - Millda`).
 * Pass segments from {@link officeInboxCustomerPoSegment} / {@link officeInboxSupplierPoSegment}.
 */
export function formatOfficeDefaultPoNumber(input: {
  shopifyOrderNumber: string;
  customerSegment: string;
  supplierSegment: string;
}): string {
  const orderNum = input.shopifyOrderNumber.replace(/^#/, '').trim();
  const c = input.customerSegment.trim();
  const s = input.supplierSegment.trim();
  if (!c && !s) return orderNum;
  if (!c) return `${orderNum} - ${s}`;
  if (!s) return `${orderNum} ${c}`;
  return `${orderNum} ${c} - ${s}`;
}

/**
 * Hub-only / internal PO # suggestion, e.g. `IN6102 MA - Millda Foods (Internal)`.
 * Does not hit Shopify — display and hub DB only.
 */
export function formatInternalHubPoNumber(input: {
  shopifyOrderNumberDigits: string;
  customerCode: string;
  supplierDisplayName: string;
}): string {
  const raw = input.shopifyOrderNumberDigits.replace(/\D/g, '');
  const n = raw.length > 0 ? raw : '0';
  const code = (input.customerCode.trim() || '?').replace(/\s+/g, ' ').trim();
  const s = (input.supplierDisplayName.trim() || 'Supplier')
    .replace(/\s+/g, ' ')
    .trim();
  return `IN${n} ${code} - ${s} (Internal)`;
}
