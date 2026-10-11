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
        id: '/',
        name: 'Khaos Nexus',
        short_name: 'Nexus',
        description: 'Khaos Nexus staff web control panel — under development',
        theme_color: '#0b0909',
        background_color: '#050505',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['utilities', 'productivity'],
        icons: [
          {
            src: '/nexus-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: 'Service Health',
            short_name: 'Services',
            url: '/#services'
          },
          {
            name: 'Account',
            short_name: 'Account',
            url: '/#account'
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
