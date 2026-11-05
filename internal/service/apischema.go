package service

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	specCodeInvalid  = "INVALID_REQUEST"
	specCodeMismatch = "EXAMPLE_SCHEMA_MISMATCH"
)

type SpecInputError struct {
	Code string
}

func (e SpecInputError) Error() string {
	if e.Code == specCodeMismatch {
		return "example schema mismatch"
	}
	return "invalid spec"
}

func mismatchErr() error { return SpecInputError{Code: specCodeMismatch} }
func invalidErr() error  { return SpecInputError{Code: specCodeInvalid} }

type fieldNode struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	Required    bool        `json:"required"`
	Nullable    bool        `json:"nullable"`
	Description string      `json:"description"`
	Example     string      `json:"example"`
	Format      string      `json:"format"`
	Enum        []string    `json:"enum"`
	Children    []fieldNode `json:"children"`
	ArrayItem   *fieldNode  `json:"arrayItem"`
	ByteOffset  *int        `json:"byteOffset"`
	ByteLength  *int        `json:"byteLength"`
	Endian      *string     `json:"endian"`
	Encoding    *string     `json:"encoding"`
	LengthMode  *string     `json:"lengthMode"`
	BitOffset   *int        `json:"bitOffset"`
	BitLength   *int        `json:"bitLength"`
}

type apiAuth struct {
	Type            string `json:"type"`
	Description     string `json:"description"`
	UseDocumentAuth bool   `json:"useDocumentAuth"`
}

type apiExampleBody struct {
	ContentType string          `json:"contentType"`
	Fields      []fieldNode     `json:"fields"`
	ExampleMode string          `json:"exampleMode"`
	Example     json.RawMessage `json:"example"`
}

type apiResponseBody struct {
	Name        string          `json:"name"`
	Status      int             `json:"status"`
	Description string          `json:"description"`
	Fields      []fieldNode     `json:"fields"`
	ExampleMode string          `json:"exampleMode"`
	Example     json.RawMessage `json:"example"`
}

type apiPayload struct {
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	Description string            `json:"description"`
	Auth        apiAuth           `json:"auth"`
	Headers     []fieldNode       `json:"headers"`
	PathParams  []fieldNode       `json:"pathParams"`
	QueryParams []fieldNode       `json:"queryParams"`
	RequestBody apiExampleBody    `json:"requestBody"`
	Responses   []apiResponseBody `json:"responses"`
}

type overviewAuth struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

type apiOverview struct {
	BaseURL       string       `json:"baseUrl"`
	Auth          overviewAuth `json:"auth"`
	CommonHeaders []fieldNode  `json:"commonHeaders"`
}

func EmptyAPIOverview() json.RawMessage {
	raw, _ := json.Marshal(apiOverview{
		Auth:          overviewAuth{Type: "NONE"},
		CommonHeaders: []fieldNode{},
	})
	return raw
}

func NormalizeAPIOverview(raw json.RawMessage) (json.RawMessage, error) {
	var overview apiOverview
	if err := decodeStrict(raw, &overview); err != nil {
		return nil, invalidErr()
	}
	if !validAuthType(overview.Auth.Type) || utf8.RuneCountInString(overview.BaseURL) > 500 || utf8.RuneCountInString(overview.Auth.Description) > 500 {
		return nil, invalidErr()
	}
	headers, err := normalizeFields(overview.CommonHeaders, 0)
	if err != nil {
		return nil, err
	}
	overview.CommonHeaders = headers
	return json.Marshal(overview)
}

func NormalizeAPIPayload(raw json.RawMessage) (json.RawMessage, error) {
	var payload apiPayload
	if err := decodeStrict(raw, &payload); err != nil {
		return nil, invalidErr()
	}
	switch payload.Method {
	case "GET", "POST", "PUT", "PATCH", "DELETE":
	default:
		return nil, invalidErr()
	}
	path := strings.TrimSpace(payload.Path)
	if path == "" || !strings.HasPrefix(path, "/") || strings.ContainsAny(path, " \t\r\n") || utf8.RuneCountInString(path) > 300 {
		return nil, invalidErr()
	}
	payload.Path = path
	if utf8.RuneCountInString(payload.Description) > 2000 || !validAuthType(payload.Auth.Type) || utf8.RuneCountInString(payload.Auth.Description) > 500 {
		return nil, invalidErr()
	}
	var err error
	if payload.Headers, err = normalizeFields(payload.Headers, 0); err != nil {
		return nil, err
	}
	if payload.PathParams, err = normalizeFields(payload.PathParams, 0); err != nil {
		return nil, err
	}
	if payload.QueryParams, err = normalizeFields(payload.QueryParams, 0); err != nil {
		return nil, err
	}
	body, err := normalizeExampleBody(payload.RequestBody)
	if err != nil {
		return nil, err
	}
	payload.RequestBody = body
	if payload.Responses == nil {
		payload.Responses = []apiResponseBody{}
	}
	seenStatus := map[int]bool{}
	for i := range payload.Responses {
		response := payload.Responses[i]
		name := strings.TrimSpace(response.Name)
		if name == "" || utf8.RuneCountInString(name) > 100 || response.Status < 100 || response.Status > 599 || seenStatus[response.Status] {
			return nil, invalidErr()
		}
		seenStatus[response.Status] = true
		if utf8.RuneCountInString(response.Description) > 2000 {
			return nil, invalidErr()
		}
		fields, err := normalizeFields(response.Fields, 0)
		if err != nil {
			return nil, err
		}
		example, err := resolveExample(response.ExampleMode, response.Example, fields)
		if err != nil {
			return nil, err
		}
		response.Name = name
		response.Fields = fields
		response.ExampleMode = strings.ToUpper(strings.TrimSpace(response.ExampleMode))
		response.Example = example
		payload.Responses[i] = response
	}
	return json.Marshal(payload)
}

