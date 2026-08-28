import { chatJSON } from './lib/llm';
import { search } from './lib/mcp';
import { desensitizeParagraphs } from './lib/desensitize';
import type { Annotation, ReviewQuestion, ReviewStats } from './api/client';

const SEV_ORDER: Record<string, number> = { 高: 3, 中: 2, 低: 1 };

function numberedText(paragraphs: { index: number; text: string }[], maxChars: number): string {
  let out = '';
  for (const p of paragraphs) {
    const line = `[${p.index}] ${p.text}\n`;
    if (maxChars && out.length + line.length > maxChars) break;
    out += line;
  }
  return out;
}

function enabledLibraries(config: any): string[] {
  const k = config.knowledge || {};
  return Object.keys(k).filter((name) => k[name]);
}

// ---------- GMP 审核维度框架 ----------
const GMP_AUDIT_FRAMEWORK = `GMP 文档审核应覆盖以下维度（按文档类型选取相关项）：
【偏差管理】问题描述完整性(5W1H：应发生/实际发生/时间地点/涉及产品工序批号设备/如何发现)、即时应急措施与现场隔离、偏差分级与初步风险评估、根本原因分析方法(5Why/鱼骨图/人机料法环测，须深挖到体系根因而非"人员培训不足")、产品影响评估(SISPQ：安全性/完整性/效价/纯度/质量)、CAPA完整性与可验证性(纠正与预防区分、责任人/完成时限/有效性确认)、历史相似事件回顾、偏差关闭与质量受权人批准
【CAPA】纠正与预防措施的区分、措施可落地可验证(非"加强管理")、是否经变更控制、有效性评估与验收
【风险评估(ICH Q9)】QRM生命周期(评估→控制→沟通→审查)、方法工具与风险级别相称、严重度/可能性评分有数据依据(非主观)、风险控制措施(预防/检测/缓解)、残余风险、风险审查与变更触发重评
【数据完整性(ALCOA+)】可归因(唯一账号/签名)、清晰、同期(无补记倒签)、原始、准确(无"试至合格")、完整(含失败/OOS/复测)、一致、持久、可用、审计追踪启用与复核
【文件管理/SOP】结构完整(目的/范围/职责/程序/记录/参考)、无模糊词("适当的""定期的")、版本与变更控制、签署批准、可读可操作(步骤≤9)、定期审核(≥每3年)
【合规与可追溯】引用条款/标准正确、记录可追溯、与注册/验证状态一致`;

type Emit = (event: string, data: any) => void;

async function extractQuestions(model: any, paragraphs: any[], emit: Emit) {
  const docText = numberedText(paragraphs, 16000);
  const system =
    '你是一位资深的 GMP（药品生产质量管理规范）文档审核专家，精通偏差调查、CAPA、ICH Q9 风险评估、数据完整性(ALCOA+)、SOP 文件管理等法规与标准。\n' +
    '你的任务不是泛泛地"读文档提问题"，而是**依据一套固定的 GMP 审核框架**，针对本文档的类型与内容，提出**有针对性、可核查**的审核问题。\n' +
    '每个问题都必须对应框架中的某个具体维度，并能指向知识库中可检索的 GMP/SOP 标准。';
  const user =
    '下面先给出 GMP 文档审核框架（你应据此选取相关维度）：\n' +
    GMP_AUDIT_FRAMEWORK +
    '\n\n待审核文档（每段前的 [n] 为段落编号）：\n\n' +
    docText +
    '\n\n请先判断文档类型（偏差报告 / 风险评估 / SOP / 其他），然后依据框架，挑选本文档最相关的 4-8 个维度。' +
    '针对每个维度，结合文档**具体内容**提出一条**针对性**审核问题——要能点出本文档可能缺失的要素、薄弱的环节或前后矛盾之处，而不是泛泛而谈。\n' +
    '每个问题给出：dimension（所选框架维度，表述尽量与框架一致，如 "根本原因分析"、"CAPA闭环"、"数据完整性-ALCOA+"、"风险评估方法"、"SOP结构" 等）、question（针对性审核问题，具体、可核查）、query（用于在 GMP/SOP 知识库检索对应标准的关键词，中文，8-20字，尽量包含标准/条款名，例如 "偏差 根本原因分析 5Why"、"CAPA 有效性确认"、"数据完整性 ALCOA 审计追踪"）。\n' +
    '仅输出 JSON，格式：{"docType":"...","questions":[{"id":1,"dimension":"...","question":"...","query":"..."}]}\n' +
    '注意：字段值中不要使用换行符或未经转义的双引号，所有内容保持在同一行内。';
  emit('progress', { stage: 'extract', message: 'AI 正在依据 GMP 审核框架，提炼针对性审核问题…' });
  const data = await chatJSON(model, { system, user, temperature: 0.2, json: true, maxTokens: 4000 });
  const questions: ReviewQuestion[] = (data.questions || []).map((q: any, i: number) => ({
    id: q.id ?? i + 1,
    dimension: q.dimension || '',
    aspect: q.dimension || '',
    question: q.question || '',
    query: q.query || q.question || '',
  }));
  emit('questions', { docType: data.docType || '', questions });
  return { questions, docType: data.docType || '' };
}

