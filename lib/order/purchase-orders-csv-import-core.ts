/**
 * Shared Shopify Auto PO CSV → DB import (used by POST /api/order/purchase-orders/import-csv).
 * Supports AbortSignal + progress callbacks for streaming UI.
 */

import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { parse as parseDf, isValid } from 'date-fns';
import { prisma } from '@/lib/core/prisma';
import { shippingBillingPayloadFromShopifyExportRow } from '@/lib/order/shopify-po-export-csv-address';
import { looseContactEmailsFromRaw } from '@/lib/order/supplier-order-channel';
import { loadVariantOfficeNotesMap } from '@/lib/order/shopify-variant-office-note';

/** Per-PO interactive tx: default 5s is too small for large line lists + relation writes. */
const PO_CSV_IMPORT_TX = { maxWait: 20_000, timeout: 120_000 } as const;

export type CsvRow = Record<string, string>;

export type PoCsvImportProgress =
  | { phase: 'parsed'; totalRows: number; totalPo: number }
  | { phase: 'shopify_lookup'; shopifyOrderCount: number }
  | { phase: 'import_po'; done: number; total: number; legacyExternalId: number };

export type PoCsvImportResult = {
  ok: true;
  totalCsvRows: number;
  purchaseOrders: number;
  created: number;
  updated: number;
  aborted: boolean;
};

function emptyToNull(s: string | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function yn(s: string | undefined): boolean {
  return s?.trim().toLowerCase() === 'yes';
}

function parseMoney(raw: string | undefined): Prisma.Decimal | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^[−-]/, '-');
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  return new Prisma.Decimal(n);
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number.parseInt(raw.replace(/,/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

function parseExportDate(s: string | undefined): Date | null {
  const t = s?.trim();
  if (!t) return null;
  for (const fmt of ['MMMM dd, yyyy', 'MMMM d, yyyy']) {
    const d = parseDf(t, fmt, new Date());
    if (isValid(d)) return d;
  }
  return null;
}

function parseExportDateTime(s: string | undefined): Date | null {
  const t = s?.trim();
  if (!t) return null;
  for (const fmt of [
    'MMMM dd, yyyy HH:mm',
    'MMMM d, yyyy HH:mm',
    'MMMM dd, yyyy h:mm a',
    'MMMM d, yyyy h:mm a',
  ]) {
    const d = parseDf(t, fmt, new Date());
    if (isValid(d)) return d;
  }
  return null;
}

function collectShopifyOrderNames(group: CsvRow[]): string[] {
  const names = new Set<string>();
  for (const row of group) {
    const raw = row['Shopify Order #']?.trim();
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const name = part.trim();
      if (name && name !== '(unknown)') names.add(name);
    }
  }
  return [...names];
}

function linePayload(row: CsvRow, sequence: number) {
  return {
    legacyLineExternalId: parseIntOrNull(row['Product ID']),
    sequence,
    quantity: parseIntOrNull(row['Product Quantity']) ?? 0,
    quantityReceived: parseIntOrNull(row['Product Received']) ?? 0,
    supplierRef: emptyToNull(row['Product Supplier ref']),
    taxPercent: parseMoney(row['Product Tax percent']),
    sku: emptyToNull(row['Product SKU']),
    variantTitle: emptyToNull(row['Product Variant title']),
    productTitle: emptyToNull(row['Product title']),
    shopifyInventoryItemGid: emptyToNull(row['Product Shopify InventoryItemID']),
    shopifyVariantGid: emptyToNull(row['Product Shopify VariantID']),
    shopifyProductGid: emptyToNull(row['Product Shopify ProductID']),
    isCustom: yn(row['Product Is custom']),
    itemPrice: parseMoney(row['Product Item price']),
    lineSubtotalPrice: parseMoney(row['Product Subtotal price']),
    lineTotalTaxPrice: parseMoney(row['Product Total tax price']),
    productProperties: emptyToNull(row['Product Properties']),
  };
}

export function parsePurchaseOrdersCsvText(buf: string): CsvRow[] {
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
  }) as CsvRow[];
}

export type RunPurchaseOrdersCsvImportOptions = {
  rows: CsvRow[];
  signal?: AbortSignal;
  onProgress?: (p: PoCsvImportProgress) => void | Promise<void>;
};

