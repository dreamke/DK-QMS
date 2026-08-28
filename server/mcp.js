import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_ADDRESS = 'http://127.0.0.1:60606/mcp';
const clients = new Map();

async function getClient(address) {
  const addr = address || DEFAULT_ADDRESS;
  const cached = clients.get(addr);
  if (cached) return cached;

  const transport = new StreamableHTTPClientTransport(new URL(addr));
  const client = new Client(
    { name: 'dk-qms', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  clients.set(addr, client);
  return client;
}

export async function callTool(name, args = {}, address) {
  const client = await getClient(address);
  return client.callTool({ name, arguments: args });
}

export function textOfResult(res) {
  const content = Array.isArray(res.content) ? res.content : [];
  return content
    .map((c) => (c && c.type === 'text' ? c.text : ''))
    .join('\n')
    .trim();
}

export async function listLibraries(address) {
  const res = await callTool('list_libraries', {}, address);
  return textOfResult(res);
}

/**
 * 在指定知识库中检索。
 * @param {string} query 检索词/自然语言
 * @param {string} [library] 库名（如 'gmp' / 'sop'），省略则全库
 * @param {number} [limit] 返回条数
 * @param {string} [address] MCP 地址
 * @returns {Promise<{query:string, results:Array, total:number}>}
 */
export async function search(query, library, limit, address) {
  const args = { query, output_format: 'json' };
  if (library) args.library = library;
  if (limit) args.limit = limit;
  const res = await callTool('search', args, address);
  const text = textOfResult(res);
  try {
    const parsed = JSON.parse(text);
    return {
      query,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      total: parsed.total ?? (parsed.results ? parsed.results.length : 0),
    };
  } catch (e) {
    // 回退：返回原始文本作为单条结果
    return { query, results: [], total: 0, raw: text };
  }
}
