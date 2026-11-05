package service

import (
	"encoding/json"
	"strings"
	"testing"

	"interface-hub/internal/model"
)

func TestMQTTPayloadNormalizesNestedExample(t *testing.T) {
	raw := mqttPayloadJSON(t, "gateway/+/heartbeat", 1, false, "DEVICE_TO_SERVER", "AUTO", nil)
	normalized, err := NormalizeMQTTPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Topic       string         `json:"topic"`
		ExampleMode string         `json:"exampleMode"`
		Example     map[string]any `json:"example"`
	}
	if err := json.Unmarshal(normalized, &payload); err != nil {
		t.Fatal(err)
	}
	device, _ := payload.Example["device"].(map[string]any)
	locks, _ := device["locks"].([]any)
	if payload.Topic != "gateway/+/heartbeat" || payload.ExampleMode != "AUTO" || len(locks) != 1 {
		t.Fatalf("example %#v", payload.Example)
	}
}

func TestMQTTPayloadRejectsInvalidTopicAndExample(t *testing.T) {
	if _, err := NormalizeMQTTPayload(mqttPayloadJSON(t, "sport/#/late", 0, false, "DEVICE_TO_SERVER", "AUTO", nil)); err == nil {
		t.Fatal("hash position")
	}
	if _, err := NormalizeMQTTPayload(mqttPayloadJSON(t, "gateway/+/event", 3, false, "DEVICE_TO_SERVER", "AUTO", nil)); err == nil {
		t.Fatal("qos")
	}
	raw := mqttPayloadJSON(t, "gateway/{gatewayId}/doorlock/{doorlockcd}/command", 2, true, "SERVER_TO_DEVICE", "MANUAL", map[string]any{"extra": 1})
	_, err := NormalizeMQTTPayload(raw)
	if code, ok := err.(SpecInputError); !ok || code.Code != specCodeMismatch {
		t.Fatalf("mismatch %#v", err)
	}
}

func TestAPIPayloadRejectsMQTTTopic(t *testing.T) {
	raw := testPayload([]any{testField("id", "string", true, "a", nil, nil)}, "AUTO", nil)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	payload["topic"] = "a/b"
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NormalizeAPIPayload(encoded); err == nil {
		t.Fatal("api payload accepted mqtt field")
	}
}

func TestMQTTMarkdownIncludesTopicContract(t *testing.T) {
	overview, _ := json.Marshal(mqttOverview{BrokerURL: "mqtt://lab.example:1883", ProtocolVersion: "5.0", Auth: overviewAuth{Type: "NONE"}})
	payload, err := NormalizeMQTTPayload(mqttPayloadJSON(t, "gateway/+/doorlock/+/event", 1, false, "DEVICE_TO_SERVER", "AUTO", nil))
	if err != nil {
		t.Fatal(err)
	}
	text := RenderMQTTMarkdown("포장 라인", model.SpecDocument{Title: "MQTT 규격", Overview: overview, Version: 4}, []model.SpecItem{{
		ItemUID: "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10", Name: "도어락 이벤트", Status: "ACTIVE", Payload: payload,
	}})
	for _, part := range []string{"mqtt://lab.example:1883", "프로토콜: 5.0", "gateway/+/doorlock/+/event", "QoS: 1", "Retain: false", "장비 → 서버", "device.locks[].code", `"code": "OPEN"`} {
		if !strings.Contains(text, part) {
			t.Fatalf("missing %s\n%s", part, text)
		}
	}
	if strings.Contains(text, "DEVICE_OFFLINE") {
		t.Fatal("invented error code")
	}
}

func mqttPayloadJSON(t *testing.T, topic string, qos int, retain bool, direction, mode string, example any) []byte {
	t.Helper()
	lock := testField("code", "string", true, "OPEN", nil, nil)
	locks := testField("locks", "array", true, "", nil, testField("item", "object", true, "", []any{lock}, nil))
	device := testField("device", "object", true, "", []any{locks}, nil)
	body := map[string]any{
		"topic": topic, "qos": qos, "retain": retain, "direction": direction,
		"publishers": []string{"gateway"}, "subscribers": []string{"server"},
		"purpose": "도어락 이벤트", "payloadFields": []any{device},
		"exampleMode": mode, "example": example, "relatedItemUid": nil,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
