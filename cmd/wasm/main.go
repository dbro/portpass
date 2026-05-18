package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	"github.com/dbro/portpass/pwsafe"
)

var databases = make(map[string]*pwsafe.V3)

func vaultUUID(db *pwsafe.V3) string {
	return fmt.Sprintf("%x", db.Header.UUID)
}

func getDB(args []js.Value) (*pwsafe.V3, string, bool) {
	if len(args) == 0 {
		return nil, "missing vault UUID argument", false
	}
	uuid := args[0].String()
	db, ok := databases[uuid]
	if !ok {
		return nil, "vault not open: " + uuid, false
	}
	return db, uuid, true
}

// openDB opens a vault and stores it. Returns JSON {"uuid":"..."} on success, error string on failure.
func openDB(this js.Value, args []js.Value) interface{} {
	if len(args) != 2 {
		return "invalid arguments: expected (data, password)"
	}

	dataJS := args[0]
	password := args[1].String()

	length := dataJS.Get("length").Int()
	data := make([]byte, length)
	js.CopyBytesToGo(data, dataJS)

	newDB := &pwsafe.V3{}
	if _, err := newDB.Decrypt(bytes.NewReader(data), password); err != nil {
		return fmt.Sprintf("failed to decrypt: %s", err)
	}

	uuid := vaultUUID(newDB)
	databases[uuid] = newDB

	result, _ := json.Marshal(map[string]string{"uuid": uuid})
	return string(result)
}

// createDatabase creates a new in-memory vault. Returns JSON {"uuid":"..."} on success.
func createDatabase(this js.Value, args []js.Value) interface{} {
	if len(args) != 1 {
		return "invalid arguments: expected (password)"
	}
	newDB := pwsafe.NewV3("", args[0].String())
	uuid := vaultUUID(newDB)
	databases[uuid] = newDB
	result, _ := json.Marshal(map[string]string{"uuid": uuid})
	return string(result)
}

// closeDB removes a vault from memory.
func closeDB(this js.Value, args []js.Value) interface{} {
	if len(args) != 1 {
		return "invalid arguments: expected (vaultUuid)"
	}
	delete(databases, args[0].String())
	return nil
}

func getDBData(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}

	type Item struct {
		UUID    string `json:"uuid"`
		Title   string `json:"title"`
		Group   string `json:"group"`
		HasTOTP bool   `json:"hasTOTP"`
	}

	var items []Item
	for uuidHex, rec := range db.Records {
		items = append(items, Item{
			UUID:    uuidHex,
			Title:   rec.Title,
			Group:   rec.Group,
			HasTOTP: len(rec.TwoFactorKey) > 0,
		})
	}

	jsonData, err := json.Marshal(items)
	if err != nil {
		return fmt.Sprintf("json marshal error: %s", err)
	}
	return string(jsonData)
}

// recordView is the JSON-safe view of a record returned to JS.
// Sensitive fields use *string: nil marshals as JSON null ("withheld"),
// pointer-to-empty-string marshals as "" ("not set").
// null means "I have this data; ask via GetFieldValue/copyFieldToClipboard."
// TwoFactorKey uses json.RawMessage with omitempty: nil = absent (not configured),
// RawMessage("null") = present but withheld.
type recordView struct {
	UUID            string            `json:"UUID"`
	Title           string            `json:"Title"`
	Group           string            `json:"Group"`
	Username        string            `json:"Username"`
	URL             string            `json:"URL"`
	Email           string            `json:"Email"`
	ModTime         string            `json:"ModTime"`
	Password        *string           `json:"Password"`
	Notes           *string           `json:"Notes"`
	PasswordHistory *string           `json:"PasswordHistory"`
	TwoFactorKey    json.RawMessage   `json:"TwoFactorKey,omitempty"`
	CustomFields    []customFieldView `json:"CustomFields"`
}

type customFieldView struct {
	Name      string  `json:"Name"`
	Value     *string `json:"Value"`
	Sensitive bool    `json:"Sensitive"`
}

// withheld returns a nil *string (JSON null) meaning "has value but withheld".
func withheld() *string { return nil }

