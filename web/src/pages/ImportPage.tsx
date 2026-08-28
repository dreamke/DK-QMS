import { useEffect, useRef, useState } from 'react';
import { Upload, Card, Button, Space, Typography, App, Spin, Steps, Progress, Alert, Tag } from 'antd';
import { InboxOutlined, FileWordOutlined, FilePdfOutlined, ReloadOutlined, AuditOutlined } from '@ant-design/icons';
import { renderAsync } from 'docx-preview';
import type { DocState, ReviewResult } from '../App';
import { getConfig, exportAnnotated, type Annotation, type ReviewQuestion, type ReviewStats } from '../api/client';
import { parseDocx } from '../lib/docx';
import { parsePdf } from '../lib/pdf';
import { runReview } from '../review';

const STAGE_INDEX: Record<string, number> = {
  parse: 0,
  desensitize: 0,
  extract: 0,
  search: 1,
  annotate: 2,
};

export default function ImportPage({
  doc,
  onDoc,
  onReviewed,
}: {
  doc: DocState | null;
  onDoc: (d: DocState | null) => void;
  onReviewed: (r: ReviewResult) => void;
}) {
  const { message } = App.useApp();
  const previewRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [percent, setPercent] = useState<number | undefined>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [docType, setDocType] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    async function render() {
      if (!doc || !previewRef.current) return;
      setRendering(true);
      previewRef.current.innerHTML = '';
      try {
        if (doc.kind === 'pdf') {
          const blob = new Blob([doc.buffer], { type: 'application/pdf' });
          url = URL.createObjectURL(blob);
          const iframe = document.createElement('iframe');
          iframe.src = url;
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.style.background = '#fff';
          previewRef.current.appendChild(iframe);
        } else {
          const copy = doc.buffer.slice(0);
          await renderAsync(copy, previewRef.current, undefined, {
            className: 'docx',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            breakPages: true,
            experimental: true,
            useBase64URL: true,
          });
        }
      } catch (e) {
        if (!cancelled) message.error(`预览渲染失败：${(e as Error).message}`);
      } finally {
        if (!cancelled) setRendering(false);
      }
    }
    render();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, message]);

  const handleFile = async (f: File) => {
    const lower = f.name.toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const isDocx = lower.endsWith('.docx');
    if (!isPdf && !isDocx) {
      message.error('仅支持 .docx / .pdf 格式');
      return false;
    }
    const buffer = await f.arrayBuffer();
    onDoc({ name: f.name, size: f.size, buffer, kind: isPdf ? 'pdf' : 'docx' });
    message.success(`已载入：${f.name}`);
    return false;
  };

  const startReview = async () => {
    if (!doc) return;
    setReviewing(true);
    setErrorMsg('');
    setStageIdx(0);
    setPercent(undefined);
    setLog([]);
    setQuestions([]);
    let finalAnnotations: Annotation[] = [];
    let finalQuestions: ReviewQuestion[] = [];
    let finalStats: ReviewStats | null = null;
    try {
      // 统一的事件分发：把审校编排的 emit 映射到 UI 状态
      const emit = (event: string, data: any) => {
        if (event === 'progress') {
          setStageIdx(STAGE_INDEX[data.stage] ?? 0);
          if (typeof data.percent === 'number') setPercent(data.percent);
          setLog((prev) => [...prev, data.message]);
        } else if (event === 'questions') {
          setQuestions(data.questions);
          if (data.docType) setDocType(data.docType);
          finalQuestions = data.questions;
        } else if (event === 'annotations') {
          finalAnnotations = data.annotations;
        } else if (event === 'done') {
          finalAnnotations = data.annotations;
          finalQuestions = data.questions;
          finalStats = data.stats;
          setStageIdx(3);
          setPercent(100);
        } else if (event === 'error') {
          setErrorMsg(data.message);
        }
      };

      // 1) 浏览器内解析文档（docx / pdf）
      const cfg = await getConfig();
      const kind = doc.kind || (doc.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx');
      const parsed = kind === 'pdf' ? await parsePdf(doc.buffer.slice(0)) : await parseDocx(doc.buffer.slice(0));
      if (!parsed.paragraphs.length) throw new Error('文档解析为空（未提取到任何段落）');
      emit('progress', { stage: 'parse', message: `已解析文档：${parsed.paragraphs.length} 个段落（${kind}）` });

      // 2) 浏览器内运行三阶段审校编排（LLM + MCP 均经代理转发，密钥不进浏览器）
      await runReview({
        paragraphs: parsed.paragraphs,
        config: cfg,
        emit,
      });
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setReviewing(false);
    }

    if (!errorMsg && finalStats) {
      message.success(`审核完成：生成 ${finalAnnotations.length} 条批注`);
      onReviewed({ annotations: finalAnnotations, questions: finalQuestions, stats: finalStats });
    }
  };

  if (!doc) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          导入报告
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          拖入一份 Word / PDF 报告（偏差调查报告 / 风险评估报告 / SOP 等），系统会在浏览器内渲染预览，
          随后结合 gmp / sop 知识库进行 AI 审核，生成结构化批注。
        </Typography.Paragraph>
        <Card>
          <Upload.Dragger accept=".docx,.pdf" maxCount={1} showUploadList={false} beforeUpload={handleFile}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#3B82F6' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽 Word / PDF 文档到此区域</p>
            <p className="ant-upload-hint">支持 .docx 与 .pdf，文件仅在本机处理</p>
          </Upload.Dragger>
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Space>
            {doc.kind === 'pdf' ? (
              <FilePdfOutlined style={{ color: '#3B82F6', fontSize: 20 }} />
            ) : (
              <FileWordOutlined style={{ color: '#3B82F6', fontSize: 20 }} />
            )}
            <div>
              <Typography.Text strong>{doc.name}</Typography.Text>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {(doc.size / 1024).toFixed(1)} KB · 已在浏览器内渲染
              </Typography.Text>
            </div>
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => onDoc(null)} disabled={reviewing}>
              重新选择
            </Button>
            <Button
              type="primary"
              icon={<AuditOutlined />}
              loading={reviewing}
              onClick={startReview}
            >
              {reviewing ? '审核中…' : '开始 AI 审核'}
            </Button>
          </Space>
        </Space>
      </Card>

      {(reviewing || log.length > 0 || errorMsg) && (
        <Card size="small" title="审核进度">
          <Steps
            size="small"
            current={stageIdx}
            items={[
              { title: '提炼关键问题' },
              { title: '检索知识库证据' },
              { title: '生成批注' },
              { title: '完成' },
            ]}
          />
          {typeof percent === 'number' && (
            <Progress percent={percent} size="small" style={{ marginTop: 12 }} />
          )}
          {questions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">
                {docType && <Tag color="blue" style={{ marginRight: 6 }}>{docType}</Tag>}
                已依据 GMP 审核框架提炼 {questions.length} 个针对性审核问题：
              </Typography.Text>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {questions.map((q) => (
                  <li key={q.id} style={{ fontSize: 13 }}>
                    <Tag color="geekblue" style={{ marginRight: 4 }}>{q.dimension || q.aspect}</Tag>
                    {q.question}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {log.length > 0 && (
            <pre
              style={{
                marginTop: 12,
                background: '#F7F9FC',
                padding: 12,
                borderRadius: 8,
                whiteSpace: 'pre-wrap',
                maxHeight: 160,
                overflow: 'auto',
                fontSize: 12,
                marginBottom: 0,
              }}
            >
              {log.join('\n')}
            </pre>
          )}
          {errorMsg && (
            <Alert style={{ marginTop: 12 }} type="error" showIcon message="审核失败" description={errorMsg} />
          )}
        </Card>
      )}

      <Card title="文档预览" styles={{ body: { padding: 0, background: '#EEF1F6' } }}>
        <Spin spinning={rendering} tip="渲染中…">
          <div
            style={{
              height: doc?.kind === 'pdf' ? 'calc(100vh - 220px)' : undefined,
              minHeight: doc?.kind === 'pdf' ? undefined : 400,
              maxHeight: doc?.kind === 'pdf' ? undefined : 'calc(100vh - 200px)',
              overflow: 'auto',
              padding: doc?.kind === 'pdf' ? 0 : 24,
              display: 'flex',
              justifyContent: doc?.kind === 'pdf' ? 'stretch' : 'center',
            }}
          >
            <div
              ref={previewRef}
              className="docx-host"
              style={doc?.kind === 'pdf' ? { width: '100%', height: '100%' } : undefined}
            />
          </div>
        </Spin>
      </Card>
    </Space>
  );
}
