package service

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

// Server verdicts that web/scripts/check-mqtt-validation.mjs expects the MQTT Topic validator to match.
func TestNormalizeMQTTPayloadEditorCases(t *testing.T) {
	field := func(name, typ, example string) map[string]any {
		return map[string]any{"name": name, "type": typ, "required": true, "nullable": false, "description": "", "example": example, "format": "", "enum": []string{}, "children": []any{}, "arrayItem": nil}
	}
	payload := func(topic string, edit func(map[string]any)) map[string]any {
		p := map[string]any{
			"topic": topic, "qos": 0, "retain": false, "direction": "DEVICE_TO_SERVER",
			"publishers": []string{}, "subscribers": []string{}, "purpose": "",
			"payloadFields": []any{}, "exampleMode": "AUTO", "example": nil, "relatedItemUid": nil,
		}
		if edit != nil {
			edit(p)
		}
		return p
	}
	many := make([]string, 31)
	for i := range many {
		many[i] = "s" + strconv.Itoa(i)
	}

	cases := []struct {
		name  string
		valid bool
		p     map[string]any
	}{
		{"variable topic with string field", true, payload("devices/{deviceId}/status", func(p map[string]any) { p["payloadFields"] = []any{field("deviceId", "string", "dev-1")} })},
		{"single-level wildcard", true, payload("gateway/+/event", nil)},
		{"multi-level wildcard at end", true, payload("devices/#", nil)},
		{"no payload fields", true, payload("devices/{deviceId}/status", nil)},
		{"publishers and subscribers", true, payload("devices/{deviceId}/status", func(p map[string]any) {
			p["publishers"] = []string{"센서"}
			p["subscribers"] = []string{"서버"}
		})},
		{"empty topic", false, payload("", nil)},
		{"empty level", false, payload("a//b", nil)},
		{"leading slash", false, payload("/a/b", nil)},
		{"trailing slash", false, payload("a/b/", nil)},
		{"space in topic", false, payload("a b/c", nil)},
		{"hash not last", false, payload("sport/#/late", nil)},
		{"hash inside level", false, payload("a/b#", nil)},
		{"plus inside level", false, payload("a/b+/c", nil)},
		{"blank payload field", false, payload("a/b", func(p map[string]any) {
			p["payloadFields"] = []any{field("deviceId", "string", ""), field("", "string", "")}
		})},
		{"integer field without example", false, payload("a/b", func(p map[string]any) { p["payloadFields"] = []any{field("count", "integer", "")} })},
		{"duplicate publishers", false, payload("a/b", func(p map[string]any) { p["publishers"] = []string{"센서", "센서"} })},
		{"publisher longer than 100", false, payload("a/b", func(p map[string]any) { p["publishers"] = []string{strings.Repeat("가", 101)} })},
		{"31 subscribers", false, payload("a/b", func(p map[string]any) { p["subscribers"] = many })},
		{"manual example with undefined key", false, payload("a/b", func(p map[string]any) {
			p["payloadFields"] = []any{field("deviceId", "string", "a")}
			p["exampleMode"] = "MANUAL"
			p["example"] = map[string]any{"deviceId": "a", "extra": 1}
		})},
	}
	for _, tc := range cases {
		raw, err := json.Marshal(tc.p)
		if err != nil {
			t.Fatal(err)
		}
		_, err = NormalizeMQTTPayload(raw)
		if tc.valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: expected rejected", tc.name)
		}
	}
}
