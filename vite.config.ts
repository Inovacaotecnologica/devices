import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    base: '/', // Caminho base no GitHub Pages

    server: {
      port: 3000,
      host: '0.0.0.0',

      // Proxy para redirecionar chamadas /api → server.cjs (porta 5175)
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:5175',
          changeOrigin: true,
          secure: false
        }
      }
    },

    plugins: [react()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    },

    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    }
  };
});
