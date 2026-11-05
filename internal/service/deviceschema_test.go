package service

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDeviceHexKeepsByteOrderAndRejectsOddLength(t *testing.T) {
	normalized, err := normalizeExampleHex("10 00 0a")
	if err != nil || normalized != "10 00 0A" {
		t.Fatalf("hex %q %v", normalized, err)
	}
	if _, err := normalizeExampleHex("10 0"); err == nil {
		t.Fatal("odd hex accepted")
	}
	if _, err := normalizeExampleHex(""); err != nil {
		t.Fatal("empty hex rejected")
	}
}

func TestDeviceFixedOverlapAndDraftLayout(t *testing.T) {
	overlap := devicePayloadJSON("0x10", "REQUEST", "10 00 01", []map[string]any{
		deviceLayoutField("commandId", "integer", "16", 0, 2, "BIG", "UINT16"),
		deviceLayoutField("speed", "integer", "10", 1, 2, "BIG", "UINT16"),
	})
	if _, err := NormalizeDevicePayload(overlap); err == nil {
		t.Fatal("overlapping fixed ranges saved")
	}
	draft := devicePayloadJSON("0x11", "RESPONSE", "", []map[string]any{
		deviceLayoutField("commandId", "integer", "17", 0, 1, "BIG", "UINT8"),
		{
			"name": "note", "type": "string", "required": false, "nullable": false,
			"description": "", "example": "", "format": "", "enum": []any{},
			"children": []any{}, "arrayItem": nil,
			"byteOffset": nil, "byteLength": nil, "endian": nil, "encoding": nil,
			"lengthMode": nil, "bitOffset": nil, "bitLength": nil,
		},
	})
	raw, err := NormalizeDevicePayload(draft)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"commandId":"0x11"`) {
		t.Fatalf("command id rewritten %s", raw)
	}
	negative := devicePayloadJSON("1", "EVENT", "", []map[string]any{
		deviceLayoutField("value", "integer", "1", -1, 1, "LITTLE", "INT8"),
	})
	if _, err := NormalizeDevicePayload(negative); err == nil {
		t.Fatal("negative offset saved")
	}
	zero := devicePayloadJSON("1", "EVENT", "", []map[string]any{
		deviceLayoutField("value", "integer", "1", 0, 0, "BIG", "UINT8"),
	})
	if _, err := NormalizeDevicePayload(zero); err == nil {
		t.Fatal("zero length saved")
	}
}

func TestDeviceBitfieldAndHexMismatchStillSaves(t *testing.T) {
	bits := map[string]any{
		"name": "running", "type": "integer", "required": true, "nullable": false,
		"description": "가동", "example": "1", "format": "", "enum": []any{},
		"children": []any{}, "arrayItem": nil,
		"byteOffset": 3, "byteLength": 1, "endian": "BIG", "encoding": "BITFIELD",
		"lengthMode": "FIXED", "bitOffset": 0, "bitLength": 1,
	}
	raw, err := NormalizeDevicePayload(devicePayloadJSON("0x10", "REQUEST", "AA", []map[string]any{bits}))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"exampleHex":"AA"`) || !strings.Contains(string(raw), `"bitLength":1`) {
		t.Fatalf("bitfield payload %s", raw)
	}
	wide := map[string]any{
		"name": "flags", "type": "integer", "required": true, "nullable": false,
		"description": "", "example": "1", "format": "", "enum": []any{},
		"children": []any{}, "arrayItem": nil,
		"byteOffset": 0, "byteLength": 1, "endian": "BIG", "encoding": "BITFIELD",
		"lengthMode": "FIXED", "bitOffset": 0, "bitLength": 9,
	}
	if _, err := NormalizeDevicePayload(devicePayloadJSON("1", "EVENT", "", []map[string]any{wide})); err == nil {
		t.Fatal("bits outside the field saved")
	}
}

func TestDeviceVariableLengthIsOutsideFixedOverlap(t *testing.T) {
	variable := map[string]any{
		"name": "body", "type": "bytes", "required": false, "nullable": false,
		"description": "", "example": "", "format": "", "enum": []any{},
		"children": []any{}, "arrayItem": nil,
		"byteOffset": 0, "byteLength": nil, "endian": nil, "encoding": "BYTES",
		"lengthMode": "VARIABLE", "bitOffset": nil, "bitLength": nil,
	}
	fixed := deviceLayoutField("head", "integer", "1", 0, 1, "BIG", "UINT8")
	raw, err := NormalizeDevicePayload(devicePayloadJSON("9", "REQUEST", "", []map[string]any{fixed, variable}))
	if err != nil {
		t.Fatalf("variable overlap %v", err)
	}
	if !strings.Contains(string(raw), `"lengthMode":"VARIABLE"`) {
		t.Fatal(raw)
	}
}

func devicePayloadJSON(commandID, direction, hex string, fields []map[string]any) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"commandId": commandID, "direction": direction, "description": "",
		"fields": fields, "exampleHex": hex, "exampleMode": "AUTO", "exampleJson": nil, "relatedItemUid": nil,
	})
	return raw
}

func deviceLayoutField(name, fieldType, example string, offset, length int, endian, encoding string) map[string]any {
	return map[string]any{
		"name": name, "type": fieldType, "required": true, "nullable": false,
		"description": name, "example": example, "format": "", "enum": []any{},
		"children": []any{}, "arrayItem": nil,
		"byteOffset": offset, "byteLength": length, "endian": endian, "encoding": encoding,
		"lengthMode": "FIXED", "bitOffset": nil, "bitLength": nil,
	}
}
