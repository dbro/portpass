# Portpass

*Open source password manager. One file, every device*

<img src="https://github.com/user-attachments/assets/8e2f7a5b-1b88-40e5-b630-e770f669a440" width="80%" alt="Screenshots of mobile version">

**Free and open source. Try it: [https://dbro.github.io/portpass](https://dbro.github.io/portpass)**

Portpass is for people who want full control of their passwords. Portpass is a password manager app that runs offline on mobile and desktop devices, storing the encrypted information in a single file using the pwsafe v3 format invented by cryptographer [Bruce Schneier](https://www.schneier.com/) in the 1990s, which is open source and audited.

Portpass is different from other password managers:

* _No cloud required. Portpass runs offline using a local vault file_
* _No browser extensions involved_
* _No proprietary synchronization methods_
* _No new encryption methods_
* _No subscription fees or upsells_
* _No lock-in_

You decide where to store your vault file: on-device, self-hosted, or in a cloud storage service that you trust. You can allow other people to read or write to your vault files using cloud service file sharing settings. You can open your password vault file with any app that supports the pwsafe v3 format. You can enable your web browser to fill-in website login forms with usernames and passwords from your vault.

## What Portpass does

* works fully **offline**, no network connection required after initial installation. Portpass runs locally, and never sends your vault file contents anywhere.
* runs on all your devices: **mobile, tablet, and desktop**
* stores each vault as a file on your device, for easy **sync/backup/sharing**
* unlocks vault files using WebAuthn methods: **fingerprint, face recognition, and PIN**
* **fills login forms on websites** using a bookmarklet you click on (desktop only). No browser extension with excessive permissions, no copying secrets to the system clipboard
* generates strong passwords
* keeps a history of previous password values
* generates **one-time codes (TOTP)** for two-factor authentication (2FA)
* supports **custom fields** (eg. credit card numbers, PIN codes, account numbers, API keys)
* searches instantly across multiple vaults and multiple data fields
* organizes password records into groups for browsing
* encrypts your vault using an established open source format (pwsafe v3)
* opens **multiple vaults simultaneously** (eg. personal, work, family), supports sharing vaults with other people
* (optionally) works files that are synced with a network file share or cloud storage provider of your choosing (Dropbox, Google Drive, etc.).
* respects read-only file permissions for each vault
* has a mobile-first design with both light and dark modes

## Installation

Portpass runs in a browser (Chrome, Safari, Firefox, Edge) and can be installed as an app on your device. This style of installing a web page as an app icon is called a "Progressive Web App" or PWA. Installation involves visiting a web page and then telling your browser to create an app icon (like a bookmark) on your homescreen. This caches the Portpass code locally, and Portpass does not communicate with any remote servers. Safari, Chrome, and Edge browsers support installing as standalone webpage apps like this. There is no app store involved, and the process is the same on mobile and desktop.

* Open [https://dbro.github.io/portpass/](https://dbro.github.io/portpass/) in your browser
* When prompted, tap "Add to Home Screen" (iOS/Android) or "Install" (desktop)
* You can pin the app to your operating system's launcher dashboard

Portpass will then be visible as a standalone app and can be launched with a tap. It works offline and uses your local vault file. Portpass NEVER sends your vault file or your master password anywhere, they remain on your device and in your control. Your vault file is in your control and you can choose how to share it and copy it.

For improved security, install Portpass in a [dedicated browser profile with no extensions](SECURITY.md#mitigation-use-a-dedicated-browser-profile). This protects against malicious browser extensions that may be running in your web browser's primary profile.

**Caveat: Firefox** browsers do not support PWA and do not support opening a file in read+write mode, only in read-only mode. This means you should not use Firefox to install Portpass, and you cannot edit Portpass vaults that are opened with Firefox. You can access Portpass vault information while using Firefox to browse the web, using the normal copy+paste and autofill methods to get passwords from the Portpass vault into a browser setting. In this scenario, Portpass runs in a different browser such as Chrome or Safari.

**Caveat: iOS** does not allow overwriting files. When running on iOS devices, Portpass opens all vaults in read-only mode. If you modify the vault data and then save it, the file will get a new name (eg. "My vault(1).psafe3").

## Choosing the right level of Security and Convenience

Basic operation of Portpass involves opening local vault files where you can store and retrieve your login names and passwords, and other sensitive information. If you want, you can run Portpass in a separate browser profile to isolate it from any potentially malicious browser extensions installed in your main browser profile.

If you are comfortable using the system clipboard, Portpass enables you to copy+paste information from your vault into the websites and apps that need them. Note that on Windows systems, the clipboard is readable by all applications, presenting a risk of a malicious app eavesdropping on the clipboard contents.

When running on desktop/laptop systems, Portpass supports automatic insertion of field values into web page DOM elements. This can be a more convenient way to log in to websites when using a browser profile that you trust to not have malicious browser extensions running.

You can read and write vault files stored in cloud storage. A file stored in the cloud can be accessed from multiple devices, and in some cases can be configured (using the cloud storage provider's settings) to have automatic versioning and backup capabilities.

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
4. Each person runs Portpass (or any app that can read a pwsafev3 vault file) on their own device, and can unlock one or more vault files, including the vault file you shared with them.

From that point on, the shared vault opens automatically alongside each person's personal vault. Adding new records to the shared vault or editing existing ones writes the changes back to the shared file, where they propagate to everyone else via normal cloud sync.

**Sync conflicts are automatically detected**

Two people editing the shared vault at exactly the same time leads to a situation where neither version of the file is the "most current". Portpass detects the potential conflict and asks for confirmation before overwriting the conflicting version of the file. To reduce the chance of colliding edits, select one person to have read+write access and everyone else to have read-only access to each vault file. Note that Portpass auto-saves changes immediately, but does NOT automatically reload if the underlying file has been changed since it was first opened.

Tip: check if your cloud storage service supports file versioning and rollback, which can be useful in password management recovery and auditing scenarios.

## Compatibility & no vendor lock-in

Portpass reads and writes the [Password Safe v3](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt) format, the same format used by [dozens of apps](https://pwsafe.org/relatedprojects.shtml) across all major platforms. This means you can switch apps at any time without losing your data — your vault file works with any compatible application, now and in the future.

## Compared to Password Safe

[Password Safe](https://pwsafe.org/) is the original and official app for pwsafe v3 vault files. It is available as a native desktop app for Windows and Linux. Portpass and Password Safe share the same vault format, so your data is never locked in.

**Features in Password Safe not currently supported by Portpass:**

- Autofill into native desktop apps (Portpass autofills into desktop browsers only)
- Automatic vault lock after an idle timeout
- Password strength indicator and breach alerts
- Aliases and linked entries (re-using a password across multiple entries)
- Passphrase generation (diceware / word lists)
- Site-specific password generation policies (Portpass uses the same adjustable policy for all vaults and entries)
- File attachments and passkeys stored in the vault
- Export and import in other vault file formats
- SSH agent integration
- Automatic file version backups
- Adjustable unlock difficulty (key stretching iteration count)

**What Portpass offers that Password Safe does not:**

- Runs on mobile, desktop, and tablet devices
- Modern mobile-first design with touch-friendly interface
- Biometric/PIN unlock via fingerprint, face recognition, PIN, or hardware security key (WebAuthn PRF — YubiKey series 5+ may work but is untested)
- Autofill inserts single-field values (as well as a configurable sequence of fields also supported by Password Safe)
- Opens multiple vault files simultaneously, especially useful for sharing passwords
- Light/dark themes with selectable accent colors

## How it works

Portpass runs entirely in your browser using WebAssembly, a technology that lets compiled code run securely in the browser at near-native speed. All cryptography happens on your device. Your vault file and master password never leave it.
There is no server, no account, and nothing to trust except the open source code, which is freely available to inspect on GitHub.

**Biometric/PIN unlock** can be enabled to use your device's built-in authentication (fingerprint, face recognition, or PIN) so you don't have to type your master password on repeat visits. Your master password is encrypted with a key only your device can produce and stored locally, it is never transmitted anywhere.

The Chrome browser routes biometric/PIN unlock setup through [Google Password Manager](https://passwords.google.com/), which requires a recovery PIN to have been set up previously. Google Password Manager stores a synced copy of the passkey in Google's cloud (but not your vault's master password, which always stays on your device). To set up or reset a Google Password Manager recovery PIN, visit [passwords.google.com/passkeys/reset/intro](https://passwords.google.com/passkeys/reset/intro). Other browsers beyond Chrome use similar hosted services (eg. Microsoft password manager, Apple iCloud keychain).

## Autofill

Portpass can fill login forms automatically to simplify your login experiences on desktop websites. This feature is only available on desktop browsers, and the settings are not visible when using a mobile device. It works using a bookmarklet that Portpass creates for you, and it avoids copying passwords into the clipboard where malicious apps could try to eavesdrop. The picker stays inside the browser window and can handle situations with multiple URL matches and fuzzy matching.

1. Visit a webpage with a login form you want to fill in
2. **Click the bookmarklet** in your browser's bookmarks bar
3. Choose a matching password if Portpass does not select one automatically
4. In the popup, leave **Autofill** selected or choose one field value to insert
5. Click the destination field on the webpage

Portpass finds matching vault entries by URL, lets you pick one if there are multiple matches, and fills the form fields following the record's Autofill sequence. You can also insert one field at a time, reveal sensitive values when needed, or search all unlocked vaults from the picker.

<img src="https://github.com/user-attachments/assets/46de7dff-c3e1-4dc4-a6e4-fd9088417033" width="80%" alt="Screenshots of autofill operation">

### How Autofill works

A `javascript:` bookmarklet in your browser's bookmarks bar opens a small picker popup when you click it on a login page. The popup shows credentials that match the current page's URL and automatically opens the credential panel when there is one exact match. The panel defaults to the record's Autofill sequence (fill username -> Tab -> fill password -> Submit), but you can select an individual field instead. After you click the destination field on the webpage, Portpass fills the selected value or sequence directly.

The bookmarklet itself is not a secret and contains no private key. It opens Portpass's `autofill.html` popup, which holds a non-extractable signing key in Portpass-origin browser storage for that profile. Portpass stores the matching public key as a revocable autofill delegate. Requests are signed by the popup, and credential replies are encrypted to a fresh per-session key. The popup initially receives field metadata; sensitive values are requested only when you reveal them or insert them.

No credentials pass through the clipboard at any point -- this matters on Windows and Linux, where clipboard contents can be read by any running process, and in browsers where extensions with clipboard permission could read a copied password before it is pasted.

In same-profile autofill, Portpass searches all unlocked vaults for URLs that match the current web page. It compares the canonical version, removing "www." as well as url parameters after the "?" and "#" characters. It looks for exact matches first, then falls back to offering the current open record (if one is open) as well as up to 5 near matches. If one of the non-exact matches is chosen, you can instruct Portpass to update that entry's URL in the vault to match the current webpage URL to accelerate future Autofill requests on this webpage. The "near match" method uses edit distance (Levenshtein) showing the five closest matches within a distance of 5 edits.

In cross-profile autofill, credential release is stricter: Portpass only sends credentials over the relay for exact authorized URL matches. If there is no exact match, it returns metadata only, such as the count of near matches, and prompts you to view or update the record inside Portpass.

### Setting up an autofill bookmarklet

1. Open Portpass and unlock your vault.
2. Open vault settings (tap the vault name in the top bar).
3. Under **Autofill**, click **+ Create a new autofill bookmarklet**, then **+ Add same-profile bookmarklet**.
4. Give it a name (e.g. "Chrome — main profile"), drag the chip to your browser's bookmarks bar, and click **Save and Close**. If the bar is hidden, click **Copy link** and add the bookmark manually.

<img src="https://github.com/user-attachments/assets/468bd877-581e-4d07-a350-713953aac0c1" width="35%" alt="Screenshot of autofill sequence configuration">

For cross-profile setup, start the [switchboard](https://github.com/dbro/switchboard) as a background service on your machine before using the bookmarklet. See the repo README for instructions to run switchboard automatically in the background.

Cross-profile setup uses a separate pairing ceremony because the filling profile and the clean Portpass profile do not share browser storage:

1. In the clean Portpass profile, open vault settings -> **Autofill** -> **+ Create a new autofill bookmarklet**.
2. Under **Cross-profile pairing**, open the pairing-page URL shown in your everyday browser profile.
3. In the everyday profile, name and install the bookmarklet, then copy the `ppair1_...` token.
4. Back in the clean Portpass profile, click **+ Pair everyday profile**, paste the token, compare the short pairing code, and click **Pair everyday profile**.


### Autofill sequence configurations for websites

Each entry in Portpass has an optional field called **Autofill sequence** that describes what and where to fill in the login form. It is based on keyboard actions, which most web login forms support natively. The visual representation shows each action as a separate unit:

<img src="https://github.com/user-attachments/assets/677ce196-f282-4de6-8506-407905e077c4" width="35%" alt="Screenshot of autofill bookmarklet creation">

The text representation is also possible, and is easier to document here. The default `\u\t\p\n` covers most sites and means: fill username, tab to the next field, fill password, press enter to submit. You can customise this for unusual login flows (e.g. single-field pages, sites that require an email, sites with two-factor code fields).

| Code | Action |
|---|---|
| `\u` | Username |
| `\p` | Password |
| `\m` | Email |
| `\2` | One-time code (TOTP) |
| `\v{name}` | Custom field whose name matches `name` |
| `\t` | Tab to next field |
| `\s` | Shift-Tab (previous field) |
| `\n` | Submit form |
| `\wNNN` | Wait NNN milliseconds |
| `\WNNN` | Wait NNN seconds |

| Example | Actions |
|---|---|
| `\p\n` | fill password, submit form | 
| `\u\n\W5\2` | fill username, submit form, wait 5 seconds, fill one-time code |
| `\v{Card number}\t\v{Expiration date}\t\v{CVN}` | fill three named custom fields, separated by tabs |

### Best practices with Autofill

- **Use a unique autofill profile for each browser profile.** Each profile has its own non-extractable signing key stored by `autofill.html` in that browser profile's Portpass-origin storage. Create a separate bookmarklet/delegate for each browser and profile where you want autofill, and give each a descriptive name so you can revoke individual ones if needed.
- **Revoke bookmarklets you no longer use.** Open vault settings → Autofill, and click **Revoke** next to any entry you want to invalidate. The corresponding bookmarklet will be rejected immediately, even if it is still in someone's bookmarks bar.
- **Prefer autofill over copy-paste on Windows and Linux (X11).** On these platforms, any running process can read the clipboard at any time. Autofill writes directly to the form field without ever putting the credential in the clipboard, eliminating that exposure window entirely. (Linux Wayland has better clipboard security than X11.)

See [SECURITY.md](SECURITY.md) for a full description of how the delegate model guards against malicious extensions, clipboard eavesdropping, and other threats.

### Differences from Official Password Safe app Autotype

The official desktop Password Safe app has a function called "Autotype" that can insert keystrokes into other apps. Portpass uses the browser's javascript to inject values directly into the DOM and supports the same named custom-field code (`\v{name}`).

### Same-profile and cross-profile autofill

It is possible to autofill while running Portpass in a separate clean profile, following the security best-practice to reduce exposure to browser extensions -- however, it requires a helper switchboard running in its own process on your system. It is also possible to run Portpass in a different browser (eg. Chrome) and use autofill in another browser (eg. Firefox).

**Same-profile**: Portpass and the pages you fill are in the same browser profile. The bookmarklet opens `autofill.html`, which talks to Portpass directly via a browser-internal channel. No extra software needed. This is the simpler approach, but it means that all your browser extensions could try to attack Portpass. If you trust your browser extensions, this is ok.

**Cross-profile**: To protect against malicious browser extensions, you can run Portpass in a separate browser profile with no extensions installed. The filling profile pairs its `autofill.html` popup with the clean Portpass profile using a short-lived copy/paste token. A helper service called **[switchboard](https://github.com/dbro/switchboard)** then provides a local message relay between the two profiles. No data leaves your machine. The relay is treated as untrusted: requests are signed by the paired popup, replies are encrypted to that popup's per-session key, replayed requests are rejected, and credentials are released only for exact authorized URL matches.

Private or incognito windows behave like a separate temporary browser profile. They cannot use a same-profile setup that has Portpass open in a normal browser window; use the cross-profile relay and pair the private window instead. Because private-window storage is temporary, pairing must be repeated after the private session closes.

See [SECURITY.md](SECURITY.md) for setup instructions.

Note that while Portpass should run in Chrome or Safari, the bookmarklet can run in Chrome, Safari, and Firefox. More than one bookmarklet can be created and used by Portpass, allowing fine-grained control for people who use multiple browsers and profiles.

## Security

Portpass's threat model, known limitations, and guidance on protecting yourself from malicious browser extensions are documented in [SECURITY.md](SECURITY.md).

## Roadmap

Possible future improvements:
* Automatically lock vault after an amount of time or system event (eg screen lock)
* Companion mobile keyboard app to autofill values
* Display and store attachments in the vault (one for each password)
* Import/Export other vault file formats

Some of these capabilitites can be done today using other apps that read and write pwsafe v3 files (mobile keyboard app, import/export).

## Credits

Portpass is built on the Go/WebAssembly backend from [gopwsafe](https://github.com/tkuhlman/gopwsafe). Portpass started as a fork of that project and has contributed changes back upstream.

[pwsafe.org](https://pwsafe.org/) is the main website for Password Safe

The broader ecosystem of compatible apps, especially Jeff Harris' [Android app](https://market.android.com/details?id=com.jefftharris.passwdsafe) and the [StrongBox apps for iOS and Mac](https://strongboxsafe.com/).

## Disambiguation

Portpass shares a name with

* [Port Pass](https://www.portpass.com/) "The secure digital identity solution for ISPS-compliant port terminals"
* [PORTpass](https://portpassportal.com/) was a private proof-of-vaccination app used in Canada
* https://github.com/paul1029-ife/portpass "A simple npm package that provides a tunnel for testing your local web apps across different IP addresses.(devices)."
