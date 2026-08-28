import { useEffect, useRef, useState } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Switch,
  Button,
  Space,
  Typography,
  App,
  Spin,
} from 'antd';
import { getConfig, saveConfig, getLibraries, type AppConfig } from '../api/client';

interface LibEntry {
  id: string;
  label: string;
}

// 解析 Linkly AI 知识库 list_libraries 的返回，兼容 JSON 数组/对象与纯文本列表。
function parseLibraries(text: string): LibEntry[] {
  if (!text || !text.trim()) return [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j
        .map((x: any) => {
          if (typeof x === 'string') return { id: x, label: x };
          const id = x?.id ?? x?.name ?? x?.key ?? x?.slug;
          const label = x?.name ?? x?.label ?? x?.description ?? id;
          return id ? { id: String(id), label: String(label ?? id) } : null;
        })
        .filter(Boolean) as LibEntry[];
    }
    if (j && typeof j === 'object') {
      return Object.entries(j).map(([k, v]: any) => ({
        id: k,
        label: v?.name ?? v?.label ?? v?.description ?? k,
      }));
    }
  } catch {
    /* 非 JSON，走文本解析 */
  }
  const out: LibEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.replace(/^[-*•\d.]\s*/, '');
    const m = cleaned.match(/^([A-Za-z0-9_./-]+)\s*[:：]?\s*(.*)$/);
    if (m && m[1]) out.push({ id: m[1], label: (m[2] || m[1]).trim() || m[1] });
  }
  return out;
}

const DEFAULT: AppConfig = {
  model: { provider: 'openai', baseURL: '', apiKey: '', modelName: '' },
  mcp: { address: '', token: '' },
  knowledge: {},
  retrieval: { topK: 5 },
  slicing: { enabled: false, chunkSize: 4000 },
  severityThreshold: 'all',
  desensitize: { enabled: true },
};

