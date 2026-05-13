# Security

## Threat model

Portpass is a local-first password manager. Your vault is a `.psafe3` file that lives on your device. All encryption and decryption happen locally in your browser — no passwords, keys, or vault contents are ever sent to a server.

### What Portpass protects against

- **Network interception** — nothing sensitive is transmitted over the network.
- **Cloud service breach** — there is no Portpass server holding your vault. A breach of this project's infrastructure cannot expose your passwords.
- **Vendor lock-in** — the `.psafe3` format is an open standard readable by multiple independent apps. Your data is yours regardless of what happens to this project.

### What Portpass does not protect against

- **Weak master password** — the vault's encryption is only as strong as your master password. Use a long, random passphrase. A weak password can be brute-forced offline if someone obtains your vault file.
- **Compromised device** — if your device is compromised at the OS level, an attacker can read browser memory, including decrypted passwords.
- **Malicious browser extensions** — see below. This is the most realistic threat for most users.
- **Lost vault file** — Portpass does not back up your vault. If the file is lost and you have no copy, your passwords are gone. Keep a backup in a safe place.

---

## Malicious browser extensions

Browser extensions are the most realistic everyday threat to any browser-based password manager.

### Why extensions are dangerous

An extension with broad host permissions runs in the same process as every web page you visit. It can:

- Read and modify the content of any page, including the Portpass UI
- Observe values typed into input fields, including your master password as you type it
- Read the clipboard immediately after you copy a password, before you paste it

This applies to every browser-based password manager — it is not a flaw specific to Portpass. It is a fundamental property of how browser extensions work.

### Mitigation: use a dedicated browser profile

The most effective defense is to use Portpass in a separate browser profile that has no extensions installed.

Extensions are installed per-profile. A profile with no extensions has no extension attack surface, regardless of what is installed in your other profiles.

**Setup (Chrome or Edge):**

1. Open the profile menu (top-right corner) and choose **Add profile**.
2. Skip Google/Microsoft sign-in — it is not required.
3. Navigate to [Portpass](https://dbro.github.io/portpass/), open the browser menu, and choose **Install app**. The app will appear as a standalone window in your taskbar or dock.
4. Do not install any extensions in this profile.

**Firefox:** Go to `about:profiles`, create a new profile, launch it with **Launch profile in new browser**, navigate to [Portpass](https://dbro.github.io/portpass/), and do not install extensions.

**Workflow:** Alt-tab to the Portpass window when you need a password, copy it, and paste it in your main browser. The 30-second clipboard autoclear limits the window during which a compromised extension could read it.

---

## Vault file security

- **Store your vault file somewhere you control.** A local disk, USB drive, or personal cloud storage account (iCloud, Dropbox, etc.) are all reasonable. The file is encrypted; an attacker who obtains it still needs your master password to read it.
- **Keep a backup.** If the only copy of your vault is on one device and that device fails, your passwords are unrecoverable. Treat the vault file like any other irreplaceable document.
- **Use a strong master password.** Prefer a long passphrase (five or more random words) over a short complex password. Length matters more than special characters.

---

## Fast unlock (biometric)

The optional biometric fast-unlock feature uses your fingerprint or face to encrypt your master password on-device. The encrypted password is stored in your browser and the decryption key never leaves your device.

If your master password changes, re-enroll biometric fast-unlock — the old enrollment is automatically cleared on the next failed unlock attempt.

---

## Reporting security issues

Please open an issue at https://github.com/dbro/portpass/issues. Include a description of the issue and steps to reproduce. Please do not include actual vault files or passwords in bug reports.
