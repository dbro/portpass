# Portpass

*A simple password manager that keeps your data in your control, across all your devices.*

<img src="https://github.com/user-attachments/assets/8e2f7a5b-1b88-40e5-b630-e770f669a440" width="80%" alt="Screenshots of mobile version">

**Free and open source. Try it: [https://dbro.github.io/portpass](https://dbro.github.io/portpass)**

Portpass is for people who want full control over their passwords, in an app that works great on mobile devices and is built with solid encryption methods. Hosted services like 1Password and LastPass are polished, but require trusting a startup with your most sensitive data.

Portpass is different: your passwords live in a file on your device, or in a cloud storage service you already trust. The encrypted vault is stored as a pwsafe v3 file, using the method invented by cryptographer [Bruce Schneier](https://www.schneier.com/) in the 1990s, open-sourced and audited for decades. No browser extensions, no proprietary sync, no new crypto to evaluate.

## What Portpass does

* fills login forms automatically via a bookmarklet — no browser extension, no clipboard
* streamlines login to apps and websites
* works fully offline, no internet connection required
* encrypts your vault using an established open source format (pwsafe v3)
* runs on all your devices: mobile, tablet, and desktop
* supports convenient WebAuthn unlock methods: fingerprint, face recognition, and PIN
* generates strong passwords
* organizes password records into groups for browsing
* generates one-time codes (TOTP) for two-factor authentication (2FA)
* supports custom fields (eg. PIN codes, account numbers, API keys)
* stores your vault as a file on your device, for easy sync/backup
* opens multiple vaults simultaneously (eg. personal, work, family), allowing sharing settings for each vault
* supports read-only access to each vault according to file's permission settings
* has a mobile-first design with both light and dark modes

## Installation

Portpass runs in your browser and can be installed as an app on any device. Installation involves visiting a web page and then telling your browser to create an app icon (like a bookmark) on your homescreen. Safari and Chrome browsers support installing as standalone webpage apps like this, and maybe some other browsers do too. There is no app store involved, and the process is the same on mobile and desktop.

* Open [https://dbro.github.io/portpass/](https://dbro.github.io/portpass/) in your browser
* When prompted, tap "Add to Home Screen" (iOS/Android) or "Install" (desktop)
* You might also want to pin the app to your app launcher dashboard on your desktop

Portpass will then be visible as a standalone app and can be launched with a tap. It works offline and uses your local vault file.

For improved security, install Portpass in a [dedicated browser profile with no extensions](SECURITY.md#mitigation-use-a-dedicated-browser-profile).

## Cross-platform + how to sync

Portpass runs as a Progressive Web App (PWA) on any device with a modern browser (eg. iPhone, Android, Windows, Mac, Linux). Install it to your home screen for quick access, just like a native app.

Because your vault is a regular file, syncing across devices is straightforward using any file storage service you already trust (eg. Dropbox, Google Drive, iCloud, Syncthing). [See sync options →]

## Multiple vaults and password sharing

Portpass can open multiple vault files at the same time. This is believed to be unique among Password Safe-compatible apps. All open vaults appear together in a single merged list, grouped by vault, with a unified search across all of them.

**How secondary vaults work**

After opening a vault, tap the vault name in the top bar to open vault settings, then tap **Unlock additional vault**. Pick another vault file, enter its master password, and Portpass remembers it as a secondary vault of the original, primary vault you opened. On future sessions, secondary vaults unlock automatically when you open the same original vault. One biometric tap or master password entry unlocks all of these vaults at once.

Each secondary vault can be read+write (you can add, edit, and delete its records) or read-only (if the file's permissions prevent writing). Read-only vaults are clearly labelled; their records appear normally in the list and search results but cannot be edited.

**Sharing passwords with a team or family**

Because vault files are just files, you can share them using the same cloud storage services you already use for file sharing:

1. Create a vault containing the shared passwords (team credentials, family Wi-Fi, subscriptions, etc.).
2. Place the vault file in a shared folder: a Dropbox shared folder, an iCloud shared album, a Google Drive shared drive, a NAS share, or any similar service.
3. Give the people you want to share with access to that folder using the cloud service's own sharing permissions. Grant read+write access to people who should be able to add or change shared passwords, and read-only access to everyone else.
4. Each person opens Portpass on their own device, unlocks their personal vault, and adds the shared vault as a secondary vault.

From that point on, the shared vault opens automatically alongside each person's personal vault. Adding new records to the shared vault or editing existing ones writes the changes back to the shared file, where they propagate to everyone else via normal cloud sync.

**Sync conflicts are not reconciled automatically**

Two people editing the shared vault at exactly the same time may produce a sync conflict in the cloud service (the same limitation that applies to any shared file). Portpass does not merge conflicts; if that happens, use the cloud service's version history to recover the version you want. For most teams and families this is rarely a problem in practice. To reduce the chance of colliding edits, select one person to have read+write access and everyone else to have read-only access to each vault file.

## Compatibility & no vendor lock-in

Portpass reads and writes the [Password Safe v3](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt) format, the same format used by [dozens of apps](https://pwsafe.org/relatedprojects.shtml) across all major platforms. This means you can switch apps at any time without losing your data — your vault file works with any compatible application, now and in the future.

## Compared to Password Safe

[Password Safe](https://pwsafe.org/) is the original app for this file format, available as a native desktop app for Windows and Linux. Portpass and Password Safe share the same vault format, so your data is never locked in.

**Features in Password Safe not currently supported by Portpass:**

- Autofill into native desktop apps (Portpass fills web login forms only)
- Automatic vault lock after an idle timeout
- Password strength indicator and breach alerts
- Password entry aliases (re-using a password across multiple sites)
- Passphrase generation (diceware / word lists)
- Multiple password generation policies
- File attachments and passkeys stored in the vault
- Export and import in other formats
- SSH agent integration
- Automatic file version backups
- Adjustable unlock difficulty count

**What Portpass offers that Password Safe does not:**

- Autofill web login forms via a bookmarklet — no browser extension required; works cross-browser-profile
- Runs in any modern browser — no installation required
- Works on mobile (iOS, Android) with a touch-friendly interface
- Biometric/PIN unlock via fingerprint, face recognition, PIN, or hardware security key (WebAuthn PRF — YubiKey series 5+ may work but is untested)
- Opens multiple vault files simultaneously, especially useful for sharing passwords
- Light/dark themes with selectable accent colors

## How it works

Portpass runs entirely in your browser using WebAssembly, a technology that lets compiled code run securely in the browser at near-native speed. All cryptography happens on your device. Your vault file and master password never leave it.
There is no server, no account, and nothing to trust except the open source code, which is freely available to inspect on GitHub.

**Biometric/PIN unlock** can be enabled to use your device's built-in authentication (fingerprint, face recognition, or PIN) so you don't have to type your master password on repeat visits. Your master password is encrypted with a key only your device can produce and stored locally, it is never transmitted anywhere.

On Android, Chrome routes biometric/PIN unlock setup through [Google Password Manager](https://passwords.google.com/), which requires a recovery PIN to have been set up previously. Google Password Manager stores a synced copy of the passkey in Google's cloud (but not your vault's master password, which always stays on your device). To set up or reset a Google Password Manager recovery PIN, visit [passwords.google.com/passkeys/reset/intro](https://passwords.google.com/passkeys/reset/intro).

## Autofill

Portpass can fill login forms automatically — username, password, one-time code, and any other fields in the right order — without a browser extension and without copying anything to the clipboard.

### How it works

A `javascript:` bookmarklet in your browser's bookmarks bar opens a small picker popup when you click it on a login page. The popup shows credentials that match the current page's URL. Click a record and Portpass fills the fields directly, following the record's **Autotype** sequence (default: fill username → Tab → fill password → Submit).

The bookmarklet communicates with your open Portpass vault over an encrypted channel. No credentials pass through the clipboard at any point — this matters on Windows and Linux, where clipboard contents can be read by any running process, and in browsers where extensions with clipboard permission could read a copied password before it is pasted.

### Same-profile and cross-profile autofill

**Same-profile**: Portpass and the pages you fill are in the same browser profile. The bookmarklet opens a relay popup that talks to Portpass directly via a browser-internal channel. No extra software needed.

**Cross-profile**: Portpass runs in a dedicated clean profile (no extensions), and the bookmarklet runs in your regular browsing profile. This is the most secure setup — your vault is completely isolated from extensions in your main profile. A small local background service, **portpass-relay**, bridges the two profiles over `localhost`. No data leaves your machine.

### Setting up autofill

1. Open Portpass and unlock your vault.
2. Open vault settings (tap the vault name in the top bar).
3. Under **Autofill**, click **+ New bookmarklet**. Give it a name (e.g. "Chrome — main profile") and click **Create**.
4. Drag the chip to your browser's bookmarks bar. If the bar is hidden, click **Copy link** and add the bookmark manually.

For cross-profile setup, start portpass-relay as a background service on your machine before using the bookmarklet.

### Autotype sequences

Each record has an **Autotype** field controlling what gets filled and in what order. The default `\u\t\p\n` covers most sites: fill username, tab to the next field, fill password, submit. You can customise this for unusual login flows (e.g. single-field pages, sites that require an email, sites with two-factor code fields).

| Code | Action |
|---|---|
| `\u` | Username |
| `\p` | Password |
| `\m` | Email |
| `\2` | One-time code (TOTP) |
| `\t` | Tab to next field |
| `\s` | Shift-Tab (previous field) |
| `\n` | Submit form |
| `\wNNN` | Wait NNN milliseconds |

### Best practices

- **Use a dedicated browser profile for Portpass.** Install Portpass in a separate browser profile with no extensions. Drag bookmarklets from that clean profile to your main browsing profile. This keeps your vault isolated from any extension installed in your day-to-day browser, including the one the bookmarklet runs in. See [SECURITY.md](SECURITY.md) for setup instructions.
- **One bookmarklet per browser or profile.** Each bookmarklet holds a unique private key. Create a separate bookmarklet for each browser and profile where you want autofill, and give each a descriptive name so you can revoke individual ones if needed.
- **Revoke bookmarklets you no longer use.** Open vault settings → Autofill, and click **Revoke** next to any entry you want to invalidate. The corresponding bookmarklet will be rejected immediately, even if it is still in someone's bookmarks bar.
- **Prefer autofill over copy-paste on Windows and Linux.** On these platforms, any running process can read the clipboard at any time. Autofill writes directly to the form field without ever putting the credential in the clipboard, eliminating that exposure window entirely.

See [SECURITY.md](SECURITY.md) for a full description of how the delegate model guards against malicious extensions, clipboard eavesdropping, and other threats.

## Security

Portpass's threat model, known limitations, and guidance on protecting yourself from malicious browser extensions are documented in [SECURITY.md](SECURITY.md).

## Credits

Portpass is built on the Go/WebAssembly backend from [gopwsafe](https://github.com/tkuhlman/gopwsafe). Portpass started as a fork of that project and has contributed changes back upstream.

[pwsafe.org](https://pwsafe.org/) is the main website for Password Safe

The broader ecosystem of compatible apps, especially Jeff Harris' [Android app](https://market.android.com/details?id=com.jefftharris.passwdsafe) and the [StrongBox apps for iOS and Mac](https://strongboxsafe.com/).

## Disambiguation

Portpass shares a name with

* [Port Pass](https://www.portpass.com/) "The secure digital identity solution for ISPS-compliant port terminals"
* [PORTpass](https://portpassportal.com/) was a private proof-of-vaccination app used in Canada
* https://github.com/paul1029-ife/portpass "A simple npm package that provides a tunnel for testing your local web apps across different IP addresses.(devices)."