// empty returns a *string pointing to "" meaning "genuinely not set".
func emptyStr() *string { s := ""; return &s }

// sensitiveString returns nil if the value is non-empty (withheld), or &"" if empty.
func sensitiveString(s string) *string {
	if s != "" {
		return withheld()
	}
	return emptyStr()
}

func recordToView(rec pwsafe.Record) recordView {
	mt := ""
	if !rec.ModTime.IsZero() {
		mt = rec.ModTime.Format("2006-01-02")
	}

	cfViews := make([]customFieldView, len(rec.CustomFields))
	for i, cf := range rec.CustomFields {
		var val *string
		if cf.Sensitive {
			val = sensitiveString(cf.Value)
		} else {
			val = &cf.Value
		}
		cfViews[i] = customFieldView{Name: cf.Name, Value: val, Sensitive: cf.Sensitive}
	}

	var tfk json.RawMessage
	if len(rec.TwoFactorKey) > 0 {
		tfk = json.RawMessage("null")
	}

	return recordView{
		UUID:            fmt.Sprintf("%x", rec.UUID),
		Title:           rec.Title,
		Group:           rec.Group,
		Username:        rec.Username,
		URL:             rec.URL,
		Email:           rec.Email,
		ModTime:         mt,
		Password:        sensitiveString(rec.Password),
		Notes:           sensitiveString(rec.Notes),
		PasswordHistory: sensitiveString(rec.PasswordHistory),
		TwoFactorKey:    tfk,
		CustomFields:    cfViews,
	}
}

func getRecord(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	if len(args) != 2 {
		return "invalid arguments: expected (vaultUuid, recordUuid)"
	}

	rec, ok := db.Records[args[1].String()]
	if !ok {
		return "record not found"
	}

	jsonData, err := json.Marshal(recordToView(rec))
	if err != nil {
		return fmt.Sprintf("json marshal error: %s", err)
	}
	return string(jsonData)
}

func getDBInfo(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}

	type DBInfo struct {
		Version     string `json:"version"`
		UUID        string `json:"uuid"`
		Name        string `json:"name"`
		Description string `json:"description"`
		What        string `json:"what"`
		When        string `json:"when"`
		Who         string `json:"who"`
		Iter        uint32 `json:"iter"`
	}

	versionMap := map[uint16]string{
		0x0300: "3.01", 0x0301: "3.03", 0x0302: "3.09", 0x0303: "3.12",
		0x0304: "3.13", 0x0305: "3.14", 0x0306: "3.19", 0x0307: "3.22",
		0x0308: "3.25", 0x0309: "3.26", 0x030A: "3.28", 0x030B: "3.29",
		0x030C: "3.29", 0x030D: "3.30", 0x030E: "3.47", 0x030F: "3.68",
		0x0310: "3.69",
	}

	versionVal := binary.LittleEndian.Uint16(db.Header.Version[:])
	versionStr := versionMap[versionVal]
	if versionStr == "" {
		versionStr = fmt.Sprintf("Format 0x%04x", versionVal)
	} else {
		versionStr = "v" + versionStr
	}

	info := DBInfo{
		Version:     versionStr,
		UUID:        vaultUUID(db),
		Name:        db.Header.Name,
		Description: db.Header.Description,
		What:        string(db.Header.LastSaveBy),
		When:        db.Header.LastSave.String(),
		Who:         string(db.Header.LastSaveUser),
		Iter:        db.Iter,
	}

	jsonData, err := json.Marshal(info)
	if err != nil {
		return fmt.Sprintf("json marshal error: %s", err)
	}
	return string(jsonData)
}

