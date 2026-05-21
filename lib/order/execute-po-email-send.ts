import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/core/prisma';
import { sendPoEmail } from '@/lib/order/send-po-email';
import { getPoEmailOutboundSettings } from '@/lib/order/po-email-settings';
import type { PoPdfInput, KoreanFonts } from '@/features/order/office/utils/purchase-order-pdf';
import { buildPoPdfBuffer } from '@/features/order/office/utils/purchase-order-pdf';
import { mergeProductAndVariantTitle } from '@/features/order/office/types/purchase-order';
import { parseSupplierOrderChannelPayload } from '@/lib/order/supplier-order-channel';
import type { EmailOrderChannelPayload, SupplierEmailContact } from '@/lib/order/supplier-order-channel';

let _cachedFonts: KoreanFonts | undefined | null = null;

function loadKoreanFontsSync(): KoreanFonts | undefined {
  if (_cachedFonts !== null) return _cachedFonts;
  try {
    const dir = path.join(process.cwd(), 'public', 'fonts');
    _cachedFonts = {
      regular: fs.readFileSync(path.join(dir, 'NanumGothic-Regular.ttf')).toString('base64'),
      bold: fs.readFileSync(path.join(dir, 'NanumGothic-Bold.ttf')).toString('base64'),
    };
    return _cachedFonts;
  } catch {
    _cachedFonts = undefined;
    return undefined;
  }
}

type PoAddress = {
  name?: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

function toAddrLines(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const a = json as PoAddress;
  if (!a.address1?.trim()) return [];
  const line1 = [a.address1.trim(), a.address2?.trim()].filter(Boolean).join(', ');
  const cityLine = [a.city?.trim(), a.province?.trim(), a.postalCode?.trim()].filter(Boolean).join(' ');
  const country = a.country?.trim() || '';
  return [line1, cityLine, country].filter(Boolean);
}

function dateToYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Loads PO, sends outbound PO email to each supplier contact, updates `emailSentAt`.
 * Intended for `after()` / background execution — callers validate auth before enqueueing.
 */
export async function executePurchaseOrderOutboundEmailSend(
  purchaseOrderId: string,
): Promise<{ recipientCount: number }> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplier: true,
      lineItems: {
        orderBy: { sequence: 'asc' },
        include: { shopifyOrderLineItem: true },
      },
      shopifyOrders: {
        include: { customer: true },
      },
    },
  });

  if (!po) {
    throw new Error(`Purchase order not found: ${purchaseOrderId}`);
  }

  if (!po.supplier) {
    throw new Error('No supplier configured for this purchase order.');
  }
  const supplier = po.supplier;

  const channelPayload = parseSupplierOrderChannelPayload(
    (supplier.orderChannelType ?? 'email') as 'email' | 'order_link' | 'direct_instruction',
    supplier.orderChannelPayload,
  );

  let contacts: SupplierEmailContact[] = [];
  let supplierCcEmails: string[] = [];
  if (channelPayload.success && supplier.orderChannelType === 'email') {
    const ep = channelPayload.data as EmailOrderChannelPayload;
    contacts = ep.contacts;
    supplierCcEmails = ep.ccEmails;
  }

  if (contacts.length === 0 && supplier.contactEmails.length > 0) {
    contacts = supplier.contactEmails.map((email, i) => ({
      email,
      name: i === 0 ? (supplier.contactName ?? null) : null,
    }));
  }

  if (contacts.length === 0) {
    throw new Error('No email contacts configured for this supplier.');
  }

  const orderById = new Map(po.shopifyOrders.map((o) => [o.id, o]));
  const firstOrder = po.shopifyOrders[0];

  const linkedShopifyOrderNames = [
    ...new Set(po.shopifyOrders.map((o) => o.name.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const lineItems = po.lineItems.map((li) => {
    const soli = li.shopifyOrderLineItem;
    const srcOrder = soli ? orderById.get(soli.orderId) : undefined;
    const orderName = srcOrder?.name ?? firstOrder?.name ?? '—';
    const title = li.productTitle ?? '(untitled)';
    const description = mergeProductAndVariantTitle(title, li.variantTitle);
    const supplierRef = (li.supplierRef?.trim() || li.sku?.trim() || '—').slice(0, 40);
    return {
      shopifyOrderNumber: orderName,
      description,
      supplierRef,
      quantity: li.quantity,
      note: li.note?.trim() ?? '',
    };
  });

  const customerHeadline =
    po.shopifyOrders[0]?.customer?.company?.trim() ||
    po.shopifyOrders[0]?.customer?.displayName?.trim() ||
    null;

  const billingAddr = po.billingSameAsShipping
    ? po.shippingAddress
    : (po.billingAddress ?? po.shippingAddress);

  const shipAddrObj = po.shippingAddress as PoAddress | null;
  const billAddrObj = billingAddr as PoAddress | null;
  const pdfInput: PoPdfInput = {
    poNumber: po.poNumber,
    linkedShopifyOrderNames,
    poNote: po.comment?.trim() ? po.comment.trim() : null,
    orderedAt: null,
    dateCreated: dateToYmd(po.dateCreated),
    expectedDate: dateToYmd(po.expectedDate),
    shippingHeadline: shipAddrObj?.name?.trim() || customerHeadline,
    billingHeadline: billAddrObj?.name?.trim() || customerHeadline,
    billingAddressLines: toAddrLines(billingAddr),
    shippingAddressLines: toAddrLines(po.shippingAddress),
    supplierCompany: supplier.company,
    lineItems,
    discount: null,
    discountReason: null,
  };

  const outbound = await getPoEmailOutboundSettings(prisma);
  const pdfBuffer = buildPoPdfBuffer(pdfInput, loadKoreanFontsSync());
  const sentAt = new Date();

  await prisma.poEmailDelivery.deleteMany({ where: { purchaseOrderId } });

  const deliveryRecords = await Promise.all(
    contacts.map(async (contact) => {
      const token = crypto.randomUUID();
      await prisma.poEmailDelivery.create({
        data: {
          purchaseOrderId,
          recipientEmail: contact.email,
          recipientName: contact.name ?? null,
          trackingToken: token,
          sentAt,
        },
      });
      return { contact, token };
    }),
  );
  const deliveryTokens = deliveryRecords.map((r) => r.token);

  await sendPoEmail({
    to: contacts,
    supplierName: supplier.company,
    pdfInput,
    outbound,
    trackingToken: deliveryTokens[0],
    pdfBuffer,
    supplierCcEmails,
  });

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      emailSentAt: sentAt,
      emailTrackingToken: deliveryTokens[0] ?? null,
      emailOpenedAt: null,
      emailDeliveryWaivedAt: null,
    },
  });

  return { recipientCount: contacts.length };
}
