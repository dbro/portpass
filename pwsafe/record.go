package pwsafe

import (
	"bytes"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/twofish"
)

const (
	PasswordExpiryIntervalMax = 3650

	// Record field constants
	recordUUID                   = 0x01
	recordGroup                  = 0x02
	recordTitle                  = 0x03
	recordUsername               = 0x04
	recordNotes                  = 0x05
	recordPassword               = 0x06
	recordCreateTime             = 0x07
	recordPasswordModTime        = 0x08
	recordAccessTime             = 0x09
	recordPasswordExpiry         = 0x0a
	recordModTime                = 0x0c
	recordURL                    = 0x0d
	recordAutotype               = 0x0e
	recordPasswordHistory        = 0x0f
	recordPasswordPolicy         = 0x10
	recordPasswordExpiryInterval = 0x11
	recordRunCommand             = 0x12
	recordDoubleClickAction      = 0x13
	recordEmail                  = 0x14
	recordProtectedEntry         = 0x15
	recordOwnSymbolsForPassword  = 0x16
	recordShiftDoubleClickAction = 0x17
	recordPasswordPolicyName     = 0x18
	recordCustomTextField        = 0x30
	recordTwoFactorKey           = 0x1b
	recordTOTPConfig             = 0x21
	recordTOTPLength             = 0x22
	recordTOTPTimeStep           = 0x23
	recordTOTPStartTime          = 0x24
	recordEndOfEntry             = 0xff
)

// CustomField is one entry in a record's custom text fields (field 0x30).
type CustomField struct {
	Name      string `json:"Name"`
	Value     string `json:"Value"`
	Sensitive bool   `json:"Sensitive"`
}

// Record The primary type for password DB entries
type Record struct {
	AccessTime             time.Time // 0x09
	Autotype               string    // 0x0e
	CreateTime             time.Time // 0x07
	DoubleClickAction      [2]byte   // 0x13
	Email                  string    // 0x14
	Group                  string    // 0x02
	ModTime                time.Time // 0x0c
	Notes                  string    // 0x05
	OwnSymbolsForPassword  string    // 0x16
	Password               string    // 0x06
	PasswordExpiry         time.Time // 0x0a
	PasswordExpiryInterval uint32    // 0x11
	PasswordHistory        string    // 0x0f
	PasswordModTime        string    // 0x08
	PasswordPolicy         string    // 0x10
	PasswordPolicyName     string    // 0x18
	ProtectedEntry         byte      // 0x15
	RunCommand             string    // 0x12
	ShiftDoubleClickAction [2]byte   // 0x17
	Title                  string          // 0x03
	TOTPConfig             byte            // 0x21 bits 0-1: algorithm (0=SHA1)
	TOTPLength             byte            // 0x22 digit count (default 6)
	TOTPStartTime          time.Time       // 0x24 T0 (default epoch)
	TOTPTimeStep           byte            // 0x23 seconds (default 30)
	TwoFactorKey           []byte          // 0x1b raw TOTP secret
	Username               string          // 0x04
	URL                    string          // 0x0d
	UUID                   [16]byte        // 0x01
	CustomFields           []CustomField   // 0x30
	UnknownFields          map[byte][]byte // forward compatibility: fields not yet parsed
}

