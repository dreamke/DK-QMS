// 浏览器端 LLM 客户端：经 /api/llm 代理调用（密钥不进浏览器）。
// 逻辑与后端一致：流式 SSE 累积 + 硬性总超时 + 截断修复。

function extractJSON(text: string): any {
  if (!text) throw new Error('模型返回为空');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start = -1;
  let endChar = '}';
  if (firstObj === -1 && firstArr === -1) throw new Error('模型未返回 JSON：' + t.slice(0, 200));
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    endChar = ']';
  } else {
    start = firstObj;
    endChar = '}';
  }
  const end = t.lastIndexOf(endChar);
  if (start !== -1 && end > start) {
    const slice = t.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {}
  }
  // 截断修复：补未闭合字符串 + 括号
  const raw = t.slice(start);
  let depthObj = 0;
  let depthArr = 0;
  let inStr = false;
  let escape = false;
  for (const ch of raw) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depthObj += 1;
    else if (ch === '}') depthObj -= 1;
    else if (ch === '[') depthArr += 1;
    else if (ch === ']') depthArr -= 1;
  }
  if (depthObj > 0 || depthArr > 0 || inStr) {
    let patched = raw;
    if (inStr) patched += '"';
    patched += ']'.repeat(Math.max(0, depthArr)) + '}'.repeat(Math.max(0, depthObj));
    try {
      return JSON.parse(patched);
    } catch (_) {}
    const lastComma = patched.lastIndexOf(',');
    if (lastComma > 0) {
      const trimmed = patched.slice(0, lastComma) + '}'.repeat(Math.max(0, depthObj)) + ']'.repeat(Math.max(0, depthArr));
      try {
        return JSON.parse(trimmed);
      } catch (_) {}
    }
  }
  throw new Error('无法解析模型返回的 JSON：' + t.slice(0, 200));
}

function normalizeBaseURL(_baseURL: string): string {
  return _baseURL || '';
}

export interface LLMModel {
  modelName?: string;
  baseURL?: string;
}

export interface ChatOpts {
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/**
 * 调用聊天补全，返回解析后的 JSON 对象。带硬性总超时（5 分钟）与重试。
 */
export async function chatJSON(model: LLMModel, opts: ChatOpts): Promise<any> {
  const maxRetries = 3;
  const TOTAL_MS = 300000;
  const ac = new AbortController();
  const hardTimer = setTimeout(() => ac.abort(new Error('__TOTAL_TIMEOUT__')), TOTAL_MS);
  let lastErr: any;
  try {
    for (let i = 0; i <= maxRetries; i += 1) {
      if (ac.signal.aborted) break;
      try {
        const raw = await chatText(model, { ...opts, signal: ac.signal });
        return extractJSON(raw);
      } catch (e: any) {
        lastErr = e;
        if (e && e.status && e.status >= 400 && e.status < 500) break;
        if (ac.signal.aborted) break;
        if (i < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
          continue;
        }
      }
    }
  } finally {
    clearTimeout(hardTimer);
  }
  if (ac.signal.aborted && lastErr && lastErr.message === '__TOTAL_TIMEOUT__') {
    throw new Error('模型响应总超时（超过 5 分钟仍未完成）。当前模型可能过载或挂起，建议更换为更稳定的模型后重试。');
  }
  throw lastErr;
}

/**
 * 流式调用聊天补全，返回原始文本。经 /api/llm 代理，浏览器自带 SSE 解析。
 */
export async function chatText(model: LLMModel, opts: ChatOpts & { signal?: AbortSignal }): Promise<string> {
  void normalizeBaseURL;
  const modelName = (model && model.modelName || '').trim();
  if (!modelName) throw new Error('未配置模型名称，请在「设置 → 模型 API」中填写');

  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user });

  const body: any = {
    model: modelName,
    messages,
    temperature: opts.temperature ?? 0.2,
    json: !!opts.json,
  };
  if (opts.maxTokens) body.maxTokens = opts.maxTokens;

  const idleTimeoutMs = 90000;

  async function streamOnce(payload: any): Promise<string> {
    const controller = new AbortController();
    let timer: any = null;
    const resetIdle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), idleTimeoutMs);
    };
    resetIdle();

    let res: Response;
    try {
      const signals: AbortSignal[] = [controller.signal];
      if (opts.signal && !opts.signal.aborted) signals.push(opts.signal);
      const fetchSignal =
        signals.length > 1 && typeof AbortSignal !== 'undefined' && (AbortSignal as any).any
          ? (AbortSignal as any).any(signals)
          : controller.signal;
      res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: fetchSignal,
      });
    } catch (e: any) {
      if (timer) clearTimeout(timer);
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
        if (opts.signal && opts.signal.aborted) {
          throw new Error('模型响应总超时（超过设定时间仍未完成），当前模型可能过载或挂起，请更换更稳定的模型后重试。');
        }
        throw new Error(`模型响应超时（超过 ${Math.round(idleTimeoutMs / 1000)}s 无任何输出）。当前模型可能过慢或被限流，请稍后重试。`);
      }
      throw new Error(`无法连接模型服务：${e.message || e}`);
    }

    if (!res.ok) {
      if (timer) clearTimeout(timer);
      let detail = '';
      try {
        detail = await res.text();
      } catch (_) {}
      const err: any = new Error(`模型接口错误 ${res.status}：${detail.slice(0, 300)}`);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.startsWith(':')) continue;
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (payloadStr === '[DONE]') {
            if (timer) clearTimeout(timer);
            return full;
          }
          try {
            const obj = JSON.parse(payloadStr);
            const delta = obj.choices && obj.choices[0] && (obj.choices[0].delta || obj.choices[0].message);
            const piece = delta && delta.content;
            if (typeof piece === 'string' && piece) full += piece;
          } catch (_) {}
        }
      }
    } catch (e: any) {
      if (timer) clearTimeout(timer);
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
        if (opts.signal && opts.signal.aborted) {
          throw new Error('模型响应总超时（超过设定时间仍未完成），当前模型可能过载或挂起，请更换更稳定的模型后重试。');
        }
        throw new Error(`模型输出中断（超过 ${Math.round(idleTimeoutMs / 1000)}s 无新数据）。请稍后重试或更换更快的模型。`);
      }
      throw new Error(`读取模型流式响应失败：${e.message || e}`);
    }
    if (timer) clearTimeout(timer);
    return full;
  }

  let lastErr: any;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const out = await streamOnce(body);
      if (out) return out;
      lastErr = new Error(`模型返回为空（空响应，正在重试 ${attempt + 1}/2）`);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    } catch (e: any) {
      lastErr = e;
      if (opts.json && e.detail && /response_format|unsupported|invalid/i.test(e.detail)) {
        const retry = { ...body, json: false };
        return await streamOnce(retry);
      }
      if (/terminated|fetch failed|reset|socket|ECONNRESET|ECONNREFUSED|network|连接可能被中断|无法连接模型服务/i.test(e.message || '') && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
