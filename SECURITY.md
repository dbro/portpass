# Security

## Threat model

Portpass is a local-first password manager. Your vault is a `.psafe3` file that lives on your device. All encryption and decryption happen locally in your browser. Portpass never sends passwords, keys, or vault contents to a server.

### What Portpass protects against

- **Network interception**: nothing sensitive is transmitted over the network.
- **Cloud service breach**: there is no Portpass server to breach.
- **Vendor lock-in**: the `.psafe3` format is an open standard readable by multiple independent apps. Your data is yours regardless of what happens to this project.

### What Portpass does not protect against

- **Weak master password**: the vault's encryption is only as strong as your master password. Use a long, random passphrase. A weak password can be brute-forced offline if someone obtains your vault file.
- **Compromised device**: if your device is compromised at the OS level, an attacker can read browser memory, including decrypted passwords.
- **Malicious browser extensions**: see below. This is the most realistic threat for most users.
- **Lost vault file**: Portpass does not back up your vault. If the file is lost and you have no copy, your passwords are gone. Keep a backup in a safe place.
- **Lost master password**: There is no recovery method or backdoor, only the master password.

---

## Malicious browser extensions

Browser extensions are the most realistic everyday threat to any browser-based password manager such as Portpass.

### Why extensions are dangerous

An extension with broad host permissions runs in the same process as every web page you visit. It can:

- Read and modify the content of any page, including the Portpass UI
- Observe values typed into input fields, including your master password as you type it
- Read the clipboard immediately after you copy a password, before you paste it

This applies to every browser-based password manager and it is not a flaw specific to Portpass. It is a fundamental property of how browser extensions work.

### The supply-chain / auto-update risk — including Portpass itself

Extensions update silently and automatically. An extension that was safe when you installed it can be bought, transferred to a new owner, or hacked, and a subsequent update can make it malicious — without any visible change and without any action on your part. This attack has occurred with popular, widely-reviewed Chrome extensions. Even careful upfront vetting only tells you the extension was safe at that moment; you are extending ongoing trust in the publisher and in anyone who might later acquire them.

**Portpass is subject to the same risk.** It is a Progressive Web App served from GitHub Pages and it updates automatically when a new version is deployed. A compromised update — whether through the GitHub repository, the build pipeline, or a dependency in the npm or Go module graph — would run in the same browser context as your vault. The mitigations are real: Portpass is open-source and every change is publicly auditable; releases are tagged and deployed by the project maintainer; the encryption core is compiled from Go source whose history is visible. But these reduce risk rather than eliminating it. If you need higher assurance, treat Portpass the same way you would any critical piece of software: review updates before they apply, or use a dedicated profile that you update intentionally.

### How to audit extensions in your regular profile

Not all extensions are equally relevant to your vault. An extension that only has access to `reddit.com` cannot run on the Portpass page and cannot see your vault or your master password — it is simply not in scope. Only extensions with broad host permissions or specific access to the Portpass URL (`dbro.github.io`) matter for vault security.

**In Chrome:** open `chrome://extensions`, click **Details** on each extension, then scroll to **Permissions**. An extension that says "Read and change all your data on all websites" (or similar) can run on the Portpass page. An extension with a narrower list of sites can only run on those sites.

**In Firefox:** open `about:addons`, click an extension, then the **Permissions** tab. "Access your data for all websites" is the broad permission; narrower extensions will list specific domains.

Neither browser provides a consolidated view — you must check each extension individually.

Once you have identified which extensions have broad access, consider two distinct surfaces:

1. **Extensions that can run on the Portpass URL** (`dbro.github.io`): highest impact. They can observe your master password as you type it, read any revealed password in the UI, and — during the brief window when the "New bookmarklet" modal is open — read the delegate private key from the chip's link attribute. If any extension you cannot fully trust has this access, use a dedicated profile for Portpass instead.

2. **Extensions that can run on login pages**: they can read form field values after autofill. This is the same exposure that exists with every password manager, including native apps — an extension that runs on `bank.com` can read whatever was typed or filled into that page. Audit extensions on your sensitive login pages separately from the Portpass audit.

### Mitigation: use a dedicated browser profile

The most effective defense is to use Portpass in a separate browser profile that has no extensions installed.

Extensions are installed per-profile. A profile with no extensions has no extension attack surface, regardless of what is installed in your other profiles.

**Setup (Chrome or Edge):**

