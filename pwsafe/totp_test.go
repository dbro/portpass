package pwsafe

import (
	"bytes"
	"encoding/base32"
	"testing"

	"github.com/stretchr/testify/assert"
)

// RFC 6238 Appendix B test vectors — HMAC-SHA1, T0=0, step=30, 8 digits.
// Key is the ASCII string "12345678901234567890".
func TestComputeTOTP_RFC6238Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	cases := []struct {
		now      int64
		expected string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
	}
	for _, c := range cases {
		code, _ := ComputeTOTP(key, c.now, 0, 30, 8)
		assert.Equal(t, c.expected, code, "now=%d", c.now)
	}
}

func TestComputeTOTP_Defaults(t *testing.T) {
	key := []byte("12345678901234567890")
	// step=0 and digits=0 should apply defaults (30s, 6 digits)
	code, remaining := ComputeTOTP(key, 59, 0, 0, 0)
	assert.Len(t, code, 6)
	assert.Greater(t, remaining, int64(0))
	assert.LessOrEqual(t, remaining, int64(30))
}

func TestComputeTOTP_SecondsRemaining(t *testing.T) {
	key := []byte("key")
	// now=59, step=30: 59%30=29, remaining=1
	_, remaining := ComputeTOTP(key, 59, 0, 30, 6)
	assert.Equal(t, int64(1), remaining)

	// now=60: 60%30=0, remaining=30 (fresh window)
	_, remaining = ComputeTOTP(key, 60, 0, 30, 6)
	assert.Equal(t, int64(30), remaining)

	// now=61: 61%30=1, remaining=29
	_, remaining = ComputeTOTP(key, 61, 0, 30, 6)
	assert.Equal(t, int64(29), remaining)
}

func TestComputeTOTP_SixtySecondPeriod(t *testing.T) {
	key := []byte("12345678901234567890")
	// Both times fall in the same 60s window → same code
	code1, _ := ComputeTOTP(key, 0, 0, 60, 6)
	code2, _ := ComputeTOTP(key, 59, 0, 60, 6)
	assert.Equal(t, code1, code2)

	// Next window → different code
	code3, _ := ComputeTOTP(key, 60, 0, 60, 6)
	assert.NotEqual(t, code1, code3)
}

func TestRecord_TOTPFields_SetField(t *testing.T) {
	t.Run("TwoFactorKey", func(t *testing.T) {
		r := &Record{}
		key := []byte{0xde, 0xad, 0xbe, 0xef}
		encoded := []byte(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(key))
		assert.NoError(t, r.setField(recordTwoFactorKey, encoded))
		assert.Equal(t, key, r.TwoFactorKey)
	})

	t.Run("TOTPConfig", func(t *testing.T) {
		r := &Record{}
		assert.NoError(t, r.setField(recordTOTPConfig, []byte{0x00}))
		assert.Equal(t, byte(0x00), r.TOTPConfig)
	})

	t.Run("TOTPLength", func(t *testing.T) {
		r := &Record{}
		assert.NoError(t, r.setField(recordTOTPLength, []byte{8}))
		assert.Equal(t, byte(8), r.TOTPLength)
	})

	t.Run("TOTPTimeStep", func(t *testing.T) {
		r := &Record{}
		assert.NoError(t, r.setField(recordTOTPTimeStep, []byte{60}))
		assert.Equal(t, byte(60), r.TOTPTimeStep)
	})

	t.Run("TOTPStartTime", func(t *testing.T) {
		r := &Record{}
		ts := uint64(1_000_000)
		data := make([]byte, 5)
		for i := 0; i < 5; i++ {
			data[i] = byte(ts >> (uint(i) * 8))
		}
		assert.NoError(t, r.setField(recordTOTPStartTime, data))
		assert.Equal(t, int64(ts), r.TOTPStartTime.Unix())
	})
}

func TestRecord_TOTP_NotMarshaledWithoutKey(t *testing.T) {
	db := NewV3("test", "pass")
	rec := Record{Title: "No TOTP", Password: "pw"}
	db.SetRecord(rec)

	var buf bytes.Buffer
	assert.NoError(t, db.Encrypt(&buf))

	db2 := &V3{}
	_, err := db2.Decrypt(bytes.NewReader(buf.Bytes()), "pass")
	assert.NoError(t, err)

	for _, r := range db2.Records {
		assert.Nil(t, r.TwoFactorKey)
		assert.Equal(t, byte(0), r.TOTPLength)
		assert.Equal(t, byte(0), r.TOTPTimeStep)
	}
}

func TestRecord_TOTP_FullRoundTrip(t *testing.T) {
	db := NewV3("test", "password")
	rec := Record{
		Title:        "TOTP Entry",
		Password:     "secret",
		TwoFactorKey: []byte{0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03},
		TOTPLength:   8,
		TOTPTimeStep: 60,
	}
	key := db.SetRecord(rec)

	var buf bytes.Buffer
	assert.NoError(t, db.Encrypt(&buf))

	db2 := &V3{}
	_, err := db2.Decrypt(bytes.NewReader(buf.Bytes()), "password")
	assert.NoError(t, err)

	got, ok := db2.Records[key]
	assert.True(t, ok)
	assert.Equal(t, rec.TwoFactorKey, got.TwoFactorKey)
	assert.Equal(t, rec.TOTPLength, got.TOTPLength)
	assert.Equal(t, rec.TOTPTimeStep, got.TOTPTimeStep)
}

func TestRecord_TOTP_ClearedWhenKeyRemoved(t *testing.T) {
	db := NewV3("test", "password")
	rec := Record{
		Title:        "TOTP Entry",
		Password:     "secret",
		TwoFactorKey: []byte{0x01, 0x02, 0x03},
		TOTPLength:   8,
		TOTPTimeStep: 60,
	}
	key := db.SetRecord(rec)

	// Clear the TOTP key
	rec2 := db.Records[key]
	rec2.TwoFactorKey = nil
	rec2.TOTPLength = 0
	rec2.TOTPTimeStep = 0
	db.Records[key] = rec2

	var buf bytes.Buffer
	assert.NoError(t, db.Encrypt(&buf))

	db2 := &V3{}
	_, err := db2.Decrypt(bytes.NewReader(buf.Bytes()), "password")
	assert.NoError(t, err)

	got := db2.Records[key]
	assert.Nil(t, got.TwoFactorKey)
	assert.Equal(t, byte(0), got.TOTPLength)
	assert.Equal(t, byte(0), got.TOTPTimeStep)
}
