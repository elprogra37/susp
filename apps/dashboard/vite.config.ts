import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 para que el puerto publicado del contenedor sea alcanzable
    // desde el host.
    host: '0.0.0.0',
    port: 55703,
    strictPort: true,
    watch: {
      // El bind mount de Windows no propaga eventos de filesystem al contenedor
      // Linux, así que sin sondeo la recarga en caliente no se entera de nada.
      usePolling: true,
      interval: 500,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
