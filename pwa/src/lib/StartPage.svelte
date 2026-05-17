<script>
  import { onMount } from 'svelte'
  import { get as idbGet, set as idbSet } from 'idb-keyval'
  import { openDatabase, createDatabase, closeDatabase, getDatabaseData, getDatabaseInfo, loadVaultFile } from '../wasm.js'
  import { selectedFile, dbItems, secondaryVaults } from '../store.js'
  import {
    isBiometricSupported, isBiometricEnrolled, isBiometricEnrolledForFile,
    enrollBiometric, unlockWithBiometric, clearBiometricForFile,
  } from './biometric.js'
  import { getSecondaryCredentials } from './secondaryVaults.js'
  import { getRecentHandles, pushRecentHandle } from './recentHandles.js'
  import Icon from './Icon.svelte'

  let { onopened, autoBiometric = true } = $props()

  function focusOnMount(node, condition = true) {
    if (condition) setTimeout(() => node.focus(), 0)
  }

  // 'landing' | 'unlock' | 'creating' | 'offer-biometric'
  let mode       = $state('landing')
  let fileHandle = $state(null)
  let password   = $state('')
  let showPw     = $state(false)
  let error      = $state('')
  let busy       = $state(false)

  let biometricAvailable = $state(false)
  let biometricEnrolled  = $state(false)

  const supportsFilePicker = typeof window !== 'undefined' && 'showOpenFilePicker' in window

  onMount(async () => {
    biometricAvailable = await isBiometricSupported()

    if (!supportsFilePicker) return
    try {
      const handles = await getRecentHandles()
      if (!handles.length) return
      const entry = handles[0]
      fileHandle = entry.handle
      mode = 'unlock'
      biometricEnrolled = entry.uuid
        ? await isBiometricEnrolled(entry.uuid)
        : await isBiometricEnrolledForFile(fileHandle.name)
      if (biometricEnrolled && autoBiometric) unlockBiometric()
    } catch {}
  })

  async function pickFile() {
    try {
      ;[fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
      })
      mode = 'unlock'
      error = ''
      password = ''
      biometricEnrolled = await isBiometricEnrolledForFile(fileHandle.name)
    } catch (e) {
      if (e.name !== 'AbortError') error = e.message
    }
  }

  // After a successful vault open, check whether to offer biometric enrollment.
  // The offer is shown at most once per vault file — if dismissed, the user can
  // enable biometric/PIN unlock later from the vault settings sheet.
  function afterUnlock() {
    const offerKey = `biometric-offered-${fileHandle?.name}`
    if (biometricAvailable && !biometricEnrolled && !localStorage.getItem(offerKey)) {
      localStorage.setItem(offerKey, '1')
      mode = 'offer-biometric'
    } else {
      onopened()
    }
  }

  async function unlock() {
    if (!password || !fileHandle) return
    busy = true; error = ''
    try {
      const perm = await fileHandle.requestPermission({ mode: 'read' })
      if (perm !== 'granted') { error = 'File access was denied.'; return }
      let file
      try { file = await fileHandle.getFile() } catch (e) {
        if (e.name === 'NotFoundError') { await handleFileMissing(); return }
        throw e
      }
      const buf  = await file.arrayBuffer()
      const vaultUuid = openDatabase(new Uint8Array(buf), password)
      dbItems.set(getDatabaseData(vaultUuid))
      const info     = getDatabaseInfo(vaultUuid)
      const writable = await probeWriteAccess(fileHandle)
      selectedFile.set({ handle: fileHandle, name: fileHandle.name, readonly: !writable, uuid: vaultUuid })
      try { await pushRecentHandle(fileHandle, vaultUuid) } catch {}
      await autoUnlockSecondaries(vaultUuid)
      afterUnlock()
    } catch (e) {
      error = 'Wrong password or invalid file.'
      console.error(e)
    } finally {
      busy = false
    }
  }

  async function unlockBiometric() {
    busy = true; error = ''
    try {
      // Retrieve the master password from biometric, use it immediately, let it go out of scope.
      let biometricPassword
      try {
        biometricPassword = await unlockWithBiometric(fileHandle.name)
      } catch (e) {
        error = e.name === 'NotAllowedError' ? 'Biometric authentication cancelled.' : e.message
        console.error(e)
        return
      }
      const perm = await fileHandle.requestPermission({ mode: 'read' })
      if (perm !== 'granted') { biometricPassword = null; error = 'File access was denied.'; return }
      let file
      try { file = await fileHandle.getFile() } catch (e) {
        if (e.name === 'NotFoundError') { biometricPassword = null; await handleFileMissing(); return }
        throw e
      }
      const buf  = await file.arrayBuffer()
      let vaultUuid
      try {
        vaultUuid = openDatabase(new Uint8Array(buf), biometricPassword)
      } catch {
        biometricPassword = null
        await clearBiometricForFile(fileHandle.name)
        biometricEnrolled = false
        error = 'Biometric/PIN unlock is out of date — please enter your master password.'
        return
      }
      biometricPassword = null
      dbItems.set(getDatabaseData(vaultUuid))
      const info     = getDatabaseInfo(vaultUuid)
      const writable = await probeWriteAccess(fileHandle)
      selectedFile.set({ handle: fileHandle, name: fileHandle.name, readonly: !writable, uuid: vaultUuid })
      await pushRecentHandle(fileHandle, vaultUuid)
      await autoUnlockSecondaries(vaultUuid)
      onopened()
    } finally {
      busy = false
    }
  }

  async function enableBiometric() {
    busy = true; error = ''
    try {
      const info = getDatabaseInfo($selectedFile?.uuid ?? '')
      await enrollBiometric(password, info?.uuid, fileHandle?.name)
      biometricEnrolled = true
      onopened()
    } catch (e) {
      error = e.message
      console.error(e)
    } finally {
      busy = false
    }
  }

  async function create() {
    if (!password) return
    busy = true; error = ''
    try {
      const vaultUuid = createDatabase(password)
      dbItems.set(getDatabaseData(vaultUuid))
      selectedFile.set({ handle: null, name: 'New vault', uuid: vaultUuid })
      onopened()
    } catch (e) {
      error = e.message
    } finally {
      busy = false
    }
  }

  async function autoUnlockSecondaries(primaryUuid) {
    try {
      const credentials = await getSecondaryCredentials(primaryUuid)
      if (credentials.length === 0) return
      const opened = []
      for (const cred of credentials) {
        const handle = cred.handle
        if (!handle) continue // no stored handle; user must manually re-link
        try {
          const perm = await handle.requestPermission({ mode: 'read' })
          if (perm !== 'granted') continue
          const vaultUuid = await loadVaultFile(handle, cred.masterPassword)
          if (vaultUuid !== cred.vaultUuid) { closeDatabase(vaultUuid); continue }
          const info  = getDatabaseInfo(vaultUuid)
          const items = getDatabaseData(vaultUuid)
          let readonly = true
          try { const w = await handle.createWritable(); await w.abort(); readonly = false } catch {}
          opened.push({
            handle, name: info?.name || handle.name,
            filename: handle.name, readonly,
            items: items.map(i => ({ ...i, vaultUuid })),
            uuid: vaultUuid, masterPassword: cred.masterPassword,
          })
        } catch {}
      }
      secondaryVaults.set(opened)
    } catch {}
  }

  async function probeWriteAccess(handle) {
    try {
      const w = await handle.createWritable()
      await w.abort()
      return true
    } catch {
      return false
    }
  }

  function switchFile() {
    fileHandle = null; password = ''; error = ''; mode = 'landing'
    secondaryVaults.set([])
  }

  async function handleFileMissing() {
    try {
      const handles = (await idbGet('recentHandles')) ?? []
      await idbSet('recentHandles', handles.filter(h => h.handle?.name !== fileHandle?.name))
    } catch {}
    fileHandle = null; password = ''; mode = 'landing'
    error = 'Vault file not found — it may have been moved or deleted.'
  }
