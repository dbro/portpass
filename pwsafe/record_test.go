package pwsafe

import (
	"encoding/binary"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRecord_PasswordExpiryInterval(t *testing.T) {
	t.Run("Valid Interval", func(t *testing.T) {
		r := &Record{}
		// 90 days
		data := make([]byte, 4)
		binary.LittleEndian.PutUint32(data, 90)

		err := r.setField(recordPasswordExpiryInterval, data)
		assert.NoError(t, err)
		assert.Equal(t, uint32(90), r.PasswordExpiryInterval)

		// Marshal
		marshaled, _, err := r.marshal()
		assert.NoError(t, err)
		assert.Contains(t, string(marshaled), string(data), "Marshaled data should contain interval")
	})

	t.Run("Invalid Interval - Too Logical Large", func(t *testing.T) {
		r := &Record{}
		// 4000 days (Max is 3650)
		data := make([]byte, 4)
		binary.LittleEndian.PutUint32(data, 4000)

		err := r.setField(recordPasswordExpiryInterval, data)
		assert.NoError(t, err)
		assert.Equal(t, uint32(0), r.PasswordExpiryInterval, "Should default to 0 if > 3650")
	})

	t.Run("Marshal Invalid Interval", func(t *testing.T) {
		r := &Record{}
		r.Title = "Test"
		r.Password = "Test"
		r.PasswordExpiryInterval = 5000 // Manually set invalid value

		_, _, err := r.marshal()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "exceeds maximum")
	})
}

func TestRecord_OwnSymbolsForPassword(t *testing.T) {
	t.Run("Set and Get OwnSymbolsForPassword", func(t *testing.T) {
		r := &Record{}
		symbols := "!@#$%^&*()"
		
		err := r.setField(recordOwnSymbolsForPassword, []byte(symbols))
		assert.NoError(t, err)
		assert.Equal(t, symbols, r.OwnSymbolsForPassword)
	})

	t.Run("Marshal and Unmarshal OwnSymbolsForPassword", func(t *testing.T) {
		r1 := &Record{
			Title:                 "Test Entry",
			Username:              "testuser",
			Password:              "testpass",
			OwnSymbolsForPassword: "!@#$%^&*()-_=+[]{}",
		}

		// Marshal the record
		marshaled, _, err := r1.marshal()
		assert.NoError(t, err)
		assert.NotNil(t, marshaled)

		// Verify the field is in the marshaled data
		// The marshaled data should contain our symbols
		assert.Contains(t, string(marshaled), r1.OwnSymbolsForPassword)
	})

	t.Run("Empty OwnSymbolsForPassword", func(t *testing.T) {
		r := &Record{
			Title:                 "Test Entry",
			Username:              "testuser",
			Password:              "testpass",
			OwnSymbolsForPassword: "",
		}

		// Marshal should work with empty string
		marshaled, _, err := r.marshal()
		assert.NoError(t, err)
		assert.NotNil(t, marshaled)
	})

	t.Run("Record Equality with OwnSymbolsForPassword", func(t *testing.T) {
		r1 := &Record{
			Title:                 "Test",
			OwnSymbolsForPassword: "!@#$",
		}
		r2 := &Record{
			Title:                 "Test",
			OwnSymbolsForPassword: "!@#$",
		}
		r3 := &Record{
			Title:                 "Test",
			OwnSymbolsForPassword: "different",
		}

		// r1 and r2 should be equal
		equal, err := recordEqual(*r1, *r2)
		assert.NoError(t, err)
		assert.True(t, equal)

		// r1 and r3 should not be equal
		equal, err = recordEqual(*r1, *r3)
		assert.False(t, equal)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "OwnSymbolsForPassword")
	})

	t.Run("UTF-8 Symbols", func(t *testing.T) {
		r := &Record{}
		symbols := "§±¿×÷"

		err := r.setField(recordOwnSymbolsForPassword, []byte(symbols))
		assert.NoError(t, err)
		assert.Equal(t, symbols, r.OwnSymbolsForPassword)
	})
}

