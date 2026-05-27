import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import { copyFileSync, existsSync } from 'fs'
import { minify } from 'terser'

function bookmarkletPlugin() {
  return {
    name: 'bookmarklet-iife-minify',
    async transform(code, id) {
      if (!id.endsWith('bookmarklet.js')) return null
      const marker = 'function DELEGATE_BOOKMARKLET_IIFE'
      const fnStart = code.indexOf(marker)
      if (fnStart === -1) return null
      const result = await minify(code.slice(fnStart), { compress: true, mangle: true })
      return {
        code: code.replace('DELEGATE_BOOKMARKLET_IIFE.toString()', JSON.stringify(result.code)),
        map: null,
      }
    }
  }
}

let version = '0.0.0-dev'
try {
  version = execSync('git describe --tags --dirty --always').toString().trim()
} catch (e) {
  console.warn('Could not get git version:', e)
}

export default defineConfig({
  plugins: [
    bookmarkletPlugin(),
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['wasm_exec.js', 'portpass.wasm.gz', 'icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Portpass',
        short_name: 'Portpass',
        description: 'Password manager — your vault, your device',
        theme_color: '#14161a',
        display: 'standalone',
        background_color: '#14161a',
        start_url: '/portpass/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ],
        protocol_handlers: [
          {
            protocol: 'web+portpass',
            url: '/portpass/?intent=%s'
          }
        ],
        launch_handler: {
          client_mode: 'focus-existing'
        }
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,gz,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5000000,
	// Inject the header into the requests
        manifestTransforms: [async (entries) => {
          const manifest = entries.map(entry => {
            return {
              ...entry,
              // This tells Workbox to use custom headers for requests
              headers: { 'ngrok-skip-browser-warning': 'true' }
            }
          })
          return { manifest }
        }]
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
