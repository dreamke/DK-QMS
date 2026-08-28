export interface AppConfig {
  model: {
    provider: 'openai' | 'claude' | 'ollama';
    baseURL: string;
    apiKey: string;
    modelName: string;
  };
  mcp: { address: string; token: string };
  knowledge: { gmp: boolean; sop: boolean };
  retrieval: { topK: number };
  slicing: { enabled: boolean; chunkSize: number };
  severityThreshold: 'all' | 'medium' | 'high';
  desensitize: { enabled: boolean };
}

const BASE = '/api';

export async function getConfig(): Promise<AppConfig> {
  const r = await fetch(`${BASE}/config`);
  if (!r.ok) throw new Error(`getConfig ${r.status}`);
  return r.json();
}

export async function saveConfig(cfg: Partial<AppConfig>): Promise<AppConfig> {
  const r = await fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!r.ok) throw new Error(`saveConfig ${r.status}`);
  return r.json();
}

export async function getLibraries(): Promise<{ ok: boolean; text?: string; error?: string }> {
  const r = await fetch(`${BASE}/libraries`);
  return r.json();
}

// ---------- 审核相关类型 ----------
export type Severity = '高' | '中' | '低';

export interface ReviewQuestion {
  id: number;
  aspect: string;
  dimension?: string;
  question: string;
  query: string;
}

export interface EvidenceHit {
  library: string;
  docId: string;
  title: string;
  path: string;
  snippet: string;
  relevance: number | null;
}

export interface EvidenceItem {
  questionId: number;
  aspect: string;
  query: string;
  hits: EvidenceHit[];
}

export interface Annotation {
  id: number;
  anchorPara: number;
  anchorText: string;
  anchorOk: boolean;
  severity: Severity;
  category: string;
  clause: string;
  summary: string;
  suggestion: string;
  source: string;
}

export interface ReviewStats {
  paragraphs: number;
  questions: number;
  annotations: number;
  high: number;
  medium: number;
  low: number;
}

export interface ReviewHandlers {
  onProgress?: (d: { stage: string; message: string; percent?: number }) => void;
  onQuestions?: (d: { docType?: string; questions: ReviewQuestion[] }) => void;
  onEvidence?: (d: { evidence: EvidenceItem[] }) => void;
  onAnnotations?: (d: { annotations: Annotation[] }) => void;
  onDone?: (d: { annotations: Annotation[]; questions: ReviewQuestion[]; docType?: string; stats: ReviewStats }) => void;
  onError?: (d: { message: string }) => void;
}

function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 浏览器内生成带批注的文件并触发下载（不再走服务端导出）。
 * docx -> 原生 Word 批注；pdf -> 保留原版式的高亮批注。
 */
export async function exportAnnotated(
  buffer: ArrayBuffer,
  fileName: string,
  annotations: Annotation[],
): Promise<void> {
  const isPdf = /\.pdf$/i.test(fileName);
  const base = fileName.replace(/\.(docx|pdf)$/i, '');
  if (isPdf) {
    const { buildAnnotatedPdf } = await import('../lib/pdf');
    const bytes = await buildAnnotatedPdf(buffer, annotations);
    downloadBytes(`${base}_已批注.pdf`, bytes, 'application/pdf');
  } else {
    const { buildAnnotatedDocx } = await import('../lib/export');
    const bytes = await buildAnnotatedDocx(buffer, annotations, { author: 'DK QMS' });
    downloadBytes(
      `${base}_已批注.docx`,
      bytes,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  }
}
