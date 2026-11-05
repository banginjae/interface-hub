package service

import (
	"encoding/json"
	"strings"
	"testing"

	"interface-hub/internal/model"
)

func TestWebSocketPayloadNormalizesNestedExample(t *testing.T) {
	raw := wsPayloadJSON(t, "command.execute", "CLIENT_TO_SERVER", "REQUEST", "AUTO", nil)
	normalized, err := NormalizeWebSocketPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		EventName   string         `json:"eventName"`
		MessageKind string         `json:"messageKind"`
		Example     map[string]any `json:"example"`
	}
	if err := json.Unmarshal(normalized, &payload); err != nil {
		t.Fatal(err)
	}
	command, _ := payload.Example["command"].(map[string]any)
	args, _ := command["args"].([]any)
	if payload.EventName != "command.execute" || payload.MessageKind != "REQUEST" || len(args) != 1 {
		t.Fatalf("example %#v", payload.Example)
	}
}

func TestWebSocketPayloadRejectsKindAndExample(t *testing.T) {
	if _, err := NormalizeWebSocketPayload(wsPayloadJSON(t, "bad name", "CLIENT_TO_SERVER", "EVENT", "AUTO", nil)); err == nil {
		t.Fatal("event name")
	}
	if _, err := NormalizeWebSocketPayload(wsPayloadJSON(t, "session.ping", "CLIENT_TO_SERVER", "NOTIFY", "AUTO", nil)); err == nil {
		t.Fatal("kind")
	}
	raw := wsPayloadJSON(t, "command.result", "SERVER_TO_CLIENT", "RESPONSE", "MANUAL", map[string]any{"extra": 1})
	_, err := NormalizeWebSocketPayload(raw)
	if code, ok := err.(SpecInputError); !ok || code.Code != specCodeMismatch {
		t.Fatalf("mismatch %#v", err)
	}
}

func TestAPIPayloadRejectsWebSocketEvent(t *testing.T) {
	raw := testPayload([]any{testField("id", "string", true, "a", nil, nil)}, "AUTO", nil)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	payload["eventName"] = "session.ping"
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NormalizeAPIPayload(encoded); err == nil {
		t.Fatal("api payload accepted websocket field")
	}
}

func TestWebSocketOverviewRejectsDuplicateCloseCode(t *testing.T) {
	body := map[string]any{
		"url": "wss://lab.example/ws", "heartbeat": "30초마다 ping",
		"auth":       map[string]string{"type": "BEARER", "description": "연결 토큰"},
		"closeCodes": []any{map[string]any{"code": 4001, "description": "인증 만료"}, map[string]any{"code": 4001, "description": "중복"}},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NormalizeWebSocketOverview(raw); err == nil {
		t.Fatal("duplicate close code")
	}
}

func TestWebSocketMarkdownIncludesMessageContract(t *testing.T) {
	overview, _ := json.Marshal(wsOverview{
		URL: "wss://lab.example/ws", Heartbeat: "30초마다 ping", Auth: overviewAuth{Type: "BEARER", Description: "연결 토큰"},
		CloseCodes: []closeCode{{Code: 4001, Description: "인증 만료"}},
	})
	payload, err := NormalizeWebSocketPayload(wsPayloadJSON(t, "command.execute", "CLIENT_TO_SERVER", "REQUEST", "AUTO", nil))
	if err != nil {
		t.Fatal(err)
	}
	text := RenderWebSocketMarkdown("포장 라인", model.SpecDocument{Title: "WebSocket 규격", Overview: overview, Version: 3}, []model.SpecItem{{
		ItemUID: "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10", Name: "명령 실행", Status: "ACTIVE", Payload: payload,
	}})
	for _, part := range []string{"wss://lab.example/ws", "인증: BEARER", "하트비트: 30초마다 ping", "| 4001 | 인증 만료 |", "command.execute", "클라이언트 → 서버", "종류: Request", "command.args[].name", `"name": "start"`} {
		if !strings.Contains(text, part) {
			t.Fatalf("missing %s\n%s", part, text)
		}
	}
	if strings.Contains(text, "CMD_UNKNOWN") {
		t.Fatal("invented error code")
	}
}

func wsPayloadJSON(t *testing.T, eventName, direction, kind, mode string, example any) []byte {
	t.Helper()
	name := testField("name", "string", true, "start", nil, nil)
	args := testField("args", "array", true, "", nil, testField("item", "object", true, "", []any{name}, nil))
	command := testField("command", "object", true, "", []any{args}, nil)
	body := map[string]any{
		"eventName": eventName, "direction": direction, "messageKind": kind,
		"description": "클라이언트가 명령을 보낼 때", "fields": []any{command},
		"exampleMode": mode, "example": example, "relatedItemUid": nil,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
