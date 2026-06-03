// The database type for a Password Safe V3 database
// The db specification - https://github.com/pwsafe/pwsafe/blob/master/docs/formatV3.txt

package pwsafe

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pborman/uuid"
)

// V3 The type representing a password safe v3 database
type V3 struct {
	CBCIV         [16]byte //Random initial value for CBC
	EncryptionKey [32]byte
	Header        header
	HMAC          [32]byte //32bytes keyed-hash MAC with SHA-256 as the hash function.
	HMACKey       [32]byte
	Iter          uint32 //the number of iterations on the hash function to create the stretched key
	LastMod       time.Time
	LastSavePath  string
	Records       map[string]Record // keyed by UUID hex (see uuidKey)
	Salt          [32]byte
	StretchedKey  [sha256.Size]byte
}

const (
	defaultStretchIterations uint32 = 262144
	maxStretchIterations     uint32 = 10_000_000
)

func DefaultStretchIterations() uint32 {
	return defaultStretchIterations
}

func MaxStretchIterations() uint32 {
	return maxStretchIterations
}

// NewV3 - create and initialize a new pwsafe.V3 db
func NewV3(name, password string) *V3 {
	var db V3
	db.Header = newHeader(name)
	db.Records = make(map[string]Record)

	// Set the password
	db.SetPassword(password)
	return &db
}

// uuidKey returns the map key string for a record UUID.
func uuidKey(uuid [16]byte) string {
	return fmt.Sprintf("%x", uuid)
}

// DeleteRecord removes a record from the db by UUID hex string.
func (db *V3) DeleteRecord(uuidHex string) {
	delete(db.Records, uuidHex)
	db.LastMod = time.Now()
}

func wipeBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// Wipe clears best-effort mutable secret material before releasing a database.
// Go strings cannot be zeroed in place, but fixed-size keys and byte slices can.
func (db *V3) Wipe() {
	wipeBytes(db.CBCIV[:])
	wipeBytes(db.EncryptionKey[:])
	wipeBytes(db.HMAC[:])
	wipeBytes(db.HMACKey[:])
	wipeBytes(db.Salt[:])
	wipeBytes(db.StretchedKey[:])
	wipeBytes(db.Header.LastSaveBy)
	wipeBytes(db.Header.LastSaveHost)
	wipeBytes(db.Header.LastSaveUser)
	for _, field := range db.Header.UnknownFields {
		wipeBytes(field.Data)
	}
	for key, record := range db.Records {
		wipeBytes(record.TwoFactorKey)
		for _, field := range record.UnknownFields {
			wipeBytes(field.Data)
		}
		delete(db.Records, key)
	}
	*db = V3{}
}

// Equal compares the content of two V3 DBs except for LastSave fields and fields with transient or changing values.
// Groups Returns an slice of strings which match all groups used by records in the DB
func (db V3) Groups() []string {
	groups := make([]string, 0, len(db.Records))
	groupSet := make(map[string]bool)
	for _, value := range db.Records {
		if _, prs := groupSet[value.Group]; !prs {
			groupSet[value.Group] = true
			groups = append(groups, value.Group)
		}
	}
	sort.Strings(groups)
	return groups
}

// List Returns the UUID hex keys of all records in the db.
func (db V3) List() []string {
	entries := make([]string, 0, len(db.Records))
	for key := range db.Records {
		entries = append(entries, key)
	}
	return entries
}

// ListByGroup Returns the UUID hex keys of records that have the given group.
func (db V3) ListByGroup(group string) []string {
	entries := make([]string, 0, len(db.Records))
	for key, rec := range db.Records {
		if rec.Group == group {
			entries = append(entries, key)
		}
	}
	return entries
}

