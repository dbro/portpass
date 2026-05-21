// Portpass autofill bookmarklet — delegate (cross-profile) variant.
// makeDelegateBookmarkletUrl(portpassUrl, privKeyJwk) returns the javascript: URL
// for a named delegate. privKeyJwk is a Web Crypto JWK export of the ECDSA P-256 private key.

export function makeDelegateBookmarkletUrl(portpassUrl, privKeyJwk, delegateId) {
  const origin = new URL(portpassUrl).origin
  return 'javascript:' + encodeURIComponent(
    `(${DELEGATE_BOOKMARKLET_IIFE.toString()})(${JSON.stringify(portpassUrl)},${JSON.stringify(origin)},${JSON.stringify(privKeyJwk)},${JSON.stringify(delegateId)})`
  )
}

// Self-contained IIFE embedded in the javascript: URL.
// PORTPASS_URL and PORTPASS_ORIGIN are baked in at install time via JSON.stringify.
// PRIV_KEY_JWK is the ECDSA P-256 private key; DELEGATE_ID identifies the delegate on the switchboard.
function DELEGATE_BOOKMARKLET_IIFE(PORTPASS_URL, PORTPASS_ORIGIN, PRIV_KEY_JWK, DELEGATE_ID) {
  'use strict'

  if (window.__ppRunning) return
  window.__ppRunning = true

  if (window.location.href.startsWith(PORTPASS_URL)) {
    showError("Autofill isn’t available on the Portpass page itself")
    window.__ppRunning = false
    return
  }

  // Capture focused element before window.open() can blur it.
  var activeEl = document.activeElement

  var isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  var currentCanonical = canonicalURL(window.location.href)
  var saveUrl = window.location.origin + window.location.pathname
  var RELAY_URL = PORTPASS_URL + 'relay.html'

  ;(async function run() {
    try {
      var pp = window.open(RELAY_URL, '_blank', 'popup=yes,width=360,height=480')
      if (!pp) { showError('Portpass could not open — allow popups for this site'); return }

      // Wait for relay.html to signal it is ready to receive the init message.
      var readyMsg
      try { readyMsg = await recv(pp, ['ready', 'error'], 10000) }
      catch (_) {
        try { pp.close() } catch (_2) {}
        showError('Portpass autofill did not start — make sure switchboard is running')
        return
      }
      if (readyMsg.type === 'error') { showError(readyMsg.message); return }

      // Send URL, private signing key, and delegate ID to relay.html with strict targetOrigin.
      // relay.html signs and sends the request to the switchboard, then waits for a reply.
      pp.postMessage({
        type: 'init',
        url: currentCanonical,
        saveUrl: saveUrl,
        isSecure: isSecure,
        privKey: PRIV_KEY_JWK,
        delegateId: DELEGATE_ID,
      }, PORTPASS_ORIGIN)

      // Wait for fill command (relay decrypted and forwarded credentials) or error.
      var result
      try {
        result = await Promise.race([
          recv(pp, ['fill', 'error'], 3600000),
          new Promise(function(_, reject) {
            var t = setInterval(function() {
              if (pp.closed) { clearInterval(t); reject(new Error('closed')) }
            }, 200)
          }),
        ])
      } catch (_) { return }
      if (result.type === 'error') { showError(result.message); return }

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

  function firstVisibleInput() {
    var list = focusableList()
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect()
      if (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) return list[i]
    }
    return null
  }

  function showFillOverlay(title, autotype, fields, startEl) {
    removeOverlay()
    var div = mkOverlay()

    if (!startEl) {
      var nearEl = firstVisibleInput()
      if (nearEl) {
        var r = nearEl.getBoundingClientRect()
        var top = window.innerHeight - r.bottom >= 100
          ? Math.round(r.bottom + 8)
          : Math.max(8, Math.round(r.top - 96))
        div.style.top   = top + 'px'
        div.style.left  = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - 344)) + 'px'
        div.style.right = 'auto'
      } else {
        div.style.top       = '50%'
        div.style.left      = '50%'
        div.style.right     = 'auto'
        div.style.transform = 'translate(-50%,-50%)'
      }
    }

    var brand = document.createElement('div')
    brand.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2e3240'
    var logo = document.createElement('img')
    logo.src = PORTPASS_URL + 'icon.svg'
    logo.style.cssText = 'width:16px;height:16px;flex-shrink:0'
    var brandName = document.createElement('span')
    brandName.style.cssText = 'font-size:12px;font-weight:600;letter-spacing:0.01em'
    brandName.textContent = 'Portpass'
    brand.appendChild(logo)
    brand.appendChild(brandName)

    var titleEl = document.createElement('div')
    titleEl.style.cssText = 'font-weight:600;padding-right:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px'
    titleEl.textContent = title

    var hint = document.createElement('div')
    hint.style.cssText = 'font-size:12px;color:#aaa;margin-top:4px'
    hint.textContent = startEl ? 'Autofilling…' : 'Click the field to start from'

    div.appendChild(brand)
    div.appendChild(titleEl)
    div.appendChild(hint)
    document.body.appendChild(div)

    if (startEl) {
      executeAutotype(startEl, autotype, fields).then(removeOverlay)
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

  function parseAutotype(seq) {
    var tokens = []
    var lit = ''
    var i = 0
    while (i < seq.length) {
      if (seq[i] !== '\\') { lit += seq[i]; i++; continue }
      var code = seq[i + 1]
      if (!code) break
      if (code === '\\') {
        lit += '\\'; i += 2
      } else if (code === 'f') {
        if (lit) { tokens.push({ type: 'lit', text: lit }); lit = '' }
        var d = seq[i + 2]
        if (d && /^[1-9]$/.test(d)) { tokens.push({ type: 'f', n: parseInt(d) }); i += 3 }
        else { tokens.push({ type: 'f', n: 1 }); i += 2 }
      } else if (code === 'w' || code === 'W') {
        if (lit) { tokens.push({ type: 'lit', text: lit }); lit = '' }
        var j = i + 2, count = 0
        while (j < seq.length && count < 3 && /^[0-9]$/.test(seq[j])) { j++; count++ }
        var ms = (parseInt(seq.slice(i + 2, j)) || 0) * (code === 'W' ? 1000 : 1)
        tokens.push({ type: 'delay', ms: ms }); i = j
      } else if ('uptmn2s'.indexOf(code) >= 0) {
        if (lit) { tokens.push({ type: 'lit', text: lit }); lit = '' }
        tokens.push({ type: 'code', code: code }); i += 2
      } else {
        i += 2
      }
    }
    if (lit) tokens.push({ type: 'lit', text: lit })
    return tokens
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

  function focusableList() {
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
    return pos.concat(zero)
  }

  function nextFocusable(el) {
    var sorted = focusableList()
    var i = sorted.indexOf(el)
    return i >= 0 ? sorted[i + 1] || null : null
  }

  function prevFocusable(el) {
    var sorted = focusableList()
    var i = sorted.indexOf(el)
    return i > 0 ? sorted[i - 1] : null
  }

  async function executeAutotype(startEl, sequence, fields) {
    var tokens = parseAutotype(sequence)
    var el = startEl
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i]
      if (tok.type === 'delay') {
        await new Promise(function(r) { setTimeout(r, tok.ms) })
      } else if (tok.type === 'lit' || tok.type === 'f') {
        if (el) fillField(el, tok.type === 'f' ? (fields['f' + tok.n] || '') : tok.text)
      } else {
        var code = tok.code
        if (code === 'u' || code === 'p' || code === 'm' || code === '2') {
          if (el) fillField(el, fields[code] || '')
        } else if (code === 't') {
          var next = nextFocusable(el)
          if (next) { if (el) el.dispatchEvent(new Event('blur', { bubbles: true })); next.focus(); el = next }
        } else if (code === 's') {
          var prev = prevFocusable(el)
          if (prev) { if (el) el.dispatchEvent(new Event('blur', { bubbles: true })); prev.focus(); el = prev }
        } else if (code === 'n') {
          var form = el && el.closest('form')
          if (form) try { form.requestSubmit() } catch (_) { form.submit() }
        }
      }
    }
  }
}
