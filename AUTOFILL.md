# Portpass Autofill

Autofill allows users to automatically fill login form fields using credential data from their Portpass vault. A bookmarklet communicates with the Portpass PWA via an encrypted postMessage channel, fills form fields directly using the browser's DOM APIs, and navigates between fields using tab order — no clipboard involved.

## Scope

**Desktop browsers, bookmarklet-first.** Same-profile autofill is the primary zero-install path. Cross-profile and cross-browser autofill use the local switchboard relay when the user wants to keep Portpass in a separate clean browser profile; the relay transport and stricter authorization policy are implemented, while the full human-authenticated pairing ceremony is still in progress.

Portpass's core value is PWA portability — a URL that works on any device with no installation. Same-profile autofill preserves that model. Cross-profile autofill is an optional exception for users who deliberately want a clean Portpass browser profile; it requires a small local relay because browsers do not provide native cross-profile messaging.

Consequences of this scope:
- Mobile browsers: not supported — the bookmarks bar is not accessible
- Same-profile: works with no helper process. `window.open()`, `postMessage`, and `BroadcastChannel` stay within one browser profile.
- Cross-profile and cross-browser: uses a local WebSocket switchboard relay. Browser-native `BroadcastChannel` cannot cross profile or browser boundaries, so the relay is the transport bridge.
- Clean browser profile: supported by the relay protocol and copy/paste pairing ceremony.

### Cross-profile / cross-browser bridging options

These approaches trade the extension attack surface on the Portpass side for other costs. The local relay is the implemented cross-profile path.

- **Local WebSocket relay / switchboard** (companion app): a minimal local process runs a WebSocket switchboard on loopback, normally `http://localhost:7577` / `ws://localhost:7577/ws`. Cross-profile and cross-browser. Requires a running process. **Implemented** — see the `switchboard` repository and the **Cross-profile autofill** section below for the full design.
- **Protocol handler + clipboard dead drop** (not implemented): a connectionless protocol using `web+portpass://` launch URLs and a temporary encrypted clipboard response. This remains experimental because browser/OS routing across profiles is inconsistent.
- **Reflector server**: a remote WebSocket relay. Works cross-machine. Introduces server dependency, availability risk, and metadata leakage; conflicts with the no-server design principle.

Mobile autofill (iOS Credential Provider, Android Autofill Service) is a separate product decision that involves consciously leaving the PWA model. It is out of scope here.

### Current paired-delegate design (May 28, 2026)

The older cross-profile implementation proved that the relay model works, but its delegate private key was embedded in the bookmarklet. That made the page-side bookmarklet a long-lived authority holder, which is the wrong trust boundary: a hostile website or extension in the filling profile should never be able to steal a reusable key that can query the clean Portpass profile later.

The redesign treats the WebSocket relay as a public, untrusted packet carrier and makes `autofill.html` the paired delegate. The bookmarklet becomes a short-lived page agent with no durable secret.

Actors:
- **B**: bookmarklet/page agent, running on the login page in browser profile A
- **A**: `autofill.html`, running on the Portpass origin in browser profile A
- **D**: Dashboard, running on the Portpass origin in browser profile B with the unlocked vault
- **R**: public relay/switchboard; may observe, delay, replay, drop, reorder, or inject packets

Trust boundaries:
- B runs in the website page context and is not trusted with any long-lived secret.
- A is trusted only as an enrolled delegate. Its private key lives in Portpass-origin storage in profile A, preferably as a non-extractable WebCrypto key.
- D owns vault access and makes all authorization decisions.
- R is never trusted for confidentiality, integrity, ordering, or identity.

#### Pairing and delegate identity

A delegate is an enrolled autofill popup/profile. Its durable authority is the non-extractable ECDSA P-256 signing key stored by `autofill.html` in Portpass-origin IndexedDB. The bookmarklet does **not** contain the private key.

The delegate ID is deterministic from the delegate signing public key:

```
afp1_<base32(first 16 bytes of SHA-256(publicKeySpki))>
```

This ID is public. It selects the registered delegate record, while the private key proves control. VaultSheet may show a short display code derived from the same fingerprint, such as the final 8 base32 characters grouped as `ABCD-2345`.

