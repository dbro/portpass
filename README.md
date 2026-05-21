# Portpass

*A simple password manager that keeps your data in your control, across all your devices.*

<img src="https://github.com/user-attachments/assets/8e2f7a5b-1b88-40e5-b630-e770f669a440" width="80%" alt="Screenshots of mobile version">

**Free and open source. Try it: [https://dbro.github.io/portpass](https://dbro.github.io/portpass)**

Portpass is for people who want full control of their passwords. Portpass is a password manager app that runs on mobile and desktop devices, using the pwsafe v3 encryption format invented by cryptographer [Bruce Schneier](https://www.schneier.com/) in the 1990s, which is open source and audited.

_No cloud required, no browser extensions, no proprietary synchronization methods, no new encryption methods._

You decide where to store your vault file: on-device, self-hosted, or in a cloud storage service that you trust. You can allow other people to read or write to your vault files using cloud service file sharing settings. You can open your password vault file with any app that supports the pwsafe v3 format. You can enable your web browser to automatically enter usernames and passwords from your vault into login forms on web sites.

## What Portpass does

* works fully offline, no network connection required after initial installation. Can also work with cloud-hosted files if you choose.
* runs on all your devices: mobile, tablet, and desktop
* unlocks vaults using WebAuthn methods: fingerprint, face recognition, and PIN
* fills login forms automatically via a bookmarklet — no browser extension, no clipboard
* generates strong passwords
* generates one-time codes (TOTP) for two-factor authentication (2FA)
* supports custom fields (eg. credit card numbers, PIN codes, account numbers, API keys)
* searches instantly across multiple vaults and multiple data fields 
* organizes password records into groups for browsing
* stores your vault as a files on your device, for easy sync/backup
* encrypts your vault using an established open source format (pwsafe v3)
* opens multiple vaults simultaneously (eg. personal, work, family), supports sharing vaults with other people
* respects read-only file permissions for each vault
* has a mobile-first design with both light and dark modes

## Installation

Portpass runs in a browser and can be installed as an app on any device. This style of installing a web page as an app icon is called a "Progressive Web App" or PWA. Installation involves visiting a web page and then telling your browser to create an app icon (like a bookmark) on your homescreen. This caches the Portpass code locally, and Portpass does not communicate with any remote servers. Safari and Chrome browsers support installing as standalone webpage apps like this (TODO: Microsoft Edge?). There is no app store involved, and the process is the same on mobile and desktop.

* Open [https://dbro.github.io/portpass/](https://dbro.github.io/portpass/) in your browser
* When prompted, tap "Add to Home Screen" (iOS/Android) or "Install" (desktop)
* You can also want to pin the app to your app launcher dashboard on your desktop

Portpass will then be visible as a standalone app and can be launched with a tap. It works offline and uses your local vault file.

For improved security, install Portpass in a [dedicated browser profile with no extensions](SECURITY.md#mitigation-use-a-dedicated-browser-profile). This protects against malicious browser extensions that may be running in your web browser's primary profile.

**Caveat: Firefox** browsers do not support PWA and do not support opening a file in read+write mode, only in read-only mode. This means you should not use Firefox to install Portpass, and you cannot edit Portpass vaults that are opened with Firefox. You can access Portpass vault information while using Firefox to browse the web, using the normal copy+paste and autofill methods to get passwords from the Portpass vault into a browser setting. In this scenario, Portpass runs in a different browser such as Chrome or Safari.

## Cross-platform + how to sync

Portpass runs as a Progressive Web App (PWA) on any device with a modern browser (eg. iPhone, Android, Windows, Mac, Linux). Install it to your home screen for quick access, just like a native app.

Because your vault is a regular file, syncing across devices is straightforward using any file storage service you already trust (eg. Dropbox, Google Drive, iCloud, Syncthing). [See sync options →]

## Multiple vaults and password sharing

Portpass can open multiple vault files at the same time. This is believed to be unique among Password Safe-compatible apps. All open vaults appear together in a single merged list, grouped by vault, with a unified search across all of them.

Portpass checks each vault file if it is read-only according to the file system. Read-only vaults are clearly labelled; their records appear normally in the list and search results but cannot be edited.

**How secondary vaults work**

To open more vaults, tap the vault name in the top bar to open vault settings, then tap **Unlock additional vault**. Pick another vault file, enter its master password, and Portpass remembers it as a secondary vault of the original, primary vault you opened. On future sessions, secondary vaults unlock automatically when you open the same original vault. One biometric tap or master password entry unlocks all of these vaults at once.

**Sharing passwords with a team or family**

Vault files can be shared just like any other regular file using file system and cloud storage settings. For example:

1. Create a vault containing the passwords you want to share (team credentials, family Wi-Fi passwords, sharable subscriptions, etc.)
2. Move the vault file to a shared folder in a cloud service such as a Dropbox, iCloud, Google Drive, or a local NAS share, or similar.
3. Use the cloud service (or NAS device) settings to grant permission to each person to access the file, which can be read-only if desired
4. Each person runs Portpass on their own device, and can ulock one or more vault files, including the vault file you shared with them.

From that point on, the shared vault opens automatically alongside each person's personal vault. Adding new records to the shared vault or editing existing ones writes the changes back to the shared file, where they propagate to everyone else via normal cloud sync.

**Sync conflicts are not reconciled automatically**

Two people editing the shared vault at exactly the same time may produce a sync conflict in the cloud service (the same limitation that applies to any shared file). Portpass does not merge conflicts; if that happens, use the cloud service's version history to recover the version you want. For most teams and families this is rarely a problem in practice. To reduce the chance of colliding edits, select one person to have read+write access and everyone else to have read-only access to each vault file. Note that Portpass auto-saves changes immediately, but does NOT automatically reload if the underlying file has been changed since it was first opened.

## Compatibility & no vendor lock-in

Portpass reads and writes the [Password Safe v3](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt) format, the same format used by [dozens of apps](https://pwsafe.org/relatedprojects.shtml) across all major platforms. This means you can switch apps at any time without losing your data — your vault file works with any compatible application, now and in the future.

## Compared to Password Safe

[Password Safe](https://pwsafe.org/) is the original and official app for pwsafe v3 vault files. It is available as a native desktop app for Windows and Linux. Portpass and Password Safe share the same vault format, so your data is never locked in.

**Features in Password Safe not currently supported by Portpass:**

- Autofill into native desktop apps (Portpass autofills into desktop browsers)
- Automatic vault lock after an idle timeout
- Password strength indicator and breach alerts
- Password entry aliases (re-using a password across multiple entries)
- Passphrase generation (diceware / word lists)
- Multiple password generation policies (Portpass uses the same adjustable policy for all vaults and entries)
- File attachments and passkeys stored in the vault
- Export and import in other vault file formats
- SSH agent integration
- Automatic file version backups
- Adjustable unlock difficulty (key stretching iteration count)

**What Portpass offers that Password Safe does not:**

- Runs on mobile, desktop, and tablet devices
- Modern mobile-first design with touch-friendly interface
- Biometric/PIN unlock via fingerprint, face recognition, PIN, or hardware security key (WebAuthn PRF — YubiKey series 5+ may work but is untested)
- Opens multiple vault files simultaneously, especially useful for sharing passwords
- Light/dark themes with selectable accent colors

## How it works

Portpass runs entirely in your browser using WebAssembly, a technology that lets compiled code run securely in the browser at near-native speed. All cryptography happens on your device. Your vault file and master password never leave it.
There is no server, no account, and nothing to trust except the open source code, which is freely available to inspect on GitHub.

**Biometric/PIN unlock** can be enabled to use your device's built-in authentication (fingerprint, face recognition, or PIN) so you don't have to type your master password on repeat visits. Your master password is encrypted with a key only your device can produce and stored locally, it is never transmitted anywhere.

On Android, Chrome routes biometric/PIN unlock setup through [Google Password Manager](https://passwords.google.com/), which requires a recovery PIN to have been set up previously. Google Password Manager stores a synced copy of the passkey in Google's cloud (but not your vault's master password, which always stays on your device). To set up or reset a Google Password Manager recovery PIN, visit [passwords.google.com/passkeys/reset/intro](https://passwords.google.com/passkeys/reset/intro).

## Autofill

Portpass can fill login forms automatically to simplify your login experiences on desktop websites. This feature is desktop-only due to browser restrictions on mobile platforms. It works using a bookmarklet the Portpass creates for you, and it avoids copying passwords into the clipboard where malicious apps could try to eavesdrop. The streamlined process involves **two clicks** and never leaves the browser window, and can handle situations with multiple URL matches and fuzzy matching.

1. Visit a webpage URL with a form you want to fill in
2. (optional) **click on the first field** to fill in (eg username)
3. **Click the bookmarklet** that was previously installed in your browser bookmark bar (see below)
4. Portpass checks if any URLs in your vault match the URL of this webpage
5. If more than one exact match is found in the vaults, a popup window asks which entry in Portpass should be used to provide the information to fill.
6. If you did not already click on a field in step 2, a small popup asks you to click on a field to begin filling in.
7. The bookmarklet follows the autofill configuration and enters all the information into the fields of the form and submits the form. 

### How it works

A `javascript:` bookmarklet in your browser's bookmarks bar opens a small picker popup when you click it on a login page. The popup shows credentials that match the current page's URL. Click a record and Portpass fills the fields directly, following the record's **Autotype** sequence (default: fill username → Tab → fill password → Submit).

The bookmarklet communicates with your open Portpass vault over an encrypted channel. No credentials pass through the clipboard at any point — this matters on Windows and Linux, where clipboard contents can be read by any running process, and in browsers where extensions with clipboard permission could read a copied password before it is pasted. The encryption key is unique to each new bookmarklet created in Portpass, and can be revoked from Portpass's vault settings.

Portpass searches all unlocked vaults for URLs that match the current web page. It compares the canonical version, removing "www." as well as url parameters after the "?" and "#" characters. It looks for exact matches first, then falls back to offering the current open record (if one is open) as well as up to 5 near matches. If one of the non-exact matches is chosen, you can instruct Portpass to update that entry's URL in the vault to match the current webpage URL to accelerate future Autofill requests on this webpage. The "near match" method uses edit distance (Levenshtein) showing the five closest matches within a distance of 5 edits.

### Same-profile and cross-profile autofill

It is possible to autofill while running Portpass in a separate clean profile, following the security best-practice to reduce exposure to browser extensions -- however, it requires a helper switchboard running in its own process on your system.

**Same-profile**: Portpass and the pages you fill are in the same browser profile. The bookmarklet opens a relay popup that talks to Portpass directly via a browser-internal channel. No extra software needed. This is the simpler approach, but it means that all your browser extensions could try to attack Portpass. If you trust your browser extensions, this is ok.

**Cross-profile**: To protect against malicious browser extensions, you could choose to run Portpass in a separate browser profile with no extensions installed. This means that the browser has stronger isolation between Portpass and the websites that you visit, and the browser prevents the bookmarklet from communicating with Portpass to transfer information from your vault to the bookmarklet. In this scenario, a helper service provides a simple message switchboard between Portpass and the bookmarklet. This service is called **portpass-switchboard**, and it runs in the background acting as a very limited shared memory. No data leaves your machine. All messages sent between Portpass and the bookmarklet via portpass-switchboard are encrypted end-to-end using the key that is set up when the bookmarklet is installed. An eavesdropper would see only encrypted blobs.

Note that while Portpass should run in Chrome or Safari, the bookmarklet can run in Chrome, Safari, and Firefox. More than one bookmarklet can be created and used by Portpass, allowing fine-grained control for people who use multiple browsers and profiles.

### Setting up autofill

1. Open Portpass and unlock your vault.
2. Open vault settings (tap the vault name in the top bar).
3. Under **Autofill**, click **+ New bookmarklet**. Give it a name (e.g. "Chrome — main profile") and click **Create**.
4. Drag the chip to your browser's bookmarks bar. If the bar is hidden, click **Copy link** and add the bookmark manually.

For cross-profile setup, start portpass-switchboard as a background service on your machine before using the bookmarklet. TODO: add instructions to make this helper app run automatically in the background whenever Portpass runs.

### Autofill form field configuration

Each entry in Portpass has an optional field called **Autotype** that describes what and where to fill in the login form. It is based on keyboard actions, which most web login forms support natively. The default `\u\t\p\n` covers most sites and means: fill username, tab to the next field, fill password, press enter to submit. You can customise this for unusual login flows (e.g. single-field pages, sites that require an email, sites with two-factor code fields).

| Code | Action |
|---|---|
| `\u` | Username |
| `\p` | Password |
| `\m` | Email |
| `\2` | One-time code (TOTP) |
| `\fN` | Nth custom field (N is between 1 and 9) |
| `\t` | Tab to next field |
| `\s` | Shift-Tab (previous field) |
| `\n` | Submit form |
| `\wNNN` | Wait NNN milliseconds |
| `\WNNN` | Wait NNN seconds |

| Example | Actions |
|---|---|
| `\p\n` | fill password, submit form | 
| `\u\n\W5\2` | fill username, submit form, wait 5 seconds, fill one-time code |
| `\f1\t\f2\t\f3` | fill custom field #1 (eg credit card number), tab, fill custom field #2 (eg. expiration date), tab, fill custom field #3 (eg. CVN number) |

Note that the code for custom fields (\fN) is a Portpass-only code and not currently supported by the official Password Safe app.

### Best practices

- **Use a dedicated browser profile for Portpass.** Install Portpass in a separate browser profile with no extensions. Drag bookmarklets from that clean profile to your main browsing profile. This keeps your vault isolated from any extension installed in your day-to-day browser, including the one the bookmarklet runs in. See [SECURITY.md](SECURITY.md) for setup instructions.
- **Use a unique bookmarklet for each browser profile.** Each bookmarklet holds a unique private key. Create a separate bookmarklet for each browser and profile where you want autofill, and give each a descriptive name so you can revoke individual ones if needed.
- **Revoke bookmarklets you no longer use.** Open vault settings → Autofill, and click **Revoke** next to any entry you want to invalidate. The corresponding bookmarklet will be rejected immediately, even if it is still in someone's bookmarks bar.
- **Prefer autofill over copy-paste on Windows and Linux (X11).** On these platforms, any running process can read the clipboard at any time. Autofill writes directly to the form field without ever putting the credential in the clipboard, eliminating that exposure window entirely. (Linux Wayland has better clipboard security than X11.)

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
