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

  if (window.__ppRunning) return
  window.__ppRunning = true

  // Capture focused element before window.open() can blur it.
  var activeEl = document.activeElement

  var isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  var currentCanonical = canonicalURL(window.location.href)
  var RELAY_URL = PORTPASS_URL + 'relay.html'

  ;(async function run() {
    try {
      // Open relay.html as a small popup window. relay.html handles the picker UI,
      // ECDH key exchange with Dashboard, and sends a fill command back to this page.
      var pp = window.open(RELAY_URL, '_blank', 'popup=yes,width=360,height=480')
      if (!pp) { showError('Portpass could not open — allow popups for this site'); return }

      // Wait for relay to finish connecting to Dashboard and doing key exchange.
      var readyMsg
      try { readyMsg = await recv(pp, ['ready', 'error'], 8000) }
      catch (_) {
        try { pp.close() } catch (_2) {}
        showError('Portpass did not respond — make sure it is open and unlocked')
        return
      }
      if (readyMsg.type === 'error') { showError(readyMsg.message); return }

      // Send the current page URL so relay can search for matching records.
      pp.postMessage({ type: 'init', url: currentCanonical, isSecure: isSecure }, PORTPASS_ORIGIN)

      // Wait for fill command or error. User may take time to pick a record.
      var result
      try { result = await recv(pp, ['fill', 'error'], 60000) }
      catch (_) { try { pp.close() } catch (_2) {} ; return }
      if (result.type === 'error') { showError(result.message); return }

      // Execute the autofill sequence on the login page.
      var startEl = isUsableInput(activeEl) ? activeEl : null
      showFillOverlay(result.title, result.autotype, result.fields, startEl)

    } catch (e) {
      showError(e.message || String(e))
    } finally {
      window.__ppRunning = false
    }
  })()

  // ── Overlay helpers ──────────────────────────────────────────────────────

  function mkOverlay() {
    var div   = document.createElement('div')
    div.id    = '__pp'
    div.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
      'background:#1a1d21', 'color:#f1ede4', 'border-radius:8px',
      'padding:12px 16px', 'font-family:system-ui,-apple-system,sans-serif',
      'font-size:14px', 'max-width:320px',
      'box-shadow:0 4px 20px rgba(0,0,0,.5)',
    ].join(';')
    var close = document.createElement('button')
    close.textContent = '×'
    close.style.cssText = 'position:absolute;top:6px;right:10px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;padding:0;line-height:1'
    close.onclick = removeOverlay
    div.appendChild(close)
    return div
  }

  function showFillOverlay(title, autotype, fields, startEl) {
    removeOverlay()
    var div = mkOverlay()

    var titleEl = document.createElement('div')
    titleEl.style.cssText = 'font-weight:600;padding-right:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px'
    titleEl.textContent = title

    var hint = document.createElement('div')
    hint.style.cssText = 'font-size:12px;color:#aaa;margin-top:4px'
    hint.textContent = startEl ? 'Autofilling…' : 'Click the field to start from'

    div.appendChild(titleEl)
    div.appendChild(hint)
    document.body.appendChild(div)

    if (startEl) {
      executeAutotype(startEl, autotype, fields)
      setTimeout(removeOverlay, 1200)
    } else {
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
  }

  function showError(msg) {
    removeOverlay()
    var div = mkOverlay()
    var err = document.createElement('div')
    err.style.cssText = 'color:#e06c75;padding-right:20px'
    err.textContent = msg
    div.appendChild(err)
    document.body.appendChild(div)
    setTimeout(removeOverlay, 8000)
  }

  function removeOverlay() {
    var el = document.getElementById('__pp')
    if (el) el.parentNode.removeChild(el)
  }

  // ── Messaging helpers ────────────────────────────────────────────────────

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

  // ── DOM / autotype helpers ───────────────────────────────────────────────

  function canonicalURL(href) {
    var s = href || ''
    var pfxs = ['https://', 'http://']
    for (var i = 0; i < pfxs.length; i++) {
      if (s.toLowerCase().indexOf(pfxs[i]) === 0) { s = s.slice(pfxs[i].length); break }
    }
    var h = s.indexOf('#'); if (h >= 0) s = s.slice(0, h)
    var q = s.indexOf('?'); if (q >= 0) s = s.slice(0, q)
    s = s.toLowerCase()
    var sl = s.indexOf('/')
    if (sl >= 0) s = s.slice(0, sl).replace(/^www\./, '') + s.slice(sl)
    else s = s.replace(/^www\./, '')
    return s.replace(/\/+$/, '')
  }

  function isUsableInput(el) {
    if (!el) return false
    var tag = el.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false
    if (el.disabled || el.type === 'hidden') return false
    var bad = ['submit', 'button', 'reset', 'image', 'checkbox', 'radio']
    if (bad.indexOf(el.type) >= 0) return false
    var s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden'
  }

  function fillField(el, value) {
    var proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    var setter = Object.getOwnPropertyDescriptor(proto, 'value')
    if (setter && setter.set) setter.set.call(el, value)
    el.dispatchEvent(new Event('input',  { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function nextFocusable(el) {
    var q = 'input:not([disabled]):not([type=hidden]):not([type=submit]):not([type=button])' +
            ':not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]),' +
            'textarea:not([disabled])'
    var all = Array.from(document.querySelectorAll(q)).filter(function(e) {
      var s = getComputedStyle(e)
      return e.tabIndex >= 0 && s.display !== 'none' && s.visibility !== 'hidden'
    })
    var pos  = all.filter(function(e) { return e.tabIndex > 0 })
               .sort(function(a, b) { return a.tabIndex - b.tabIndex })
    var zero = all.filter(function(e) { return e.tabIndex === 0 })
    var sorted = pos.concat(zero)
    var i = sorted.indexOf(el)
    return i >= 0 ? sorted[i + 1] || null : null
  }

  function executeAutotype(startEl, sequence, fields) {
    var el = startEl
    for (var i = 0; i < sequence.length; i += 2) {
      var code = sequence[i + 1]
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
}
