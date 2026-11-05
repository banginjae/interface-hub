package service

import (
	"encoding/json"
	"testing"
)

func TestAPIPayloadRejectsExampleMismatch(t *testing.T) {
	speed := testField("speed", "integer", true, "10", nil, nil)
	missing := testPayload([]any{speed}, "MANUAL", map[string]any{})
	if code := payloadCode(t, missing); code != specCodeMismatch {
		t.Fatalf("missing required %s", code)
	}
	wrongType := testPayload([]any{speed}, "MANUAL", map[string]any{"speed": "fast"})
	if code := payloadCode(t, wrongType); code != specCodeMismatch {
		t.Fatalf("type mismatch %s", code)
	}
	unknown := testPayload([]any{speed}, "MANUAL", map[string]any{"speed": 10, "extra": 1})
	if code := payloadCode(t, unknown); code != specCodeMismatch {
		t.Fatalf("unknown field %s", code)
	}
	broken := testPayload([]any{speed}, "MANUAL", json.RawMessage(`"not-json-object"`))
	if code := payloadCode(t, broken); code != specCodeMismatch {
		t.Fatalf("json string example %s", code)
	}
}

func TestAPIPayloadBuildsNestedExamples(t *testing.T) {
	nested := testField("params", "object", true, "", []any{
		testField("speed", "integer", true, "10", nil, nil),
	}, nil)
	raw := testPayload([]any{nested}, "AUTO", nil)
	normalized, err := NormalizeAPIPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		RequestBody struct {
			ExampleMode string         `json:"exampleMode"`
			Example     map[string]any `json:"example"`
		} `json:"requestBody"`
	}
	if err := json.Unmarshal(normalized, &payload); err != nil {
		t.Fatal(err)
	}
	params, _ := payload.RequestBody.Example["params"].(map[string]any)
	if payload.RequestBody.ExampleMode != "AUTO" || params["speed"] != float64(10) {
		t.Fatalf("nested example %#v", payload.RequestBody.Example)
	}

	item := testField("item", "object", true, "", []any{
		testField("id", "string", true, "device-1", nil, nil),
	}, nil)
	list := testField("items", "array", true, "", nil, item)
	arrayRaw := testPayload([]any{list}, "AUTO", nil)
	arrayNormalized, err := NormalizeAPIPayload(arrayRaw)
	if err != nil {
		t.Fatal(err)
	}
	var arrayPayload struct {
		RequestBody struct {
			Example map[string]any `json:"example"`
		} `json:"requestBody"`
	}
	if err := json.Unmarshal(arrayNormalized, &arrayPayload); err != nil {
		t.Fatal(err)
	}
	items, _ := arrayPayload.RequestBody.Example["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("array example %#v", arrayPayload.RequestBody.Example)
	}
	first, _ := items[0].(map[string]any)
	if first["id"] != "device-1" {
		t.Fatalf("array item %#v", first)
	}
}

func payloadCode(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	_, err := NormalizeAPIPayload(raw)
	var input SpecInputError
	if !asInput(err, &input) {
		t.Fatal(err)
	}
	return input.Code
}

func asInput(err error, target *SpecInputError) bool {
	if input, ok := err.(SpecInputError); ok {
		*target = input
		return true
	}
	return false
}

func testPayload(fields []any, mode string, example any) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"method": "POST", "path": "/devices", "description": "",
		"auth":        map[string]any{"type": "NONE", "description": "", "useDocumentAuth": false},
		"headers":     []any{},
		"pathParams":  []any{},
		"queryParams": []any{},
		"requestBody": map[string]any{"contentType": "application/json", "fields": fields, "exampleMode": mode, "example": example},
		"responses":   []any{map[string]any{"name": "성공", "status": 200, "description": "", "fields": []any{}, "exampleMode": "AUTO", "example": nil}},
	})
	return raw
}

func testField(name, kind string, required bool, example string, children, arrayItem any) map[string]any {
	if children == nil {
		children = []any{}
	}
	return map[string]any{
		"name": name, "type": kind, "required": required, "nullable": false,
		"description": "", "example": example, "format": "", "enum": []any{},
		"children": children, "arrayItem": arrayItem,
	}
}
