package service

import (
	"encoding/json"
	"strings"
	"testing"
)

// Server verdicts that web/scripts/check-ws-validation.mjs expects the WebSocket message validator to match.
func TestNormalizeWebSocketEditorCases(t *testing.T) {
	field := func(name, typ, example string) map[string]any {
		return map[string]any{"name": name, "type": typ, "required": true, "nullable": false, "description": "", "example": example, "format": "", "enum": []string{}, "children": []any{}, "arrayItem": nil}
	}
	payload := func(eventName string, edit func(map[string]any)) map[string]any {
		p := map[string]any{
			"eventName": eventName, "direction": "CLIENT_TO_SERVER", "messageKind": "REQUEST", "description": "",
			"fields": []any{}, "exampleMode": "AUTO", "example": nil, "relatedItemUid": nil,
		}
		if edit != nil {
			edit(p)
		}
		return p
	}
	messages := []struct {
		name  string
		valid bool
		p     map[string]any
	}{
		{"dotted identifier with field", true, payload("doorlock.open", func(p map[string]any) { p["fields"] = []any{field("doorlockId", "string", "DL001")} })},
		{"leading underscore", true, payload("_internal.ping", nil)},
		{"leading hyphen", true, payload("-legacy", nil)},
		{"mixed separators", true, payload("gateway.status_changed-v2", nil)},
		{"no payload fields", true, payload("session.ready", nil)},
		{"empty identifier", false, payload("", nil)},
		{"space in identifier", false, payload("doorlock open", nil)},
		{"leading dot", false, payload(".doorlock", nil)},
		{"trailing dot", false, payload("doorlock.", nil)},
		{"double dot", false, payload("doorlock..open", nil)},
		{"korean identifier", false, payload("도어락", nil)},
		{"slash in identifier", false, payload("doorlock/open", nil)},
		{"identifier longer than 200", false, payload(strings.Repeat("a", 201), nil)},
		{"blank payload field", false, payload("doorlock.open", func(p map[string]any) {
			p["fields"] = []any{field("doorlockId", "string", ""), field("", "string", "")}
		})},
		{"integer field without example", false, payload("doorlock.open", func(p map[string]any) { p["fields"] = []any{field("count", "integer", "")} })},
		{"manual example with undefined key", false, payload("doorlock.open", func(p map[string]any) {
			p["fields"] = []any{field("doorlockId", "string", "a")}
			p["exampleMode"] = "MANUAL"
			p["example"] = map[string]any{"doorlockId": "a", "extra": 1}
		})},
		{"malformed related uid", false, payload("doorlock.open", func(p map[string]any) { p["relatedItemUid"] = "abc" })},
	}
	for _, tc := range messages {
		raw, err := json.Marshal(tc.p)
		if err != nil {
			t.Fatal(err)
		}
		_, err = NormalizeWebSocketPayload(raw)
		if tc.valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: expected rejected", tc.name)
		}
	}

	overview := func(edit func(map[string]any)) map[string]any {
		o := map[string]any{"url": "wss://lab.example/ws", "auth": map[string]any{"type": "NONE", "description": ""}, "heartbeat": "", "closeCodes": []any{}}
		if edit != nil {
			edit(o)
		}
		return o
	}
	code := func(value int, description string) map[string]any {
		return map[string]any{"code": value, "description": description}
	}
	overviews := []struct {
		name  string
		valid bool
		o     map[string]any
	}{
		{"valid overview with close codes", true, overview(func(o map[string]any) { o["closeCodes"] = []any{code(1000, "정상"), code(4001, "인증 만료")} })},
		{"close code above 4999", false, overview(func(o map[string]any) { o["closeCodes"] = []any{code(5000, "")} })},
		{"duplicate close code", false, overview(func(o map[string]any) { o["closeCodes"] = []any{code(4001, ""), code(4001, "")} })},
		{"close code description over 200", false, overview(func(o map[string]any) { o["closeCodes"] = []any{code(4001, strings.Repeat("가", 201))} })},
		{"space in url", false, overview(func(o map[string]any) { o["url"] = "wss://lab example/ws" })},
	}
	for _, tc := range overviews {
		raw, err := json.Marshal(tc.o)
		if err != nil {
			t.Fatal(err)
		}
		_, err = NormalizeWebSocketOverview(raw)
		if tc.valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: expected rejected", tc.name)
		}
	}
}
