import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch, Agent } from 'undici';
import { getConfig, saveConfig, maskConfig } from './config.js';
import { callTool, listLibraries, textOfResult } from './mcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 进程级兜底：即使底层库抛出未捕获错误，也只记录日志、保持服务存活。
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && (e.stack || e.message || e));
});
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && (e.stack || e.message || e));
});

// ---------- 极简 LLM 转发（仅注入密钥，无任何业务逻辑） ----------
const llmDispatcher = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connectTimeout: 30000,
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 600000,
});

function normalizeBaseURL(baseURL) {
  let b = (baseURL || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('未配置模型 Base URL，请在「设置 → 模型 API」中填写');
  if (!/\/v\d|\/chat\/completions|\/completions/.test(b)) b += '/v1';
  return b;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ---------- 配置（密钥仅存服务端，浏览器永不持有明文） ----------
app.get('/api/config', (req, res) => {
  res.json(maskConfig(getConfig()));
});

app.post('/api/config', (req, res) => {
  try {
    const merged = saveConfig(req.body || {});
    res.json(maskConfig(merged));
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 列举知识库（经 MCP 代理）
app.get('/api/libraries', async (req, res) => {
  try {
    const cfg = getConfig();
    const text = await listLibraries(cfg.mcp && cfg.mcp.address);
    res.json({ ok: true, text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// LLM 转发：浏览器只发 {model, messages, temperature, maxTokens, json}，
// 代理补上 baseURL + Authorization，并把上游 SSE 原样回传（浏览器自带解析器）。
app.post('/api/llm', async (req, res) => {
  try {
    const cfg = getConfig();
    const base = normalizeBaseURL(cfg.model.baseURL);
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const modelName = (req.body && req.body.model) || cfg.model.modelName;
    if (!modelName) throw new Error('未配置模型名称，请在「设置 → 模型 API」中填写');

    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const buildBody = (withFormat) => {
      const b = {
        model: modelName,
        messages,
        temperature: req.body.temperature ?? 0.2,
        stream: true,
      };
      if (req.body.maxTokens) b.max_tokens = req.body.maxTokens;
      if (withFormat && req.body.json) b.response_format = { type: 'json_object' };
      return b;
    };

    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (cfg.model.apiKey) headers.Authorization = `Bearer ${cfg.model.apiKey}`;

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const doFetch = (b) =>
      undiciFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(b),
        signal: ac.signal,
        dispatcher: llmDispatcher,
      });

    let upstream = await doFetch(buildBody(true));
    if (!upstream.ok && req.body.json) {
      const detail = await upstream.text();
      if (/response_format|unsupported|invalid/i.test(detail)) {
        upstream = await doFetch(buildBody(false)); // 模型不支持 json_object，去掉后重试
      } else {
        res.status(upstream.status).send(detail);
        return;
      }
    }
    if (!upstream.ok) {
      const detail = await upstream.text();
      res.status(upstream.status).send(detail);
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => {
      try {
        res.end();
      } catch (_) {}
    });
    nodeStream.pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message || String(e) });
    } else {
      try {
        res.end();
      } catch (_) {}
    }
  }
});

// MCP 转发：浏览器发 {tool, args}，代理用 MCP SDK 调用本地 Linkly 并返回文本。
app.post('/api/mcp', async (req, res) => {
  try {
    const { tool, args } = req.body || {};
    if (!tool) throw new Error('缺少 tool 参数');
    const cfg = getConfig();
    const address = cfg.mcp && cfg.mcp.address;
    const r = await callTool(tool, args || {}, address);
    res.json({ ok: true, text: textOfResult(r) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ---------- 静态前端（纯 SPA：解析/编排/导出全在浏览器，代理只做转发） ----------
const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`DK QMS static proxy listening on http://localhost:${PORT}`);
});
