<script>
  import { onMount } from 'svelte'
  import { loadWasm } from './wasm.js'
  import StartPage from './lib/StartPage.svelte'
  import Dashboard from './lib/Dashboard.svelte'
  import Toast from './lib/Toast.svelte'

  let wasmReady = $state(false)
  let wasmError = $state(null)
  let view = $state('start') // 'start' | 'dashboard'

  let theme  = $state(localStorage.getItem('theme')  || 'dark')
  let accent = $state(localStorage.getItem('accent') || 'amber')
  let isDesktop = $state(false)

  $effect(() => { localStorage.setItem('theme',  theme)  })
  $effect(() => { localStorage.setItem('accent', accent) })

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

  onMount(async () => {
    const mq = window.matchMedia('(min-width: 768px)')
    isDesktop = mq.matches
    mq.addEventListener('change', e => { isDesktop = e.matches })

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
  {#if wasmError}
    <div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;text-align:center;">
      <span style="font-size:14px;color:var(--danger)">Failed to load engine: {wasmError}</span>
    </div>
  {:else if !wasmReady}
    <div style="height:100%;display:flex;align-items:center;justify-content:center;opacity:0.4;font-size:14px;">
      Loading…
    </div>
  {:else if view === 'start'}
    <StartPage onopened={() => view = 'dashboard'} />
  {:else}
    <Dashboard
      onclosed={() => view = 'start'}
      {theme}
      {accent}
      {isDesktop}
      ontheme={t => theme = t}
      onaccent={a => accent = a}
    />
  {/if}
  <Toast />
</div>
