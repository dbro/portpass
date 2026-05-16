# Portpass

*A simple password manager that keeps your data in your control, across all your devices.*

<img src="https://github.com/user-attachments/assets/6917e607-a4ce-4ba8-bf76-b926f830713f" width="65%" alt="Screenshots of mobile layouts">

**Free and open source. Try it: [https://dbro.github.io/portpass](https://dbro.github.io/portpass)**

Portpass is for people who want full control over their passwords, in an app that works great on mobile devices and is built with solid encryption methods. Hosted services like 1Password and LastPass are polished, but require trusting a startup with your most sensitive data.

Portpass is different: your passwords live in a file on your device, or in a cloud storage service you already trust. The encrypted vault is stored as a pwsafe v3 file, using the method invented by cryptographer [Bruce Schneier](https://www.schneier.com/) in the 1990s, open-sourced and audited for decades. No browser extensions, no proprietary sync, no new crypto to evaluate.

## What Portpass does

* streamlines login to apps and websites
* works fully offline, no internet connection required
* runs on all your devices: mobile, tablet, and desktop
* generates strong passwords
* generates one-time codes (TOTP) for two-factor authentication (2FA)
* organizes password records into groups for browsing
* supports custom fields (eg. PIN codes, account numbers, API keys)
* encrypts your vault using an established open source format (pwsafe v3)
* stores your vault as a file on your device, for easy sync/backup
* supports convenient alternate unlock methods: fingerprint, face recognition, and PIN
* has a mobile-first design with both light and dark modes

## Installation

Portpass runs in your browser and can be installed as an app on any device. Installation involves visiting a web page and then telling your browser to create an app icon (like a bookmark) on your homescreen. Safari and Chrome browsers support installing as standalone webpage apps like this, and maybe some other browsers do too. There is no app store involved, and the process is the same on mobile and desktop.

* Open [https://dbro.github.io/portpass/](https://dbro.github.io/portpass/) in your browser
* When prompted, tap "Add to Home Screen" (iOS/Android) or "Install" (desktop)
* You might also want to pin the app to your app launcher dashboard on your desktop

Portpass will then be visible as a standalone app and can be launched with a tap. It works offline and uses your local vault file.

For best security, install Portpass in a [dedicated browser profile with no extensions](SECURITY.md#mitigation-use-a-dedicated-browser-profile).

## Cross-platform + how to sync

Portpass runs as a Progressive Web App (PWA) on any device with a modern browser (eg. iPhone, Android, Windows, Mac, Linux). Install it to your home screen for quick access, just like a native app.

Because your vault is a regular file, syncing across devices is straightforward using any file storage service you already trust (eg. Dropbox, Google Drive, iCloud, Syncthing). [See sync options →]

## Compatibility & no vendor lock-in

Portpass reads and writes the [Password Safe v3](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt) format, the same format used by [dozens of apps](https://pwsafe.org/relatedprojects.shtml) across all major platforms. This means you can switch apps at any time without losing your data — your vault file works with any compatible application, now and in the future.

## Compared to Password Safe

[Password Safe](https://pwsafe.org/) is the original app for this file format, available as a native desktop app for Windows and Linux. Portpass and Password Safe share the same vault format, so your data is never locked in.

**Features in Password Safe not currently supported by Portpass:**

- Autofill passwords into other apps (requires a browser extension or native helper app)
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

- Runs in any modern browser — no installation required
- Works on mobile (iOS, Android) with a touch-friendly interface
- Biometric/PIN unlock via fingerprint, face recognition, PIN, or hardware security key (WebAuthn PRF — YubiKey series 5+ may work but is untested)
- Light/dark themes with selectable accent colors

## How it works

Portpass runs entirely in your browser using WebAssembly, a technology that lets compiled code run securely in the browser at near-native speed. All cryptography happens on your device. Your vault file and master password never leave it.
There is no server, no account, and nothing to trust except the open source code, which is freely available to inspect on GitHub.

**Biometric/PIN unlock** can be enabled to use your device's built-in authentication (fingerprint, face recognition, or PIN) so you don't have to type your master password on repeat visits. Your master password is encrypted with a key only your device can produce and stored locally, it is never transmitted anywhere.

On Android, Chrome routes biometric/PIN unlock setup through [Google Password Manager](https://passwords.google.com/), which requires a recovery PIN to have been set up previously. Google Password Manager stores a synced copy of the passkey in Google's cloud (but not your vault's master password, which always stays on your device). To set up or reset a Google Password Manager recovery PIN, visit [passwords.google.com/passkeys/reset/intro](https://passwords.google.com/passkeys/reset/intro).

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
