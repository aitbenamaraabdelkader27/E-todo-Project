import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    watch: {
      ignored: ['**/playwright-report/**', '**/test-results/**', '**/artifacts/**', '**/tests/**'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@js-temporal') || id.includes('/jsbi/')) return 'time';
          if (id.includes('/motion') || id.includes('/framer-motion')) return 'motion';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/'))
            return 'react';
        },
      },
    },
  },
});
