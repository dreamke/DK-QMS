import { useEffect, useState } from 'react';
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

const DEFAULT: AppConfig = {
  model: { provider: 'openai', baseURL: '', apiKey: '', modelName: '' },
  mcp: { address: 'http://127.0.0.1:60606/mcp', token: '' },
  knowledge: { gmp: true, sop: true },
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

  useEffect(() => {
    getConfig()
      .then((cfg) => {
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
      })
      .catch(() => {
        form.setFieldsValue(DEFAULT);
        setLoading(false);
      });
  }, [form]);

  const loadLibs = async () => {
    setLibLoading(true);
    try {
      const r = await getLibraries();
      if (r.ok) setLibText(r.text || '(空)');
      else message.error(`知识库列举失败：${r.error}`);
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
      knowledge: v.knowledge,
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
            <Input placeholder="https://api.linkly.ai/v1" />
          </Form.Item>
          <Form.Item label="API Key" name={['model', 'apiKey']}>
            <Input.Password placeholder="留空表示不修改" />
          </Form.Item>
          <Form.Item
            label="模型名称"
            name={['model', 'modelName']}
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="如 gpt-4o / Linkly 模型 ID" />
          </Form.Item>
        </Card>

        <Card title="知识库（Linkly AI MCP）" size="small" style={{ marginBottom: 16 }}>
          <Form.Item
            label="MCP 地址"
            name={['mcp', 'address']}
            rules={[{ required: true, message: '必填' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="MCP Token（可选）" name={['mcp', 'token']}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="知识库范围"
            tooltip="对应 MCP 实际库：gmp（GMP 标准/法规）、sop（技术文档/标准操作规程）"
          >
            <Space size={16}>
              <Space size={6}>
                <Form.Item name={['knowledge', 'gmp']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <span>gmp（GMP 标准）</span>
              </Space>
              <Space size={6}>
                <Form.Item name={['knowledge', 'sop']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
                <span>sop（技术文档/SOP）</span>
              </Space>
            </Space>
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
