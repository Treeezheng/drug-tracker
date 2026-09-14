import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:process.env.DRUG_BASE_PATH||'/',plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:4310'}},build:{target:'es2022'}});
