import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端根目录为 web/，构建产物输出到项目根 dist/，由代理 server 托管。
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    // 关闭自动清空：WorkBuddy 的 genie-safe-delete 会拦截 vite 的 rmSync，
    // 导致 build 在清空 dist 时失败。改为直接覆盖（旧 hash 资源残留无害）。
    emptyOutDir: false,
  },
});
