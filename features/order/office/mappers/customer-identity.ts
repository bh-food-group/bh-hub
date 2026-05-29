import type { CustomerAddress } from '../types';
import { resolveCustomerDisplayName } from '@/lib/order/resolve-customer-display-name';

export type CustomerIdentity = {
  customerId: string;
  name: string;
  email: string;
  company: string | null;
  customerDisplayName: string | null;
  displayNameOverride: string | null;
  officePoAccountCode: string | null;
  defaultShippingAddress: CustomerAddress | null;
  defaultBillingAddress: CustomerAddress | null;
  billingSameAsShipping: boolean;
};

export function resolveCustomerFields(customer: {
  displayNameOverride?: string | null;
  displayName?: string | null;
  email?: string | null;
  company?: string | null;
}): {
  name: string;
  company: string | null;
  customerDisplayName: string | null;
  displayNameOverride: string | null;
} {
  const override = customer.displayNameOverride?.trim() || null;
  const company = customer.company?.trim() || null;
  const shopifyDisplay = customer.displayName?.trim() || null;
  const name = resolveCustomerDisplayName(customer);
  return { name, company, customerDisplayName: shopifyDisplay, displayNameOverride: override };
}

export function extractCustomerAddresses(customer: {
  shippingAddress?: unknown;
  billingAddress?: unknown;
  billingSameAsShipping?: boolean;
}): {
  defaultShippingAddress: CustomerAddress | null;
  defaultBillingAddress: CustomerAddress | null;
  billingSameAsShipping: boolean;
} {
  const ship = customer.shippingAddress as CustomerAddress | null ?? null;
  const bill = customer.billingAddress as CustomerAddress | null ?? null;
  return {
    defaultShippingAddress: ship && ship.address1 ? ship : null,
    defaultBillingAddress: bill && bill.address1 ? bill : null,
    billingSameAsShipping: customer.billingSameAsShipping ?? true,
  };
}

export function identityFromCustomerRow(customer: {
  id: string;
  displayNameOverride?: string | null;
  displayName?: string | null;
  email?: string | null;
  company?: string | null;
  officePoAccountCode?: string | null;
  shippingAddress?: unknown;
  billingAddress?: unknown;
  billingSameAsShipping?: boolean;
}): CustomerIdentity {
  const { name, company, customerDisplayName, displayNameOverride } = resolveCustomerFields(customer);
  const addr = extractCustomerAddresses(customer);
  return {
    customerId: customer.id,
    name,
    email: customer.email ?? '',
    company,
    customerDisplayName,
    displayNameOverride,
    officePoAccountCode: customer.officePoAccountCode?.trim() || null,
    ...addr,
  };
}

export function identityFromEmail(email: string): CustomerIdentity {
  return {
    customerId: `email::${email}`,
    name: email,
    email,
    company: null,
    customerDisplayName: null,
    displayNameOverride: null,
    officePoAccountCode: null,
    defaultShippingAddress: null,
    defaultBillingAddress: null,
    billingSameAsShipping: true,
  };
}

/** Prefer real `ShopifyCustomer` row over `email::…` stubs; keep best PO account code. */
export function mergeCustomerIdentities(a: CustomerIdentity, b: CustomerIdentity): CustomerIdentity {
  const aEmail = a.customerId.startsWith('email::');
  const bEmail = b.customerId.startsWith('email::');
  if (aEmail && !bEmail) return b;
  if (!aEmail && bEmail) return a;
  const code = (b.officePoAccountCode?.trim() || a.officePoAccountCode?.trim() || null) ?? null;
  return { ...a, ...b, officePoAccountCode: code };
}
