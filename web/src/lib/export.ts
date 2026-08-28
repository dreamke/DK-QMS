import JSZip from 'jszip';
import { decodeXml, paragraphText } from './docx';
export { buildAnnotatedPdf } from './pdf';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const CT_COMMENTS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

function xmlEscape(s: string): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeWs(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function tryPreciseInject(rest: string, cid: number, anchorText: string): { rest: string; ok: boolean } {
  const anchor = (anchorText || '').trim();
  if (!anchor) return { rest, ok: false };
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(rest)) !== null) {
    const runXml = m[0];
    const tMatch = runXml.match(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/);
    if (!tMatch) continue;
    const decoded = decodeXml(tMatch[2]);

    let pos = decoded.indexOf(anchor);
    let matchLen = anchor.length;
    if (pos === -1) continue;

    const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : '';
    const before = decoded.slice(0, pos);
    const mid = decoded.slice(pos, pos + matchLen);
    const after = decoded.slice(pos + matchLen);
    const mkRun = (txt: string) =>
      txt ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(txt)}</w:t></w:r>` : '';

    const replacement =
      mkRun(before) +
      `<w:commentRangeStart w:id="${cid}"/>` +
      mkRun(mid) +
      `<w:commentRangeEnd w:id="${cid}"/>` +
      `<w:r><w:commentReference w:id="${cid}"/></w:r>` +
      mkRun(after);

    const newRest = rest.slice(0, m.index) + replacement + rest.slice(m.index + runXml.length);
    return { rest: newRest, ok: true };
  }
  return { rest, ok: false };
}

function wholeWrap(rest: string, cids: number[]): string {
  let starts = '';
  let ends = '';
  let refs = '';
  for (const cid of cids) {
    starts += `<w:commentRangeStart w:id="${cid}"/>`;
    ends += `<w:commentRangeEnd w:id="${cid}"/>`;
    refs += `<w:r><w:commentReference w:id="${cid}"/></w:r>`;
  }
  return starts + rest + ends + refs;
}

function injectParagraph(full: string, anns: { cid: number; anchorText: string }[]): string {
  const openMatch = full.match(/^<w:p\b[^>]*>/);
  const open = openMatch ? openMatch[0] : '<w:p>';
  let body = full.slice(open.length, full.length - '</w:p>'.length);

  let pPr = '';
  const pprMatch = body.match(/^<w:pPr\b[\s\S]*?<\/w:pPr>/) || body.match(/^<w:pPr\b[^>]*\/>/);
  if (pprMatch) {
    pPr = pprMatch[0];
    body = body.slice(pPr.length);
  }

  let rest = body;
  const fallbackCids: number[] = [];
  for (const a of anns) {
    const r = tryPreciseInject(rest, a.cid, a.anchorText);
    if (r.ok) rest = r.rest;
    else fallbackCids.push(a.cid);
  }
  if (fallbackCids.length) rest = wholeWrap(rest, fallbackCids);

  return `${open}${pPr}${rest}</w:p>`;
}

function commentParagraph(text: string, first: boolean): string {
  const refRun = first ? '<w:r><w:annotationRef/></w:r>' : '';
  return `<w:p>${refRun}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function buildCommentBody(a: any): string {
  const lines: string[] = [];
  const head = `【${a.severity || '中'}危】${a.category || ''}`.trim();
  lines.push(head);
  if (a.anchorText) lines.push(`原文：「${a.anchorText}」`);
  if (a.summary) lines.push(`问题：${a.summary}`);
  if (a.suggestion) lines.push(`建议：${a.suggestion}`);
  if (a.clause) lines.push(`依据：${a.clause}`);
  if (a.source) lines.push(`来源：${a.source}`);
  return lines.map((ln, i) => commentParagraph(ln, i === 0)).join('');
}

function buildCommentsXml(annotations: any[], author: string, dateISO: string): string {
  const body = annotations
    .map(
      (a) =>
        `<w:comment w:id="${a.cid}" w:author="${xmlEscape(author)}" w:date="${dateISO}" w:initials="DK">` +
        buildCommentBody(a) +
        `</w:comment>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:comments xmlns:w="${W_NS}">${body}</w:comments>`
  );
}

function patchContentTypes(ct: string): string {
  if (ct.includes('/word/comments.xml')) return ct;
  const override = `<Override PartName="/word/comments.xml" ContentType="${CT_COMMENTS}"/>`;
  return ct.replace('</Types>', `${override}</Types>`);
}

function patchDocRels(rels: string): string {
  if (rels.includes(REL_COMMENTS)) return rels;
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const next = (ids.length ? Math.max(...ids) : 0) + 1;
  const rel = `<Relationship Id="rId${next}" Type="${REL_COMMENTS}" Target="comments.xml"/>`;
  return rels.replace('</Relationships>', `${rel}</Relationships>`);
}

/**
 * 生成带原生 Word 批注的 docx，返回 Uint8Array（浏览器内运行）。
 */
export async function buildAnnotatedDocx(
  buffer: ArrayBuffer,
  annotations: any[],
  opts: { author?: string } = {},
): Promise<Uint8Array> {
  const author = opts.author || 'DK QMS';
  const dateISO = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('无效的 .docx：缺少 word/document.xml');
  const xml = await docFile.async('string');

  const anns = (annotations || []).map((a, i) => ({ ...a, cid: i }));
  const byPara = new Map<number, any[]>();
  for (const a of anns) {
    const key = Number.isInteger(a.anchorPara) ? a.anchorPara : -1;
    if (!byPara.has(key)) byPara.set(key, []);
    byPara.get(key)!.push(a);
  }

  let logical = -1;
  const newXml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (full) => {
    const inner = full.replace(/^<w:p\b[^>]*>/, '').replace(/<\/w:p>$/, '');
    const text = paragraphText(inner);
    if (!text) return full;
    logical += 1;
    const list = byPara.get(logical);
    if (!list || !list.length) return full;
    return injectParagraph(full, list);
  });

  zip.file('word/document.xml', newXml);
  zip.file('word/comments.xml', buildCommentsXml(anns, author, dateISO));

  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    const ct = await ctFile.async('string');
    zip.file('[Content_Types].xml', patchContentTypes(ct));
  }

  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const rels = await relsFile.async('string');
    zip.file('word/_rels/document.xml.rels', patchDocRels(rels));
  } else {
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL_COMMENTS}" Target="comments.xml"/>` +
      '</Relationships>';
    zip.file('word/_rels/document.xml.rels', rels);
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
