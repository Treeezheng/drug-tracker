import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dedicated synthetic-data UI environment. Never proxy this fixture to the personal database.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4311', changeOrigin: true,
      configure(proxy) { proxy.on('proxyReq', (outgoing, incoming) => {
        if (incoming.headers.origin === 'http://127.0.0.1:5174') outgoing.setHeader('origin', 'http://127.0.0.1:4311');
      }); },
    } } },
});
