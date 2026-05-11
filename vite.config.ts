import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite 构建工具配置
 * - 使用 @vitejs/plugin-react 提供 React Fast Refresh 与 JSX 支持
 * - 通过 alias 将 `@/` 映射到 `src/`，简化模块引用路径
 * - 定义 ali-oss 在浏览器侧运行所需的 Node 兼容性 polyfill
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 项目内统一使用 `@/xxx` 形式的绝对路径
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // ali-oss 内部依赖 process.env 与 global 等 Node 全局对象，需要在浏览器环境下进行 shim
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    port: 5173,
    open: true,
    host: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 按类型拆包，避免主 chunk 过大
        manualChunks: {
          react: ['react', 'react-dom'],
          antd: ['antd', '@ant-design/icons'],
          oss: ['ali-oss'],
        },
      },
    },
  },
});
