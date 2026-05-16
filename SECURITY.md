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

---

## Vault file security

- **Store your vault file somewhere you control.** A local disk, USB drive, or personal cloud storage account (iCloud, Dropbox, etc.) are all reasonable. The file is encrypted; an attacker who obtains it still needs your master password to read it.
- **Keep a backup.** If the only copy of your vault is on one device and that device fails, your passwords are unrecoverable. Treat the vault file like any other irreplaceable document.
- **Use a strong master password.** Prefer a long passphrase (five or more random words) over a short complex password. Length matters more than special characters.
- **Cloud sync is safe but adds a dependency.** Storing the vault in a synced folder (iCloud, Dropbox, etc.) is convenient and the file stays encrypted, but you are also relying on the security of that service. Use a strong, unique master password.

---

## Fast unlock (biometric)

The optional biometric fast-unlock feature uses your fingerprint or face to encrypt your master password on-device. The encrypted password is stored in your browser's local storage (IndexedDB), and the decryption key is derived from your biometric via the WebAuthn PRF extension and it never leaves your device.

An attacker with physical access to your device and browser profile could extract the ciphertext from IndexedDB, but cannot decrypt it without the biometric credential held in your device's secure hardware.

If your master password changes, re-enroll biometric fast-unlock. The old enrollment is automatically cleared on the next failed unlock attempt.

---

## Clipboard security

Portpass automatically clears the clipboard 30 seconds after you copy a password, reducing the window during which it can be read by another app.

### Platform differences

Clipboard access is restricted at the OS level on **iOS, Android, and Linux (Wayland)**. On these platforms, only the foreground app can read the clipboard, so copied passwords are well-protected from background processes.

**macOS** restricts clipboard access for non-browser apps, but browser extensions running in the same profile can still read it. Use a dedicated browser profile with no extensions (see above).

**Windows and Linux (X11)** have no OS-level clipboard isolation which means any running process can read the clipboard at any time. Users on these platforms should be especially careful to use the dedicated browser profile mitigation, and be aware that other apps may be able to read a copied password before the clipboard gets cleared.

---

## Implementation notes

- **Memory**: the salted password buffer used during key stretching is zeroed immediately after use.
- **Timing**: password comparison uses a constant-time XOR accumulator to prevent timing side-channel attacks.
- **KDF**: the vault key is derived using SHA-256 iterated 262,144 times (the [pwsafe v3 format minimum](https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt)), making offline brute-force attacks significantly more costly.

---

## Reporting security issues

To report a vulnerability privately, use [GitHub Security Advisories](https://github.com/dbro/portpass/security/advisories/new). This lets the issue be addressed before public disclosure.

For non-security bugs, open a regular [GitHub issue](https://github.com/dbro/portpass/issues). Include a description and steps to reproduce. Do not include actual vault files or passwords in reports.
