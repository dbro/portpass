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
  // isUsableInput is a function declaration so it is hoisted and available here.
  var activeEl = isUsableInput(document.activeElement) ? document.activeElement : null

  var isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  var currentCanonical = canonicalURL(window.location.href)
  var saveUrl = window.location.origin + window.location.pathname
  var RELAY_URL = PORTPASS_URL + 'relay.html'
  var pp = null
  var startEl = null   // element the user clicked in the host page during the waiting phase
  var cleanedUp = false

  function cleanup() {
    if (cleanedUp) return
    cleanedUp = true
    document.removeEventListener('click', onFieldClick, true)
    window.removeEventListener('message', onPopupMessage)
    window.__ppRunning = false
  }

  function onFieldClick(e) {
    var target = e.target
    if (!isUsableInput(target)) return
    e.preventDefault()
    startEl = target
    try { pp.postMessage({ type: 'field-clicked' }, PORTPASS_ORIGIN) } catch(_) {}
  }

  function onPopupMessage(e) {
    if (!pp || e.source !== pp) return
    var msg = e.data
    if (!msg) return
    if (msg.type === 'fill') {
      // Relay has chosen a record and the user has clicked a field (or one was pre-focused).
      // Remove the field-click listener so it doesn't fire again mid-fill.
      document.removeEventListener('click', onFieldClick, true)
      var el = startEl || activeEl
      executeAutotype(el, msg.autotype, msg.fields).then(function() {
        try { pp.postMessage({ type: 'fill-done' }, PORTPASS_ORIGIN) } catch(_) {}
        // Focus the relay popup from the main-window context so the done state is visible.
        // (window.focus() from within relay.html is blocked; pp.focus() from the opener works.)
        try { pp.focus() } catch(_) {}
        cleanup()
      })
    } else if (msg.type === 'cancel') {
      cleanup()
    }
  }

  ;(async function run() {
    try {
      var ppW = 380, ppH = 480
      var ppLeft = screen.width - ppW - 24
      pp = window.open(RELAY_URL, 'portpass_autofill',
        'popup=yes,width=' + ppW + ',height=' + ppH + ',left=' + ppLeft + ',top=24')
      if (!pp) { cleanup(); return }

      var readyMsg
      try { readyMsg = await recv(pp, ['ready', 'error'], 10000) }
      catch (_) {
        try { pp.close() } catch (_2) {}
        cleanup()
        return
      }
      if (readyMsg.type === 'error') { cleanup(); return }

      pp.postMessage({
        type: 'init',
        url: currentCanonical,
        saveUrl: saveUrl,
        isSecure: isSecure,
        privKey: PRIV_KEY_JWK,
        delegateId: DELEGATE_ID,
        hasActiveField: !!activeEl,
      }, PORTPASS_ORIGIN)

      // Register field-click listener (host page) and message handler (popup).
      window.addEventListener('message', onPopupMessage)
      document.addEventListener('click', onFieldClick, true)

      // Clean up when popup is closed by the user.
      var closeCheck = setInterval(function() {
        if (pp && pp.closed) { clearInterval(closeCheck); cleanup() }
      }, 500)

    } catch (e) {
      cleanup()
    }
  })()

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