Same-profile setup currently uses the "New bookmarklet" flow:
1. Portpass generates A's non-extractable signing keypair in the current browser profile.
2. Portpass stores A's private signing key, public key, delegate ID, created time, and relay URL in Portpass-origin storage.
3. Dashboard stores the delegate public key, name, created time, display code, and revocation/use metadata.
4. The generated bookmarklet contains only the Portpass URL, relay routing data, delegate ID, and page-agent code.

True cross-profile pairing needs one additional UI ceremony because profile A and profile B do not share IndexedDB. The implemented copy/paste-token flow is:

1. User opens D in the clean Portpass profile and chooses "Add autofill profile".
2. User opens A in the filling profile.
3. A generates a delegate signing keypair locally. The private key never leaves profile A's Portpass origin storage.
4. A shows a `ppair1_...` token containing its public key, relay URL, expiry, pairing ID, and short display code.
5. D stores A's public key, delegate name, created time, and revocation metadata.
6. A stores D's public key or pairing identifier so it can authenticate D's replies.

Pairing is the only moment where D grants durable authority. Revoking the delegate in D immediately prevents future cross-profile requests from A.

The same delegate model is used for same-profile and cross-profile autofill. The transport changes; the identity and authorization model does not.

#### Runtime exact-match flow

1. User clicks B while on a login page.
2. B opens A and sends page URL/routing data using `postMessage`.
3. A creates a fresh session ID and ephemeral ECDH keypair for its session with D.
4. A validates `event.source === opener`, validates that `event.origin` matches `pageUrl`, and rejects non-HTTPS pages except localhost.
5. A signs a request to D containing `{version, delegateId, sessionId, pageOrigin, pageUrl, aEphemeralPublicKey, action: "match", timestamp, nonce}`.
6. D verifies A's signature, freshness, delegate status, and message binding.
7. D searches only records whose saved URL is authorized for the verified page origin.
8. If an exact match is allowed by policy, D encrypts the credential payload to A's ephemeral public key and replies.
9. A decrypts the credential payload, waits for the user to click the form field if needed, and sends fill instructions to B.
10. B fills the page and discards all session material.

#### Same-profile behavior

Same-profile uses `BroadcastChannel('portpass-autofill')` between `autofill.html` and the unlocked Dashboard tab. The page-side bookmarklet opens `autofill.html`, passes page URL/routing data by `postMessage`, and then waits for the popup to send back fill instructions.

Same-profile keeps the existing convenience behavior:
- Initial lookup can return exact matches and same-site fuzzy metadata for the picker.
- If exactly one exact match exists, the popup auto-advances to the "click a field to begin" state.
- If multiple exact matches or fuzzy suggestions exist, the popup shows a picker.
- Picker search is available in the same-profile path.
- Credentials are fetched lazily after the user selects a record, encrypted to the popup's session ECDH key, then posted to the bookmarklet for filling.
- Save URL can update a selected non-readonly record after explicit user action.

#### Cross-profile behavior

Cross-profile uses the local switchboard WebSocket relay. The relay is a public packet carrier: it can observe metadata, delay, drop, replay, reorder, or inject packets, but it cannot forge signed delegate requests or decrypt credential replies.

Cross-profile is intentionally stricter than same-profile:
- Initial lookup releases no credentials unless there is an exact authorized saved URL match.
- If there is no exact match, D returns only a near-match count and the popup offers to view/edit the records in Portpass.
- Global cross-profile search is disabled by default. If it is reintroduced, it should be an explicit high-risk setting and metadata-only until an exact URL authorization exists.
- Relay `fill-uuid` credential fetches require the selected record's saved URL to exactly match the verified current page URL.
- Revoked delegates, stale timestamps, reused nonces, missing bindings, or wrong-origin URL claims are rejected.

#### Picker/search flow

For anything other than one exact authorized match, D returns metadata only to A:
- vault UUID
- record UUID
- title
- saved URL
- match type
- read-only flag

D must not include passwords, TOTP secrets/codes, sensitive custom fields, notes, or autotype field values in picker/search metadata.

Recommended policy:
- Exact match: may return one matching credential payload after A's signed request.
- Same-site fuzzy match: may return metadata to A for user selection.
- No same-site match: return "no match"; do not expose global vault search over cross-profile autofill. Could summarize count of fuzzy matches and offer to show them in Portpass to facilitate editing there.
- Save URL: require explicit user action in A and a signed request from A; D may update only the selected record with the verified current page URL.