func updateRecordFields(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	// args: vaultUuid, recordUuid, field1, value1, ...
	if len(args) < 4 || len(args)%2 != 0 {
		return "invalid arguments: expected (vaultUuid, recordUuid, field, value, ...)"
	}

	uuidHex := args[1].String()
	var rec pwsafe.Record
	if uuidHex != "" {
		var exists bool
		rec, exists = db.Records[uuidHex]
		if !exists {
			return "record not found"
		}
	}

	for i := 2; i+1 < len(args); i += 2 {
		field, value := args[i].String(), args[i+1].String()
		switch field {
		case "Title":
			rec.Title = value
		case "Group":
			rec.Group = value
		case "Username":
			rec.Username = value
		case "Password":
			if value != rec.Password && rec.Password != "" {
				rec.PasswordHistory = pushPasswordHistory(rec.PasswordHistory, rec.Password)
			}
			rec.Password = value
		case "URL":
			rec.URL = value
		case "Email":
			rec.Email = value
		case "Notes":
			rec.Notes = value
		case "TwoFactorKey":
			if value == "" {
				rec.TwoFactorKey = nil
				rec.TOTPConfig = 0
				rec.TOTPLength = 0
				rec.TOTPTimeStep = 0
				rec.TOTPStartTime = time.Time{}
			} else {
				decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(value)))
				if err != nil {
					return fmt.Sprintf("invalid TOTP secret: %s", err)
				}
				rec.TwoFactorKey = decoded
			}
		case "TOTPLength":
			n, err := strconv.Atoi(value)
			if err != nil || (n != 6 && n != 8) {
				return fmt.Sprintf("TOTP digits must be 6 or 8, got: %s", value)
			}
			rec.TOTPLength = byte(n)
		case "TOTPTimeStep":
			n, err := strconv.Atoi(value)
			if err != nil || (n != 30 && n != 60) {
				return fmt.Sprintf("TOTP period must be 30 or 60, got: %s", value)
			}
			rec.TOTPTimeStep = byte(n)
		case "CustomFields":
			if value == "" {
				rec.CustomFields = nil
			} else {
				// Use *string for Value so JSON null (withheld) can be distinguished from "" (clear).
				type cfInput struct {
					Name      string  `json:"Name"`
					Value     *string `json:"Value"`
					Sensitive bool    `json:"Sensitive"`
				}
				var inputs []cfInput
				if err := json.Unmarshal([]byte(value), &inputs); err != nil {
					return fmt.Sprintf("invalid CustomFields JSON: %s", err)
				}
				if len(inputs) > 9 {
					inputs = inputs[:9]
				}
				cfs := make([]pwsafe.CustomField, len(inputs))
				for i, inp := range inputs {
					cfs[i] = pwsafe.CustomField{Name: inp.Name, Sensitive: inp.Sensitive}
					if inp.Value != nil {
						cfs[i].Value = *inp.Value
					} else {
						// null = preserve existing value for this field name
						for _, ex := range rec.CustomFields {
							if ex.Name == inp.Name {
								cfs[i].Value = ex.Value
								break
							}
						}
					}
				}
				rec.CustomFields = cfs
			}
		default:
			return fmt.Sprintf("unknown field: %s", field)
		}
	}

	if rec.Title == "" {
		return "Title is required"
	}
	if rec.Password == "" {
		return "Password is required"
	}
	return db.SetRecord(rec)
}

func updateDBFields(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	// args: vaultUuid, field1, value1, ...
	if len(args) < 3 || len(args)%2 == 0 {
		return "invalid arguments: expected (vaultUuid, field, value, ...)"
	}
	for i := 1; i+1 < len(args); i += 2 {
		field, value := args[i].String(), args[i+1].String()
		switch field {
		case "Name":
			db.Header.Name = value
		case "Description":
			db.Header.Description = value
		case "LastSaveUser":
			db.Header.LastSaveUser = []byte(value)
		default:
			return fmt.Sprintf("unknown field: %s", field)
		}
	}
	return nil
}

func saveDB(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}

	var buf bytes.Buffer
	if err := db.Encrypt(&buf); err != nil {
		return fmt.Sprintf("failed to encrypt db: %s", err)
	}

	dst := js.Global().Get("Uint8Array").New(buf.Len())
	js.CopyBytesToJS(dst, buf.Bytes())
	return dst
}

func deleteRecord(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	if len(args) != 2 {
		return "invalid arguments: expected (vaultUuid, recordUuid)"
	}
	db.DeleteRecord(args[1].String())
	return nil
}

