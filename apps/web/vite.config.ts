import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{port:5173,proxy:{'/api':{target:process.env.API_DEV_TARGET??'http://127.0.0.1:3001',changeOrigin:false}}},build:{manifest:true,sourcemap:false}});
