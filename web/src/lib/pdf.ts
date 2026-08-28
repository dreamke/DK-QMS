import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// Vite 会把 worker 文件作为静态资源处理，返回其 URL
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFArray,
  PDFDict,
  rgb,
} from 'pdf-lib';

// 浏览器必须显式指定 worker 路径（Node 端不需要）
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SEV_RGB: Record<string, any> = {
  高: rgb(0.85, 0.25, 0.2),
  中: rgb(0.88, 0.53, 0.0),
  低: rgb(0.23, 0.51, 0.96),
};

function utf16beHex(s: string): string {
  let h = 'FEFF';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0) ?? 0;
    h += cp.toString(16).padStart(4, '0').toUpperCase();
  }
  return h;
}

function normWs(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * 解析 PDF ArrayBuffer -> 段落数组 + 每页文本项坐标（浏览器内运行）。
 */
export async function parsePdf(buffer: ArrayBuffer): Promise<{
  paragraphs: { index: number; text: string; pageIndex: number; lineIndex: number }[];
  pages: { pageIndex: number; items: any[] }[];
  fullText: string;
}> {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const paragraphs: any[] = [];
  const pages: any[] = [];
  let globalIdx = 0;

  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const raw = (tc.items || [])
      .filter((it: any) => typeof it.str === 'string' && it.str.trim().length)
      .map((it: any) => {
        const tr = it.transform || [1, 0, 0, 1, 0, 0];
        const x = tr[4];
        const y = tr[5];
        const w = it.width || 0;
        const h = it.height || Math.abs(tr[3]) || 10;
        return { str: it.str, x, y, w, h };
      });

    raw.sort((a: any, b: any) => b.y - a.y || a.x - b.x);
    const lines: any[] = [];
    let curY: number | null = null;
    for (const it of raw) {
      if (curY === null || Math.abs(it.y - curY) > 4) {
        lines.push([]);
        curY = it.y;
      }
      lines[lines.length - 1].push(it);
    }

    const pageItems: any[] = [];
    lines.forEach((ln: any, li: number) => {
      ln.sort((a: any, b: any) => a.x - b.x);
      const text = ln.map((i: any) => i.str).join('');
      if (!text.trim()) return;
      const paraIndex = globalIdx;
      paragraphs.push({ index: globalIdx, text: text.trim(), pageIndex: p - 1, lineIndex: li });
      ln.forEach((i: any) =>
        pageItems.push({ str: i.str, x: i.x, y: i.y, w: i.w, h: i.h, lineIndex: li, paraIndex }),
      );
      globalIdx += 1;
    });
    pages.push({ pageIndex: p - 1, items: pageItems });
  }

  const fullText = paragraphs.map((pp) => pp.text).join('\n');
  return { paragraphs, pages, fullText };
}

/**
 * 生成带「原生 PDF 高亮批注」的新 PDF（保留原版式），返回 Uint8Array。
 */
export async function buildAnnotatedPdf(
  buffer: ArrayBuffer,
  annotations: any[],
  opts: { author?: string } = {},
): Promise<Uint8Array> {
  void opts;
  const { pages } = await parsePdf(buffer);
  const pdfDoc = await PDFDocument.load(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  const pdfPages = pdfDoc.getPages();
  const context = pdfDoc.context;

  for (const a of annotations || []) {
    const paraIdx = Number(a.anchorPara);
    if (!Number.isInteger(paraIdx)) continue;

    let target: any = null;
    for (const pg of pages) {
      const hit = pg.items.find((i: any) => i.paraIndex === paraIdx);
      if (hit) {
        target = { pg, lineIndex: hit.lineIndex };
        break;
      }
    }
    if (!target) continue;
    const { pg, lineIndex } = target;
    const lineItems = pg.items.filter((i: any) => i.lineIndex === lineIndex).sort((x: any, y: any) => x.x - y.x);
    if (!lineItems.length) continue;
    const pagePdf = pdfPages[pg.pageIndex];
    if (!pagePdf) continue;

    const lineText = lineItems.map((i: any) => i.str).join('');

    let start = lineText.indexOf(a.anchorText || '');
    let hitItems: any[];
    if (start >= 0) {
      const end = start + (a.anchorText || '').length;
      let acc = 0;
      hitItems = [];
      for (const it of lineItems) {
        const s = acc;
        const e = acc + it.str.length;
        if (e > start && s < end) hitItems.push(it);
        acc = e;
      }
    } else if (normWs(lineText).includes(normWs(a.anchorText || '')) && normWs(a.anchorText || '')) {
      hitItems = lineItems;
    } else {
      hitItems = lineItems;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const it of hitItems) {
      minX = Math.min(minX, it.x);
      maxX = Math.max(maxX, it.x + it.w);
      minY = Math.min(minY, it.y - it.h);
      maxY = Math.max(maxY, it.y);
    }
    const pad = 1.5;
    const rx = minX - pad;
    const ry = minY - pad;
    const rw = maxX - minX + 2 * pad;
    const rh = maxY - minY + 2 * pad;
    const color = SEV_RGB[a.severity] || SEV_RGB['中'];

    pagePdf.drawRectangle({
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      color,
      opacity: 0.28,
      borderColor: color,
      borderWidth: 0.6,
    });

    const contents =
      `【${a.severity || '中'}危】${a.category || ''}\n` +
      `原文：${a.anchorText || ''}\n` +
      `问题：${a.summary || ''}\n` +
      `建议：${a.suggestion || ''}\n` +
      `依据：${a.clause || ''}\n` +
      `来源：${a.source || ''}`;
    const title = `DK QMS #${a.id != null ? a.id : ''}`;

    const quad = PDFArray.withContext(context);
    [rx, ry + rh, rx + rw, ry + rh, rx, ry, rx + rw, ry].forEach((n) =>
      quad.push(PDFNumber.of(Number(n.toFixed(2)))),
    );
    const rectArr = PDFArray.withContext(context);
    [rx, ry, rx + rw, ry + rh].forEach((n) => rectArr.push(PDFNumber.of(Number(n.toFixed(2)))));
    const colorArr = PDFArray.withContext(context);
    [color.red, color.green, color.blue].forEach((n) => colorArr.push(PDFNumber.of(Number(n.toFixed(3)))));

    const annot = PDFDict.withContext(context);
    annot.set(PDFName.of('Type'), PDFName.of('Annot'));
    annot.set(PDFName.of('Subtype'), PDFName.of('Highlight'));
    annot.set(PDFName.of('Rect'), rectArr);
    annot.set(PDFName.of('QuadPoints'), quad);
    annot.set(PDFName.of('Contents'), PDFHexString.of(utf16beHex(contents)));
    annot.set(PDFName.of('T'), PDFHexString.of(utf16beHex(title)));
    annot.set(PDFName.of('C'), colorArr);
    annot.set(PDFName.of('P'), pagePdf.ref);
    annot.set(PDFName.of('F'), PDFNumber.of(4));
    annot.set(PDFName.of('Open'), PDFNumber.of(0));
    const ref = context.register(annot);

    let annots = pagePdf.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) {
      annots = PDFArray.withContext(context);
      pagePdf.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
  }

  const out = await pdfDoc.save();
  return out;
}