async function retrieveEvidence(questions: ReviewQuestion[], config: any, emit: Emit) {
  const libs = enabledLibraries(config);
  const topK = (config.retrieval && config.retrieval.topK) || 5;
  const evidence: any[] = [];
  let done = 0;

  for (const q of questions) {
    const hits: any[] = [];
    for (const lib of libs) {
      try {
        const r = await search(q.query, lib, topK);
        for (const item of r.results || []) {
          hits.push({
            library: lib,
            docId: item.doc_id,
            title: item.title || '',
            path: item.path || '',
            snippet: item.snippet || '',
            relevance: item.relevance ?? null,
          });
        }
      } catch (e: any) {
        emit('progress', { stage: 'search', message: `检索「${q.aspect}」在 ${lib} 失败：${e.message}` });
      }
    }
    const byDoc = new Map();
    for (const h of hits) {
      const prev = byDoc.get(h.docId);
      if (!prev || (h.relevance || 0) > (prev.relevance || 0)) byDoc.set(h.docId, h);
    }
    const merged = [...byDoc.values()]
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .slice(0, topK);
    evidence.push({ questionId: q.id, aspect: q.aspect, query: q.query, hits: merged });
    done += 1;
    emit('progress', {
      stage: 'search',
      message: `检索证据 ${done}/${questions.length}：${q.aspect}（命中 ${merged.length} 条）`,
      percent: Math.round((done / questions.length) * 100),
    });
  }
  emit('evidence', { evidence });
  return evidence;
}

function evidenceBlock(questions: ReviewQuestion[], evidence: any[]): string {
  const byId = new Map(evidence.map((e) => [e.questionId, e]));
  let out = '';
  for (const q of questions) {
    const e = byId.get(q.id);
    out += `\n【问题${q.id}·${q.aspect}】${q.question}\n`;
    const hits = (e && e.hits) || [];
    if (!hits.length) {
      out += '  （知识库无相关命中）\n';
      continue;
    }
    hits.forEach((h: any, i: number) => {
      const snip = (h.snippet || '(无摘要)').replace(/\s+/g, ' ').slice(0, 240);
      out += `  ${i + 1}. [${h.library}] ${h.title}｜相关度${(h.relevance ?? 0).toFixed(2)}\n     摘要：${snip}\n`;
    });
  }
  return out;
}

async function generateAnnotations(
  model: any,
  paragraphs: any[],
  questions: ReviewQuestion[],
  evidence: any[],
  emit: Emit,
  chunkStart: number,
  chunkEnd: number,
  docType: string,
  sourceEnum: string,
) {
  const slice = paragraphs.slice(chunkStart, chunkEnd);
  const docText = slice.map((p) => `[${p.index}] ${p.text}`).join('\n');
  const evi = evidenceBlock(questions, evidence);
  const system =
    '你是一位资深 GMP 文档审核专家。' +
    (docType ? `本文档类型识别为：${docType}。` : '') +
    '请基于「审核关键问题（已按 GMP 审核框架针对性提炼）」与「知识库证据」，对文档逐段核查，只针对确有问题、风险或改进空间之处生成批注。' +
    '不要为没有问题的内容强行批注。批注要专业、具体、可执行，并尽量引用证据中的标准/文件作为依据；批注的 category 应对应问题所属维度。';
  const user =
    '待审核文档（[n] 为段落编号，仅可对这些编号出现的段落生成批注）：\n' +
    docText +
    '\n\n审核关键问题与知识库证据：\n' +
    evi +
    '\n\n请输出批注 JSON，格式：\n' +
    '{"annotations":[{' +
    '"anchorPara": 段落编号(整数,必须来自上文出现的[n]),' +
    '"anchorText": "从该段原文中精确复制的、需要批注的片段(10-40字，必须是原文子串)",' +
    '"severity": "高|中|低",' +
    '"category": "问题类别(如 根因分析不足/CAPA不闭环/风险评估方法缺陷/数据可追溯性/条款引用错误 等)",' +
    '"clause": "引用的标准/文件依据(如 证据中的文件名或条款；无则填\'\')",' +
    '"summary": "问题说明(一句话)",' +
    '"suggestion": "具体修改建议",' +
    `"source": "${sourceEnum}"` +
    '}]}\n' +
    '要求：anchorText 必须是对应段落原文的子串；若整篇无实质问题可返回 {"annotations":[]}。\n' +
    '注意：字段值中不要使用换行符或未经转义的双引号，所有内容保持在同一行内。';
  const data = await chatJSON(model, { system, user, temperature: 0.2, json: true, maxTokens: 8000 });
  return (data.annotations || []).filter((a: any) => a && Number.isInteger(a.anchorPara));
}