func searchRecords(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "database not open"
	}
	if len(args) != 3 {
		return "invalid arguments: expected (vaultUuid, query, namesOnly)"
	}
	query := args[1].String()
	namesOnly := args[2].Bool()
	uuids := db.Search(query, namesOnly)
	jsonData, err := json.Marshal(uuids)
	if err != nil {
		return fmt.Sprintf("json marshal error: %s", err)
	}
	return string(jsonData)
}

func getSuggestion(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return ""
	}
	if len(args) != 3 {
		return ""
	}
	field := args[1].String()
	prefix := args[2].String()
	if prefix == "" {
		return ""
	}

	prefixLower := strings.ToLower(prefix)
	freq := make(map[string]int)
	for _, rec := range db.Records {
		var val string
		switch field {
		case "group":
			val = rec.Group
		case "username":
			val = rec.Username
		default:
			return ""
		}
		if val != "" {
			freq[val]++
		}
	}

	var matches []string
	for val := range freq {
		if strings.HasPrefix(strings.ToLower(val), prefixLower) {
			matches = append(matches, val)
		}
	}
	if len(matches) == 0 {
		return ""
	}

	sort.Slice(matches, func(i, j int) bool {
		fi, fj := freq[matches[i]], freq[matches[j]]
		if fi != fj {
			return fi > fj
		}
		return strings.ToLower(matches[i]) < strings.ToLower(matches[j])
	})
	return matches[0]
}

func getTOTP(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	if len(args) < 2 {
		return "invalid arguments: expected (vaultUuid, recordUuid[, returnCode])"
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return "record not found"
	}
	if len(rec.TwoFactorKey) == 0 {
		return "no TOTP configured"
	}

	returnCode := len(args) >= 3 && args[2].Bool()

	var t0 int64
	if !rec.TOTPStartTime.IsZero() {
		t0 = rec.TOTPStartTime.Unix()
	}
	code, remaining := pwsafe.ComputeTOTP(rec.TwoFactorKey, time.Now().Unix(), t0, rec.TOTPTimeStep, rec.TOTPLength)

	type Result struct {
		Code    interface{} `json:"code"`
		Seconds int64       `json:"seconds"`
		Period  int         `json:"period"`
	}
	period := int(rec.TOTPTimeStep)
	if period == 0 {
		period = 30
	}
	var codeVal interface{}
	if returnCode {
		codeVal = code
	}
	data, err := json.Marshal(Result{codeVal, remaining, period})
	if err != nil {
		return fmt.Sprintf("error: %s", err)
	}
	return string(data)
}

// standardFieldValue returns the string value of a named standard field.
func standardFieldValue(rec pwsafe.Record, fieldname string) (string, error) {
	switch fieldname {
	case "Password":
		return rec.Password, nil
	case "Notes":
		return rec.Notes, nil
	case "Username":
		return rec.Username, nil
	case "URL":
		return rec.URL, nil
	case "Email":
		return rec.Email, nil
	case "Title":
		return rec.Title, nil
	case "Group":
		return rec.Group, nil
	case "PasswordHistory":
		return rec.PasswordHistory, nil
	case "TwoFactorKey":
		return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(rec.TwoFactorKey), nil
	default:
		return "", fmt.Errorf("unknown field: %s", fieldname)
	}
}

// writeToClipboard writes value to the clipboard via the browser API.
// Returns "{}" or a JSON hash object depending on returnHash.
func writeToClipboard(value string, returnHash bool) string {
	js.Global().Get("navigator").Get("clipboard").Call("writeText", value)
	if !returnHash {
		return `{}`
	}
	h := sha256.Sum256([]byte(value))
	type Result struct {
		Hash string `json:"hash"`
	}
	data, _ := json.Marshal(Result{Hash: hex.EncodeToString(h[:])})
	return string(data)
}

func copyFieldToClipboard(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return `{"error":"vault not open"}`
	}
	if len(args) < 3 {
		return `{"error":"expected (vaultUuid, recordUuid, fieldname[, returnHash])"}`
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return `{"error":"record not found"}`
	}
	value, err := standardFieldValue(rec, args[2].String())
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	returnHash := len(args) >= 4 && args[3].Bool()
	return writeToClipboard(value, returnHash)
}

