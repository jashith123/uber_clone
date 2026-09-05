import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on all interfaces so phones on the same Wi-Fi can connect
    port: 5173,
    allowedHosts: true, // allow tunnel hostnames (localtunnel / cloudflared)
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  build: {
    sourcemap: false,
  },
});
