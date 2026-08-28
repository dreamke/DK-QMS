import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  model: { provider: 'openai', baseURL: '', apiKey: '', modelName: '' },
  mcp: { address: 'http://127.0.0.1:60606/mcp', token: '' },
  knowledge: { gmp: true, sop: true },
  retrieval: { topK: 5 },
  slicing: { enabled: false, chunkSize: 4000 },
  severityThreshold: 'all',
  desensitize: { enabled: true },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, patch) {
  if (!isObj(patch)) return patch === undefined ? target : patch;
  if (!isObj(target)) return patch;
  const out = { ...target };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === undefined) continue; // 不覆盖已有值
    if (isObj(pv) && isObj(out[k])) out[k] = deepMerge(out[k], pv);
    else out[k] = pv;
  }
  return out;
}

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

export function getConfig() {
  ensure();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

export function saveConfig(patch) {
  const cur = getConfig();
  const merged = deepMerge(cur, patch);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

export function maskConfig(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  if (c.model && typeof c.model.apiKey === 'string' && c.model.apiKey) {
    c.model.apiKey = '******';
  }
  return c;
}
