import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Интерфейс модуля 04 «Акты ТП» (TP_Approval) — отдельная страница /tp/ внутри Сферы.
// Собирается после основного интерфейса (основной очищает dist/web).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/tp/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174, proxy: { '/tp/api': 'http://127.0.0.1:3000', '/tp/auth': 'http://127.0.0.1:3000' } },
  build: { outDir: '../../dist/web/tp', emptyOutDir: true },
});