1. Open the profile menu (top-right corner) and choose **Add profile**.
2. Skip Google/Microsoft sign-in, which is not required.
3. Navigate to [Portpass](https://dbro.github.io/portpass/), open the browser menu, and choose **Install app**. The app will appear as a standalone window in your taskbar or dock.
4. Do not install any extensions in this profile.
5. To prevent the browser from clearing site data on shutdown, go to `chrome://settings/content/siteData` and add `dbro.github.io` to the "Allowed to save data on your device" list. This preserves your vault file and biometric enrollment across browser restarts.

**Firefox:** Go to `about:profiles`, create a new profile, launch it with **Launch profile in new browser**, navigate to [Portpass](https://dbro.github.io/portpass/), and do not install extensions. To preserve site data across restarts, go to `about:preferences#privacy`, scroll to **Cookies and Site Data**, and make sure "Delete cookies and site data when Firefox is closed" is unchecked (or add an exception for `dbro.github.io` via **Manage Exceptions**).

**Safari on iOS:** tap the share button and choose **Add to Home Screen**. Home Screen PWAs have isolated, persistent storage that survives browser restarts.

**Safari on macOS:** Safari does not offer per-site data retention exceptions. Apple's Intelligent Tracking Prevention can clear site data for sites not visited within 7 days. To avoid losing your vault file or biometric enrollment, either visit Portpass at least once a week, or use Chrome or Firefox for your dedicated Portpass profile instead.

**Workflow:** Alt-tab to the Portpass window when you need a password, copy it, and paste it in your main browser. The 30-second clipboard autoclear limits the window during which a compromised extension could read it.

**Autofill and the dedicated profile.** Portpass supports two autofill modes that work alongside the dedicated clean-profile setup:

- **Same-profile autofill**: both Portpass and the page being filled are in the same browser profile. The bookmarklet opens a relay popup that communicates with Portpass via BroadcastChannel. This is more convenient but exposes Portpass to any extensions in that profile.

- **Cross-profile autofill**: Portpass runs in a clean, extension-free profile; the bookmarklet runs in your main browsing profile. Credentials travel via [switchboard](https://github.com/dbro/switchboard), a tiny local WebSocket broker (`localhost:7577`). This preserves full extension isolation — Portpass never touches the browsing profile. Requires switchboard to be running as a background service.

Both modes use the **delegate model**: each bookmarklet installation holds an ECDSA P-256 private key; the corresponding public key is registered in Portpass. Every autofill request is signed with the private key and verified by Portpass before any credentials are exchanged. This means a malicious extension on the page cannot impersonate a legitimate bookmarklet and trick Portpass into delivering credentials to an attacker's key.

---

## Vault file security

- **Store your vault file somewhere you control.** A local disk, USB drive, or personal cloud storage account (iCloud, Dropbox, etc.) are all reasonable. The file is encrypted; an attacker who obtains it still needs your master password to read it.
- **Keep a backup.** If the only copy of your vault is on one device and that device fails, your passwords are unrecoverable. Treat the vault file like any other irreplaceable document.
- **Use a strong master password.** Prefer a long passphrase (five or more random words) over a short complex password. Length matters more than special characters.
- **Cloud sync is safe but adds a dependency.** Storing the vault in a synced folder (iCloud, Dropbox, etc.) is convenient and the file stays encrypted, but you are also relying on the security of that service. Use a strong, unique master password.

---

## Biometric/PIN unlock

The optional biometric/PIN unlock feature uses your fingerprint, face, or PIN to encrypt your master password on-device. The encrypted password is stored in your browser's local storage (IndexedDB), and the decryption key is derived from your biometric via the WebAuthn PRF extension and it never leaves your device. When biometric/PIN unlock is used, the master password is decrypted from your device's secure storage and passed directly to the vault-opening function. Portpass explicitly clears the master password variable immediately after the vault opens and it is not retained in JavaScript memory beyond that single call.

An attacker with physical access to your device and browser profile could extract the ciphertext from IndexedDB, but cannot decrypt it without the biometric credential held in your device's secure hardware.

If your master password changes, re-enroll biometric/PIN unlock. The old enrollment is automatically cleared on the next failed unlock attempt.

---

## Secondary vault associations

When secondary vaults are linked to a primary vault, their master passwords are stored encrypted in your browser's IndexedDB. The encryption uses AES-256-GCM with a key derived inside the WASM engine from the primary vault's stretched key and this key never appears in JavaScript. JavaScript only ever handles ciphertext and nonces, which are not sensitive.

**Changing the primary vault's master password** generates a new encryption key and any previously linked secondary vaults will no longer auto-unlock and must be re-linked.

---

## Clipboard security

Portpass automatically clears the clipboard 30 seconds after you copy a password, reducing the window during which it can be read by another app.

### Clipboard sniffing is a universal risk for password managers

Any password manager that uses the clipboard to transfer passwords — including native apps such as 1Password and Bitwarden — shares this exposure. A browser extension with `clipboardRead` permission can call `navigator.clipboard.readText()` at any time and capture whatever is currently in the clipboard, regardless of which app placed it there. This applies equally to passwords copied from Portpass, from a native password manager, or typed by hand and then cut.

Portpass's 30-second autoclear and the Autocopy bookmarklet's immediate post-paste clear both reduce the exposure window, but neither can prevent an actively polling adversary from reading the clipboard before the clear fires.

**Checking which extensions have clipboard access.** In Chrome, open `chrome://extensions/` → Details → Permissions for each extension individually. In Firefox, go to `about:addons` → click the extension → Permissions tab. Neither browser provides a consolidated view; you must check each extension one by one. Any extension you do not recognise and trust that lists clipboard read access should be treated as a risk.

### Platform differences

Clipboard access is restricted at the OS level on **iOS, Android, and Linux (Wayland)**. On these platforms, only the foreground app can read the clipboard, so copied passwords are well-protected from background processes.

**macOS** restricts clipboard access for non-browser apps, but browser extensions running in the same profile can still read it. Use a dedicated browser profile with no extensions (see above).

### The better answer: passkeys

Passkeys (WebAuthn) eliminate the clipboard and extension risks entirely — there is no password to copy, intercept, or sniff. Authentication is a cryptographic challenge/response that never leaves your device. If a site you use offers passkey login, using it is the strongest choice available. Portpass is for sites that still require a password; for everything else, prefer your platform's passkey manager (iCloud Keychain, Google Password Manager, Windows Hello, etc.).

**Windows and Linux (X11)** have no OS-level clipboard isolation which means any running process can read the clipboard at any time. Users on these platforms should be especially careful to use the dedicated browser profile mitigation, and be aware that other apps may be able to read a copied password before the clipboard gets cleared.

---

## Autofill security

The Autofill bookmarklet uses a **delegate model** to create a cryptographically authenticated channel between the bookmarklet and Portpass, without any server infrastructure and without browser extensions.

### Trusted islands

- **Bookmarklet URL** — stored in the browser's bookmark store, which no web API can read or modify. Contains an ECDSA P-256 private key unique to this installation.
- **relay.html** — served from the Portpass HTTPS origin, cross-origin isolated from the page being autofilled. Receives the private key from the bookmarklet via `postMessage` with strict `targetOrigin`.
- **Portpass** — holds the registered public key for each delegate; verifies every autofill request signature before acting.

### Authentication

Before exchanging any credentials, relay.html signs a challenge `{relayNonce, ecdhSpki}` (same-profile) or `{url, nonce, ecdh, timestamp}` (cross-profile) with the delegate's ECDSA P-256 private key. Portpass verifies the signature against the registered public keys. A forged or unsigned request is silently rejected.

This prevents the masquerade attack: a malicious extension or page script running at the Portpass origin can observe the BroadcastChannel but cannot forge a valid ECDSA signature for a registered delegate's key.

### Credential encryption in transit

After authentication, credentials are encrypted with ECDH P-256 + AES-256-GCM. The session key is ephemeral — a fresh ECDH key pair is generated for each autofill session. Credentials in transit are ciphertext only; no key material appears on the channel.

### Cross-profile relay server

The switchboard (`localhost:7577`) is a dumb pipe — it stores and forwards encrypted blobs without inspecting content. It binds to `127.0.0.1` only and is not accessible over the network. An attacker who can read the relay server's memory has OS-level access and is outside the threat model.

### What autofill does not protect against

- **Credential in the DOM**: after filling, the credential is in `input.value` and readable by any extension on the page. This is identical to manual typing or any other password manager and cannot be avoided without browser-level APIs.
- **Delegate private key in the bookmark store**: the bookmark store is stored as a plaintext JSON file in the browser profile directory. Any process that can read that directory — including backup software, another user account with filesystem access, or malware with user-level permissions — can extract the private key. The key persists indefinitely, so an exfiltrated copy remains valid until the delegate is explicitly revoked in Portpass.

  However, the key is an *authentication token*, not an encryption key. It does not contain or unlock any vault data on its own. An attacker who holds the key can only use it by making a signed request to a running, unlocked Portpass instance — and only via BroadcastChannel (same browser profile) or the local switchboard WebSocket (same machine). Both channels require the attacker to be active on the same machine at the same moment the user has Portpass open. At that point the attacker already has access to more direct attacks.

  This makes the key fundamentally different from a password captured off the clipboard: a clipboard password is immediately and permanently usable anywhere; the delegate key requires an ongoing session to exploit and becomes worthless the moment the vault is locked.

  The same property that protects the key — the bookmark store is inaccessible to web pages — also means Portpass cannot rotate it automatically. Periodic manual rotation (revoke the old delegate in VaultSheet, drag a new bookmarklet) is good hygiene, especially if you suspect a device may have been accessed by someone else. A future VaultSheet version may display key age to prompt rotation.
- **Extension present at drag-install time**: an extension running in the **Portpass profile** (the clean profile where the bookmarklet is dragged *from*) could modify the bookmarklet's JavaScript or substitute a different key before the drag completes. This is why the clean profile must have no extensions — not just to protect the vault, but to ensure the bookmarklet delivered to the bookmarks bar is genuine. Extensions in the *destination* browsing profile cannot intercept the bookmarklet because it arrives already stored in the bookmark store, which extensions cannot read.

---

## Implementation notes

- **Memory**: the salted password buffer used during key stretching is zeroed immediately after use.
- **Timing**: password comparison uses a constant-time XOR accumulator to prevent timing side-channel attacks.
- **KDF**: the vault key is derived using SHA-256 iterated 262,144 times (the [pwsafe v3 format minimum](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt)), making offline brute-force attacks significantly more costly.

---

## Reporting security issues

To report a vulnerability privately, use [GitHub Security Advisories](https://github.com/dbro/portpass/security/advisories/new). This lets the issue be addressed before public disclosure.

For non-security bugs, open a regular [GitHub issue](https://github.com/dbro/portpass/issues). Include a description and steps to reproduce. Do not include actual vault files or passwords in reports.
