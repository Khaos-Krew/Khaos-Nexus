import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['nexus-mark.svg'],
      manifest: {
        name: 'Khaos Nexus',
        short_name: 'Nexus',
        description: 'Khaos Nexus web control surface',
        theme_color: '#0b0909',
        background_color: '#050505',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/nexus-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: []
      }
    })
  ],
  server: {
    host: true,
    port: 5173
  }
});
