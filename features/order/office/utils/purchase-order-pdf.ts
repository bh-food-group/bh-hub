import { jsPDF } from 'jspdf';
import { format, isValid, parseISO } from 'date-fns';
import { formatProductLabel, type OfficePurchaseOrderBlock, type PoAddress } from '../types';

export type KoreanFonts = { regular: string; bold: string }; // base64-encoded TTF

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

let _cachedFonts: KoreanFonts | null = null;

export async function loadPdfFonts(): Promise<KoreanFonts> {
  if (_cachedFonts) return _cachedFonts;
  const [regular, bold] = await Promise.all([
    fetch('/fonts/NanumGothic-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/NanumGothic-Bold.ttf').then((r) => r.arrayBuffer()),
  ]);
  _cachedFonts = { regular: arrayBufferToBase64(regular), bold: arrayBufferToBase64(bold) };
  return _cachedFonts;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_W = 215.9;
const PAGE_H = 279.4;
const MARGIN = 14;
const LH      = 4.8;   // baseline-to-baseline for body text
const FONT_H  = 2.2;   // visible text height (cap + descender) at 9 pt — replaces the trailing LH gap

// Row padding around text within each table cell
const ROW_TOP = 4.5;   // hairline → first text baseline
const ROW_BOT = 0.3;   // last text baseline → hairline

// Horizontal inset for the leftmost and rightmost table cells
const CELL_PAD_H = 2.5;

// Table column x-positions (Order no. | Item | Supplier Ref. | Qty | Note)
const X_ORDER = MARGIN + CELL_PAD_H; // 16.5
const W_ORDER_COL = 20;              // Shopify order name (#…)
const X_ITEM  = X_ORDER + W_ORDER_COL + 2;
const X_REF   = MARGIN + 86;         // Ref col start (item wraps to here)
const X_RIGHT = PAGE_W - MARGIN;      // 201.9

const W_ITEM  = X_REF - X_ITEM - 2;  // item description wrap width

/** Rightmost: line note (PO-specific; also shown in hub UI). */
const W_NOTE_COL = 28;
const X_NOTE_R = X_RIGHT - CELL_PAD_H;
// Qty sits just left of the note column
const X_QTY_R = X_NOTE_R - W_NOTE_COL - 2;

// Address section: Ship to + Bill to stacked on left; signature box on right
const W_ADDR_COL = 104;                               // text wrap width for address columns
const X_SIG_BOX  = MARGIN + W_ADDR_COL + 7;          // ~125 mm from left edge
const W_SIG_BOX  = PAGE_W - MARGIN - X_SIG_BOX;      // ~77 mm wide
const H_SIG_BOX  = 30;                               // fixed height; independent of address block

// Linked Shopify order names in the PO title band (right-aligned)
const ORDER_BAND_FONT_PT = 8;
const ORDER_BAND_LINE_MM = 3.25;                     // baseline step for ORDER_BAND_FONT_PT
/** Lowers 8pt baselines slightly so cap-heavy lines sit visually centered vs band mid. */
const ORDER_BAND_BASELINE_NUDGE_MM = 0.4;
/** 13pt bold title: baseline offset below band mid so caps read vertically centered. */
const TITLE_BAND_BASELINE_NUDGE_MM = 1.25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ymd2display(ymd: string | null): string | null {
  if (!ymd) return null;
  const day = ymd.trim().slice(0, 10);
  const d = parseISO(`${day}T12:00:00`);
  return isValid(d) ? format(d, 'MMMM d, yyyy (EEE)') : ymd.trim();
}

function countryLabel(code: string | undefined): string {
  const c = (code ?? '').trim().toUpperCase();
  if (c === 'CA' || c === 'CAN') return 'Canada';
  if (c === 'US' || c === 'USA') return 'United States';
  return code?.trim() || '';
}

function addrLines(addr: PoAddress | null | undefined): string[] {
  if (!addr?.address1?.trim()) return [];
  const line1    = [addr.address1.trim(), addr.address2?.trim()].filter(Boolean).join(', ');
  const cityLine = [addr.city?.trim(), addr.province?.trim(), addr.postalCode?.trim()]
    .filter(Boolean).join(' ');
  const country  = countryLabel(addr.country);
  return [line1, cityLine, country].filter(Boolean);
}

function makeEnsurePage(pageH: number) {
  return function ensurePage(doc: jsPDF, y: number, need: number): number {
    // Footer starts at pageH - MARGIN; leave a small gap above it.
    if (y + need > pageH - MARGIN - 4) {
      doc.addPage();
      return MARGIN;
    }
    return y;
  };
}

function drawSignatureBox(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  const mid = x + w / 2;

  // Outer border
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h, 'S');

  // Centre divider
  doc.setLineWidth(0.15);
  doc.line(mid, y, mid, y + h);

  // ── Left panel: DRIVER / OFFICE SIGNATURE ─────────────────────────────
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(130, 130, 130);
  doc.text('DRIVER / OFFICE', x + 3.5, y + 5);
  doc.text('SIGNATURE',       x + 3.5, y + 5 + 3.8);

  const lineY = y + h - 7.5;
  doc.setDrawColor(170, 170, 170);
  doc.setLineWidth(0.15);
  doc.line(x + 3.5, lineY, mid - 3.5, lineY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Signature', x + 3.5, lineY + 3.2);

  // ── Right panel: RECEIVED ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(130, 130, 130);
  doc.text('RECEIVED', mid + 3.5, y + 5);

  const rightLineY = lineY;
  doc.setDrawColor(170, 170, 170);
  doc.line(mid + 3.5, rightLineY, x + w - 3.5, rightLineY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Signature', mid + 3.5, rightLineY + 3.2);

  // Reset
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.1);
  doc.setTextColor(0, 0, 0);
}

/** Wrap note for PDF: explicit newlines + width; right column uses same line height as body. */
function wrapNoteLinesForPdf(doc: jsPDF, note: string, maxW: number): string[] {
  const t = note.trim();
  if (!t) return ['—'];
  const paragraphs = t.split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const p of paragraphs) {
    const chunk = p.trimEnd();
    if (chunk.length === 0) {
      out.push('');
      continue;
    }
    const wrapped = doc.splitTextToSize(chunk, maxW) as string[];
    for (const line of wrapped) out.push(line);
  }
  return out.length > 0 ? out : ['—'];
}

