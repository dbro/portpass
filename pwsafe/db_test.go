package pwsafe

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

/* The test databases simple.dat and three.dat were made using Loxodo (https://github.com/sommer/loxodo)
Some other test dbs can be found at https://github.com/ronys/pypwsafe/tree/master/test_safes
these all have the password 'bogus12345'
*/

func TestKeys(t *testing.T) {
	var db V3
	db.Iter = 2048
	db.Salt = [32]byte{224, 70, 145, 8, 59, 173, 47, 241, 203, 157, 83, 209, 22, 55, 151, 157, 96, 234, 194, 167, 175, 251, 199, 145, 7, 219, 203, 168, 6, 166, 238, 241}
	expectedKey := [32]byte{243, 201, 143, 194, 139, 58, 186, 186, 133, 14, 238, 200, 139, 153, 45, 247, 215, 251, 24, 49, 28, 170, 157, 181, 21, 174, 129, 231, 234, 62, 51, 203}

	// tests the stretchedKey
	db.calculateStretchKey("password")
	assert.Equal(t, db.StretchedKey, expectedKey)

	keyBuf := &bytes.Buffer{}
	assert.NoError(t, db.refreshEncryptedKeys(keyBuf))
	createdEncryptionKey := db.EncryptionKey
	createdHMACKey := db.HMACKey

	// extract the keys from the encrypted bytes and compare to the original
	db.extractKeys(keyBuf.Bytes())
	assert.Equal(t, createdEncryptionKey, db.EncryptionKey)
	assert.Equal(t, createdHMACKey, db.HMACKey)
}

func TestWipeClearsMutableSecretMaterial(t *testing.T) {
	db := NewV3("test", "password")
	db.EncryptionKey = [32]byte{1}
	db.HMACKey = [32]byte{2}
	db.HMAC = [32]byte{3}
	db.CBCIV = [16]byte{4}
	db.Header.LastSaveBy = []byte{5, 6}
	db.Header.UnknownFields = []unknownField{{ID: 0xfe, Data: []byte{7, 8}}}
	db.Records["record"] = Record{
		Title:        "record",
		Password:     "password",
		TwoFactorKey: []byte{9, 10},
		UnknownFields: []unknownField{
			{ID: 0xfd, Data: []byte{11, 12}},
		},
	}

	headerBytes := db.Header.LastSaveBy
	headerUnknown := db.Header.UnknownFields[0].Data
	totp := db.Records["record"].TwoFactorKey
	recordUnknown := db.Records["record"].UnknownFields[0].Data

	db.Wipe()

	assert.Equal(t, V3{}, *db)
	assert.Equal(t, []byte{0, 0}, headerBytes)
	assert.Equal(t, []byte{0, 0}, headerUnknown)
	assert.Equal(t, []byte{0, 0}, totp)
	assert.Equal(t, []byte{0, 0}, recordUnknown)
}

func TestInvalidFile(t *testing.T) {
	_, err := OpenPWSafeFile("./db.go", "password")
	assert.Equal(t, err, errors.New("file is not a valid Password Safe v3 file"))
	_, err = OpenPWSafeFile("./notafile", "password")
	assert.NotNil(t, err)
}

func TestCanonicalURL(t *testing.T) {
	cases := [][2]string{
		{"https://www.example.com/login/", "example.com/login"},
		{"http://www.example.com/login/", "example.com/login"},
		{"https://example.com/login", "example.com/login"},
		{"https://www.Example.COM/Login/?ref=1#top", "example.com/login"},
		{"example.com", "example.com"},
		{"example.com/path", "example.com/path"},
		{"https://sub.example.com/a/b/", "sub.example.com/a/b"},
		{"", ""},
	}
	for _, c := range cases {
		assert.Equal(t, c[1], CanonicalURL(c[0]), "input: %q", c[0])
	}
}

func TestSearchModeURL(t *testing.T) {
	db := NewV3("test", "pw")
	db.SetRecord(Record{Title: "Bank", URL: "https://www.bank.com/login/"})
	db.SetRecord(Record{Title: "Other", URL: "https://other.com"})

	hits := db.Search("bank.com/login", 2)
	assert.Len(t, hits, 1)

	hits = db.Search("bank.com", 2)
	assert.Len(t, hits, 0, "path mismatch should not match")

	hits = db.Search("https://www.bank.com/login/", 2)
	assert.Len(t, hits, 1, "full URL query should match")
}

func TestSearchModeAllIncludesCustomFields(t *testing.T) {
	db := NewV3("test", "pw")
	db.SetRecord(Record{
		Title: "Site",
		CustomFields: []CustomField{
			{Name: "accountId", Value: "12345", Sensitive: false},
			{Name: "secret", Value: "hidden", Sensitive: true},
		},
	})
	hits := db.Search("accountId", 0)
	assert.Len(t, hits, 1, "non-sensitive custom field name should be searched")

	hits = db.Search("12345", 0)
	assert.Len(t, hits, 1, "non-sensitive custom field value should be searched")

	hits = db.Search("hidden", 0)
	assert.Len(t, hits, 0, "sensitive custom field value must not be searched")
}

func TestSetRecordTimes(t *testing.T) {
	db := NewV3("test", "password")
	record := Record{Title: "Test Record", Password: "password"}

	// Test new record
	key := db.SetRecord(record)
	savedRecord, ok := db.Records[key]
	assert.True(t, ok)
	assert.False(t, savedRecord.CreateTime.IsZero())
	assert.False(t, savedRecord.ModTime.IsZero())
	assert.False(t, db.LastMod.IsZero())

	// Capture times
	createTime := savedRecord.CreateTime
	modTime := savedRecord.ModTime
	dbLastMod := db.LastMod

	// Sleep to ensure time difference
	time.Sleep(1 * time.Second)

	// Test update record
	savedRecord.Password = "newpassword"
	db.SetRecord(savedRecord)
	updatedRecord, ok := db.Records[key]
	assert.True(t, ok)
	assert.Equal(t, createTime, updatedRecord.CreateTime)
	assert.True(t, updatedRecord.ModTime.After(modTime))
	assert.True(t, db.LastMod.After(dbLastMod))
}
