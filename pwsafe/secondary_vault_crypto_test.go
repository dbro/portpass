package pwsafe

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// deriveTestKey mirrors the WASM deriveSecondaryKey function.
func deriveTestKey(stretchedKey []byte) []byte {
	mac := hmac.New(sha256.New, stretchedKey)
	mac.Write([]byte("portpass-secondary-vault-v1"))
	return mac.Sum(nil)
}

// encryptDecryptRoundtrip mirrors the WASM encryptForSecondaryVaults/decryptForSecondaryVaults pair.
func encryptDecryptRoundtrip(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(iv); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, iv, []byte(plaintext), nil)

	// Decrypt immediately to verify roundtrip
	result, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

func TestDeriveSecondaryKey_IsDeterministic(t *testing.T) {
	db := NewV3("test", "hunter2")
	key1 := deriveTestKey(db.StretchedKey[:])
	key2 := deriveTestKey(db.StretchedKey[:])
	assert.Equal(t, key1, key2, "key derivation must be deterministic")
}

func TestDeriveSecondaryKey_Is32Bytes(t *testing.T) {
	db := NewV3("test", "hunter2")
	key := deriveTestKey(db.StretchedKey[:])
	assert.Len(t, key, 32, "derived key must be 32 bytes for AES-256")
}

func TestDeriveSecondaryKey_DifferentPasswords(t *testing.T) {
	db1 := NewV3("test", "password1")
	db2 := NewV3("test", "password2")
	key1 := deriveTestKey(db1.StretchedKey[:])
	key2 := deriveTestKey(db2.StretchedKey[:])
	assert.NotEqual(t, key1, key2, "different passwords must produce different keys")
}

func TestDeriveSecondaryKey_ChangesWithSalt(t *testing.T) {
	// Simulate password change (new salt → new stretched key → new derived key)
	db := NewV3("test", "samepassword")
	key1 := deriveTestKey(db.StretchedKey[:])
	require.NoError(t, db.SetPassword("samepassword")) // new salt
	key2 := deriveTestKey(db.StretchedKey[:])
	assert.NotEqual(t, key1, key2, "password change (new salt) must change the derived key")
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	db := NewV3("test", "hunter2")
	key := deriveTestKey(db.StretchedKey[:])

	plaintext := "super-secret-vault-password!@#$"
	result, err := encryptDecryptRoundtrip(key, plaintext)
	require.NoError(t, err)
	assert.Equal(t, plaintext, result)
}

func TestEncryptDecryptRoundtrip_EmptyString(t *testing.T) {
	db := NewV3("test", "hunter2")
	key := deriveTestKey(db.StretchedKey[:])
	result, err := encryptDecryptRoundtrip(key, "")
	require.NoError(t, err)
	assert.Equal(t, "", result)
}

func TestEncryptDecryptRoundtrip_WrongKey(t *testing.T) {
	db1 := NewV3("test", "password1")
	db2 := NewV3("test", "password2")
	key1 := deriveTestKey(db1.StretchedKey[:])
	key2 := deriveTestKey(db2.StretchedKey[:])

	// Encrypt with key1, try to decrypt with key2 — must fail
	block, _ := aes.NewCipher(key1)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, gcm.NonceSize())
	rand.Read(iv)
	ciphertext := gcm.Seal(nil, iv, []byte("secret"), nil)

	block2, _ := aes.NewCipher(key2)
	gcm2, _ := cipher.NewGCM(block2)
	_, err := gcm2.Open(nil, iv, ciphertext, nil)
	assert.Error(t, err, "decryption with wrong key must fail")
}