If global search is retained for convenience, it should be an explicit high-risk feature, disabled by default, and should return metadata only until the user selects a record. A stronger mode is to require the user to open D for global search or URL attachment.

#### Message requirements

Every signed message should include:
- protocol version
- sender delegate ID
- intended recipient ID
- session ID
- action
- verified page origin and URL when relevant
- monotonic counter or nonce
- timestamp with a short validity window
- previous message hash or request ID for replies

D should reject messages with missing bindings, stale timestamps, reused nonces, unknown delegate IDs, revoked delegates, unexpected actions, or page origins outside the requested record's saved URL scope.

Sensitive credential payloads are encrypted to A's ephemeral session key for the selected fill session. A then sends the selected fill instructions to B over `postMessage` restricted to the verified opener origin.

#### Security properties

This redesign removes the transport trust concern: R can see traffic, but cannot read credentials, forge requests, or alter replies without detection.

It also removes the reusable-secret exposure from B. A malicious website can still observe credentials after they are filled into the page, and a sufficiently privileged extension in profile A can still steal filled values. That is inherent to autofill. The goal is narrower and achievable: the page-side actor cannot obtain a durable delegate key and cannot browse or request arbitrary vault records outside the verified current site authorization policy.

#### Remaining work

1. Add relay-focused tests for replay rejection, wrong-origin URL claims, metadata-only no-match behavior, and exact-match credential release.
2. Optionally add QR or short-code pairing on top of the copy/paste token flow.
3. Optionally add activity logs in VaultSheet: delegate, channel, page origin, action, record title, timestamp, and whether credentials were released.

---

## Relationship to the Password Safe format

Autofill uses the existing **Autotype field** (field type 0x0e) from the Password Safe v3 format. The default sequence `\u\t\p\n` covers the common case: fill username, tab to password, fill password, submit. Users configure this manually by editing the Autotype field on each record.

Documentation for the Password Safe Autotype feature is here: https://pwsafe.org/help/pwsafe.html

---

## Autotype codes recognised by Portpass

### Standard fields

| Code | Meaning |
|---|---|
| `\u` | Username |
| `\p` | Password |
| `\m` | Email |
| `\2` | TOTP one-time code (current value at fill time) |

**Security restriction:** if the autotype sequence references any sensitive field — `\p` (password), `\2` (TOTP), or a sensitive custom field (`\fN` where that field is hidden in the record view) — and the login page is served over plain HTTP (not HTTPS or localhost), Portpass refuses to fill and shows an error. Non-sensitive fields (`\u`, `\m`, non-sensitive `\fN`, literal text) are not restricted.

### Navigation

| Code | Meaning |
|---|---|
| `\t` | Tab — advance focus to the next field in tab order |
| `\s` | Shift-Tab — move focus to the previous field in tab order |
| `\n` | Enter — submit the form (`form.requestSubmit()`) |

### Delays

| Code | Meaning |
|---|---|
| `\wNNN` | Wait NNN milliseconds (1–3 digits, 0–999) |
| `\WNNN` | Wait NNN seconds (1–3 digits, 0–999) |

### Literal text

| Code | Meaning |
|---|---|
| `\\` | Literal backslash character |
| *(any other character)* | Typed literally into the current field |

Literal characters and `\\` are accumulated into a single fill operation. For example, `abc\\def` fills the current field with `abc\def` in one step, not three.

### Custom fields (Portpass extension — not in official Password Safe)

| Code | Meaning |
|---|---|
| `\f` | Value of custom field 1 (bare `\f` defaults to field 1) |
| `\fN` | Value of custom field N, where N is a single digit 1–9 |

`\f0` is an error. `\f` codes are a Portpass-specific extension; the official Password Safe desktop app does not recognise them and will treat them as unknown.

### Unknown codes

Any `\X` not listed above is treated as an **unknown code**. Portpass:
- Allows saving the sequence (shows an amber warning, does not block Save)
- Shows the same warning in the record read view
- Silently skips the unknown code at fill time — surrounding literal text is preserved and joined

This means sequences written for the official Password Safe app (which supports additional codes such as `\g` group, `\i` title, `\l` notes, `\e` Escape, and various key codes) can be stored in Portpass without error, and the recognised portions will execute without error but will not behave the same as when they are executed by the official Password Safe app.

---

## User flow

### Installation (one-time per browser profile)

#### Same-profile installation

