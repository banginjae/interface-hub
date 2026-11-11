package service

import (
	"encoding/json"
	"testing"
)

// Server verdicts that web/scripts/check-rest-validation.mjs expects the REST editor validator to match.
func TestNormalizeAPIPayloadEditorCases(t *testing.T) {
	field := func(name, typ, example string) map[string]any {
		return map[string]any{"name": name, "type": typ, "required": true, "nullable": false, "description": "", "example": example, "format": "", "enum": []string{}, "children": []any{}, "arrayItem": nil}
	}
	body := func(fields ...map[string]any) map[string]any {
		if fields == nil {
			fields = []map[string]any{}
		}
		return map[string]any{"contentType": "application/json", "fields": fields, "exampleMode": "AUTO", "example": nil}
	}
	response := func(status int, fields ...map[string]any) map[string]any {
		if fields == nil {
			fields = []map[string]any{}
		}
		return map[string]any{"name": "성공", "status": status, "description": "", "fields": fields, "exampleMode": "AUTO", "example": nil}
	}
	payload := func(edit func(map[string]any)) map[string]any {
		p := map[string]any{
			"method": "POST", "path": "/api/v1/auth/login", "description": "",
			"auth":    map[string]any{"type": "NONE", "description": "", "useDocumentAuth": false},
			"headers": []any{}, "pathParams": []any{}, "queryParams": []any{},
			"requestBody": body(), "responses": []any{response(200)},
		}
		edit(p)
		return p
	}
	enumField := func(values []string, example string) map[string]any {
		f := field("state", "enum", example)
		f["enum"] = values
		return f
	}
	object := field("user", "object", "")
	object["children"] = []any{field("id", "string", ""), field("", "string", "")}
	array := field("ids", "array", "")
	array["arrayItem"] = field("item", "integer", "")

	cases := []struct {
		name  string
		valid bool
		p     map[string]any
	}{
		{"two strings and response 200", true, payload(func(p map[string]any) {
			p["requestBody"] = body(field("loginId", "string", "user01"), field("password", "string", "secret"))
			p["responses"] = []any{response(200, field("accessToken", "string", "abc"))}
		})},
		{"GET without request body", true, payload(func(p map[string]any) { p["method"] = "GET" })},
		{"enum with example", true, payload(func(p map[string]any) { p["requestBody"] = body(enumField([]string{"ACTIVE", "INACTIVE"}, "ACTIVE")) })},
		{"blank row in request body", false, payload(func(p map[string]any) {
			p["requestBody"] = body(field("loginId", "string", ""), field("", "string", ""))
		})},
		{"blank row in header", false, payload(func(p map[string]any) { p["headers"] = []any{field("", "string", "")} })},
		{"blank row in response", false, payload(func(p map[string]any) { p["responses"] = []any{response(200, field("", "string", ""))} })},
		{"space in field name", false, payload(func(p map[string]any) { p["requestBody"] = body(field("login Id", "string", "")) })},
		{"brace in field name", false, payload(func(p map[string]any) { p["requestBody"] = body(field("{id}", "string", "")) })},
		{"integer header without example", false, payload(func(p map[string]any) { p["headers"] = []any{field("X-Count", "integer", "")} })},
		{"boolean query without example", false, payload(func(p map[string]any) { p["queryParams"] = []any{field("all", "boolean", "")} })},
		{"enum without values", false, payload(func(p map[string]any) { p["requestBody"] = body(enumField([]string{}, "")) })},
		{"blank child inside object", false, payload(func(p map[string]any) { p["requestBody"] = body(object) })},
		{"array of integer without example", false, payload(func(p map[string]any) { p["requestBody"] = body(array) })},
		{"duplicate response status", false, payload(func(p map[string]any) { p["responses"] = []any{response(200), response(200)} })},
		{"empty path", false, payload(func(p map[string]any) { p["path"] = "" })},
	}
	for _, tc := range cases {
		raw, err := json.Marshal(tc.p)
		if err != nil {
			t.Fatal(err)
		}
		_, err = NormalizeAPIPayload(raw)
		if tc.valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: expected rejected", tc.name)
		}
	}
}