func TestCustomField_UnknownPropsRoundTrip(t *testing.T) {
	t.Run("unknown property ID survives parse/marshal cycle", func(t *testing.T) {
		// Encode a custom field entry that includes a future property 0x04.
		raw := "010005hello020005world0300010" + "040003abc"
		fields := parseCustomFields(raw)
		assert.Len(t, fields, 1)
		assert.Equal(t, "hello", fields[0].Name)
		assert.Equal(t, "world", fields[0].Value)
		assert.False(t, fields[0].Sensitive)
		assert.Len(t, fields[0].UnknownProps, 1)
		assert.Equal(t, byte(0x04), fields[0].UnknownProps[0].id)
		assert.Equal(t, "abc", fields[0].UnknownProps[0].val)

		marshaled := string(marshalCustomFields(fields))
		reparsed := parseCustomFields(marshaled)
		assert.Len(t, reparsed, 1)
		assert.Equal(t, fields[0].Name, reparsed[0].Name)
		assert.Equal(t, fields[0].Value, reparsed[0].Value)
		assert.Equal(t, fields[0].Sensitive, reparsed[0].Sensitive)
		assert.Equal(t, fields[0].UnknownProps, reparsed[0].UnknownProps)
	})

	t.Run("unknown property survives vault file write-read cycle", func(t *testing.T) {
		db := NewV3("test", "password")
		cf := CustomField{
			Name:         "key",
			Value:        "val",
			UnknownProps: []customFieldProp{{0x04, "future"}},
		}
		rec := Record{Title: "Site", Password: "pass", CustomFields: []CustomField{cf}}
		uuid := db.SetRecord(rec)

		savePath := "./test_dbs/unknown_prop_test.dat"
		err := WritePWSafeFile(db, savePath)
		defer os.Remove(savePath)
		assert.NoError(t, err)

		loaded, err := OpenPWSafeFile(savePath, "password")
		assert.NoError(t, err)
		got := loaded.Records[uuid].CustomFields
		assert.Len(t, got, 1)
		assert.Equal(t, "key", got[0].Name)
		assert.Equal(t, "val", got[0].Value)
		assert.Len(t, got[0].UnknownProps, 1)
		assert.Equal(t, byte(0x04), got[0].UnknownProps[0].id)
		assert.Equal(t, "future", got[0].UnknownProps[0].val)
	})
}

func TestRecord_Autotype(t *testing.T) {
	t.Run("setField stores autotype string", func(t *testing.T) {
		r := &Record{}
		err := r.setField(recordAutotype, []byte(`\u\t\p\n`))
		assert.NoError(t, err)
		assert.Equal(t, `\u\t\p\n`, r.Autotype)
	})

	t.Run("empty autotype marshals without error", func(t *testing.T) {
		r := Record{Title: "Test", Password: "pass", Autotype: ""}
		_, _, err := r.marshal()
		assert.NoError(t, err)
	})

	t.Run("autotype survives vault file write-read cycle", func(t *testing.T) {
		db := NewV3("test", "password")
		rec := Record{Title: "Site", Password: "pass", Autotype: `\u\t\p\n`}
		uuid := db.SetRecord(rec)

		savePath := "./test_dbs/autotype_test.dat"
		err := WritePWSafeFile(db, savePath)
		defer os.Remove(savePath)
		assert.NoError(t, err)

		loaded, err := OpenPWSafeFile(savePath, "password")
		assert.NoError(t, err)
		assert.Equal(t, `\u\t\p\n`, loaded.Records[uuid].Autotype)
	})

	t.Run("record equality checks autotype field", func(t *testing.T) {
		r1 := Record{Title: "Test", Autotype: `\u\t\p\n`}
		r2 := Record{Title: "Test", Autotype: `\u\t\p\n`}
		r3 := Record{Title: "Test", Autotype: `\u\p`}

		equal, err := recordEqual(r1, r2)
		assert.NoError(t, err)
		assert.True(t, equal)

		equal, err = recordEqual(r1, r3)
		assert.False(t, equal)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "Autotype")
	})
}