function rule(doc: jsPDF, y: number, rgb: [number, number, number] = [200, 200, 200]): void {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.1);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  doc.setDrawColor(0, 0, 0);
}

/** Single-line ship-to for page footer: customer name (if any) + address, truncated. */
function footerShipToOneLine(customerHeadline: string | null, lines: string[]): string {
  const addr = lines.map((s) => s.trim()).filter(Boolean).join(', ');
  const name = customerHeadline?.trim() ?? '';
  let merged: string;
  if (name && addr) merged = `${name}, ${addr}`;
  else if (name) merged = name;
  else if (addr) merged = addr;
  else merged = '';
  if (!merged) return '—';
  return merged.length > 90 ? `${merged.slice(0, 87)}...` : merged;
}

/**
 * Draws one address column (label + headline + address lines).
 * Returns the y-position after the last line of text.
 */
function drawAddrCol(
  doc: jsPDF,
  label: string,
  headline: string | null,
  lines: string[],
  x: number,
  y: number,
  maxW: number,
  ff: string,
): number {
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x, y);
  doc.setTextColor(0, 0, 0);
  y += LH * 0.85;

  doc.setFont(ff, 'normal');
  doc.setFontSize(9.5);

  if (headline?.trim()) {
    doc.setFont(ff, 'bold');
    const hl = doc.splitTextToSize(headline.trim(), maxW) as string[];
    for (const l of hl) { doc.text(l, x, y); y += LH; }
    doc.setFont(ff, 'normal');
  }

  if (lines.length === 0 && !headline?.trim()) {
    doc.text('—', x, y);
    y += LH;
  } else {
    for (const ln of lines) {
      const wrapped = doc.splitTextToSize(ln, maxW) as string[];
      for (const l of wrapped) { doc.text(l, x, y); y += LH; }
    }
  }

  return y;
}

// ─── Public input type ────────────────────────────────────────────────────────