func normalizeExampleBody(body apiExampleBody) (apiExampleBody, error) {
	if body.ContentType != "application/json" {
		return body, invalidErr()
	}
	fields, err := normalizeFields(body.Fields, 0)
	if err != nil {
		return body, err
	}
	example, err := resolveExample(body.ExampleMode, body.Example, fields)
	if err != nil {
		return body, err
	}
	body.Fields = fields
	body.ExampleMode = strings.ToUpper(strings.TrimSpace(body.ExampleMode))
	body.Example = example
	return body, nil
}

func resolveExample(mode string, raw json.RawMessage, fields []fieldNode) (json.RawMessage, error) {
	switch strings.ToUpper(strings.TrimSpace(mode)) {
	case "AUTO":
		built, err := buildObject(fields)
		if err != nil {
			return nil, err
		}
		return json.Marshal(built)
	case "MANUAL":
		if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
			return nil, invalidErr()
		}
		value, err := decodeJSONValue(raw)
		if err != nil {
			return nil, invalidErr()
		}
		if _, ok := value.(string); ok {
			return nil, mismatchErr()
		}
		object, ok := value.(map[string]any)
		if !ok {
			return nil, mismatchErr()
		}
		if err := matchObject(fields, object); err != nil {
			return nil, err
		}
		return compactRaw(raw)
	default:
		return nil, invalidErr()
	}
}

func normalizeFields(fields []fieldNode, depth int) ([]fieldNode, error) {
	return normalizeFieldsMode(fields, depth, false)
}

func normalizeDeviceFields(fields []fieldNode, depth int) ([]fieldNode, error) {
	fields, err := normalizeFieldsMode(fields, depth, true)
	if err != nil {
		return nil, err
	}
	if fixedRangesOverlap(fields) {
		return nil, invalidErr()
	}
	return fields, nil
}

func normalizeFieldsMode(fields []fieldNode, depth int, deviceLayout bool) ([]fieldNode, error) {
	if fields == nil {
		return []fieldNode{}, nil
	}
	if depth > 12 {
		return nil, invalidErr()
	}
	names := map[string]bool{}
	out := make([]fieldNode, 0, len(fields))
	for _, field := range fields {
		normalized, err := normalizeField(field, depth, deviceLayout)
		if err != nil {
			return nil, err
		}
		if names[normalized.Name] {
			return nil, invalidErr()
		}
		names[normalized.Name] = true
		out = append(out, normalized)
	}
	return out, nil
}

func normalizeField(field fieldNode, depth int, deviceLayout bool) (fieldNode, error) {
	field.Name = strings.TrimSpace(field.Name)
	if !validFieldName(field.Name) || utf8.RuneCountInString(field.Description) > 500 || utf8.RuneCountInString(field.Format) > 50 || utf8.RuneCountInString(field.Example) > 4000 {
		return field, invalidErr()
	}
	if deviceLayout {
		if err := normalizeDeviceLayout(&field); err != nil {
			return field, err
		}
	} else if field.ByteOffset != nil || field.ByteLength != nil || field.Endian != nil || field.Encoding != nil || field.LengthMode != nil || field.BitOffset != nil || field.BitLength != nil {
		return field, invalidErr()
	}
	switch field.Type {
	case "string", "number", "integer", "boolean", "bytes", "enum", "object", "array":
	default:
		return field, invalidErr()
	}
	if field.Enum == nil {
		field.Enum = []string{}
	}
	if field.Type == "enum" {
		if len(field.Enum) == 0 {
			return field, invalidErr()
		}
		seen := map[string]bool{}
		for _, value := range field.Enum {
			if strings.TrimSpace(value) == "" || seen[value] {
				return field, invalidErr()
			}
			seen[value] = true
		}
	} else if len(field.Enum) > 0 {
		return field, invalidErr()
	}
	if field.Type == "object" {
		if field.ArrayItem != nil {
			return field, invalidErr()
		}
		children, err := normalizeFieldsMode(field.Children, depth+1, deviceLayout)
		if err != nil {
			return field, err
		}
		field.Children = children
		field.ArrayItem = nil
		if err := checkNodeExample(field); err != nil {
			return field, err
		}
		return field, nil
	}
	if field.Type == "array" {
		if field.ArrayItem == nil || len(field.Children) > 0 {
			return field, invalidErr()
		}
		item, err := normalizeField(*field.ArrayItem, depth+1, deviceLayout)
		if err != nil {
			return field, err
		}
		field.ArrayItem = &item
		field.Children = []fieldNode{}
		if err := checkNodeExample(field); err != nil {
			return field, err
		}
		return field, nil
	}
	if field.ArrayItem != nil || len(field.Children) > 0 {
		return field, invalidErr()
	}
	field.Children = []fieldNode{}
	field.ArrayItem = nil
	if _, err := scalarValue(field); err != nil {
		return field, err
	}
	return field, nil
}

