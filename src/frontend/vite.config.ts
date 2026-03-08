import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  cacheDir: 'C:/ViteCache/copilot-care-frontend',
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'echarts-charts': ['echarts/charts'],
          'echarts-components': ['echarts/components'],
          'echarts-renderers': ['echarts/renderers'],
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
});
