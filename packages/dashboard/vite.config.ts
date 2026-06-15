import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['flounder-immense-moose.ngrok-free.app'],
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3456',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3456',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
