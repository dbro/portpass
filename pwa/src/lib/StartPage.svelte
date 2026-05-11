<script>
  import { onMount } from 'svelte'
  import { get as idbGet, set as idbSet } from 'idb-keyval'
  import { openDatabase, createDatabase, getDatabaseData } from '../wasm.js'
  import { selectedFile, dbItems } from '../store.js'
  import Icon from './Icon.svelte'

  let { onopened } = $props()

  // 'landing' | 'unlock' | 'creating'
  let mode = $state('landing')
  let fileHandle = $state(null)  // FileSystemFileHandle
  let password = $state('')
  let showPw = $state(false)
  let error = $state('')
  let busy = $state(false)

  const supportsFilePicker = typeof window !== 'undefined' && 'showOpenFilePicker' in window

  onMount(async () => {
    if (!supportsFilePicker) return
    try {
      const handle = await idbGet('lastHandle')
      if (!handle) return
      const perm = await handle.queryPermission({ mode: 'read' })
      if (perm === 'granted') {
        fileHandle = handle
        mode = 'unlock'
      }
    } catch (e) {
      // ignore — browser may not support stored handles
    }
  })

  async function pickFile() {
    try {
      ;[fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
      })
      mode = 'unlock'
      error = ''
      password = ''
    } catch (e) {
      if (e.name !== 'AbortError') error = e.message
    }
  }

  async function unlock() {
    if (!password || !fileHandle) return
    busy = true
    error = ''
    try {
      const file = await fileHandle.getFile()
      const buf  = await file.arrayBuffer()
      openDatabase(new Uint8Array(buf), password)

      const items = getDatabaseData()
      dbItems.set(items)
      selectedFile.set({ handle: fileHandle, name: fileHandle.name })
      await idbSet('lastHandle', fileHandle)
      onopened()
    } catch (e) {
      error = 'Wrong password or invalid file.'
      console.error(e)
    } finally {
      busy = false
    }
  }

  async function create() {
    if (!password) return
    busy = true
    error = ''
    try {
      createDatabase(password)
      const items = getDatabaseData()
      dbItems.set(items)
      selectedFile.set({ handle: null, name: 'New vault' })
      onopened()
    } catch (e) {
      error = e.message
    } finally {
      busy = false
    }
  }

  function switchFile() {
    fileHandle = null
    password = ''
    error = ''
    mode = 'landing'
  }
</script>

{#if mode === 'landing'}
  <div class="start-landing">
    <div class="start-mark">
      <Icon name="lock" size={32}/>
    </div>
    <div class="start-title">Portpass</div>
    <div class="start-sub muted">Your passwords, on your device.</div>

    {#if error}
      <div class="unlock-error">{error}</div>
    {/if}

    <div class="start-actions">
      {#if supportsFilePicker}
        <button class="btn btn-primary" onclick={pickFile}>Open vault file</button>
      {:else}
        <div class="unlock-error" style="font-size:13px;text-align:center">
          Your browser doesn't support file picker.<br>
          Try Chrome or Safari.
        </div>
      {/if}
    </div>

    <div class="start-create muted">
      No vault yet?
      <button onclick={() => { mode = 'creating'; error = ''; password = '' }}>Create one</button>
    </div>
  </div>

{:else if mode === 'unlock'}
  <div class="unlock-screen">
    <div class="unlock-stack">
      <div class="unlock-mark">
        <Icon name="lock" size={28}/>
      </div>
      <div class="unlock-vault">{fileHandle?.name ?? 'Vault'}</div>
      <div class="unlock-sub muted">Vault is locked</div>

      <div class="unlock-pw">
        <input
          type={showPw ? 'text' : 'password'}
          bind:value={password}
          placeholder="Master password"
          onkeydown={e => { if (e.key === 'Enter' && password) unlock() }}
          autofocus
        />
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle password visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>

      {#if error}
        <div class="unlock-error">{error}</div>
      {/if}

      <button class="btn btn-primary" disabled={!password || busy} onclick={unlock}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>

      <button class="btn-text muted" style="margin-top:auto" onclick={switchFile}>
        Open a different vault
      </button>
    </div>
  </div>

{:else}
  <!-- creating -->
  <div class="unlock-screen">
    <div class="unlock-stack">
      <div class="unlock-mark">
        <Icon name="lock" size={28}/>
      </div>
      <div class="unlock-vault">New vault</div>
      <div class="unlock-sub muted">Choose a master password</div>

      <div class="unlock-pw">
        <input
          type={showPw ? 'text' : 'password'}
          bind:value={password}
          placeholder="Master password"
          onkeydown={e => { if (e.key === 'Enter' && password) create() }}
          autofocus
        />
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle password visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>

      {#if error}
        <div class="unlock-error">{error}</div>
      {/if}

      <button class="btn btn-primary" disabled={!password || busy} onclick={create}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>

      <button class="btn-text muted" style="margin-top:auto" onclick={switchFile}>
        Cancel
      </button>
    </div>
  </div>
{/if}