// CanonicalURL returns a normalised form suitable for exact-match URL search:
// scheme stripped, "www." prefix stripped, lowercased, query string and fragment
// removed, trailing slash removed.
// E.g. "https://www.Bank.com/Login/?ref=1#top" → "bank.com/login"
func CanonicalURL(rawURL string) string {
	s := strings.TrimSpace(rawURL)
	if s == "" {
		return ""
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	parsed, err := url.Parse(s)
	if err != nil || parsed.Host == "" {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(parsed.Host), "www.")
	return strings.TrimRight(host+strings.ToLower(parsed.EscapedPath()), "/")
}

// Search returns UUIDs of records matching query.
//
//   - mode 0 (all fields): title, group, username, URL, notes, email, and
//     non-sensitive custom field names and values.
//   - mode 1 (names only): title and group.
//   - mode 2 (URL exact): records whose URL field canonicalises to the same
//     value as the query. Password is never searched in any mode.
func (db V3) Search(query string, mode int) []string {
	if mode == 2 {
		canonical := CanonicalURL(query)
		if canonical == "" {
			return nil
		}
		var results []string
		for key, rec := range db.Records {
			if CanonicalURL(rec.URL) == canonical {
				results = append(results, key)
			}
		}
		return results
	}

	terms := strings.Fields(strings.ToLower(query))
	if len(terms) == 0 {
		return db.List()
	}
	var results []string
	for key, rec := range db.Records {
		var hay string
		if mode == 1 {
			hay = strings.ToLower(rec.Title + "\n" + rec.Group)
		} else {
			hay = strings.ToLower(rec.Title + "\n" + rec.Group + "\n" + rec.Username + "\n" + rec.URL + "\n" + rec.Notes + "\n" + rec.Email)
			for _, cf := range rec.CustomFields {
				if !cf.Sensitive {
					hay += "\n" + strings.ToLower(cf.Name) + "\n" + strings.ToLower(cf.Value)
				}
			}
		}
		match := true
		for _, t := range terms {
			if !strings.Contains(hay, t) {
				match = false
				break
			}
		}
		if match {
			results = append(results, key)
		}
	}
	return results
}

type SearchResults struct {
	UUIDs           []string `json:"uuids"`
	AutoSelectUUID  string   `json:"autoSelectUuid,omitempty"`
	AutoSelectScore int      `json:"autoSelectScore,omitempty"`
}

// SearchWithAutoSelect returns matching UUIDs and, for main search, the record
// that should be shown automatically. The auto-select decision is made from the
// filtered result set ordered like the record list: group, then title.
func (db V3) SearchWithAutoSelect(query string, mode int) SearchResults {
	uuids := db.Search(query, mode)
	result := SearchResults{UUIDs: uuids}
	if mode != 0 || strings.TrimSpace(query) == "" || len(uuids) == 0 {
		return result
	}
	if uuid, score, ok := db.SearchAutoSelect(query, db.sortUUIDsForRecordList(uuids)); ok {
		result.AutoSelectUUID = uuid
		result.AutoSelectScore = score
	}
	return result
}

type SearchSelectionCandidate struct {
	UUID      string
	VaultUUID string
	Record    Record
}

// SelectSearchRecord returns the one record that should be shown automatically.
// candidates must already be filtered and sorted in the caller's visible order.
func SelectSearchRecord(query string, candidates []SearchSelectionCandidate) (SearchSelectionCandidate, int, bool) {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" || len(candidates) == 0 {
		return SearchSelectionCandidate{}, 0, false
	}

	var best SearchSelectionCandidate
	bestScore := 70000
	for _, candidate := range candidates {
		score := searchAutoSelectScore(candidate.Record, q)
		if score < bestScore {
			best = candidate
			bestScore = score
			if score < 20000 {
				break
			}
		}
	}
	if bestScore < 60000 {
		return best, bestScore, true
	}
	if len(candidates) == 1 {
		return candidates[0], fallbackAutoSelectScore(candidates[0].Record), true
	}
	return SearchSelectionCandidate{}, 0, false
}

// SearchAutoSelect returns the record that should be shown automatically from
// orderedUUIDs for a single vault.
func (db V3) SearchAutoSelect(query string, orderedUUIDs []string) (string, int, bool) {
	candidates := make([]SearchSelectionCandidate, 0, len(orderedUUIDs))
	for _, id := range orderedUUIDs {
		rec, ok := db.Records[id]
		if !ok {
			continue
		}
		candidates = append(candidates, SearchSelectionCandidate{UUID: id, Record: rec})
	}
	match, score, ok := SelectSearchRecord(query, candidates)
	return match.UUID, score, ok
}

