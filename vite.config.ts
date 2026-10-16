import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// maplibre-gl v5 spawns its worker from its own bundle; pre-bundling it in dev breaks the worker URL.
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 }, preview: { host: true, port: 4173, allowedHosts: true }, optimizeDeps: { exclude: ['maplibre-gl'] } });