export type PoPdfInput = {
  poNumber: string;
  /** Distinct Shopify order names (#…) linked to this PO; shown in title band. */
  linkedShopifyOrderNames: string[];
  /** Hub-only PO note (`purchase_orders.comment`); shown below title band when set. */
  poNote: string | null;
  /** Earliest Shopify order placement date (processedAt) among linked orders. */
  orderedAt: string | null;
  dateCreated: string | null;
  expectedDate: string | null;
  shippingHeadline: string | null;
  billingHeadline: string | null;
  billingAddressLines: string[];
  shippingAddressLines: string[];
  supplierCompany: string;
  lineItems: {
    /** Shopify display order number for this line’s source order. */
    shopifyOrderNumber: string;
    description: string;
    supplierRef: string;
    quantity: number;
    /** Right column on the PDF line table. */
    note: string;
  }[];
  /** PO-level discount amount; null when not set. */
  discount: number | null;
  discountReason: string | null;
};

// ─── PDF builder ──────────────────────────────────────────────────────────────

function buildDocCore(input: PoPdfInput, pageH: number, fonts?: KoreanFonts): { doc: jsPDF; finalY: number } {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const ff = fonts ? 'NanumGothic' : 'helvetica';
  if (fonts) {
    doc.addFileToVFS('NanumGothic-Regular.ttf', fonts.regular);
    doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
    doc.addFileToVFS('NanumGothic-Bold.ttf', fonts.bold);
    doc.addFont('NanumGothic-Bold.ttf', 'NanumGothic', 'bold');
  }
  doc.setFont(ff, 'normal');

  const ensurePage = makeEnsurePage(pageH);

  let y = MARGIN;

  // ── PO title band (TOP) ───────────────────────────────────────────────────
  const ordersStr = input.linkedShopifyOrderNames.length
    ? input.linkedShopifyOrderNames.join(', ')
    : '';
  doc.setFont(ff, 'normal');
  doc.setFontSize(ORDER_BAND_FONT_PT);
  doc.setTextColor(95, 95, 95);
  const orderBandMaxW = 88;
  const orderBandLines = ordersStr
    ? (doc.splitTextToSize(ordersStr, orderBandMaxW) as string[])
    : [];
  const orderBlockH =
    orderBandLines.length > 0
      ? 3.8 + orderBandLines.length * ORDER_BAND_LINE_MM
      : 0;
  const bandH = Math.max(10, orderBlockH + 5);
  doc.setTextColor(0, 0, 0);

  doc.setFillColor(245, 245, 245);
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.15);
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, bandH, 'FD');
  doc.setDrawColor(0, 0, 0);

  // Vertically center title + order lines in the band (cross-axis like flex items-center)
  const yBandMid = y + bandH / 2;
  doc.setFont(ff, 'bold');
  doc.setFontSize(13);
  doc.text(
    `Purchase Order #${input.poNumber}`,
    MARGIN + 4,
    yBandMid + TITLE_BAND_BASELINE_NUDGE_MM,
  );

  if (orderBandLines.length > 0) {
    doc.setFont(ff, 'normal');
    doc.setFontSize(ORDER_BAND_FONT_PT);
    doc.setTextColor(95, 95, 95);
    const lx = PAGE_W - MARGIN - 2;
    const nOrder = orderBandLines.length;
    let oy =
      yBandMid
      - ((nOrder - 1) * ORDER_BAND_LINE_MM) / 2
      + ORDER_BAND_BASELINE_NUDGE_MM;
    for (const ol of orderBandLines) {
      doc.text(ol, lx, oy, { align: 'right' });
      oy += ORDER_BAND_LINE_MM;
    }
    doc.setTextColor(0, 0, 0);
  }

  y += bandH + 6;

  // ── PO note (hub; below title band) ─────────────────────────────────────
  const noteText = input.poNote?.trim() ?? '';
  if (noteText) {
    doc.setFontSize(8);
    doc.setFont(ff, 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('PO NOTE', MARGIN, y);
    y += LH * 0.85;
    doc.setFont(ff, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const noteLines = doc.splitTextToSize(noteText, PAGE_W - 2 * MARGIN) as string[];
    for (const nl of noteLines) {
      y = ensurePage(doc, y, LH + 1);
      doc.text(nl, MARGIN, y);
      y += LH;
    }
    y += 4;
  }

  // ── Ship to (top) → Bill to (below) stacked left; Signature box right ───
  const yAddrStart = y;
  const yAfterShip = drawAddrCol(
    doc, 'Ship to', input.shippingHeadline, input.shippingAddressLines,
    MARGIN, y, W_ADDR_COL, ff,
  );
  const yAfterBill = drawAddrCol(
    doc, 'Bill to', input.billingHeadline, input.billingAddressLines,
    MARGIN, yAfterShip + 5, W_ADDR_COL, ff,
  );
  // Signature box: right column, fixed height (left addresses may extend lower)
  drawSignatureBox(doc, X_SIG_BOX, yAddrStart, W_SIG_BOX, H_SIG_BOX);
  y = Math.max(yAfterBill, yAddrStart + H_SIG_BOX) + 5;

  rule(doc, y);
  y += 5;

  // ── Supplier + dates (4 columns) ─────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('SUPPLIER',       MARGIN,        y);
  doc.text('ORDER PLACED',   MARGIN + 42,   y);
  doc.text('PO CREATED',     MARGIN + 95,   y);
  doc.text('DELIVERY DATE',  MARGIN + 148,  y);
  doc.setTextColor(0, 0, 0);
  y += LH * 0.85;

  doc.setFont(ff, 'normal');
  doc.setFontSize(9.5);
  doc.text(input.supplierCompany,                          MARGIN,       y);
  doc.text(ymd2display(input.orderedAt)    ?? '—',         MARGIN + 42,  y);
  doc.text(ymd2display(input.dateCreated)  ?? '—',         MARGIN + 95,  y);
  doc.text(ymd2display(input.expectedDate) ?? '—',         MARGIN + 148, y);
  y += LH + 6;

  // ── Table header (filled row) ─────────────────────────────────────────────
  const hdrH = ROW_TOP + FONT_H + ROW_BOT;
  doc.setFillColor(235, 235, 235);
  doc.rect(MARGIN, y, PAGE_W - 2 * MARGIN, hdrH, 'F');
  rule(doc, y, [180, 180, 180]);
  rule(doc, y + hdrH, [180, 180, 180]);

  const hdrY = y + ROW_TOP;
  doc.setFontSize(8);
  doc.setFont(ff, 'bold');
  doc.text('Order no.',     X_ORDER, hdrY);
  doc.setFontSize(8.5);
  doc.text('Item',          X_ITEM,  hdrY);
  doc.text('Supplier Ref.', X_REF,   hdrY);
  doc.text('Qty',           X_QTY_R,   hdrY, { align: 'right' });
  doc.text('Note',          X_NOTE_R,  hdrY, { align: 'right' });
  y += hdrH;

  // ── Table rows ────────────────────────────────────────────────────────────
  doc.setFont(ff, 'normal');
  doc.setFontSize(9);

  for (const row of input.lineItems) {
    const orderBits = doc.splitTextToSize(
      row.shopifyOrderNumber?.trim() || '—',
      W_ORDER_COL - 1,
    ) as string[];
    const descLines = doc.splitTextToSize(row.description || '(untitled)', W_ITEM) as string[];
    const noteLines = wrapNoteLinesForPdf(doc, row.note ?? '', W_NOTE_COL);
    const contentLines = Math.max(orderBits.length, descLines.length, noteLines.length);
    const rowH =
      ROW_TOP + (contentLines - 1) * LH + FONT_H + ROW_BOT;
    y = ensurePage(doc, y, rowH);
    const rowY = y + ROW_TOP;

    for (let i = 0; i < orderBits.length; i++) {
      doc.text(orderBits[i] ?? '', X_ORDER, rowY + i * LH);
    }
    for (let i = 0; i < descLines.length; i++) {
      doc.text(descLines[i] ?? '', X_ITEM, rowY + i * LH);
    }

    doc.text(row.supplierRef || '—', X_REF, rowY);
    doc.text(String(row.quantity), X_QTY_R, rowY, { align: 'right' });
    for (let i = 0; i < noteLines.length; i++) {
      doc.text(noteLines[i] ?? '', X_NOTE_R, rowY + i * LH, { align: 'right' });
    }

    y += rowH;
    rule(doc, y);
  }

  const finalY = y;

  // ── Repeating footer (all pages) ─────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  const shippingDateLabel = ymd2display(input.expectedDate) ?? '—';
  const shippingAddressLabel = footerShipToOneLine(
    input.shippingHeadline,
    input.shippingAddressLines,
  );
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont(ff, 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`PO #${input.poNumber}`, MARGIN, pageH - 14);
    doc.text(`Ship To: ${shippingAddressLabel}`, MARGIN, pageH - 10);
    doc.text(`Shipping Date: ${shippingDateLabel}`, MARGIN, pageH - 6);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, pageH - 6, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  return { doc, finalY };
}

function buildDoc(input: PoPdfInput, fonts?: KoreanFonts): jsPDF {
  return buildDocCore(input, PAGE_H, fonts).doc;
}

// ─── Build input from a PO block ──────────────────────────────────────────────

export function buildPoPdfInput(args: {
  block: OfficePurchaseOrderBlock;
  supplierCompany: string;
  customerHeadline: string | null;
  /** Fallback used when the PO itself has no billing address stored. */
  fallbackBillingAddress?: PoAddress | null;
  /** Fallback used when the PO itself has no shipping address stored. */
  fallbackShippingAddress?: PoAddress | null;
}): PoPdfInput | null {
  const {
    block, supplierCompany, customerHeadline,
    fallbackBillingAddress, fallbackShippingAddress,
  } = args;
  const meta = block.panelMeta;
  if (!meta) return null;

  // Prefer address stored on the PO; fall back to the customer's defaults.
  const shipAddr = (meta.shippingAddress ?? fallbackShippingAddress) as PoAddress | null;
  const billAddr = meta.billingSameAsShipping
    ? shipAddr
    : ((meta.billingAddress ?? fallbackBillingAddress) as PoAddress | null);

  const linkedShopifyOrderNames = [
    ...new Set(
      meta.linkedShopifyOrders
        .map((o) => o.name.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows = block.lineItems.map((li) => ({
    shopifyOrderNumber: li.shopifyOrderNumber?.trim() || '—',
    description: formatProductLabel(li),
    supplierRef: (li.supplierRef?.trim() || li.sku?.trim() || '—').slice(0, 40),
    quantity: li.quantity,
    note: li.note?.trim() ?? '',
  }));

  const parsedDiscount = meta.discount != null ? parseFloat(meta.discount) : NaN;
  const discount = Number.isFinite(parsedDiscount) && parsedDiscount > 0 ? parsedDiscount : null;

  return {
    poNumber: block.poNumber,
    linkedShopifyOrderNames,
    poNote: meta.comment?.trim() ? meta.comment.trim() : null,
    orderedAt: meta.orderedAt ?? null,
    dateCreated: meta.dateCreated,
    expectedDate: meta.expectedDate,
    shippingHeadline: (shipAddr as PoAddress | null)?.name?.trim() || customerHeadline,
    billingHeadline: (billAddr as PoAddress | null)?.name?.trim() || customerHeadline,
    billingAddressLines: addrLines(billAddr),
    shippingAddressLines: addrLines(shipAddr),
    supplierCompany,
    lineItems: rows,
    discount,
    discountReason: meta.discountReason ?? null,
  };
}

// ─── Public actions ───────────────────────────────────────────────────────────

export function buildPoPdfBuffer(input: PoPdfInput, fonts?: KoreanFonts): Buffer {
  const doc = buildDoc(input, fonts);
  return Buffer.from(doc.output('arraybuffer'));
}

function poPdfFilename(poNumber: string): string {
  const safe = poNumber
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `PO-${safe || 'order'}.pdf`;
}

/** Saves the same PDF as print, as a file download in the browser. */
export async function downloadPoPdf(input: PoPdfInput): Promise<void> {
  const fonts = await loadPdfFonts();
  const doc = buildDoc(input, fonts);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = poPdfFilename(input.poNumber);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openPoPdfPrint(input: PoPdfInput): Promise<void> {
  const fonts = await loadPdfFonts();
  const doc = buildDoc(input, fonts);
  const blob = doc.output('blob');
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