// setField sets the field value based on the ID
func (r *Record) setField(id byte, data []byte) error {
	switch id {
	case recordUUID:
		if len(data) != 16 {
			return errors.New("invalid length for UUID")
		}
		copy(r.UUID[:], data)
	case recordGroup:
		r.Group = string(data)
	case recordTitle:
		r.Title = string(data)
	case recordUsername:
		r.Username = string(data)
	case recordNotes:
		r.Notes = string(data)
	case recordPassword:
		r.Password = string(data)
	case recordCreateTime:
		r.CreateTime = time.Unix(int64(binary.LittleEndian.Uint32(data)), 0)
	case recordPasswordModTime:
		r.PasswordModTime = string(data)
	case recordAccessTime:
		r.AccessTime = time.Unix(int64(binary.LittleEndian.Uint32(data)), 0)
	case recordPasswordExpiry:
		r.PasswordExpiry = time.Unix(int64(binary.LittleEndian.Uint32(data)), 0)
	case recordModTime:
		r.ModTime = time.Unix(int64(binary.LittleEndian.Uint32(data)), 0)
	case recordURL:
		r.URL = string(data)
	case recordAutotype:
		r.Autotype = string(data)
	case recordPasswordHistory:
		r.PasswordHistory = string(data)
	case recordPasswordPolicy:
		r.PasswordPolicy = string(data)
	case recordPasswordExpiryInterval:
		if len(data) != 4 {
			return errors.New("invalid length for PasswordExpiryInterval")
		}
		interval := binary.LittleEndian.Uint32(data)
		if interval > PasswordExpiryIntervalMax {
			r.PasswordExpiryInterval = 0
		} else {
			r.PasswordExpiryInterval = interval
		}
	case recordRunCommand:
		r.RunCommand = string(data)
	case recordDoubleClickAction:
		if len(data) != 2 {
			return errors.New("invalid length for DoubleClickAction")
		}
		copy(r.DoubleClickAction[:], data)
	case recordEmail:
		r.Email = string(data)
	case recordProtectedEntry:
		if len(data) != 1 {
			return errors.New("invalid length for ProtectedEntry")
		}
		r.ProtectedEntry = data[0]
	case recordOwnSymbolsForPassword:
		r.OwnSymbolsForPassword = string(data)
	case recordShiftDoubleClickAction:
		if len(data) != 2 {
			return errors.New("invalid length for ShiftDoubleClickAction")
		}
		copy(r.ShiftDoubleClickAction[:], data)
	case recordPasswordPolicyName:
		r.PasswordPolicyName = string(data)
	case recordCustomTextField:
		r.CustomFields = parseCustomFields(string(data))
	case recordTwoFactorKey:
		// Official PasswordSafe stores field 0x1b as the base32-encoded string.
		// Portpass previously stored raw bytes; try base32 decode first, fall back.
		if decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(string(data))); err == nil && len(decoded) > 0 {
			r.TwoFactorKey = decoded
		} else {
			r.TwoFactorKey = append([]byte(nil), data...)
		}
	case recordTOTPConfig:
		if len(data) >= 1 {
			r.TOTPConfig = data[0]
		}
	case recordTOTPLength:
		if len(data) >= 1 {
			r.TOTPLength = data[0]
		}
	case recordTOTPTimeStep:
		if len(data) >= 1 {
			r.TOTPTimeStep = data[0]
		}
	case recordTOTPStartTime:
		if len(data) >= 5 {
			var ts uint64
			for i := 0; i < 5; i++ {
				ts |= uint64(data[i]) << (uint(i) * 8)
			}
			if ts > 0 {
				r.TOTPStartTime = time.Unix(int64(ts), 0)
			}
		}
	default:
		if r.UnknownFields == nil {
			r.UnknownFields = make(map[byte][]byte)
		}
		r.UnknownFields[id] = append([]byte(nil), data...)
	}
	return nil
}