func copyCustomFieldToClipboard(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return `{"error":"vault not open"}`
	}
	if len(args) < 3 {
		return `{"error":"expected (vaultUuid, recordUuid, customFieldName[, returnHash])"}`
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return `{"error":"record not found"}`
	}
	name := args[2].String()
	for _, cf := range rec.CustomFields {
		if cf.Name == name {
			returnHash := len(args) >= 4 && args[3].Bool()
			return writeToClipboard(cf.Value, returnHash)
		}
	}
	return `{"error":"custom field not found"}`
}

func copyTOTP(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return `{"error":"vault not open"}`
	}
	if len(args) < 2 {
		return `{"error":"expected (vaultUuid, recordUuid)"}`
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return `{"error":"record not found"}`
	}
	if len(rec.TwoFactorKey) == 0 {
		return `{"error":"no TOTP configured"}`
	}
	var t0 int64
	if !rec.TOTPStartTime.IsZero() {
		t0 = rec.TOTPStartTime.Unix()
	}
	code, _ := pwsafe.ComputeTOTP(rec.TwoFactorKey, time.Now().Unix(), t0, rec.TOTPTimeStep, rec.TOTPLength)
	js.Global().Get("navigator").Get("clipboard").Call("writeText", code)
	return `{}`
}

func getFieldValueFn(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return `{"error":"vault not open"}`
	}
	if len(args) < 3 {
		return `{"error":"expected (vaultUuid, recordUuid, fieldname)"}`
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return `{"error":"record not found"}`
	}
	value, err := standardFieldValue(rec, args[2].String())
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	type Result struct {
		Value string `json:"value"`
	}
	data, _ := json.Marshal(Result{Value: value})
	return string(data)
}

func getCustomFieldValueFn(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return `{"error":"vault not open"}`
	}
	if len(args) < 3 {
		return `{"error":"expected (vaultUuid, recordUuid, customFieldName)"}`
	}
	rec, ok := db.Records[args[1].String()]
	if !ok {
		return `{"error":"record not found"}`
	}
	name := args[2].String()
	for _, cf := range rec.CustomFields {
		if cf.Name == name {
			type Result struct {
				Value string `json:"value"`
			}
			data, _ := json.Marshal(Result{Value: cf.Value})
			return string(data)
		}
	}
	return `{"error":"custom field not found"}`
}

// deriveSecondaryKey derives a 32-byte AES key from the vault's stretched key.
// The stretched key never leaves WASM; only ciphertext crosses the boundary.
func deriveSecondaryKey(db *pwsafe.V3) ([]byte, error) {
	mac := hmac.New(sha256.New, db.StretchedKey[:])
	mac.Write([]byte("portpass-secondary-vault-v1"))
	return mac.Sum(nil), nil
}

