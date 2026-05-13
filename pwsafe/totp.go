package pwsafe

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
)

// ComputeTOTP computes an RFC 6238 TOTP code using HMAC-SHA1.
// now and t0 are Unix timestamps; step is the time step in seconds (default 30);
// digits is the output length (default 6). Returns the code and seconds remaining
// in the current window.
func ComputeTOTP(key []byte, now, t0 int64, step, digits byte) (code string, secondsRemaining int64) {
	if step == 0 {
		step = 30
	}
	if digits == 0 {
		digits = 6
	}

	elapsed := now - t0
	counter := elapsed / int64(step)
	secondsRemaining = int64(step) - elapsed%int64(step)

	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, uint64(counter))

	mac := hmac.New(sha1.New, key)
	mac.Write(msg)
	h := mac.Sum(nil)

	offset := h[len(h)-1] & 0x0f
	truncated := (uint32(h[offset])&0x7f)<<24 |
		uint32(h[offset+1])<<16 |
		uint32(h[offset+2])<<8 |
		uint32(h[offset+3])

	pow10 := uint32(1)
	for i := byte(0); i < digits; i++ {
		pow10 *= 10
	}

	code = fmt.Sprintf("%0*d", digits, truncated%pow10)
	return
}
