package service

import (
	"encoding/json"
	"os"
	"testing"
)

// Replays payloads produced by the device protocol page (web/scripts/check-device-validation.mjs)
// so the server verdict stays aligned with the client validator and payload conversion.
func TestNormalizeDeviceEditorCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/device_editor_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name    string          `json:"name"`
		Valid   bool            `json:"valid"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no device editor cases")
	}
	for _, tc := range cases {
		_, err := NormalizeDevicePayload(tc.Payload)
		if tc.Valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.Name, err)
		}
		if !tc.Valid && err == nil {
			t.Errorf("%s: expected rejected", tc.Name)
		}
	}
}