func searchAutoSelectScore(rec Record, q string) int {
	title := strings.ToLower(rec.Title)
	host := normalizeSearchHost(rec.URL)
	notes := strings.ToLower(rec.Notes)
	switch {
	case strings.HasPrefix(title, q):
		return autoSelectScore(1, rec.Title)
	case strings.Contains(title, q):
		return autoSelectScore(2, rec.Title)
	case strings.HasPrefix(host, q):
		return autoSelectScore(3, host)
	case strings.Contains(host, q):
		return autoSelectScore(4, host)
	case strings.Contains(notes, q):
		return autoSelectScore(5, rec.Notes)
	default:
		return fallbackAutoSelectScore(rec)
	}
}

func fallbackAutoSelectScore(rec Record) int {
	return autoSelectScore(6, rec.Title)
}

func autoSelectScore(criterion int, matched string) int {
	n := utf8.RuneCountInString(matched)
	if n > 9999 {
		n = 9999
	}
	return criterion*10000 + n
}

func normalizeSearchHost(url string) string {
	host := strings.ToLower(strings.TrimSpace(url))
	if i := strings.Index(host, "://"); i >= 0 {
		host = host[i+3:]
	}
	host = strings.TrimPrefix(host, "www.")
	if i := strings.IndexAny(host, "/?#"); i >= 0 {
		host = host[:i]
	}
	return host
}

func (db V3) sortUUIDsForRecordList(uuids []string) []string {
	sorted := append([]string(nil), uuids...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a := db.Records[sorted[i]]
		b := db.Records[sorted[j]]
		ag := a.Group
		if ag == "" {
			ag = "Ungrouped"
		}
		bg := b.Group
		if bg == "" {
			bg = "Ungrouped"
		}
		if ag != bg {
			return ag < bg
		}
		return a.Title < b.Title
	})
	return sorted
}

// SetPassword Sets the password that will be used to encrypt the file on next save
func (db *V3) SetPassword(pw string) error {
	return db.SetPasswordWithIterations(pw, defaultStretchIterations)
}

// SetPasswordWithIterations sets the password and stretch count used on next save.
func (db *V3) SetPasswordWithIterations(pw string, iter uint32) error {
	if err := validateStretchIterations(iter); err != nil {
		return err
	}
	// First recalculate the Salt and set iter
	db.Iter = iter
	if _, err := rand.Read(db.Salt[:]); err != nil {
		return err
	}
	db.calculateStretchKey(pw)
	db.LastMod = time.Now()
	return nil
}

func (db *V3) VerifyPassword(pw string) bool {
	check := V3{Salt: db.Salt, Iter: db.Iter}
	check.calculateStretchKey(pw)
	defer wipeBytes(check.StretchedKey[:])
	return hmac.Equal(check.StretchedKey[:], db.StretchedKey[:])
}

func validateStretchIterations(iter uint32) error {
	if iter == 0 || iter > maxStretchIterations {
		return fmt.Errorf("invalid stretch iteration count %d", iter)
	}
	return nil
}

// SetRecord Adds or updates a record in the db, keyed by UUID. Returns the UUID hex key.
func (db *V3) SetRecord(record Record) string {
	now := time.Now()
	if record.UUID == [16]byte{} {
		record.UUID = [16]byte(uuid.NewRandom().Array())
	}
	key := uuidKey(record.UUID)
	oldRecord, prs := db.Records[key]
	if !prs {
		record.CreateTime = now
	} else if record.CreateTime.IsZero() {
		record.CreateTime = oldRecord.CreateTime
	}

	record.ModTime = now
	db.Records[key] = record
	db.LastMod = now
	return key
}

// calculateHMAC calculate and set db.HMAC for the unencrypted data using HMACKey
func (db *V3) calculateHMAC(unencrypted []byte) {
	hmacHash := hmac.New(sha256.New, db.HMACKey[:])
	hmacHash.Write(unencrypted)
	copy(db.HMAC[:], hmacHash.Sum(nil))
}

// calculateStretchKey Using the db Salt and Iter along with the passwd calculate the stretch key
func (db *V3) calculateStretchKey(passwd string) {
	if err := validateStretchIterations(db.Iter); err != nil {
		panic(err)
	}
	iterations := int(db.Iter)
	salted := append([]byte(passwd), db.Salt[:]...)
	defer func() {
		for i := range salted {
			salted[i] = 0
		}
	}()
	stretched := sha256.Sum256(salted)
	for i := 0; i < iterations; i++ {
		stretched = sha256.Sum256(stretched[:])
	}
	db.StretchedKey = stretched
}
