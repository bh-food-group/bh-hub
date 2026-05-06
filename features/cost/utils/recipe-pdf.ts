import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecipeIngredient = {
  title: string;
  amount: number;
  unit: string;
};

export type RecipeMemo = {
  id: string;
  memo: string;
};

export type RecipePdfInput = {
  title: string;
  totalCount: number;
  lossAmount: number | null;
  finalWeight: number | null;
  ingredients: RecipeIngredient[];
  packagings: RecipeIngredient[];
  memos: RecipeMemo[];
};

// ─── Font loading (Korean: NanumGothic) ──────────────────────────────────────

type KoreanFonts = { regular: string; bold: string };

let _cachedFonts: KoreanFonts | null = null;

async function loadFonts(): Promise<KoreanFonts> {
  if (_cachedFonts) return _cachedFonts;
  const [regular, bold] = await Promise.all([
    fetch('/fonts/NanumGothic-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/NanumGothic-Bold.ttf').then((r) => r.arrayBuffer()),
  ]);
  const toBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  };
  _cachedFonts = { regular: toBase64(regular), bold: toBase64(bold) };
  return _cachedFonts;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAGE_W = 210;   // A4
const PAGE_H = 297;
const M = 14;         // margin
const LH = 5.0;       // line height
const ROW_PAD_V = 3.5; // cell vertical padding (top+bottom per row)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensurePage(doc: jsPDF, y: number, need: number): number {
  if (y + need > PAGE_H - M - 4) {
    doc.addPage();
    return M;
  }
  return y;
}

function rule(
  doc: jsPDF,
  y: number,
  rgb: [number, number, number] = [200, 200, 200],
  xStart = M,
  xEnd = PAGE_W - M,
): void {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.2);
  doc.line(xStart, y, xEnd, y);
  doc.setDrawColor(0, 0, 0);
}

