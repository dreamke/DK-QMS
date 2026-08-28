# DK QMS · GMP 文档审核助手

导入 Word / PDF 报告（偏差调查报告 / 风险评估报告 / SOP 等），AI 结合 **Linkly AI 知识库**（GMP 标准 + SOP 规范）自动审阅，并将审阅意见以**原生批注**写回文档：

- **Word 文档** → 导出含原生 Word 批注（OOXML 评论）的新 `.docx`，可在 Word / WPS 审阅窗格查看与编辑。
- **PDF 文档** → 在**原版式**上叠加半透明高亮 + 原生 PDF 批注，保留图片、表格与排版，由阅读器渲染中文。

> 本应用为**本地单机**工具：文档不会离开本机，密钥仅保存在服务端配置中。

---

## 特性

- 支持 **Word (.docx)** 与 **PDF (.pdf)** 导入与解析。
- AI 三阶段审校：**脱敏 → 提炼关键问题 → 检索知识库证据 → 生成结构化批注**。
- 基于 **GMP 审核框架**（六维：偏差管理 / CAPA / 风险评估 ICH Q9 / 数据完整性 ALCOA+ / 文件管理 SOP / 合规与可追溯）生成针对性问题，而非笼统提问。
- 知识库检索经 **Linkly AI 知识库 MCP** 实时取证，批注附引用条款与依据。
- **纯前端编排**：文档解析、审校流水线、批注导出全部在浏览器内完成；极简 Node 代理仅负责转发 LLM / MCP 调用并托管静态资源，API Key 不进入浏览器。
- 批注在浏览器内可增删改，再导出最终文件。

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│ 浏览器（纯静态 SPA，Vite + React + TS + Ant Design）          │
│   web/src/lib/*   解析(docx/pdf) · 导出(批注) · LLM/MCP 客户端 │
│   web/src/review.ts  三阶段审校编排（脱敏→问题→检索→批注）    │
│   所有重活都在这里跑，UI 直接呈现进度与结果                    │
└───────────────────────────┬─────────────────────────────────┘
                            │  /api/llm（注入密钥，转发 SSE）
                            │  /api/mcp（转发知识库检索）
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 极简 Node 代理（server/index.js，Express）                    │
│   • POST /api/llm  → 注入 config 中的 apiKey，把 DeepSeek     │
│                     SSE 原样回传（浏览器自带解析器）           │
│   • POST /api/mcp  → 用 MCP SDK 调 Linkly AI 知识库              │
│   • GET  /api/config · /api/libraries（配置与知识库列举）      │
│   • 托管 dist/ 静态前端                                        │
└───────────────────────────┬─────────────────────────────────┘
            │                       │
            ▼                       ▼
     DeepSeek LLM API         Linkly AI 知识库 MCP
     （浏览器不可直连，        （浏览器不可跨域，经代理转发）
      经代理转发）
```

**为什么不直接纯静态：** DeepSeek API 支持浏览器跨域直连，但知识库 MCP 不支持 CORS，因此保留一个只做转发、不持有任何业务逻辑的极简代理。密钥始终只在服务端 `data/config.json` 中，前端拿到的是掩码后的 `******`。

---

## 目录结构

```
DK QMS/
├─ README.md                   本文件
├─ package.json · package-lock.json
├─ .gitignore · tsconfig.json · vite.config.ts
├─ data/
│  └─ config.example.json      配置模板（真实 config.json 不入库）
├─ server/                     极简转发代理（Express）
│  ├─ index.js                 路由 + 静态托管（入口）
│  ├─ config.js                data/config.json 读写
│  └─ mcp.js                   知识库 MCP 转发客户端
└─ web/                        前端（Vite + React + TS + AntD）
   ├─ index.html
   └─ src/
      ├─ main.tsx · App.tsx · theme.ts · index.css · vite-env.d.ts
      ├─ api/client.ts         前端 API 封装（config / libraries）
      ├─ components/AppLayout.tsx   布局外壳
      ├─ pages/                ImportPage · ResultPage · SettingsPage
      ├─ lib/                  浏览器端核心库（无需 Node）
      │  ├─ docx.ts            docx 解析（jszip 抽段落）
      │  ├─ pdf.ts             pdf 解析（pdfjs-dist 抽段落+坐标）+ 高亮导出
      │  ├─ export.ts          docx 原生批注导出
      │  ├─ llm.ts             LLM 客户端（调 /api/llm，解析 SSE）
      │  ├─ mcp.ts             MCP 客户端（调 /api/mcp）
      │  └─ desensitize.ts     发送前脱敏规则
      └─ review.ts             三阶段审校编排（纯前端）
```

---

## 环境要求

- **Node.js 20+**（推荐用 WorkBuddy 管理版 Node 22）。
- 本机已启动 **Linkly AI 知识库 MCP 服务**（应用仅靠检索取证，需先确保其运行）。
- 一个可用的 **DeepSeek（或 OpenAI 兼容）** 模型 API Key。

---

## 快速开始

```bash
# 1. 安装依赖（含前端与代理依赖）
npm install

# 2-A. 开发模式（热更新）：前端 5173，代理 8787
npm run dev
#    浏览器打开 http://localhost:5173

# 2-B. 生产/静态模式：构建前端并由代理托管
npm run build                 # 产出 dist/
npm start                     # 代理托管 dist/，默认 http://localhost:8787
#    浏览器打开 http://localhost:8787

# 端口被占用时（例如上一次会话残留进程占住 8787）：
PORT=8790 npm start           # 然后用 http://localhost:8790
```

---

## 配置

配置存于 `data/config.json`（首次启动自动生成，含明文 API Key，请勿提交到仓库）：

```json
{
  "model": {
    "provider": "openai",
    "baseURL": "<模型服务 BaseURL，OpenAI 兼容接口，例如 https://api.example.com/v1>",
    "apiKey": "sk-...",
    "modelName": "deepseek-v4-flash"
  },
  "mcp": {
    "address": "<Linkly AI 知识库 MCP 地址>",
    "token": ""
  },
  "knowledge": {},
  "retrieval": { "topK": 5 },
  "slicing": { "enabled": false, "chunkSize": 4000 },
  "severityThreshold": "all"
}
```

或直接在页面 **「设置」** 中修改并保存（模型 API、知识库地址、检索 Top-K、切片、严重度阈值、发送前脱敏开关）。设置页通过 `/api/config` 读写，浏览器看到的 Key 始终为掩码。

---

## 使用流程

1. **导入**：首页拖入 `.docx` 或 `.pdf`，浏览器内即时预览（PDF 用原生 iframe）。
2. **审核**：点「开始 AI 审核」，前端按三阶段运行并在页面呈现进度：
   - 已解析文档 N 个段落；
   - 提炼针对性审核问题（带 GMP 维度标签）；
   - 逐项检索知识库证据并校验；
   - 生成结构化批注。
3. **复核**：结果页可在浏览器内对批注增删改。
4. **导出**：
   - Word 文档 →「导出批注版 Word」（原生 OOXML 批注）；
   - PDF 文档 →「导出批注版 PDF」（原版式高亮批注）。

---

## 审核引擎（三阶段）

| 阶段 | 说明 |
|------|------|
| 0. 脱敏（可选，默认开） | 对发给模型 / 知识库的文本做正则脱敏（姓名、工号、批号、设备编号、手机、邮箱、身份证），原始文档与导出文件不变。 |
| 1. 提炼关键问题 | 先判定文档类型（偏差 / 风险评估 / SOP / 其他），再按 **GMP 审核框架六维**生成 4–8 个针对性问题，每题绑定向知识库检索的 query。 |
| 2. 检索知识库证据 | 逐题调用 Linkly AI 知识库 MCP `search` 检索相关库，返回条款与原文片段作为依据。 |
| 3. 生成批注 | 综合原文 + 问题 + 证据，输出每条批注：`anchorPara / anchorText（锚定原文）/ severity（严重度）/ summary（问题摘要）/ question / suggestion（建议）/ reference（依据）`。 |

批注署名统一为 **DK QMS**。

---

## 注意事项 / 常见问题

- **知识库必须在线**：审核依赖本机 Linkly AI 知识库 MCP 检索，若未启动，阶段 2 会报错；可在「设置 → 列举知识库」验证连通。
- **PDF 导出是保留版式的高亮批注**，不是 Word 那种可编辑 OOXML 批注；如需 Word 批注版，请导入 `.docx`。
- **端口冲突**：默认 8787，被占用时可用 `PORT=8790`（或任意空闲端口）启动，并相应访问该端口。
- **密钥安全**：`data/config.json` 含明文 Key，已列入 `.gitignore`，切勿提交。
- **模型偶发不稳定**：`deepseek-v4-flash` 可能偶发无响应 / 畸形 JSON / 截断，前端已加硬性总超时与自动重试；若仍失败，可在「设置」更换更快更稳的模型（如 `deepseek-chat`）。

---

## 调试

- 连通性排查：确保本机 Linkly AI 知识库 MCP 已启动，可在「设置 → 列举知识库」验证连通。
- 本地调试脚本（MCP 连通性探针、PDF 解析验证等）保留在开发环境，未随仓库发布；常见故障与排查要点见上方「注意事项」。

---

## 技术栈

前端：Vite · React 18 · TypeScript · Ant Design 5 · jszip · pdfjs-dist · pdf-lib · docx-preview
代理：Express · @modelcontextprotocol/sdk · undici
模型：DeepSeek 等 OpenAI 兼容接口 · 知识库：Linkly AI 本机 MCP
