import type { ReactNode } from 'react';
import { Layout, Menu, Typography } from 'antd';
import { FileProtectOutlined, SettingOutlined, AuditOutlined } from '@ant-design/icons';
import type { PageKey } from '../App';

const { Header, Content } = Layout;

export default function AppLayout({
  page,
  onChange,
  hasResult,
  children,
}: {
  page: PageKey;
  onChange: (p: PageKey) => void;
  hasResult?: boolean;
  children: ReactNode;
}) {
  const items = [
    { key: 'import', icon: <FileProtectOutlined />, label: '导入审核' },
    ...(hasResult ? [{ key: 'result', icon: <AuditOutlined />, label: '审核结果' }] : []),
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fff',
          borderBottom: '1px solid #E5E9F0',
          paddingInline: 24,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0, color: '#3B82F6' }}>
          DK QMS · 文档审核助手
        </Typography.Title>
        <Menu
          mode="horizontal"
          selectedKeys={[page]}
          onClick={(e) => onChange(e.key as PageKey)}
          items={items}
          style={{ borderBottom: 'none', minWidth: 320, justifyContent: 'flex-end' }}
        />
      </Header>
      <Content style={{ padding: 24, width: '100%', maxWidth: 1400, margin: '0 auto' }}>
        {children}
      </Content>
    </Layout>
  );
}
