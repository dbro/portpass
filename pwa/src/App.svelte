<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { selectedFile } from './store.js'
  import { verifyDelegate } from './lib/delegates.js'
  import { loadWasm } from './wasm.js'
  import StartPage from './lib/StartPage.svelte'
  import Dashboard from './lib/Dashboard.svelte'
  import Toast from './lib/Toast.svelte'

  let wasmReady = $state(false)
  let wasmError = $state(null)
  let view = $state('start') // 'start' | 'dashboard'
  let hasBeenUnlocked = $state(false)
  let multipleInstances = $state(false)
  let isPopup = $state(false)
  let bridgeMode = $state(false)
  let pendingIntent = $state(null)

  let theme  = $state(localStorage.getItem('theme')  || 'dark')
  let accent = $state(localStorage.getItem('accent') || 'amber')
  let isDesktop             = $state(false)
  let bookmarkletsSupported = $state(false)

  $effect(() => { localStorage.setItem('theme',  theme)  })
  $effect(() => { localStorage.setItem('accent', accent) })

  async function handleIntent(intentUrl) {

    const q = intentUrl.indexOf('?')
    if (q < 0) return
    const params = new URLSearchParams(intentUrl.slice(q + 1))

    const url    = params.get('url')   ?? ''
    const sigB64 = params.get('sig')   ?? ''
    const pubB64 = params.get('pub')   ?? ''
    const ecdhB64 = params.get('ecdh') ?? ''
    const nonce  = params.get('nonce') ?? ''
    const ts     = parseInt(params.get('ts') ?? '0', 10)



    const age = Date.now() - ts
    if (age > 60000 || age < -5000) return

    const vaultUuid = get(selectedFile)?.uuid ?? ''
    if (!vaultUuid) return

    const spkiBytes = Uint8Array.from(atob(pubB64), c => c.charCodeAt(0))
    const sigBytes  = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0))
    const message   = new TextEncoder().encode(JSON.stringify({ url, nonce, ecdh: ecdhB64, ts }))

    const delegate = await verifyDelegate(vaultUuid, spkiBytes, message, sigBytes)
    if (!delegate) return

    pendingIntent = { url, nonce, ecdhSpkiB64: ecdhB64 }
  }

  // Respond to autofill queries when vault is locked (Dashboard handles unlocked case).
  // Suppressed in bridge mode — the autofill bridge handles all messaging instead.
  $effect(() => {
    if (!isPopup || bridgeMode) return
    function handleLockedQuery(event) {
      if (view !== 'start') return
      const t = event.data?.type
      if (t !== 'query' && t !== 'hello') return
      if (!event.source) return
      event.source.postMessage(
        { type: 'error', message: 'Vault is locked — unlock Portpass first' },
        event.origin
      )
    }
    window.addEventListener('message', handleLockedQuery)
    return () => window.removeEventListener('message', handleLockedQuery)
  })

  const THEME_COLORS = {
    light: { bg: '#f6f3ee', text: '#1c1f24' },
    dark:  { bg: '#14161a', text: '#f1ede4' },
  }

  $effect(() => {
    const colors = THEME_COLORS[theme] ?? THEME_COLORS.dark

    // Update browser chrome color
    let metaTheme = document.querySelector('meta[name="theme-color"]')
    if (!metaTheme) {
      metaTheme = document.createElement('meta')
      metaTheme.setAttribute('name', 'theme-color')
      document.head.appendChild(metaTheme)
    }
    metaTheme.setAttribute('content', colors.bg)

    // Update favicon — replace dark theme colors with current theme colors
    fetch(import.meta.env.BASE_URL + 'icon.svg')
      .then(r => r.text())
      .then(svg => {
        const themed = svg
          .replace(/#14161a/gi, colors.bg)
          .replace(/#f1ede4/gi, colors.text)
        const url = 'data:image/svg+xml,' + encodeURIComponent(themed)
        document.querySelector('link[rel="icon"]')?.setAttribute('href', url)
      })
      .catch(() => {})
  })

  // Ping an already-open unlocked Portpass tab via BroadcastChannel.
  // Returns true and sets up a bridge to the main Portpass tab if found; false otherwise.
  async function tryBridge() {
    const nonce = crypto.randomUUID()
    const ch = new BroadcastChannel('portpass-autofill')

    const found = await new Promise(resolve => {
      const t = setTimeout(() => { ch.close(); resolve(false) }, 300)
      ch.onmessage = e => {
        if (e.data?.type === 'pong' && e.data?.nonce === nonce) {
          clearTimeout(t)
          resolve(true)
        }
      }
      ch.postMessage({ type: 'ping', nonce })
    })

    if (!found) return false

    let bookmarkletSource = null
    let bookmarkletOrigin = null
    let sessionNonce = null

    window.addEventListener('message', event => {
      if (!event.source) return
      const msg = event.data
      if (!msg?.type) return

      if (msg.type === 'hello') {
        bookmarkletSource = event.source
        bookmarkletOrigin = event.origin
        sessionNonce = crypto.randomUUID()
        ch.postMessage({ type: 'hello', pubkey: msg.pubkey, nonce: sessionNonce })
      } else if (msg.type === 'query' && sessionNonce) {
        // Cross-validate the sent URL's hostname against the browser-provided event.origin.
        if (msg.url !== undefined) {
          const sentHost = msg.url.split('/')[0]
          const evHost = new URL(event.origin).host.replace(/^www\./, '').toLowerCase()
          if (sentHost !== evHost) return
        }
        ch.postMessage({ type: 'query', url: msg.url, uuid: msg.uuid, vaultUuid: msg.vaultUuid, nonce: sessionNonce })
      } else if (msg.type === 'save-url' && sessionNonce) {
        ch.postMessage({ type: 'save-url', uuid: msg.uuid, vaultUuid: msg.vaultUuid, url: msg.url, nonce: sessionNonce })
      }
    })

    ch.onmessage = e => {
      const msg = e.data
      if (!bookmarkletSource || msg?.nonce !== sessionNonce) return
      if (msg.type === 'hello-response') {
        bookmarkletSource.postMessage({ type: 'hello', pubkey: msg.pubkey }, bookmarkletOrigin)
      } else if (msg.type === 'records') {
        bookmarkletSource.postMessage({ type: 'records', records: msg.records }, bookmarkletOrigin)
      } else if (msg.type === 'record') {
        bookmarkletSource.postMessage({
          type: 'record', title: msg.title, autotype: msg.autotype,
          iv: msg.iv, ciphertext: msg.ciphertext,
        }, bookmarkletOrigin)
        setTimeout(() => window.close(), 100)
      } else if (msg.type === 'url-saved') {
        bookmarkletSource.postMessage({ type: 'url-saved' }, bookmarkletOrigin)
      } else if (msg.type === 'error') {
        bookmarkletSource.postMessage({ type: 'error', message: msg.message }, bookmarkletOrigin)
        setTimeout(() => window.close(), 100)
      }
    }

    return true
  }

  onMount(async () => {
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer((launchParams) => {
        if (launchParams.targetURL) {
          const intent = new URL(launchParams.targetURL).searchParams.get('intent')
          if (intent) handleIntent(intent)
        }
      })
    }

    isPopup = window.opener !== null

    const mq = window.matchMedia('(min-width: 768px)')
    isDesktop = mq.matches
    mq.addEventListener('change', e => { isDesktop = e.matches })

    // (any-pointer: fine) falsely excludes Windows touchscreen devices; detect mobile OS instead
    const isMobileOS = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    bookmarkletsSupported = !isMobileOS

    // In popup mode, try to bridge to an already-open unlocked Portpass tab.
    // If bridge succeeds, skip WASM loading — the popup is just a bridge.
    if (isPopup) {
      const bridged = await tryBridge()
      if (bridged) { bridgeMode = true; return }
    }

    if (navigator.locks) {
      const held = await new Promise(resolve => {
        navigator.locks.request('portpass-singleton', { ifAvailable: true }, lock => {
          resolve(!!lock)
          if (lock) return new Promise(() => {}) // hold for app lifetime
        })
      })
      if (!held) multipleInstances = true
    }

    try {
      await loadWasm()
      wasmReady = true
    } catch (e) {
      console.error('WASM load error', e)
      wasmError = e.message
    }
  })
</script>

<div
  class="vault-app theme-{theme} accent-{accent}"
  class:is-desktop={isDesktop && view === 'dashboard'}
>
  {#if bridgeMode}
    <div style="height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;opacity:0.5;font-size:14px;line-height:1.6">
      Portpass autofill in progress<br>This tab will close automatically
    </div>
  {:else if wasmError}
    <div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;text-align:center;">
      <span style="font-size:14px;color:var(--danger)">Failed to load engine: {wasmError}</span>
    </div>
  {:else if !wasmReady}
    <div style="height:100%;display:flex;align-items:center;justify-content:center;opacity:0.4;font-size:14px;">
      Loading…
    </div>
  {:else if view === 'start'}
    <StartPage {isPopup} autoBiometric={!hasBeenUnlocked} onopened={() => { hasBeenUnlocked = true; view = 'dashboard' }} />
  {:else}
    <Dashboard
      {isPopup}
      onclosed={() => view = 'start'}
      {theme}
      {accent}
      {isDesktop}
      {bookmarkletsSupported}
      ontheme={t => theme = t}
      onaccent={a => accent = a}
      intent={pendingIntent}
      onclearintent={() => { pendingIntent = null }}
    />
  {/if}
  {#if multipleInstances && !isPopup}
    <div class="multi-instance-warning">
      Portpass is already open in another tab — saving from both may cause conflicts.
    </div>
  {/if}
  <Toast />
</div>

<style>
  .multi-instance-warning {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    padding: 10px 16px;
    background: var(--danger);
    color: #fff;
    font-size: 13px;
    text-align: center;
  }
</style>
