// 敏感信息脱敏：在把文档文本送给模型 / 知识库之前，对常见 PII 打码。
// 仅影响「模型与 MCP 看到的文本」——原始 docx 与最终导出的「已批注.docx」保持不变。

const RULES = [
  {
    type: '姓名',
    pattern:
      /(报告人|审核人|批准人|调查人|责任人|编制人|复核人|起草人|负责人|联系人|记录人|操作员|受训人|培训人|主管|经理|总监|签名人|授权人)[:：]?\s*([一-龥]{2,4})/g,
    capture: 2,
    global: true,
  },
  {
    type: '工号',
    pattern: /(工号|员工编号|职工号|人员编号|职员号)[:：]?\s*([A-Za-z0-9\-]{3,12})/g,
    capture: 2,
    global: true,
  },
  {
    type: '手机号',
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    capture: 0,
    global: true,
  },
  {
    type: '邮箱',
    pattern: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
    capture: 0,
    global: true,
  },
  {
    type: '身份证',
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    capture: 0,
    global: true,
  },
  {
    type: '批号',
    pattern: /(批号|生产批号|产品批号|批代码)[:：]?\s*([A-Za-z0-9\-]{4,20})/g,
    capture: 2,
    global: true,
  },
  {
    type: '设备编号',
    pattern:
      /(设备编号|仪器编号|设备ID|固定资产编号|设备位号|仪表编号)[:：]?\s*([A-Za-z0-9\-]{3,20})/g,
    capture: 2,
    global: true,
  },
];

function shouldGlobalReplace(value: string): boolean {
  if (!value) return false;
  const isShortHan = /^[一-龥]+$/.test(value) && value.length < 3;
  return !isShortHan;
}

export function desensitizeText(text: string): string {
  if (!text) return text;
  let out = String(text);
  const globals: { value: string; tag: string }[] = [];
  for (const rule of RULES) {
    const tag = `[${rule.type}]`;
    out = out.replace(rule.pattern, (...args: any[]) => {
      const full = args[0];
      const value = rule.capture > 0 ? args[rule.capture] : full;
      if (rule.global && shouldGlobalReplace(value)) globals.push({ value, tag });
      return tag;
    });
  }
  for (const { value, tag } of globals) {
    if (shouldGlobalReplace(value)) out = out.split(value).join(tag);
  }
  return out;
}

export function desensitizeParagraphs(paragraphs: { index: number; text: string }[]): { index: number; text: string }[] {
  if (!Array.isArray(paragraphs)) return paragraphs;
  return paragraphs.map((p) => ({ ...p, text: desensitizeText(p.text) }));
}