export default function SettingsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [libLoading, setLibLoading] = useState(false);
  const [libText, setLibText] = useState('');
  const [libs, setLibs] = useState<LibEntry[]>([]);
  const initialKnowledgeRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        let libEntries: LibEntry[] = [];
        try {
          const r = await getLibraries();
          if (r.ok) {
            libEntries = parseLibraries(r.text || '');
            setLibText(r.text || '(空)');
          }
        } catch {
          /* 知识库未配置或离线，留空，用户可稍后点「列举知识库」 */
        }
        initialKnowledgeRef.current = cfg.knowledge || {};
        setLibs(libEntries);
        form.setFieldsValue({
          model: { ...DEFAULT.model, ...cfg.model },
          mcp: { ...DEFAULT.mcp, ...cfg.mcp },
          knowledge: { ...DEFAULT.knowledge, ...cfg.knowledge },
          retrieval: { ...DEFAULT.retrieval, ...cfg.retrieval },
          slicing: { ...DEFAULT.slicing, ...cfg.slicing },
          severityThreshold: cfg.severityThreshold ?? 'all',
          desensitize: { ...DEFAULT.desensitize, ...cfg.desensitize },
        });
        setLoading(false);
      } catch {
        form.setFieldsValue(DEFAULT);
        setLoading(false);
      }
    })();
  }, [form]);

  const loadLibs = async () => {
    setLibLoading(true);
    try {
      const r = await getLibraries();
      if (r.ok) {
        setLibText(r.text || '(空)');
        setLibs(parseLibraries(r.text || ''));
      } else {
        message.error(`知识库列举失败：${r.error}`);
      }
    } finally {
      setLibLoading(false);
    }
  };

  const onSave = async () => {
    const v = await form.validateFields();
    const patch = {
      model: {
        ...v.model,
        apiKey: v.model.apiKey === '******' ? undefined : v.model.apiKey,
      },
      mcp: v.mcp,
      knowledge: { ...initialKnowledgeRef.current, ...(v.knowledge || {}) },
      retrieval: v.retrieval,
      slicing: v.slicing,
      severityThreshold: v.severityThreshold,
      desensitize: v.desensitize,
    };
    await saveConfig(patch);
    message.success('设置已保存');
  };

  if (loading) return <Spin />;

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        设置
      </Typography.Title>

      <Form form={form} layout="vertical" style={{ maxWidth: 720 }}>
        <Card title="模型 API" size="small" style={{ marginBottom: 16 }}>
          <Form.Item label="Provider" name={['model', 'provider']}>
            <Select
              options={[
                { value: 'openai', label: 'OpenAI 兼容' },
                { value: 'claude', label: 'Claude' },
                { value: 'ollama', label: '本地 Ollama' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name={['model', 'baseURL']}
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name={['model', 'apiKey']}>
            <Input.Password placeholder="留空表示不修改" />
          </Form.Item>
          <Form.Item
            label="模型名称"
            name={['model', 'modelName']}
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="如 gpt-4o / 你的模型 ID" />
          </Form.Item>
        </Card>

        <Card title="知识库（Linkly AI MCP）" size="small" style={{ marginBottom: 16 }}>
          <Form.Item
            label="MCP 地址"
            name={['mcp', 'address']}
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="本机 Linkly AI 知识库提供的 MCP 端点地址" />
          </Form.Item>
          <Form.Item label="MCP Token（可选）" name={['mcp', 'token']}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="知识库范围"
            tooltip="由 Linkly AI 知识库 list_libraries 动态发现。勾选需要参与审核的库；未勾选的库不会被检索。"
          >
            {libs.length ? (
              <Space size={[16, 8]} wrap>
                {libs.map((lib) => (
                  <Space key={lib.id} size={6}>
                    <Form.Item name={['knowledge', lib.id]} valuePropName="checked" noStyle>
                      <Switch />
                    </Form.Item>
                    <span>{lib.label}</span>
                  </Space>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">
                尚未读取到知识库列表，请点击右侧「列举知识库」后重试。
              </Typography.Text>
            )}
          </Form.Item>
          <Button onClick={loadLibs} loading={libLoading}>
            列举知识库（list_libraries）
          </Button>
          {libText && (
            <pre
              style={{
                marginTop: 12,
                background: '#F7F9FC',
                padding: 12,
                borderRadius: 8,
                whiteSpace: 'pre-wrap',
                maxHeight: 280,
                overflow: 'auto',
                fontSize: 12,
              }}
            >
              {libText}
            </pre>
          )}
        </Card>

        <Card title="检索与切片" size="small" style={{ marginBottom: 16 }}>
          <Form.Item label="检索 Top-K" name={['retrieval', 'topK']}>
            <InputNumber min={1} max={20} />
          </Form.Item>
          <Form.Item label="启用切片" name={['slicing', 'enabled']} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="切片长度（字符）" name={['slicing', 'chunkSize']}>
            <InputNumber min={500} max={20000} step={500} />
          </Form.Item>
          <Form.Item label="严重度阈值" name="severityThreshold">
            <Select
              options={[
                { value: 'all', label: '全部' },
                { value: 'medium', label: '中及以上' },
                { value: 'high', label: '仅高' },
              ]}
            />
          </Form.Item>
        </Card>

        <Card title="隐私与安全" size="small" style={{ marginBottom: 16 }}>
          <Form.Item
            label="发送前脱敏"
            name={['desensitize', 'enabled']}
            valuePropName="checked"
            tooltip="默认开启。在把文档文本发送给模型与知识库之前，自动对姓名/工号/手机/邮箱/身份证/批号/设备编号等敏感信息打码。原始 docx 与导出的「已批注.docx」不受影响。"
          >
            <Switch />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            脱敏仅作用于「模型与知识库看到的文本」，因此批注锚点可能更频繁地回退为整段高亮。如需对导出文件也脱敏，请在需求中说明。
          </Typography.Paragraph>
        </Card>

        <Button type="primary" onClick={onSave}>
          保存设置
        </Button>
      </Form>
    </div>
  );
}
