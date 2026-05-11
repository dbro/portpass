# Portpass

*A simple password manager that keeps your data in your control, across all your devices.*

Portpass is for people who take password security seriously but are frustrated by the options. Existing open-source tools often look and feel dated. Hosted services like 1Password and LastPass are polished, but require trusting a startup with your most sensitive data.

Portpass is different: your passwords live in a file on your device, or in a cloud storage service you already trust. The encrypted vault is stored as a pwsafe v3 file, using the method invented by cryptographer [Bruce Schneier](https://www.schneier.com/) in the 1990s, open-sourced and audited for decades. No browser extensions, no proprietary sync, no new crypto to evaluate.

## What Portpass does

* streamlines login to apps and websites
* works fully offline, no internet connection required
* generates strong passwords
* organizes password records into groups for browsing
* encrypts your vault using an established open source format (pwsafe v3)
* stores your vault as a file on your device, for easy sync/backup

## Installation

Portpass runs in your browser and can be installed as an app on any device. There installation method involves visiting a web page and then telling your browser to create an app icon (like a bookmark) on your homescreen. Not all mobile browsers support installing websites as app icons; Safari and Chrome do. There is no app store involved, and the process is the same on mobile and desktop.

* Open https://dbro.github.io/portpass/ in your browser
* When prompted, tap "Add to Home Screen" (iOS/Android) or "Install" (desktop)

Portpass is now available as a standalone app. It works offline and uses your local vault file.

## Cross-platform + how to sync

Portpass runs as a Progressive Web App (PWA) on any device with a modern browser (eg. iPhone, Android, Windows, Mac, Linux). Install it to your home screen for quick access, just like a native app.

Because your vault is a regular file, syncing across devices is straightforward using any file storage service you already trust (eg. Dropbox, Google Drive, iCloud, Syncthing). [See sync options →]

## Compatibility & no vendor lock-in

Portpass reads and writes the [Password Safe v3](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt) format, the same format used by [dozens of apps](https://pwsafe.org/relatedprojects.shtml) across all major platforms. This means you can switch apps at any time without losing your data — your vault file works with any compatible application, now and in the future.

## How it works

Portpass runs entirely in your browser using WebAssembly, a technology that lets compiled code run securely in the browser at near-native speed. All cryptography happens on your device. Your vault file and master password never leave it.
There is no server, no account, and nothing to trust except the open source code, which is freely available to inspect on GitHub.

## Credits

Portpass is built on the Go/WebAssembly backend from [gopwsafe](https://github.com/tkuhlman/gopwsafe). Portpass started as a fork of that project and has contributed changes back upstream.

[pwsafe.org](https://pwsafe.org/) is the main website for Password Safe

The broader ecosystem of compatible apps, especially Jeff Harris' [Android app](https://market.android.com/details?id=com.jefftharris.passwdsafe) and the [StrongBox apps for iOS and Mac](https://strongboxsafe.com/).

## Disambiguation

Portpass shares a name with

* [Port Pass](https://www.portpass.com/) "The secure digital identity solution for ISPS-compliant port terminals"
* [PORTpass](https://portpassportal.com/) was a private proof-of-vaccination app used in Canada
* https://github.com/paul1029-ife/portpass "A simple npm package that provides a tunnel for testing your local web apps across different IP addresses.(devices)."