export async function runPurchaseOrdersCsvImport(
  options: RunPurchaseOrdersCsvImportOptions,
): Promise<PoCsvImportResult> {
  const { rows, signal, onProgress } = options;

  const byPo = new Map<number, CsvRow[]>();
  for (const row of rows) {
    const id = parseIntOrNull(row['ID']);
    if (id === null) continue;
    const list = byPo.get(id) ?? [];
    list.push(row);
    byPo.set(id, list);
  }

  await onProgress?.({
    phase: 'parsed',
    totalRows: rows.length,
    totalPo: byPo.size,
  });

  if (signal?.aborted) {
    return {
      ok: true,
      totalCsvRows: rows.length,
      purchaseOrders: byPo.size,
      created: 0,
      updated: 0,
      aborted: true,
    };
  }

  const poNumberCounts = new Map<string, number>();
  const poIdToNumber = new Map<number, string>();
  for (const [legacyId, group] of byPo) {
    const rawPo = group[0]['PO number']?.trim() ?? String(legacyId);
    const count = (poNumberCounts.get(rawPo) ?? 0) + 1;
    poNumberCounts.set(rawPo, count);
    poIdToNumber.set(legacyId, count > 1 ? `${rawPo} (${count})` : rawPo);
  }

  const allShopifyOrders = await prisma.shopifyOrder.findMany({
    select: { id: true, name: true, displayFulfillmentStatus: true },
  });

  await onProgress?.({
    phase: 'shopify_lookup',
    shopifyOrderCount: allShopifyOrders.length,
  });

  if (signal?.aborted) {
    return {
      ok: true,
      totalCsvRows: rows.length,
      purchaseOrders: byPo.size,
      created: 0,
      updated: 0,
      aborted: true,
    };
  }

  type SoRef = { id: string; fulfillStatus: string | null };
  const soByName = new Map<string, SoRef>();
  for (const so of allShopifyOrders) {
    const ref: SoRef = { id: so.id, fulfillStatus: so.displayFulfillmentStatus };
    soByName.set(so.name, ref);
    const stripped = so.name.replace(/^#/, '');
    if (!soByName.has(stripped)) soByName.set(stripped, ref);
  }

  const supplierCache = new Map<string, string>();
  async function resolveSupplier(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    company: string | null,
    contactName: string | null,
    supplierContactEmail: string | null,
  ): Promise<string> {
    const name = company?.trim() || '(unknown supplier)';
    const key = name.toLowerCase();
    const cached = supplierCache.get(key);
    if (cached) return cached;
    const supplier = await tx.supplier.upsert({
      where: { shopifyVendorName: name },
      create: {
        company: name,
        shopifyVendorName: name,
        contactName,
        contactEmails: looseContactEmailsFromRaw(supplierContactEmail),
      },
      update: {},
    });
    supplierCache.set(key, supplier.id);
    return supplier.id;
  }

  let created = 0;
  let updated = 0;
  const totalPo = byPo.size;
  let donePo = 0;

  const entries = [...byPo.entries()];

  for (const [legacyId, group] of entries) {
    if (signal?.aborted) {
      return {
        ok: true,
        totalCsvRows: rows.length,
        purchaseOrders: byPo.size,
        created,
        updated,
        aborted: true,
      };
    }

    await onProgress?.({
      phase: 'import_po',
      done: donePo,
      total: totalPo,
      legacyExternalId: legacyId,
    });

    const first = group[0];
    const poNumber =
      poIdToNumber.get(legacyId) ?? first['PO number']?.trim() ?? String(legacyId);
    const supplierCompany = emptyToNull(first['Supplier company']);
    const supplierContactName = emptyToNull(first['Supplier contact name']);
    const supplierContactEmail = emptyToNull(first['Supplier contact email']);

    await prisma.$transaction(
      async (tx) => {
      const supplierId = await resolveSupplier(
        tx,
        supplierCompany,
        supplierContactName,
        supplierContactEmail,
      );

      const orderNames = collectShopifyOrderNames(group);
      const matchedRefs: SoRef[] = [];
      for (const name of orderNames) {
        const ref = soByName.get(name);
        if (ref) matchedRefs.push(ref);
      }

      const fulfilledCount = matchedRefs.filter((r) => r.fulfillStatus === 'FULFILLED').length;
      const total = matchedRefs.length;
      const allFulfilled = total > 0 && fulfilledCount === total;
      const completedAt = parseExportDateTime(first['Completed at']);
      let status: string;
      if (completedAt && allFulfilled) status = 'completed';
      else if (allFulfilled) status = 'fulfilled';
      else if (fulfilledCount > 0) status = 'partially_fulfilled';
      else status = 'unfulfilled';

      async function uniquePoNumberForRow(
        desired: string,
        excludePurchaseOrderId?: string,
      ): Promise<string> {
        const taken = await tx.purchaseOrder.findFirst({
          where: {
            poNumber: desired,
            ...(excludePurchaseOrderId
              ? { id: { not: excludePurchaseOrderId } }
              : {}),
          },
          select: { id: true },
        });
        return taken ? `${desired}-${legacyId}` : desired;
      }

      const headerData = {
        legacyExternalId: legacyId,
        poNumber,
        currency: first['Currency']?.trim() ?? 'USD',
        isAuto: yn(first['Is Auto']),
        displayTaxColumn: yn(first['Display tax column']),
        comment: emptyToNull(first['Comment']),
        authorizedBy: emptyToNull(first['Authorized by']),
        unitsOrdered: parseIntOrNull(first['Units Ordered']),
        dateCreated: parseExportDate(first['Date created']),
        expectedDate: parseExportDate(first['Expected date']),
        subtotalPrice: parseMoney(first['Subtotal price']),
        discount: parseMoney(first['Discount']),
        discountReason: emptyToNull(first['Discount reason']),
        shippingHandlingPrice: parseMoney(first['Shipping and handling price']),
        totalTaxPrice: parseMoney(first['Total tax price']),
        totalPrice: parseMoney(first['Total price']),
        sourceCreatedAt: parseExportDateTime(first['Created at']),
        sourceUpdatedAt: parseExportDateTime(first['Updated at']),
        completedAt,
        status,
        supplierId,
        ...shippingBillingPayloadFromShopifyExportRow(first),
      };

      const existing = await tx.purchaseOrder.findFirst({
        where: { legacyExternalId: legacyId },
        select: { id: true },
      });

      let poId: string;
      if (existing) {
        const finalPoNumber = await uniquePoNumberForRow(poNumber, existing.id);
        await tx.purchaseOrder.update({
          where: { id: existing.id },
          data: {
            ...headerData,
            poNumber: finalPoNumber,
            shopifyOrders:
              matchedRefs.length > 0
                ? { set: matchedRefs.map((r) => ({ id: r.id })) }
                : { set: [] },
          },
        });
        poId = existing.id;
        await tx.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: poId } });
        updated++;
      } else {
        const finalPoNumber = await uniquePoNumberForRow(poNumber);

        const po = await tx.purchaseOrder.create({
          data: {
            ...headerData,
            poNumber: finalPoNumber,
            shopifyOrders:
              matchedRefs.length > 0
                ? { connect: matchedRefs.map((r) => ({ id: r.id })) }
                : undefined,
          },
        });
        poId = po.id;
        created++;
      }

      const lines = group.map((r, seq) => ({
        ...linePayload(r, seq),
        purchaseOrderId: poId,
      }));
      const variantGids = lines
        .map((l) => l.shopifyVariantGid?.trim())
        .filter((g): g is string => Boolean(g));
      const noteByVariant = await loadVariantOfficeNotesMap(tx, variantGids);
      const linesWithNotes = lines.map((l) => {
        const vg = l.shopifyVariantGid?.trim() ?? null;
        const note = vg ? noteByVariant.get(vg) ?? null : null;
        return { ...l, note };
      });
      await tx.purchaseOrderLineItem.createMany({ data: linesWithNotes });
    },
      PO_CSV_IMPORT_TX,
    );

    donePo += 1;
    await onProgress?.({
      phase: 'import_po',
      done: donePo,
      total: totalPo,
      legacyExternalId: legacyId,
    });
  }

  return {
    ok: true,
    totalCsvRows: rows.length,
    purchaseOrders: byPo.size,
    created,
    updated,
    aborted: false,
  };
}
