import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const edition = process.env.DRUG_EDITION === 'cloud' ? 'cloud' : 'local';
export default defineConfig({
  base: process.env.DRUG_BASE_PATH || (edition === 'cloud' ? '/drug/' : '/'),
  define: { 'import.meta.env.DRUG_EDITION': JSON.stringify(edition) },
  plugins: [react(), { name: 'drug-edition', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'drug-edition', content: edition }, injectTo: 'head' }] }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4310' } },
  build: { target: 'es2022' },
});