// encryptForSecondaryVaults encrypts a plaintext string using the vault's stretched key.
// Returns JSON {"iv":"<hex>","ciphertext":"<hex>"} on success, error string on failure.
func encryptForSecondaryVaults(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	if len(args) != 2 {
		return "invalid arguments: expected (vaultUuid, plaintext)"
	}
	key, _ := deriveSecondaryKey(db)
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Sprintf("cipher error: %s", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Sprintf("gcm error: %s", err)
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(iv); err != nil {
		return fmt.Sprintf("rand error: %s", err)
	}
	ciphertext := gcm.Seal(nil, iv, []byte(args[1].String()), nil)
	result, _ := json.Marshal(map[string]string{
		"iv":         hex.EncodeToString(iv),
		"ciphertext": hex.EncodeToString(ciphertext),
	})
	return string(result)
}

// decryptForSecondaryVaults decrypts a ciphertext encrypted by encryptForSecondaryVaults.
// Returns the plaintext string on success, error string on failure.
func decryptForSecondaryVaults(this js.Value, args []js.Value) interface{} {
	db, _, ok := getDB(args)
	if !ok {
		return "vault not open"
	}
	if len(args) != 3 {
		return "invalid arguments: expected (vaultUuid, ivHex, ciphertextHex)"
	}
	key, _ := deriveSecondaryKey(db)
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Sprintf("cipher error: %s", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Sprintf("gcm error: %s", err)
	}
	iv, err := hex.DecodeString(args[1].String())
	if err != nil {
		return "invalid IV"
	}
	ct, err := hex.DecodeString(args[2].String())
	if err != nil {
		return "invalid ciphertext"
	}
	plaintext, err := gcm.Open(nil, iv, ct, nil)
	if err != nil {
		return "decryption failed"
	}
	return string(plaintext)
}

// pushPasswordHistory appends oldPassword to the pwsafe password history string.
func pushPasswordHistory(current, oldPassword string) string {
	type entry struct {
		ts int64
		pw string
	}
	enabled := true
	maxEntries := 10
	var entries []entry

	if len(current) >= 5 {
		enabled = current[0] == '1'
		if m, err := strconv.ParseInt(current[1:3], 16, 64); err == nil && m > 0 {
			maxEntries = int(m)
		}
		count := 0
		if c, err := strconv.ParseInt(current[3:5], 16, 64); err == nil {
			count = int(c)
		}
		pos := 5
		for i := 0; i < count; i++ {
			if pos+12 > len(current) {
				break
			}
			ts, err := strconv.ParseInt(current[pos:pos+8], 16, 64)
			if err != nil {
				break
			}
			pos += 8
			l, err := strconv.ParseInt(current[pos:pos+4], 16, 64)
			if err != nil {
				break
			}
			pos += 4
			if pos+int(l) > len(current) {
				break
			}
			entries = append(entries, entry{ts, current[pos : pos+int(l)]})
			pos += int(l)
		}
	}

	if !enabled {
		return current
	}

	entries = append(entries, entry{time.Now().Unix(), oldPassword})
	for len(entries) > maxEntries {
		entries = entries[1:]
	}

	var sb strings.Builder
	if enabled {
		sb.WriteByte('1')
	} else {
		sb.WriteByte('0')
	}
	sb.WriteString(fmt.Sprintf("%02x%02x", maxEntries, len(entries)))
	for _, e := range entries {
		sb.WriteString(fmt.Sprintf("%08x%04x%s", e.ts, len(e.pw), e.pw))
	}
	return sb.String()
}

func main() {
	c := make(chan struct{}, 0)

	js.Global().Set("openDB", js.FuncOf(openDB))
	js.Global().Set("encryptForSecondaryVaults", js.FuncOf(encryptForSecondaryVaults))
	js.Global().Set("decryptForSecondaryVaults", js.FuncOf(decryptForSecondaryVaults))
	js.Global().Set("closeDB", js.FuncOf(closeDB))
	js.Global().Set("getDBData", js.FuncOf(getDBData))
	js.Global().Set("getRecord", js.FuncOf(getRecord))
	js.Global().Set("createDatabase", js.FuncOf(createDatabase))
	js.Global().Set("getDBInfo", js.FuncOf(getDBInfo))
	js.Global().Set("saveDB", js.FuncOf(saveDB))
	js.Global().Set("UpdateRecordFields", js.FuncOf(updateRecordFields))
	js.Global().Set("deleteRecord", js.FuncOf(deleteRecord))
	js.Global().Set("UpdateDBFields", js.FuncOf(updateDBFields))
	js.Global().Set("searchRecords", js.FuncOf(searchRecords))
	js.Global().Set("getSuggestion", js.FuncOf(getSuggestion))
	js.Global().Set("getTOTP", js.FuncOf(getTOTP))
	js.Global().Set("copyFieldToClipboard", js.FuncOf(copyFieldToClipboard))
	js.Global().Set("copyCustomFieldToClipboard", js.FuncOf(copyCustomFieldToClipboard))
	js.Global().Set("copyTOTP", js.FuncOf(copyTOTP))
	js.Global().Set("GetFieldValue", js.FuncOf(getFieldValueFn))
	js.Global().Set("GetCustomFieldValue", js.FuncOf(getCustomFieldValueFn))

	fmt.Println("WASM initialized")
	<-c
}