func checkNodeExample(field fieldNode) error {
	if strings.TrimSpace(field.Example) == "" {
		return nil
	}
	value, err := decodeJSONValue(json.RawMessage(field.Example))
	if err != nil {
		return invalidErr()
	}
	if err := matchValue(field, value); err != nil {
		return err
	}
	return nil
}

func buildObject(fields []fieldNode) (map[string]any, error) {
	out := map[string]any{}
	for _, field := range fields {
		value, err := buildValue(field)
		if err != nil {
			return nil, err
		}
		out[field.Name] = value
	}
	return out, nil
}

func buildValue(field fieldNode) (any, error) {
	switch field.Type {
	case "object":
		return buildObject(field.Children)
	case "array":
		item, err := buildValue(*field.ArrayItem)
		if err != nil {
			return nil, err
		}
		return []any{item}, nil
	default:
		return scalarValue(field)
	}
}

func scalarValue(field fieldNode) (any, error) {
	switch field.Type {
	case "string", "bytes":
		return field.Example, nil
	case "enum":
		for _, value := range field.Enum {
			if value == field.Example {
				return field.Example, nil
			}
		}
		return nil, invalidErr()
	case "integer":
		number, err := strconv.ParseInt(field.Example, 10, 64)
		if err != nil {
			return nil, invalidErr()
		}
		return number, nil
	case "number":
		number, err := strconv.ParseFloat(field.Example, 64)
		if err != nil {
			return nil, invalidErr()
		}
		return number, nil
	case "boolean":
		if field.Example != "true" && field.Example != "false" {
			return nil, invalidErr()
		}
		return field.Example == "true", nil
	default:
		return nil, invalidErr()
	}
}

func matchObject(fields []fieldNode, object map[string]any) error {
	known := map[string]fieldNode{}
	for _, field := range fields {
		known[field.Name] = field
	}
	for key := range object {
		if _, ok := known[key]; !ok {
			return mismatchErr()
		}
	}
	for _, field := range fields {
		value, ok := object[field.Name]
		if !ok {
			if field.Required {
				return mismatchErr()
			}
			continue
		}
		if value == nil {
			if !field.Nullable {
				return mismatchErr()
			}
			continue
		}
		if err := matchValue(field, value); err != nil {
			return err
		}
	}
	return nil
}

func matchValue(field fieldNode, value any) error {
	switch field.Type {
	case "string", "bytes", "enum":
		text, ok := value.(string)
		if !ok {
			return mismatchErr()
		}
		if field.Type == "enum" {
			for _, allowed := range field.Enum {
				if allowed == text {
					return nil
				}
			}
			return mismatchErr()
		}
		return nil
	case "integer":
		number, ok := value.(json.Number)
		if !ok {
			return mismatchErr()
		}
		if _, err := strconv.ParseInt(number.String(), 10, 64); err != nil {
			return mismatchErr()
		}
		return nil
	case "number":
		number, ok := value.(json.Number)
		if !ok {
			return mismatchErr()
		}
		if _, err := strconv.ParseFloat(number.String(), 64); err != nil {
			return mismatchErr()
		}
		return nil
	case "boolean":
		if _, ok := value.(bool); !ok {
			return mismatchErr()
		}
		return nil
	case "object":
		child, ok := value.(map[string]any)
		if !ok {
			return mismatchErr()
		}
		return matchObject(field.Children, child)
	case "array":
		items, ok := value.([]any)
		if !ok || field.ArrayItem == nil {
			return mismatchErr()
		}
		for _, item := range items {
			if item == nil {
				if !field.ArrayItem.Nullable {
					return mismatchErr()
				}
				continue
			}
			if err := matchValue(*field.ArrayItem, item); err != nil {
				return err
			}
		}
		return nil
	default:
		return invalidErr()
	}
}

func decodeJSONValue(raw json.RawMessage) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if decoder.More() {
		return nil, invalidErr()
	}
	return value, nil
}

func decodeStrict(raw json.RawMessage, dest any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	return nil
}

func compactRaw(raw json.RawMessage) (json.RawMessage, error) {
	var buffer bytes.Buffer
	if err := json.Compact(&buffer, raw); err != nil {
		return nil, invalidErr()
	}
	return buffer.Bytes(), nil
}

func validAuthType(value string) bool {
	switch value {
	case "NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM":
		return true
	default:
		return false
	}
}

func validFieldName(name string) bool {
	if name == "" || utf8.RuneCountInString(name) > 100 || strings.Contains(name, ".") || strings.ContainsAny(name, " \t\r\n{}[]") {
		return false
	}
	return true
}
