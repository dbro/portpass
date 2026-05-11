import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

let version = '0.0.0-dev'
try {
  version = execSync('git describe --tags --dirty --always').toString().trim()
} catch (e) {
  console.warn('Could not get git version:', e)
}

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['wasm_exec.js', 'portpass.wasm.gz', 'icon.svg'],
      manifest: {
        name: 'Portpass',
        short_name: 'Portpass',
        description: 'Password manager — your vault, your device',
        theme_color: '#ffffff',
        display: 'standalone',
        background_color: '#ffffff',
        start_url: '/portpass/',
        icons: [
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 5000000,
      }
    })
  ],
  base: '/portpass/',
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version)
  }
})
