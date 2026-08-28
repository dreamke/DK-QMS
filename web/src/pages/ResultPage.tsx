import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Tag,
  Space,
  Typography,
  Button,
  Empty,
  Segmented,
  Statistic,
  Row,
  Col,
  Tooltip,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Popconfirm,
  App,
} from 'antd';
import {
  ArrowLeftOutlined,
  ExportOutlined,
  FileWordOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { renderAsync } from 'docx-preview';
import type { DocState, ReviewResult } from '../App';
import type { Annotation, Severity, ReviewStats } from '../api/client';
import { exportAnnotated } from '../api/client';

const SEV_COLOR: Record<Severity, string> = { 高: '#D93F30', 中: '#E08600', 低: '#3B82F6' };
const SEV_BG: Record<Severity, string> = { 高: '#FEF1F0', 中: '#FEF6E9', 低: '#EEF4FE' };

function computeStats(anns: Annotation[], base: ReviewStats | null): ReviewStats {
  return {
    paragraphs: base?.paragraphs ?? 0,
    questions: base?.questions ?? 0,
    annotations: anns.length,
    high: anns.filter((a) => a.severity === '高').length,
    medium: anns.filter((a) => a.severity === '中').length,
    low: anns.filter((a) => a.severity === '低').length,
  };
}

export default function ResultPage({
  doc,
  result,
  onResultChange,
  onBack,
}: {
  doc: DocState | null;
  result: ReviewResult | null;
  onResultChange: (r: ReviewResult) => void;
  onBack: () => void;
}) {
  const { message } = App.useApp();
  const previewRef = useRef<HTMLDivElement>(null);
  const [sevFilter, setSevFilter] = useState<string>('全部');
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState<Annotation | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    async function render() {
      if (!doc || !previewRef.current) return;
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
            breakPages: true,
            experimental: true,
            useBase64URL: true,
          });
        }
      } catch (e) {
        if (!cancelled) message.error(`预览渲染失败：${(e as Error).message}`);
      }
    }
    render();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, message]);

  const annotations = result?.annotations || [];
  const stats = result?.stats;

  const filtered = useMemo(() => {
    if (sevFilter === '全部') return annotations;
    return annotations.filter((a) => a.severity === sevFilter);
  }, [annotations, sevFilter]);

  function commit(next: Annotation[]) {
    const renumbered = next.map((a, i) => ({ ...a, id: i + 1 }));
    onResultChange({
      annotations: renumbered,
      questions: result?.questions || [],
      stats: computeStats(renumbered, result?.stats || null),
    });
  }

  function handleDelete(id: number) {
    commit(annotations.filter((a) => a.id !== id));
    message.success('已删除该批注');
  }

  function openEdit(a: Annotation) {
    setEditing(a);
    form.setFieldsValue(a);
  }

  function openAdd() {
    const blank: Annotation = {
      id: -1,
      anchorPara: 0,
      anchorText: '',
      anchorOk: true,
      severity: '中',
      category: '',
      clause: '',
      summary: '',
      suggestion: '',
      source: '经验',
    };
    setEditing(blank);
    form.setFieldsValue(blank);
  }

  async function handleSaveEdit() {
    const values = await form.validateFields();
    if (!editing) return;
    if (editing.id === -1) {
      const na: Annotation = { ...editing, ...values, id: annotations.length + 1, anchorOk: true };
      commit([...annotations, na]);
      message.success('已新增批注');
    } else {
      commit(annotations.map((a) => (a.id === editing.id ? { ...a, ...values } : a)));
      message.success('已保存修改');
    }
    setEditing(null);
  }

  async function handleExport() {
    if (!doc) {
      message.error('缺少原始文档，无法导出');
      return;
    }
    if (!annotations.length) {
      message.warning('当前没有批注可导出');
      return;
    }
    setExporting(true);
    try {
      await exportAnnotated(doc.buffer.slice(0), doc.name || '审核结果', annotations);
      message.success('已生成带批注的文件，开始下载');
    } catch (e) {
      message.error((e as Error).message || '导出失败');
    } finally {
      setExporting(false);
    }
  }

  if (!result) {
    return <Empty description="尚无审核结果，请先在「导入审核」中运行 AI 审核" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={16} align="middle">
          <Col flex="auto">
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
                返回
              </Button>
              <FileWordOutlined style={{ color: '#3B82F6', fontSize: 18 }} />
              <Typography.Text strong>{doc?.name || '审核结果'}</Typography.Text>
            </Space>
          </Col>
          <Col>
            <Space size={24}>
              <Statistic
                title="批注总数"
                value={stats?.annotations ?? annotations.length}
                valueStyle={{ fontSize: 20 }}
              />
              <Statistic title="高" value={stats?.high ?? 0} valueStyle={{ fontSize: 20, color: SEV_COLOR['高'] }} />
              <Statistic title="中" value={stats?.medium ?? 0} valueStyle={{ fontSize: 20, color: SEV_COLOR['中'] }} />
              <Statistic title="低" value={stats?.low ?? 0} valueStyle={{ fontSize: 20, color: SEV_COLOR['低'] }} />
            </Space>
          </Col>
          <Col>
              <Tooltip
                title={
                  doc?.kind === 'pdf'
                    ? '将当前批注以高亮形式写入原 PDF（保留版式，可在阅读器审阅窗格查看）'
                    : '将当前批注写入原文档的 Word 审阅批注（可在 Word/WPS 审阅窗格查看与处理）'
                }
              >
                <Button
                  type="primary"
                  icon={<ExportOutlined />}
                  loading={exporting}
                  onClick={handleExport}
                >
                  {doc?.kind === 'pdf' ? '导出批注版 PDF' : '导出批注版 Word'}
                </Button>
              </Tooltip>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col span={13}>
          <Card title="文档预览" styles={{ body: { padding: 0, background: '#EEF1F6' } }}>
            <div
              style={{
                height: 'calc(100vh - 240px)',
                overflow: 'auto',
                padding: doc?.kind === 'pdf' ? 0 : 20,
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
          </Card>
        </Col>
        <Col span={11}>
          <Card
            title={`审核批注（${filtered.length}）`}
            extra={
              <Space>
                <Segmented
                  size="small"
                  value={sevFilter}
                  onChange={(v) => setSevFilter(v as string)}
                  options={['全部', '高', '中', '低']}
                />
                <Button size="small" icon={<PlusOutlined />} onClick={openAdd}>
                  新增
                </Button>
              </Space>
            }
            styles={{ body: { padding: 12 } }}
          >
            <div style={{ height: 'calc(100vh - 300px)', overflow: 'auto' }}>
              {filtered.length === 0 ? (
                <Empty description="无匹配批注" />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {filtered.map((a) => (
                    <AnnotationCard
                      key={a.id}
                      a={a}
                      onEdit={() => openEdit(a)}
                      onDelete={() => handleDelete(a.id)}
                    />
                  ))}
                </Space>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title={editing?.id === -1 ? '新增批注' : '编辑批注'}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleSaveEdit}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="anchorPara"
                label="段落编号"
                rules={[{ required: true, message: '请输入段落编号' }]}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: '高', label: '高' },
                    { value: '中', label: '中' },
                    { value: '低', label: '低' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="source" label="来源">
                <Select
                  allowClear
                  options={[
                    { value: 'gmp', label: 'gmp' },
                    { value: 'sop', label: 'sop' },
                    { value: '两者', label: '两者' },
                    { value: '经验', label: '经验' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="anchorText"
            label="原文片段（用于在 Word 中定位高亮，建议为原文子串）"
          >
            <Input placeholder="从原文精确复制的片段" />
          </Form.Item>
          <Form.Item name="category" label="问题类别">
            <Input placeholder="如 根因分析不足 / CAPA不闭环 / 风险评估方法缺陷" />
          </Form.Item>
          <Form.Item name="summary" label="问题说明" rules={[{ required: true, message: '请输入问题说明' }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="suggestion" label="修改建议">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="clause" label="依据（标准/文件/条款）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function AnnotationCard({
  a,
  onEdit,
  onDelete,
}: {
  a: Annotation;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      size="small"
      styles={{ body: { padding: 12 } }}
      style={{ borderLeft: `4px solid ${SEV_COLOR[a.severity]}`, background: SEV_BG[a.severity] }}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Row align="middle" wrap={false}>
          <Col flex="auto">
            <Space wrap size={6}>
              <Tag color={SEV_COLOR[a.severity]} style={{ marginRight: 0 }}>
                {a.severity}危
              </Tag>
              {a.category && <Tag>{a.category}</Tag>}
              {a.source && <Tag color="blue">{a.source}</Tag>}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                段落 #{a.anchorPara}
                {!a.anchorOk && '（锚定未精确匹配）'}
              </Typography.Text>
            </Space>
          </Col>
          <Col>
            <Space size={2}>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} />
              <Popconfirm title="删除此批注？" onConfirm={onDelete} okText="删除" cancelText="取消">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </Col>
        </Row>
        {a.anchorText && (
          <Typography.Paragraph
            style={{
              margin: 0,
              padding: '4px 8px',
              background: '#fff',
              borderRadius: 6,
              fontSize: 13,
              borderLeft: '3px solid #d9d9d9',
            }}
          >
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              原文：
            </Typography.Text>
            「{a.anchorText}」
          </Typography.Paragraph>
        )}
        <div>
          <Typography.Text strong>{a.summary}</Typography.Text>
        </div>
        {a.suggestion && (
          <div style={{ fontSize: 13 }}>
            <Typography.Text type="secondary">建议：</Typography.Text>
            {a.suggestion}
          </div>
        )}
        {a.clause && (
          <div style={{ fontSize: 12 }}>
            <Typography.Text type="secondary">依据：{a.clause}</Typography.Text>
          </div>
        )}
      </Space>
    </Card>
  );
}