// marshal returns the binary format for the record and the values used for hmac calculations
func (r *Record) marshal() ([]byte, []byte, error) {
	var recordBuf bytes.Buffer
	var hmacBuf bytes.Buffer

	// Helper to append a field
	appendField := func(id byte, data any) {
		size := binary.Size(data)
		if size <= 0 {
			return
		}
		// Write to HMAC buffer
		binary.Write(&hmacBuf, binary.LittleEndian, data)

		// Write length
		binary.Write(&recordBuf, binary.LittleEndian, uint32(size))
		// Write ID
		recordBuf.WriteByte(id)
		// Write Data
		binary.Write(&recordBuf, binary.LittleEndian, data)

		// Write Padding
		usedBlockSpace := (size + 5) % twofish.BlockSize
		if usedBlockSpace != 0 {
			recordBuf.Write(pseudoRandomBytes(twofish.BlockSize - usedBlockSpace))
		}
	}

	appendField(recordUUID, r.UUID[:])
	appendField(recordGroup, []byte(r.Group))
	appendField(recordTitle, []byte(r.Title))
	appendField(recordUsername, []byte(r.Username))
	appendField(recordNotes, []byte(r.Notes))
	appendField(recordPassword, []byte(r.Password))
	if !r.CreateTime.IsZero() {
		appendField(recordCreateTime, uint32(r.CreateTime.Unix()))
	}
	appendField(recordPasswordModTime, []byte(r.PasswordModTime))
	if !r.AccessTime.IsZero() {
		appendField(recordAccessTime, uint32(r.AccessTime.Unix()))
	}
	if !r.PasswordExpiry.IsZero() {
		appendField(recordPasswordExpiry, uint32(r.PasswordExpiry.Unix()))
	}
	if !r.ModTime.IsZero() {
		appendField(recordModTime, uint32(r.ModTime.Unix()))
	}
	appendField(recordURL, []byte(r.URL))
	appendField(recordAutotype, []byte(r.Autotype))
	appendField(recordPasswordHistory, []byte(r.PasswordHistory))
	appendField(recordPasswordPolicy, []byte(r.PasswordPolicy))
	if r.PasswordExpiryInterval > 0 && r.PasswordExpiryInterval <= PasswordExpiryIntervalMax {
		appendField(recordPasswordExpiryInterval, r.PasswordExpiryInterval)
	} else if r.PasswordExpiryInterval > PasswordExpiryIntervalMax {
		return nil, nil, fmt.Errorf("PasswordExpiryInterval %d exceeds maximum of %d", r.PasswordExpiryInterval, PasswordExpiryIntervalMax)
	}
	appendField(recordRunCommand, []byte(r.RunCommand))
	appendField(recordDoubleClickAction, r.DoubleClickAction[:])
	appendField(recordEmail, []byte(r.Email))
	if r.ProtectedEntry != 0 {
		appendField(recordProtectedEntry, []byte{r.ProtectedEntry})
	}
	appendField(recordOwnSymbolsForPassword, []byte(r.OwnSymbolsForPassword))
	appendField(recordShiftDoubleClickAction, r.ShiftDoubleClickAction[:])
	appendField(recordPasswordPolicyName, []byte(r.PasswordPolicyName))

	if len(r.TwoFactorKey) > 0 {
		encodedKey := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(r.TwoFactorKey)
		appendField(recordTwoFactorKey, []byte(encodedKey))
		appendField(recordTOTPConfig, []byte{r.TOTPConfig})
		length := r.TOTPLength
		if length == 0 {
			length = 6
		}
		appendField(recordTOTPLength, []byte{length})
		step := r.TOTPTimeStep
		if step == 0 {
			step = 30
		}
		appendField(recordTOTPTimeStep, []byte{step})
		if !r.TOTPStartTime.IsZero() {
			ts := uint64(r.TOTPStartTime.Unix())
			tsBytes := make([]byte, 5)
			for i := 0; i < 5; i++ {
				tsBytes[i] = byte(ts >> (uint(i) * 8))
			}
			appendField(recordTOTPStartTime, tsBytes)
		}
	}

	if len(r.CustomFields) > 0 {
		cfs := r.CustomFields
		if len(cfs) > 9 {
			cfs = cfs[:9]
		}
		appendField(recordCustomTextField, marshalCustomFields(cfs))
	}

	if len(r.UnknownFields) > 0 {
		keys := make([]byte, 0, len(r.UnknownFields))
		for k := range r.UnknownFields {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
		for _, k := range keys {
			appendField(k, r.UnknownFields[k])
		}
	}

	// End of entry
	recordBuf.Write([]byte{0, 0, 0, 0})
	recordBuf.WriteByte(recordEndOfEntry)
	recordBuf.Write(pseudoRandomBytes(twofish.BlockSize - 5))

	return recordBuf.Bytes(), hmacBuf.Bytes(), nil
}

// parseCustomFields decodes a PLVPLV…S…PLVPLV… encoded custom text field value.
func parseCustomFields(s string) []CustomField {
	var fields []CustomField
	var cur *CustomField
	for i := 0; i+6 <= len(s); {
		pID, err1 := strconv.ParseUint(s[i:i+2], 16, 8)
		lVal, err2 := strconv.ParseUint(s[i+2:i+6], 16, 16)
		if err1 != nil || err2 != nil {
			break
		}
		i += 6
		if i+int(lVal) > len(s) {
			break
		}
		v := s[i : i+int(lVal)]
		i += int(lVal)
		if pID == 0 { // separator
			if cur != nil && cur.Name != "" {
				fields = append(fields, *cur)
			}
			cur = nil
			continue
		}
		if cur == nil {
			cur = &CustomField{}
		}
		switch byte(pID) {
		case 0x01:
			cur.Name = v
		case 0x02:
			cur.Value = v
		case 0x03:
			cur.Sensitive = len(v) == 1 && v[0] == '1'
		}
	}
	if cur != nil && cur.Name != "" {
		fields = append(fields, *cur)
	}
	if len(fields) > 9 {
		fields = fields[:9]
	}
	return fields
}

// marshalCustomFields encodes custom fields to the PLVPLV…S…PLVPLV… format.
func marshalCustomFields(fields []CustomField) []byte {
	var sb strings.Builder
	for i, cf := range fields {
		if i > 0 {
			sb.WriteString("000000")
		}
		sb.WriteString(fmt.Sprintf("01%04X%s", len(cf.Name), cf.Name))
		sb.WriteString(fmt.Sprintf("02%04X%s", len(cf.Value), cf.Value))
		if cf.Sensitive {
			sb.WriteString("0300011")
		} else {
			sb.WriteString("0300010")
		}
	}
	return []byte(sb.String())
}
