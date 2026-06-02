// Portpass autofill bookmarklet page agent.
// The bookmarklet intentionally contains no durable private key. It only carries
// Portpass routing data; autofill.html signs requests using Portpass-origin storage.

export function makeDelegateBookmarkletUrl(portpassUrl, delegateId, relayUrl) {
  const origin = new URL(portpassUrl).origin
  return 'javascript:' + encodeURIComponent(
    `(${DELEGATE_BOOKMARKLET_IIFE.toString()})(${JSON.stringify(portpassUrl)},${JSON.stringify(origin)},${JSON.stringify(delegateId)},${JSON.stringify(relayUrl)})`
  )
}

// Self-contained IIFE embedded in the javascript: URL.
// PORTPASS_URL and PORTPASS_ORIGIN are baked in at install time via JSON.stringify.
// DELEGATE_ID identifies the paired autofill popup profile.
function DELEGATE_BOOKMARKLET_IIFE(PORTPASS_URL, PORTPASS_ORIGIN, DELEGATE_ID, RELAY_URL) {
  'use strict'

  if (window.__ppRunning) return
  window.__ppRunning = true

  var initialOrigin = window.location.origin
  var currentPageUrl = window.location.href
  var initialPageUrl = currentPageUrl
  var currentCanonical = canonicalURL(currentPageUrl)
  var saveUrl = window.location.origin + window.location.pathname
  var AUTOFILL_URL = PORTPASS_URL + 'autofill.html'
  var pp = null
  var startEl = null   // element the user clicked in the host page during the waiting phase
  var cleanedUp = false
  var capability = null

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
    try { pp.postMessage({ type: 'field-clicked', capability: capability, pageUrl: window.location.href }, PORTPASS_ORIGIN) } catch(_) {}
  }

  function onPopupMessage(e) {
    if (!pp || e.source !== pp || e.origin !== PORTPASS_ORIGIN) return
    var msg = e.data
    if (!msg || msg.capability !== capability) return
    if (msg.type === 'fill') {
      // Autofill popup has chosen an action and the user has clicked a field.
      // Remove the field-click listener so it doesn't fire again mid-fill.
      document.removeEventListener('click', onFieldClick, true)
      var el = startEl
      executeAutotype(el, msg.autotype, msg.fields, msg.allowSubmit !== false).then(function() {
        try { pp.postMessage({ type: 'fill-done', capability: capability, mode: msg.mode }, PORTPASS_ORIGIN) } catch(_) {}
        // Focus the autofill popup from the main-window context so the done state is visible.
        // (window.focus() from within autofill.html is blocked; pp.focus() from the opener works.)
        try { pp.focus() } catch(_) {}
        if (msg.mode === 'single') {
          startEl = null
          document.addEventListener('click', onFieldClick, true)
        } else {
          cleanup()
        }
      }).catch(function(err) {
        startEl = null
        document.addEventListener('click', onFieldClick, true)
        try { pp.postMessage({ type: 'fill-error', capability: capability, error: err && err.message || 'Autofill stopped', fieldCode: err && err.fieldCode || null }, PORTPASS_ORIGIN) } catch(_) {}
      })
    } else if (msg.type === 'cancel') {
      cleanup()
    }
  }

  ;(async function run() {
    try {
      var ppW = 380, ppH = 480
      var ppLeft = screen.width - ppW - 24
      pp = window.open(AUTOFILL_URL, 'portpass_autofill',
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
      capability = readyMsg.capability
      if (!capability) { cleanup(); return }

      pp.postMessage({
        type: 'init',
        capability: capability,
        url: currentCanonical,
        pageUrl: currentPageUrl,
        saveUrl: saveUrl,
        delegateId: DELEGATE_ID,
        relayUrl: RELAY_URL,
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
        if (e.source !== target || e.origin !== PORTPASS_ORIGIN) return
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
    var s = (href || '').trim()
    if (!s) return ''
    try {
      var parsed = new URL(s.indexOf('://') >= 0 ? s : 'https://' + s)
      return (parsed.host.replace(/^www\./i, '') + parsed.pathname).toLowerCase().replace(/\/+$/, '')
    } catch (_) {
      return ''
    }
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
      } else if (code === 'v' && seq[i + 2] === '{') {
        if (lit) { tokens.push({ type: 'lit', text: lit }); lit = '' }
        var end = seq.indexOf('}', i + 3)
        if (end < 0) break
        tokens.push({ type: 'v', name: seq.slice(i + 3, end) }); i = end + 1
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
    if (!el.isConnected) return false
    var s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.1) return false
    var r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 ||
        r.top >= window.innerHeight || r.left >= window.innerWidth) return false
    var x = Math.max(0, Math.min(window.innerWidth - 1, r.left + r.width / 2))
    var y = Math.max(0, Math.min(window.innerHeight - 1, r.top + r.height / 2))
    var top = document.elementFromPoint(x, y)
    return !!top && (top === el || el.contains(top))
  }

  function validatePage() {
    if (window.location.origin !== initialOrigin || window.location.href !== initialPageUrl)
      throw new Error('Page changed during autofill')
  }

  function validateField(el, code, startForm) {
    validatePage()
    if (!isUsableInput(el)) throw new Error('Destination field changed or is not visible')
    if (startForm && el.closest('form') !== startForm) throw new Error('Destination form changed during autofill')
    if (code === 'p' && el.type !== 'password') throw fieldError('Password destination is not a password field', code)
    if (code === '2' && ['text', 'tel', 'number'].indexOf(el.type) < 0) throw fieldError('One-time code destination is not suitable', code)
  }

  function fieldError(message, fieldCode) {
    var err = new Error(message)
    err.fieldCode = fieldCode
    return err
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
      return e.tabIndex >= 0 && isUsableInput(e)
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

  async function executeAutotype(startEl, sequence, fields, allowSubmit) {
    var tokens = parseAutotype(sequence)
    var el = startEl
    var startForm = startEl && startEl.closest('form')
    validateField(el, null, startForm)
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i]
      if (tok.type === 'delay') {
        await new Promise(function(r) { setTimeout(r, tok.ms) })
      } else if (tok.type === 'lit' || tok.type === 'v') {
        if (el) {
          validateField(el, null, startForm)
          fillField(el, tok.type === 'v' ? (fields['v{' + tok.name + '}'] || '') : tok.text)
        }
      } else {
        var code = tok.code
        if (code === 'u' || code === 'p' || code === 'm' || code === '2') {
          if (el) { validateField(el, code, startForm); fillField(el, fields[code] || '') }
        } else if (code === 't') {
          var next = nextFocusable(el)
          if (next) { if (el) el.dispatchEvent(new Event('blur', { bubbles: true })); next.focus(); el = next }
        } else if (code === 's') {
          var prev = prevFocusable(el)
          if (prev) { if (el) el.dispatchEvent(new Event('blur', { bubbles: true })); prev.focus(); el = prev }
        } else if (code === 'n') {
          if (!allowSubmit) continue
          validateField(el, null, startForm)
          if (el) {
            ['keydown', 'keypress', 'keyup'].forEach(function(evType) {
              el.dispatchEvent(new KeyboardEvent(evType, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true
              }))
            })
          }
          var form = el && el.closest('form')
          var submitBtn = (form && form.querySelector('[type=submit]')) ||
                          (form && form.querySelector('[default-button]'))
          if (!submitBtn && form) {
            var btns = Array.from(form.querySelectorAll('button:not([type=reset])'))
            if (btns.length === 1) submitBtn = btns[0]
          }
          if (submitBtn) {
            submitBtn.click()
          } else if (form) {
            try { form.requestSubmit() } catch (_) {
              try { form.submit() } catch (_2) {}
            }
          }
        }
      }
    }
  }
}
