import JSZip from 'jszip';

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

// 从单个 <w:p>…</w:p> 片段抽取纯文本（拼接所有 w:t，处理 tab / br）
export function paragraphText(pXml: string): string {
  let out = '';
  const re = /<w:(t|tab|br|cr)\b([^>]*)>([\s\S]*?)<\/w:\1>|<w:(tab|br|cr)\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pXml)) !== null) {
    const tag = m[1] || m[4];
    if (tag === 't') {
      out += decodeXml(m[3] || '');
    } else if (tag === 'tab') {
      out += '\t';
    } else if (tag === 'br' || tag === 'cr') {
      out += '\n';
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * 解析 docx buffer -> 段落数组（浏览器内运行，输入为 ArrayBuffer）。
 */
export async function parseDocx(buffer: ArrayBuffer): Promise<{ paragraphs: { index: number; text: string }[]; fullText: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('无效的 .docx：缺少 word/document.xml');
  const xml = await docFile.async('string');

  const paragraphs: { index: number; text: string }[] = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;
  let idx = 0;
  while ((pm = pRe.exec(xml)) !== null) {
    const text = paragraphText(pm[1]);
    if (text) {
      paragraphs.push({ index: idx, text });
      idx += 1;
    }
  }

  const fullText = paragraphs.map((p) => p.text).join('\n');
  return { paragraphs, fullText };
}