function sectionTitle(doc: jsPDF, ff: string, y: number, text: string): number {
  doc.setFont(ff, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(text, M, y);
  doc.setTextColor(0, 0, 0);
  y += 2;
  rule(doc, y, [180, 180, 180]);
  return y + 5;
}

// ─── Table renderer ───────────────────────────────────────────────────────────

type ColDef = { label: string; x: number; w: number; align?: 'left' | 'right' };

function drawTableHeader(doc: jsPDF, ff: string, y: number, cols: ColDef[]): number {
  const rowH = ROW_PAD_V + LH * 0.9;
  doc.setFillColor(235, 235, 235);
  doc.rect(M, y, PAGE_W - 2 * M, rowH, 'F');
  rule(doc, y, [180, 180, 180]);
  rule(doc, y + rowH, [180, 180, 180]);

  doc.setFont(ff, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  const textY = y + ROW_PAD_V / 2 + LH * 0.65;
  for (const col of cols) {
    if (col.align === 'right') {
      doc.text(col.label, col.x + col.w, textY, { align: 'right' });
    } else {
      doc.text(col.label, col.x, textY);
    }
  }
  doc.setTextColor(0, 0, 0);
  return y + rowH;
}

function drawTableRows(
  doc: jsPDF,
  ff: string,
  y: number,
  rows: string[][],
  cols: ColDef[],
): number {
  doc.setFont(ff, 'normal');
  doc.setFontSize(9);

  for (const row of rows) {
    // Compute wrapped lines per cell
    const cellLines = cols.map((col, i) =>
      doc.splitTextToSize(row[i] ?? '', col.w - 1) as string[],
    );
    const maxLines = Math.max(...cellLines.map((l) => l.length));
    const rowH = ROW_PAD_V + maxLines * LH;

    y = ensurePage(doc, y, rowH + 1);
    const textY = y + ROW_PAD_V / 2 + LH * 0.72;

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]!;
      const lines = cellLines[ci]!;
      for (let li = 0; li < lines.length; li++) {
        if (col.align === 'right') {
          doc.text(lines[li] ?? '', col.x + col.w, textY + li * LH, { align: 'right' });
        } else {
          doc.text(lines[li] ?? '', col.x, textY + li * LH);
        }
      }
    }

    y += rowH;
    rule(doc, y);
  }

  return y;
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

function buildDoc(input: RecipePdfInput, fonts?: KoreanFonts): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ff = fonts ? 'NanumGothic' : 'helvetica';

  if (fonts) {
    doc.addFileToVFS('NanumGothic-Regular.ttf', fonts.regular);
    doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
    doc.addFileToVFS('NanumGothic-Bold.ttf', fonts.bold);
    doc.addFont('NanumGothic-Bold.ttf', 'NanumGothic', 'bold');
  }
  doc.setFont(ff, 'normal');

  let y = M;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFont(ff, 'bold');
  doc.setFontSize(18);
  doc.text(input.title, M, y + 6);
  y += 10;

  doc.setFont(ff, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 120);
  doc.text(format(new Date(), 'yyyy-MM-dd'), M, y + 4);
  doc.setTextColor(0, 0, 0);
  y += 8;
  rule(doc, y, [160, 160, 160]);
  y += 7;

  // ── Summary box ───────────────────────────────────────────────────────────
  const totalWeight = input.ingredients.reduce((s, i) => s + i.amount, 0);
  const weightPerPiece =
    input.totalCount > 0 ? totalWeight / input.totalCount : 0;

  const finalWeightPerPiece = input.finalWeight ?? weightPerPiece;
  const lossPerPiece = weightPerPiece - finalWeightPerPiece;
  const lossRate =
    totalWeight > 0 && lossPerPiece > 0 && input.totalCount > 0
      ? (lossPerPiece * input.totalCount / totalWeight) * 100
      : 0;

  const summaryH = 26;
  doc.setFillColor(248, 248, 248);
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.2);
  doc.roundedRect(M, y, PAGE_W - 2 * M, summaryH, 2, 2, 'FD');

  const col1X = M + 6;
  const col2X = M + 55;
  const col3X = M + 110;

  const labelY = y + 7;
  const valY = y + 13;

  doc.setFont(ff, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text('총 갯수', col1X, labelY);
  doc.text('총 무게', col2X, labelY);
  doc.text('개당 무게 (로스 전)', col3X, labelY);

  doc.setFont(ff, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(`${input.totalCount}개`, col1X, valY);
  doc.text(`${totalWeight.toFixed(1)}g`, col2X, valY);
  doc.text(`${weightPerPiece.toFixed(2)}g`, col3X, valY);

  const row2LabelY = y + 20;
  const row2ValY = y + 24; // not used directly

  if (input.finalWeight != null || input.lossAmount != null) {
    doc.setFont(ff, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text('개당 최종 무게', col1X, row2LabelY);
    doc.text('개당 로스', col2X, row2LabelY);
    doc.text('로스율', col3X, row2LabelY);

    doc.setFont(ff, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const finalWStr = `${finalWeightPerPiece.toFixed(2)}g`;
    const lossStr = lossPerPiece > 0 ? `${lossPerPiece.toFixed(2)}g` : '-';
    const rateStr = lossRate > 0 ? `${lossRate.toFixed(1)}%` : '-';
    doc.text(finalWStr, col1X + 22, row2LabelY, { align: 'right' });
    doc.text(lossStr, col2X + 22, row2LabelY, { align: 'right' });
    doc.text(rateStr, col3X + 18, row2LabelY, { align: 'right' });
  }

  doc.setDrawColor(0, 0, 0);
  y += summaryH + 10;

  // ── Ingredients table ─────────────────────────────────────────────────────
  y = sectionTitle(doc, ff, y, '재료');

  const ingredientCols: ColDef[] = [
    { label: 'No.', x: M, w: 10 },
    { label: '재료명', x: M + 11, w: 100 },
    { label: '양', x: M + 112, w: 35, align: 'right' },
    { label: '단위', x: M + 148, w: 24 },
  ];

  y = drawTableHeader(doc, ff, y, ingredientCols);
  y = drawTableRows(
    doc,
    ff,
    y,
    input.ingredients.map((ing, i) => [
      String(i + 1),
      ing.title,
      ing.amount % 1 === 0 ? String(ing.amount) : ing.amount.toFixed(2),
      ing.unit,
    ]),
    ingredientCols,
  );
  y += 8;

  // ── Packagings table (optional) ───────────────────────────────────────────
  if (input.packagings.length > 0) {
    y = ensurePage(doc, y, 30);
    y = sectionTitle(doc, ff, y, '패키징');

    const packagingCols: ColDef[] = [
      { label: 'No.', x: M, w: 10 },
      { label: '패키징명', x: M + 11, w: 100 },
      { label: '양', x: M + 112, w: 35, align: 'right' },
      { label: '단위', x: M + 148, w: 24 },
    ];

    y = drawTableHeader(doc, ff, y, packagingCols);
    y = drawTableRows(
      doc,
      ff,
      y,
      input.packagings.map((pkg, i) => [
        String(i + 1),
        pkg.title,
        pkg.amount % 1 === 0 ? String(pkg.amount) : pkg.amount.toFixed(2),
        pkg.unit,
      ]),
      packagingCols,
    );
    y += 8;
  }

  // ── Memos (optional) ──────────────────────────────────────────────────────
  if (input.memos.length > 0) {
    y = ensurePage(doc, y, 24);
    y = sectionTitle(doc, ff, y, '메모');

    doc.setFont(ff, 'normal');
    doc.setFontSize(9);

    for (const memo of input.memos) {
      const lines = doc.splitTextToSize(`• ${memo.memo}`, PAGE_W - 2 * M - 4) as string[];
      const blockH = lines.length * LH + 2;
      y = ensurePage(doc, y, blockH);
      for (let i = 0; i < lines.length; i++) {
        doc.text(lines[i] ?? '', M + 2, y + LH * (i + 0.75));
      }
      y += blockH;
    }
  }

  // ── Page footer ───────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(ff, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(input.title, M, PAGE_H - 8);
    doc.text(`${p} / ${pageCount}`, PAGE_W - M, PAGE_H - 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);
  }

  return doc;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function safeFilename(title: string): string {
  return `Recipe-${title.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').slice(0, 80)}.pdf`;
}

export async function openRecipePdfPrint(input: RecipePdfInput): Promise<void> {
  const fonts = await loadFonts();
  const doc = buildDoc(input, fonts);
  const url = URL.createObjectURL(doc.output('blob'));
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadRecipePdf(input: RecipePdfInput): Promise<void> {
  const fonts = await loadFonts();
  const doc = buildDoc(input, fonts);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(input.title);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