1. Open Portpass in the target browser profile
2. Open VaultSheet settings — drag the Autofill bookmarklet link to the browser bookmarks bar

The bookmarklet contains no private key. Portpass creates a paired autofill profile with a non-extractable signing key in Portpass-origin storage and registers the corresponding public key as a delegate. Each browser profile — and each browser — requires its own independent installation.

#### Cross-profile installation

1. Start the local switchboard relay.
2. Open and unlock Portpass in the clean profile.
3. Enable cross-profile autofill and configure the relay URL if needed.
4. Pair the filling profile's `autofill.html` delegate with the clean-profile Dashboard.
5. Install the bookmarklet in the filling profile.

Cross-profile pairing is separate from the same-profile "New bookmarklet" flow. The filling profile holds the non-extractable private signing key and displays a `ppair1_...` token from `autofill.html?pair=1`; the clean profile imports that token with Vault settings → Autofill → Add autofill profile and stores the matching public delegate record.

### Per-use

1. Make sure Portpass is open in a tab and the vault is unlocked (any tab — doesn't need to be the active tab)
2. Switch to the login page tab
3. Click the bookmarklet
4. Same-profile: a picker appears listing exact URL matches first. If there is no exact match, it can show fuzzy suggestions (Levenshtein ≤ 5 on hostname) plus the currently open record if any.
5. Cross-profile: exact authorized matches can be filled. If there is no exact match, the popup shows only a near-match count and offers to open Portpass so the saved URL can be updated there.
6. Select a record when a picker is shown. Optionally save/replace the URL on a non-readonly record to make future requests exact matches.
7. If the page had a focused input when the bookmarklet was clicked (`document.activeElement`), autofill executes immediately on that field; otherwise a "Click the field to start from" prompt appears.

The URL matching (step 4) removes the need to pre-select a record in Portpass before switching tabs. Note that URLs are canonicalized (remove "https://[www.]" and and url parameters ("?trackingcode=abc123#section3")

### Focus handling

Clicking the bookmarks bar typically causes the page to lose its focused element. Autofill handles this with a two-step model:

- **Step 1 (bookmarklet click):** Portpass popup opens, authenticates the paired delegate, and looks up records for the current page URL
- **Step 2 (field click):** Overlay prompts "Click the field to start from" — when the user clicks a form input, autofill begins from that element

macOS users can configure an App Shortcut (System Settings → Keyboard → App Shortcuts) to trigger the bookmarklet via keyboard. This preserves the page's focused element and skips Step 2 entirely, matching the desktop app's workflow.

### Field filling

Fields are filled using the native input value setter, which works correctly with React, Vue, Angular, and other frameworks that intercept the standard `value` property setter:

```javascript
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(field, value);
field.dispatchEvent(new Event('input', { bubbles: true }));
field.dispatchEvent(new Event('change', { bubbles: true }));
```

`\t` advances focus by calling `.focus()` on the next focusable element in tab order. `\n` submits via `form.requestSubmit()` or by clicking the submit button.

---

## Error states

Displayed in a small overlay on the page:

| Condition | Message |
|---|---|
| Vault locked | "Vault is locked — unlock Portpass first" |
| No record open in Portpass | "Open a record in Portpass first" |
| Autotype field empty or missing | "No autofill sequence set — edit the record in Portpass to add one" |
| Unrecognised token in sequence | "Could not parse autofill sequence: [value]" |

---

## Security model

Same-profile credentials travel: Portpass WASM memory → encrypted BroadcastChannel → autofill.html → postMessage → bookmarklet JS → form field. Cross-profile credentials travel: Portpass WASM memory → signed/encrypted relay reply → autofill.html → postMessage → bookmarklet JS → form field. No clipboard is used at any point.

**Credential briefly in JS:** after decryption, the credential exists as a JS variable in the bookmarklet's main-world context for the duration of the fill. This is equivalent in exposure to a user manually typing a memorised password — not a meaningful regression.

**After filling:** the credential is in `input.value`, readable by any extension on the page. This is identical to the exposure from manual typing or any other password manager. It cannot be avoided without browser-level autofill APIs (which require site cooperation).

**Cross-profile isolation:** `window.open()`, `postMessage`, and `BroadcastChannel` are browser-internal and scoped to a single browser profile. Cross-profile communication uses the local switchboard relay and does not trust the relay for confidentiality, integrity, ordering, identity, or freshness.

**Passkeys:** where a site supports passkeys (WebAuthn), using them is always preferable — no credential to intercept at any stage. Autofill is for sites that still require passwords.

### Channel notes

Same-profile Dashboard communication uses `BroadcastChannel('portpass-autofill')`. The channel is origin-scoped but still broadcast-style, so requests are signed by the paired delegate and credential payloads are encrypted to a per-session ECDH key.

Cross-profile communication uses the switchboard relay. The relay is treated as hostile transport: signatures authenticate requests, timestamps and nonces protect freshness, and encrypted replies protect credential contents.

---

## Implementation status (as of 2026-05-28)

The secure paired-delegate foundation is implemented. The bookmarklet no longer contains a private key; the durable signing key lives in `autofill.html`'s Portpass-origin IndexedDB storage and is created as a non-extractable WebCrypto key. Same-profile autofill is working through this model. Cross-profile transport, copy/paste pairing, reply binding, and stricter relay-side authorization are implemented.

### What is built

**Go (`pwsafe/db.go`)**: `Search(query, mode int)` — mode 0 = all fields (incl. non-sensitive custom fields), mode 1 = names only, mode 2 = URL exact match on `CanonicalURL`. `CanonicalURL` strips scheme/www/query/fragment/trailing slash.

**WASM (`cmd/wasm/main.go`)**: `getDBData` now returns `url` per item. `searchRecords` takes mode int (JS callers updated from bool to 0/1/2).

**Autofill popup (`pwa/public/autofill.html`)**: A minimal static HTML page (no WASM, no Svelte). Loads its paired delegate profile from IndexedDB, signs requests with the non-extractable signing key, and uses a `$transport` abstraction set once at startup: BroadcastChannel path (same-profile, if Portpass responds to a `ping`) or switchboard WebSocket path (cross-profile). Picker shows autotype sequence as read-only chips; theme/accent are received from Portpass in the first reply.

**Dashboard.svelte**: BC autofill handler responds to signed paired-popup `hello` messages, performs replay/freshness checks, and encrypts credential payloads to the popup's ECDH session key. `connectSwitchboard` maintains a persistent WebSocket connection to the switchboard on vault unlock, verifies signed relay messages by delegate ID, rejects replayed nonces, and enforces exact saved-URL authorization before releasing credentials on the relay path.

**App.svelte**: `tryBridge()` in popup `onMount` — pings main Portpass tab via BroadcastChannel; if found, enters bridge mode (`bridgeMode = true`, skips WASM, bridges postMessage↔BC). Shows "Portpass autofill in progress" text. `handleIntent` parses `web+portpass://` LaunchQueue intents (currently reaches Portpass in the same Chrome profile rather than a clean profile on Linux — see cross-profile section for details).

**bookmarklet.js**: Page-agent variant — `makeDelegateBookmarkletUrl(portpassUrl, delegateId, relayUrl)` embeds only routing data and the public delegate ID in the `javascript:` URL. Bookmarklet opens `autofill.html` as popup, sends `{url, saveUrl, isSecure, delegateId, relayUrl}` via `postMessage`, and bridges field-click events. Autotype execution and DOM helpers are self-contained in the IIFE.

**pairedAutofill.js**: IDB module for A-side paired profiles. Generates non-extractable ECDSA P-256 signing keys, exports the public SPKI, derives `delegateId = afp1_<base32(first 16 bytes of SHA-256(publicKeySpki))>`, and stores created time, relay URL, display code, public key, and the private `CryptoKey`.

**delegates.js**: IDB module for D-side delegate records keyed by vault UUID. Records contain `{id, name, publicKey, displayCode, created, bcCount, bcLastUsed, relayCount, relayLastUsed}`. Functions include `getDelegates`, `addDelegate`, `revokeDelegate`, `verifyDelegateById`, and usage counter updates.

**RecordEdit.svelte**: Visual/Raw toggle for autotype field. Visual mode: chip builder with `parseTokens`/`tokensToRaw`, drag-to-reorder, three-row palette, inline mini-forms for freeform text and wait delays, raw equivalence line. Error/warning shown as styled banner cards. Raw mode: monospace input with three-row token legend.

**RecordRead.svelte**: Read-only chip display of autotype sequence (same chip styles as RecordEdit). Warning banner for unknown codes.

### Open UX issue: bookmarklet shows globe icon in bookmarks bar

When the bookmarklet `javascript:` link is dragged from VaultSheet to the bookmarks bar, Chrome shows a generic globe icon instead of the Portpass Pkey logo. Root cause: App.svelte replaces the `<link rel="icon">` href with a `data:image/svg+xml,...` URL for theme-aware tab favicon display. Chrome stores that data: URL as the bookmark's favicon URL, but cannot later fetch it from storage → falls back to globe. The browser tab shows the correct icon because it uses the data: URL directly in memory.

Appending a separate `<link rel="icon">` element (rather than mutating the original) was tried and did not resolve the issue.

**Workaround**: bookmark the Portpass page normally first (Chrome captures the favicon at this point), then right-click the bookmark → Edit → paste the `javascript:` URL. Chrome preserves the captured favicon when the URL is edited.

---

## Cross-profile autofill

Allows Portpass to run in a dedicated clean browser profile (no extensions, single purpose) while autofill is triggered from a regular browsing profile in the same or a different browser on the same machine.

### switchboard

A tiny local WebSocket pub/sub broker (standalone repo: github.com/dbro/switchboard). Protocol:

- Portpass (subscriber) → `{"type":"subscribe","channels":["portpass-autofill"]}`
- autofill.html (publisher) → `{"type":"publish","channel":"portpass-autofill","replyTo":"nonce",...signed payload...}`
- Switchboard forwards the publish verbatim to the subscriber for that channel
- Portpass → `{"type":"reply","replyTo":"nonce",...encrypted blob...}`
- Switchboard routes the reply back to the waiting autofill.html connection

The switchboard is a dumb pipe — it never inspects payload content. Publisher connections that receive no reply within 60 seconds are closed. Binds to `127.0.0.1` only. Builds as a single portable APE binary via Cosmopolitan Libc (Linux/macOS/Windows/FreeBSD). Runs continuously as a background process (systemd/launchd/Task Scheduler).

Auto-start instructions (systemd, launchd, Task Scheduler) are documented in the switchboard repository.

### Trust model

The attack surface of the bookmarklet approach: any JavaScript running on a page (XSS, malicious ad) can replicate the page-agent mechanics — open `autofill.html` and ask for data. The page-side bookmarklet therefore must not be treated as a durable authority holder.

The solution is to make `autofill.html`, not the bookmarklet, the cryptographic authenticator.

**Trusted islands:**
- **autofill.html** — served from the Portpass HTTPS origin; cross-origin isolated from the page it autofills. Holds the non-extractable delegate signing key in profile-local IndexedDB.
- **Portpass PWA / Dashboard** — holds the registered delegate public key; verifies every request signature, freshness value, nonce, delegate status, and URL binding before acting.
- **Bookmarklet URL** — stored in the browser's bookmark store. It contains only routing data, delegate ID, and page-agent code. It is not a secret.

**Untrusted channels** (carry only public/encrypted material — no secrets leak even if observed):
- Page → autofill.html postMessage: secured by `targetOrigin`
- switchboard: sees only encrypted blobs it cannot decrypt
- localhost network: same

An attacker who controls the page can observe credentials after they are filled into that page, which is inherent to autofill. The narrower guarantee is that the page-side actor cannot steal a reusable delegate private key from the bookmarklet and cannot use the relay to browse or fetch arbitrary vault records outside the current-site authorization policy. OS-level compromise is outside the threat model.

### Delegate model

Each paired autofill profile is a **delegate** — a registered autofill agent that Portpass trusts to request credentials on the user's behalf.

**Per-delegate record (stored in IDB, keyed by vault UUID):**
```
{
  id:        "afp1_<public-key-fingerprint>",
  name:      string,        // user-assigned: "Chrome — work profile"
  publicKey: ECDSA P-256 SPKI,
  displayCode: string,      // short UI code derived from the same fingerprint
  created:   timestamp,
  bcCount:   number,
  bcLastUsed: timestamp,
  relayCount: number,
  relayLastUsed: timestamp,
}
```

Use counters are updated only on requests that pass signature verification — they serve as a record of legitimate use and provide the user feedback on how much time the feature is saving them.

**Key storage:** A stores its non-extractable private signing key in Portpass-origin IndexedDB in the filling profile. D stores the delegate public key in IndexedDB keyed by vault UUID. If site data is cleared, delegates must be re-paired and new bookmarklets dragged to the bar. Acceptable tradeoff — vault storage would require extending the psafe3 format.

**Revocation:** delete the public key entry from D's delegate list. Any bookmarklet naming that delegate ID is immediately rejected because D no longer accepts signatures for that delegate.

### VaultSheet UI

The AUTOFILL section in VaultSheet lists registered bookmarklets (called "delegates" internally):

| Name | Created | Uses | Last used | |
|---|---|---|---|---|
| Chrome — work profile | 2026-05-20 | 47 | today | Revoke |

"New bookmarklet" button: prompts for a name → generates a non-extractable ECDSA P-256 key pair → derives the delegate ID from the public key fingerprint → stores the private key in the paired autofill profile and the public key in the delegate list → shows draggable bookmarklet `<a>` chip with routing data and delegate ID only.

### Protocol flow

1. User clicks bookmarklet on a login page
2. Bookmarklet opens `autofill.html` as a popup, passes `{url, saveUrl, isSecure, delegateId, relayUrl}` via `postMessage` with `targetOrigin = Portpass origin`
3. `autofill.html` loads the paired delegate profile, generates an ECDH key pair, and signs `{version, sender: delegateId, recipient, url, nonce, ecdhSpki, timestamp, action}` with its non-extractable private key
4. autofill.html opens a WebSocket to `ws://localhost:7577/ws`; sends `{type:"publish", channel:"portpass-autofill", delegateId, replyTo:nonce, url, ecdh, ts, sig, pub}`
5. Switchboard forwards the publish to the Portpass subscriber registered for that channel (or returns `{type:"error"}` if Portpass is not connected)
6. Portpass verifies the ECDSA signature against the registered public key; rejects silently if invalid
7. Portpass checks the current-site authorization policy. On the cross-profile path, credentials are released only for exact saved URL matches; otherwise only near-match count metadata is returned.
8. Portpass encrypts allowed credential payloads for `autofill.html`'s ECDH public key, sends `{type:"reply", replyTo:nonce, ...blob}` on its switchboard WebSocket
9. Switchboard routes the reply to `autofill.html`'s publisher connection; `autofill.html` decrypts and shows the picker or near-match notice
10. User selects a record when a picker is available; `autofill.html` sends `{type: 'fill', ...}` to `window.opener`; bookmarklet executes autotype
11. Portpass increments same-profile or relay use counters for the verified delegate after a fill completes

**Note on `web+portpass://` LaunchQueue:** The original design routed cross-profile requests via a `web+portpass://` URL handled by the OS. On Chrome/Linux, the protocol handler routes to the active browser profile rather than the profile where the PWA is installed, making it unreliable for cross-profile use. The relay-server polling approach above is used instead. The LaunchQueue handler (`handleIntent` in App.svelte) remains wired up and may work correctly on macOS/Windows — untested.

### Same-profile versus cross-profile behavior

The popup code uses the same broad UI shell in both modes, but credential release policy differs:

| Behavior | Same-profile | Cross-profile |
|---|---|---|
| Transport | BroadcastChannel within the same profile | Local WebSocket switchboard |
| Request authentication | Signed by A's paired non-extractable key | Signed by A's paired non-extractable key |
| Initial lookup | Exact matches plus fuzzy picker metadata | Exact authorized matches only, otherwise near-match count |
| Global search | Available in the same-profile picker | Disabled by default |
| Credential fetch after selection | Allowed for selected picker record | Allowed only when selected record URL exactly matches verified page URL |
| Save URL | Explicit user action updates selected non-readonly record | Should require explicit user action and signed request; exact-match policy applies before future credential release |
| Revocation | Delete delegate record in VaultSheet | Delete delegate record in clean-profile VaultSheet |

### Browser notes

- **Chrome and Firefox** tested for the same-profile bookmarklet flow. Cross-profile relay transport and copy/paste pairing UI are implemented; relay end-to-end testing still needs the local switchboard path exercised in CI/manual QA.
- **Switchboard URL**: use `http://localhost:7577` (not `http://127.0.0.1:7577`). Firefox's mixed-content loopback exemption is specified for `localhost`; `127.0.0.1` may not be exempt on older Firefox versions.
- **Protocol handler** (`web+portpass://` LaunchQueue): tested on Chrome/Linux where it routes to the active profile rather than the PWA's profile. May behave correctly on macOS/Windows — `handleIntent` in App.svelte is wired up for this path.

---
