// Portpass autofill bookmarklet.
// makeBookmarkletUrl(portpassUrl) returns the javascript: URL for the bookmarks bar link.

export function makeBookmarkletUrl(portpassUrl) {
  const origin = new URL(portpassUrl).origin
  return 'javascript:' + encodeURIComponent(buildCode(portpassUrl, origin))
}

function buildCode(portpassUrl, portpassOrigin) {
  return `(${BOOKMARKLET_IIFE.toString()})
  (${JSON.stringify(portpassUrl)},${JSON.stringify(portpassOrigin)})`
}

// Self-contained IIFE. Receives (portpassUrl, portpassOrigin) as parameters so
// makeBookmarkletUrl can embed them at install time via JSON.stringify.
function BOOKMARKLET_IIFE(PORTPASS_URL, PORTPASS_ORIGIN) {
  'use strict'

  // Prevent concurrent runs (e.g. double-click).
  if (window.__ppRunning) return
  window.__ppRunning = true

  ;(async function run() {
    try {
      // 1. Open or focus the Portpass tab/window.
      const pp = window.open(PORTPASS_URL, 'portpass_autofill')
      if (!pp) { showError('Portpass could not open — allow popups for this site'); return }

      // 2. ECDH key exchange (with retry so WASM loading time is covered).
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']
      )
      const ourPub = await crypto.subtle.exportKey('jwk', pair.publicKey)

      let helloReply
      try {
        helloReply = await sendRetry(pp, { type: 'hello', pubkey: ourPub }, PORTPASS_ORIGIN)
      } catch (msg) {
        showError(typeof msg === 'string' ? msg : 'Portpass did not respond — make sure it is open and unlocked')
        return
      }
      if (helloReply.type === 'error') { showError(helloReply.message); return }

      const ppPub = await crypto.subtle.importKey(
        'jwk', helloReply.pubkey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
      )
      const sessionKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: ppPub }, pair.privateKey,
        { name: 'AES-GCM', length: 256 }, false, ['decrypt']
      )

      // 3. Query for the currently open record.
      pp.postMessage({ type: 'query' }, PORTPASS_ORIGIN)
      let qReply
      try { qReply = await recv(pp, ['record', 'error']) }
      catch (_) { showError('No response to query — try again'); return }
      if (qReply.type === 'error') { showError(qReply.message); return }

      // 4. Decrypt the credentials.
      const iv  = Uint8Array.from(atob(qReply.iv),         c => c.charCodeAt(0))
      const ct  = Uint8Array.from(atob(qReply.ciphertext), c => c.charCodeAt(0))
      const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct)
      const fields = JSON.parse(new TextDecoder().decode(pt))

      // 5. Show the two-step overlay.
      showOverlay(qReply.title, qReply.autotype, fields)
    } catch (e) {
      showError(e.message || String(e))
    } finally {
      window.__ppRunning = false
    }
  })()

  // Send msg to target and wait for a matching reply type, retrying every second
  // until timeout (to survive WASM load time on a freshly opened Portpass).
  function sendRetry(target, msg, origin, timeout, interval) {
    timeout  = timeout  || 15000
    interval = interval || 1000
    return new Promise(function(resolve, reject) {
      var start = Date.now(), timer
      function handler(e) {
        if (e.source !== target) return
        var t = e.data && e.data.type
        if (t === msg.type || t === 'error') {
          clearInterval(timer)
          window.removeEventListener('message', handler)
          resolve(e.data)
        }
      }
      window.addEventListener('message', handler)
      function attempt() {
        if (Date.now() - start > timeout) {
          clearInterval(timer)
          window.removeEventListener('message', handler)
          reject('Portpass did not respond — make sure it is open and unlocked')
          return
        }
        try { target.postMessage(msg, origin) } catch (_) {}
      }
      attempt()
      timer = setInterval(attempt, interval)
    })
  }

  // Wait for the next message from target matching one of the given types.
  function recv(target, types, timeout) {
    timeout = timeout || 5000
    return new Promise(function(resolve, reject) {
      var t = setTimeout(function() {
        window.removeEventListener('message', handler)
        reject('timeout')
      }, timeout)
      function handler(e) {
        if (e.source !== target) return
        if (types.indexOf(e.data && e.data.type) >= 0) {
          clearTimeout(t)
          window.removeEventListener('message', handler)
          resolve(e.data)
        }
      }
      window.addEventListener('message', handler)
    })
  }

  // Fill a field via the native value setter so React/Vue/Angular frameworks notice.
  function fillField(el, value) {
    var proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    var setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, value)
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // Return the next text-entry field after el, respecting tabindex order.
  // Deliberately excludes buttons, links, and non-text inputs so that \t skips
  // UI controls (e.g. a "show password" button) that appear between form fields.
  function nextFocusable(el) {
    var q = 'input:not([disabled]):not([type=hidden]):not([type=submit]):not([type=button])' +
            ':not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]),' +
            'textarea:not([disabled])'
    var all = Array.from(document.querySelectorAll(q)).filter(function(e) {
      var s = getComputedStyle(e)
      return e.tabIndex >= 0 && s.display !== 'none' && s.visibility !== 'hidden'
    })
    // Elements with tabindex > 0 first (ascending), then tabindex=0 in DOM order.
    var pos  = all.filter(function(e) { return e.tabIndex > 0 })
               .sort(function(a, b) { return a.tabIndex - b.tabIndex })
    var zero = all.filter(function(e) { return e.tabIndex === 0 })
    var sorted = pos.concat(zero)
    var i = sorted.indexOf(el)
    return i >= 0 ? sorted[i + 1] || null : null
  }

  // Execute the autotype sequence from startEl.
  function executeAutotype(startEl, sequence, fields) {
    var el = startEl
    for (var i = 0; i < sequence.length; i += 2) {
      var code = sequence[i + 1]   // sequence[i] === '\\'
      if (code === 'u' || code === 'p') {
        if (el) fillField(el, fields[code] || '')
      } else if (code === 't') {
        var next = nextFocusable(el)
        if (next) {
          if (el) el.dispatchEvent(new Event('blur', { bubbles: true }))
          next.focus()
          el = next
        }
      } else if (code === 'n') {
        var form = el && el.closest('form')
        if (form) try { form.requestSubmit() } catch (_) { form.submit() }
      }
    }
  }

  function mkOverlay() {
    var div   = document.createElement('div')
    div.id    = '__pp'
    div.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'background:#1a1d21', 'color:#f1ede4', 'border-radius:8px',
      'padding:12px 16px', 'font-family:system-ui,-apple-system,sans-serif',
      'font-size:14px', 'max-width:280px',
      'box-shadow:0 4px 20px rgba(0,0,0,.5)',
    ].join(';')
    var close        = document.createElement('button')
    close.textContent = '×'
    close.style.cssText = 'position:absolute;top:6px;right:10px;background:none;border:none;color:#666;font-size:20px;cursor:pointer;padding:0;line-height:1'
    close.onclick = removeOverlay
    div.appendChild(close)
    return div
  }

  function showOverlay(title, autotype, fields) {
    removeOverlay()
    var div = mkOverlay()

    var titleEl        = document.createElement('div')
    titleEl.style.cssText = 'font-weight:600;padding-right:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px'
    titleEl.textContent   = title

    var hint           = document.createElement('div')
    hint.style.cssText = 'font-size:12px;color:#aaa;margin-top:4px'
    hint.textContent   = 'Click the field to start from'

    div.appendChild(titleEl)
    div.appendChild(hint)
    document.body.appendChild(div)

    function onFieldClick(e) {
      var el  = e.target
      var tag = el && el.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
      if (el.type === 'hidden') return
      e.preventDefault()
      document.removeEventListener('click', onFieldClick, true)
      removeOverlay()
      executeAutotype(el, autotype, fields)
    }
    document.addEventListener('click', onFieldClick, true)
  }

  function showError(msg) {
    removeOverlay()
    var div = mkOverlay()
    var err        = document.createElement('div')
    err.style.cssText = 'color:#e06c75;padding-right:20px'
    err.textContent   = msg
    div.appendChild(err)
    document.body.appendChild(div)
    setTimeout(removeOverlay, 8000)
  }

  function removeOverlay() {
    var el = document.getElementById('__pp')
    if (el) el.parentNode.removeChild(el)
  }
}
