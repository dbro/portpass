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

  // Capture focused element before window.open() can blur it.
  var activeEl = document.activeElement

  var isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  var currentCanonical = canonicalURL(window.location.href)
  var saveUrl = window.location.origin + window.location.pathname
  var RELAY_URL = PORTPASS_URL + 'relay.html'

  ;(async function run() {
    try {
      var ppW = 380, ppH = 520
      var ppLeft = screen.width - ppW - 24
      var pp = window.open(RELAY_URL, 'portpass_autofill',
        'popup=yes,width=' + ppW + ',height=' + ppH + ',left=' + ppLeft + ',top=24')
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

      if (result.theme) T = buildTheme(result.theme === 'dark')
      var startEl = isUsableInput(activeEl) ? activeEl : null
      showFillOverlay(result.title, result.autotype, result.fields, startEl)

    } catch (e) {
      showError(e.message || String(e))
    } finally {
      window.__ppRunning = false
    }
  })()

  // ── Overlay helpers ──────────────────────────────────────────────────────

  // Theme: relay.html (Portpass origin) sends the current Portpass theme in the fill
  // message. For early error overlays (before fill arrives) fall back to system preference.
  function buildTheme(dark) {
    return dark ? {
      bg:     '#1c1f24', border: '#2c3038', text: '#f1ede4', muted: '#a6a39b',
      amber:  '#d4953d', orange: '#c47030', red:  '#e08673', green: '#6cba8a',
      shadow: '0 8px 30px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35)',
    } : {
      bg:     '#fbfaf7', border: '#e3ddd1', text: '#1c1f24', muted: '#5a5d65',
      amber:  '#a06415', orange: '#8b5020', red:  '#b3361f', green: '#2c7a4e',
      shadow: '0 8px 30px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.10)',
    }
  }
  var T = buildTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches)

  function icoSvg(name, color) {
    var paths = {
      lock:  '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      warn:  '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      check: '<path d="m5 12 5 5L20 7"/>',
    }
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + color +
      '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'style="flex-shrink:0;margin-top:1px">' + paths[name] + '</svg>'
  }

  // Creates the overlay shell (header + appends to body). Returns the overlay element.
  // noHdrBorder: omit the header bottom border (used in success state).
  function mkOverlay(noHdrBorder) {
    removeOverlay()
    var ov = document.createElement('div')
    ov.id = '__pp'
    ov.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;width:236px;' +
      'background:' + T.bg + ';color:' + T.text + ';border-radius:12px;' +
      'font-family:system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.4;' +
      'box-shadow:' + T.shadow

    var hdr = document.createElement('div')
    hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 14px 10px;' +
      (noHdrBorder ? '' : 'border-bottom:1px solid ' + T.border)

    var logo = document.createElement('img')
    logo.src = PORTPASS_URL + 'icon.svg'
    logo.style.cssText = 'width:18px;height:18px;border-radius:4px;flex-shrink:0'

    var brand = document.createElement('span')
    brand.textContent = 'Portpass'
    brand.style.cssText = 'font-weight:600;font-size:13px;flex:1'

    var xBtn = document.createElement('button')
    xBtn.textContent = '×'
    xBtn.title = 'Dismiss'
    xBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0;flex-shrink:0;' +
      'width:22px;height:22px;display:flex;align-items:center;justify-content:center;' +
      'font-size:18px;line-height:1;color:' + T.muted + ';border-radius:4px'
    xBtn.onclick = removeOverlay

    hdr.appendChild(logo)
    hdr.appendChild(brand)
    hdr.appendChild(xBtn)
    ov.appendChild(hdr)
    document.body.appendChild(ov)
    return ov
  }

  // Appends and returns a body div inside the overlay.
  function ovBody(ov, pad) {
    var body = document.createElement('div')
    body.style.cssText = 'padding:' + (pad || '8px 14px 12px')
    ov.appendChild(body)
    return body
  }

  // Returns an amber action link element that opens the Portpass tab.
  function actionLink(text) {
    var a = document.createElement('a')
    a.textContent = text
    a.href = PORTPASS_URL
    a.target = '_blank'
    a.rel = 'noopener'
    a.style.cssText = 'display:block;color:' + T.amber + ';font-size:12px;font-weight:600;' +
      'text-decoration:none;margin-top:6px'
    a.onclick = function(e) { e.stopPropagation() }
    return a
  }

  function showFillOverlay(title, autotype, fields, startEl) {
    if (startEl) {
      // Field already focused — skip ready state, execute immediately then show success.
      executeAutotype(startEl, autotype, fields).then(showSuccess)
      return
    }

    var ov   = mkOverlay(false)
    var body = ovBody(ov)

    var nameEl = document.createElement('div')
    nameEl.textContent = title
    nameEl.style.cssText = 'font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'

    var hint = document.createElement('div')
    hint.textContent = 'Click the field to start from'
    hint.style.cssText = 'font-size:12px;color:' + T.muted + ';margin-top:4px'

    body.appendChild(nameEl)
    body.appendChild(hint)

    function onFieldClick(e) {
      var target = e.target
      var tag = target && target.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return
      if (target.type === 'hidden') return
      e.preventDefault()
      document.removeEventListener('click', onFieldClick, true)
      removeOverlay()
      executeAutotype(target, autotype, fields).then(showSuccess)
    }
    document.addEventListener('click', onFieldClick, true)
  }

  function showSuccess() {
    var ov   = mkOverlay(true)
    var body = ovBody(ov, '6px 14px 12px')
    var row  = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:8px'
    row.innerHTML = icoSvg('check', T.green)
    var msg = document.createElement('span')
    msg.textContent = 'Filled successfully'
    msg.style.cssText = 'color:' + T.green + ';font-weight:600'
    row.appendChild(msg)
    body.appendChild(row)
    setTimeout(removeOverlay, 1500)
  }

  function showError(msg) {
    var lm    = (msg || '').toLowerCase()
    var state = /lock/.test(lm) || /open a record/.test(lm)                           ? 'locked'
              : /autofill sequence|no autofill|autotype|could not parse/.test(lm)      ? 'noseq'
              : /non-https|insecure|sensitive.*http/.test(lm)                          ? 'http'
              : 'other'

    var ov   = mkOverlay(false)
    var body = ovBody(ov)
    var row  = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:flex-start;gap:8px'

    var content = document.createElement('div')
    var hd = document.createElement('div')

    if (state === 'locked') {
      row.innerHTML = icoSvg('lock', T.red)
      hd.textContent = 'Vault is locked'
      hd.style.cssText = 'font-weight:600;color:' + T.red
      content.appendChild(hd)
      content.appendChild(actionLink('Unlock Portpass →'))

    } else if (state === 'noseq') {
      row.innerHTML = icoSvg('warn', T.orange)
      hd.textContent = 'No autofill sequence set'
      hd.style.cssText = 'font-weight:600;color:' + T.orange
      content.appendChild(hd)
      content.appendChild(actionLink('Edit password in Portpass →'))

    } else if (state === 'http') {
      row.innerHTML = icoSvg('warn', T.red)
      hd.textContent = 'Insecure page — blocked'
      hd.style.cssText = 'font-weight:600;color:' + T.red
      var sub = document.createElement('div')
      sub.textContent = 'Passwords are only filled on HTTPS pages.'
      sub.style.cssText = 'font-size:12px;color:' + T.muted + ';margin-top:4px'
      content.appendChild(hd)
      content.appendChild(sub)

    } else {
      hd.textContent = msg || 'Autofill failed'
      hd.style.cssText = 'font-size:12px;color:' + T.red
      content.appendChild(hd)
      setTimeout(removeOverlay, 8000)
    }

    row.appendChild(content)
    body.appendChild(row)
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