</script>

{#if mode === 'landing'}
  <div class="start-landing">
    <div class="start-mark">
      <img src="{import.meta.env.BASE_URL}icon.svg" alt="Portpass" style="width:80px;height:80px" />
    </div>
    <div class="start-title">Portpass</div>
    <div class="start-sub muted">Your passwords, on your device.</div>

    {#if error}<div class="unlock-error">{error}</div>{/if}

    <div class="start-actions">
      {#if supportsFilePicker}
        <button class="btn btn-primary" onclick={pickFile}>Open vault file</button>
      {:else}
        <div class="unlock-error" style="font-size:13px;text-align:center">
          Your browser doesn't support file picker.<br>Try Chrome or Safari.
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
        <img src="{import.meta.env.BASE_URL}icon.svg" alt="Portpass" style="width:64px;height:64px" />
      </div>
      <div class="unlock-vault">{fileHandle?.name ?? 'Vault'}</div>
      <div class="unlock-sub" class:muted={!busy} class:unlock-busy={busy}>
        {busy ? 'Unlocking…' : 'Vault is locked'}
      </div>

      {#if busy}
        <div class="unlock-shimmer-wrap"><div class="unlock-shimmer"></div></div>
        <div class="unlock-hint muted">Your vault uses strong encryption — this takes a moment.</div>
      {/if}

      {#if biometricEnrolled}
        <button class="btn btn-biometric" disabled={busy} onclick={unlockBiometric}>
          <Icon name="face-id" size={22}/>
          <span>Unlock with biometric/PIN</span>
        </button>
        <div class="unlock-or muted">or use master password</div>
      {/if}

      <div class="unlock-pw">
        <input
          type={showPw ? 'text' : 'password'}
          bind:value={password}
          placeholder="Master password"
          onkeydown={e => { if (e.key === 'Enter' && password) unlock() }}
          use:focusOnMount={!biometricEnrolled}
        />
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle password visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>

      {#if error}<div class="unlock-error">{error}</div>{/if}

      <button class="btn btn-primary" disabled={!password || busy} onclick={unlock}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>

      <button class="btn-text muted" style="margin-top:auto" onclick={switchFile}>
        Open a different vault
      </button>
    </div>
  </div>

{:else if mode === 'offer-biometric'}
  <div class="unlock-screen">
    <div class="unlock-stack">
      <div class="unlock-mark"><Icon name="face-id" size={28}/></div>
      <div class="unlock-vault">Enable biometric/PIN unlock?</div>
      <div class="unlock-sub muted" style="text-align:left;max-width:320px">
        Skip typing your master password each time you open Portpass. Your device will offer one or more options:
      </div>
      <ul class="offer-list muted">
        <li>Fingerprint or face recognition</li>
        <li>Device PIN</li>
        <li>iCloud Keychain / Google Password Manager <span class="offer-note">(syncs a key to the cloud)</span></li>
      </ul>
      <div class="offer-footer muted">You can disable this at any time from the vault settings.</div>

      {#if error}<div class="unlock-error">{error}</div>{/if}

      <button class="btn btn-primary" disabled={busy} onclick={enableBiometric}>
        {busy ? 'Setting up…' : 'Enable biometric/PIN unlock'}
      </button>

      <button class="btn-text muted" onclick={onopened}>Not now</button>
    </div>
  </div>

{:else}
  <!-- creating -->
  <div class="unlock-screen">
    <div class="unlock-stack">
      <div class="unlock-mark">
        <img src="{import.meta.env.BASE_URL}icon.svg" alt="Portpass" style="width:64px;height:64px" />
      </div>
      <div class="unlock-vault">New vault</div>
      <div class="unlock-sub muted">Choose a master password</div>

      <div class="unlock-pw">
        <input
          type={showPw ? 'text' : 'password'}
          bind:value={password}
          placeholder="Master password"
          onkeydown={e => { if (e.key === 'Enter' && password) create() }}
          use:focusOnMount
        />
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle password visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>

      {#if error}<div class="unlock-error">{error}</div>{/if}

      <button class="btn btn-primary" disabled={!password || busy} onclick={create}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>

      <button class="btn-text muted" style="margin-top:auto" onclick={switchFile}>Cancel</button>
    </div>
  </div>
{/if}
