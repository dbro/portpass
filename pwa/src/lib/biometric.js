import { get, set, del } from 'idb-keyval'

const STORAGE_KEY    = 'biometric-v1'
const PRF_SALT       = new TextEncoder().encode('portpass-v1')
const MAX_ENROLLMENTS = 10

async function getEnrollments() {
  return (await get(STORAGE_KEY)) ?? []
}

async function saveEnrollments(arr) {
  if (arr.length === 0) await del(STORAGE_KEY)
  else await set(STORAGE_KEY, arr)
}

export async function isBiometricSupported() {
  if (!window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch { return false }
}

// Returns true only when the stored enrollment matches the given vault UUID.
export async function isBiometricEnrolled(vaultUuid) {
  if (!vaultUuid) return false
  try {
    const enrollments = await getEnrollments()
    return enrollments.some(e => e.vaultUuid === vaultUuid)
  } catch { return false }
}

// Pre-open check for StartPage: match by filename before the vault is decrypted.
export async function isBiometricEnrolledForFile(filename) {
  if (!filename) return false
  try {
    const enrollments = await getEnrollments()
    return enrollments.some(e => e.filename === filename)
  } catch { return false }
}

// Upserts an enrollment for this vault, keeping up to MAX_ENROLLMENTS total.
export async function enrollBiometric(masterPassword, vaultUuid, filename) {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId    = crypto.getRandomValues(new Uint8Array(16))

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Portpass', id: window.location.hostname },
      user: { id: userId, name: 'portpass-vault', displayName: 'Portpass Vault' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7   },  // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: { prf: { eval: { first: PRF_SALT } } },
      timeout: 60000,
    },
  })

  const prfResult = cred.getClientExtensionResults().prf?.results?.first
  if (!prfResult) throw new Error('Biometric unlock is not supported on this device or browser.')

  const key = await deriveKey(prfResult)
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(masterPassword)
  )

  const enrollment = {
    vaultUuid,
    filename,
    credentialId: Array.from(new Uint8Array(cred.rawId)),
    iv:           Array.from(iv),
    ciphertext:   Array.from(new Uint8Array(ciphertext)),
  }

  const existing = await getEnrollments()
  const filtered = existing.filter(e => e.vaultUuid !== vaultUuid)
  await saveEnrollments([enrollment, ...filtered].slice(0, MAX_ENROLLMENTS))
}

export async function unlockWithBiometric(filename) {
  const enrollments = await getEnrollments()
  const stored = enrollments.find(e => e.filename === filename)
  if (!stored) throw new Error('No biometric enrollment found.')

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: new Uint8Array(stored.credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: PRF_SALT } } },
      timeout: 60000,
    },
  })

  const prfResult = assertion.getClientExtensionResults().prf?.results?.first
  if (!prfResult) throw new Error('PRF extension not available — biometric unlock failed.')

  const key = await deriveKey(prfResult)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(stored.iv) },
    key,
    new Uint8Array(stored.ciphertext)
  )

  return new TextDecoder().decode(plaintext)
}

// Remove enrollment for a specific vault UUID (used when disabling from vault settings).
export async function clearBiometric(vaultUuid) {
  const enrollments = await getEnrollments()
  await saveEnrollments(enrollments.filter(e => e.vaultUuid !== vaultUuid))
}

// Remove enrollment by filename (used when a stale credential is detected on unlock).
export async function clearBiometricForFile(filename) {
  const enrollments = await getEnrollments()
  await saveEnrollments(enrollments.filter(e => e.filename !== filename))
}

async function deriveKey(prfOutput) {
  const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('portpass-master-key-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