function passesThreshold(sev: string, threshold: string | undefined): boolean {
  if (threshold === 'high') return sev === '高';
  if (threshold === 'medium') return (SEV_ORDER[sev] || 0) >= 2;
  return true;
}

export interface RunReviewParams {
  paragraphs: { index: number; text: string }[];
  config: any;
  emit: Emit;
}

export async function runReview({ paragraphs, config, emit }: RunReviewParams): Promise<Annotation[]> {
  const model = config.model || {};
  if (!model.baseURL) throw new Error('未配置模型 Base URL，请先在「设置 → 模型 API」中完成配置');
  if (!model.modelName) throw new Error('未配置模型名称，请先在「设置 → 模型 API」中完成配置');
  const enabledLibs = enabledLibraries(config);
  if (!enabledLibs.length) throw new Error('未启用任何知识库，请在「设置 → 知识库范围」中至少启用一个');

  const doMask = !config.desensitize || config.desensitize.enabled !== false;
  const modelParagraphs = doMask ? desensitizeParagraphs(paragraphs) : paragraphs;
  if (doMask) {
    emit('progress', {
      stage: 'desensitize',
      message: `已对发送给模型/知识库的文本进行敏感信息脱敏（姓名/工号/手机/邮箱/身份证/批号/设备编号等）`,
    });
  }

  const { questions, docType } = await extractQuestions(model, modelParagraphs, emit);
  if (!questions.length) throw new Error('未能提炼出审核问题，请检查文档内容或模型配置');

  const evidence = await retrieveEvidence(questions, config, emit);

  emit('progress', { stage: 'annotate', message: 'AI 正在综合证据生成批注…' });
  const slicing = config.slicing || {};
  const chunkSize = slicing.chunkSize || 4000;
  const chunks: [number, number][] = [];
  if (slicing.enabled) {
    let curStart = 0;
    let curChars = 0;
    for (let i = 0; i < modelParagraphs.length; i += 1) {
      curChars += modelParagraphs[i].text.length + 6;
      if (curChars >= chunkSize) {
        chunks.push([curStart, i + 1]);
        curStart = i + 1;
        curChars = 0;
      }
    }
    if (curStart < modelParagraphs.length) chunks.push([curStart, modelParagraphs.length]);
  } else {
    chunks.push([0, paragraphs.length]);
  }

  const sourceEnum = [...enabledLibs, '两者', '经验'].join('|');
  let annotations: any[] = [];
  for (let ci = 0; ci < chunks.length; ci += 1) {
    const [s, e] = chunks[ci];
    if (chunks.length > 1) {
      emit('progress', {
        stage: 'annotate',
        message: `生成批注（分片 ${ci + 1}/${chunks.length}）…`,
        percent: Math.round(((ci + 1) / chunks.length) * 100),
      });
    }
    const part = await generateAnnotations(model, modelParagraphs, questions, evidence, emit, s, e, docType, sourceEnum);
    annotations = annotations.concat(part);
  }

  const byIndex = new Map(modelParagraphs.map((p) => [p.index, p.text]));
  annotations = annotations
    .map((a, i) => {
      const paraText = byIndex.get(a.anchorPara) || '';
      let anchorText = (a.anchorText || '').trim();
      let anchorOk = anchorText && paraText.includes(anchorText);
      if (!anchorOk && anchorText) {
        const short = anchorText.slice(0, 20);
        if (paraText.includes(short)) {
          anchorText = short;
          anchorOk = true;
        }
      }
      return {
        id: i + 1,
        anchorPara: a.anchorPara,
        anchorText: anchorOk ? anchorText : a.anchorText || '',
        anchorOk,
        severity: ['高', '中', '低'].includes(a.severity) ? a.severity : '中',
        category: a.category || '',
        clause: a.clause || '',
        summary: a.summary || '',
        suggestion: a.suggestion || '',
        source: a.source || '',
      } as Annotation;
    })
    .filter((a) => passesThreshold(a.severity, config.severityThreshold || 'all'))
    .sort((a, b) => SEV_ORDER[b.severity]! - SEV_ORDER[a.severity]!);

  annotations.forEach((a, i) => (a.id = i + 1));

  emit('annotations', { annotations });
  emit('done', {
    annotations,
    questions,
    docType,
    stats: {
      paragraphs: paragraphs.length,
      questions: questions.length,
      annotations: annotations.length,
      high: annotations.filter((a) => a.severity === '高').length,
      medium: annotations.filter((a) => a.severity === '中').length,
      low: annotations.filter((a) => a.severity === '低').length,
    } as ReviewStats,
  });
  return annotations;
}
