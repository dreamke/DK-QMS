// 浏览器端 MCP 客户端：经 /api/mcp 代理调用本地 Linkly 知识库（CORS 由代理补）。
async function callTool(tool: string, args: Record<string, any> = {}): Promise<string> {
  const r = await fetch('/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || `MCP 调用失败：${tool}`);
  return j.text || '';
}

export async function listLibraries(): Promise<string> {
  return callTool('list_libraries', {});
}

export async function search(
  query: string,
  library?: string,
  limit?: number,
): Promise<{ query: string; results: any[]; total: number; raw?: string }> {
  const args: Record<string, any> = { query, output_format: 'json' };
  if (library) args.library = library;
  if (limit) args.limit = limit;
  const text = await callTool('search', args);
  try {
    const parsed = JSON.parse(text);
    return {
      query,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      total: parsed.total ?? (parsed.results ? parsed.results.length : 0),
    };
  } catch (_) {
    return { query, results: [], total: 0, raw: text };
  }
}
