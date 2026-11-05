package service

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type wsOverview struct {
	URL        string       `json:"url"`
	Auth       overviewAuth `json:"auth"`
	Heartbeat  string       `json:"heartbeat"`
	CloseCodes []closeCode  `json:"closeCodes"`
}

type closeCode struct {
	Code        int    `json:"code"`
	Description string `json:"description"`
}

type wsPayload struct {
	EventName      string          `json:"eventName"`
	Direction      string          `json:"direction"`
	MessageKind    string          `json:"messageKind"`
	Description    string          `json:"description"`
	Fields         []fieldNode     `json:"fields"`
	ExampleMode    string          `json:"exampleMode"`
	Example        json.RawMessage `json:"example"`
	RelatedItemUID *string         `json:"relatedItemUid"`
}

func EmptyWebSocketOverview() json.RawMessage {
	raw, _ := json.Marshal(wsOverview{
		Auth:       overviewAuth{Type: "NONE"},
		CloseCodes: []closeCode{},
	})
	return raw
}

func NormalizeWebSocketOverview(raw json.RawMessage) (json.RawMessage, error) {
	var overview wsOverview
	if err := decodeStrict(raw, &overview); err != nil {
		return nil, invalidErr()
	}
	if !validAuthType(overview.Auth.Type) || utf8.RuneCountInString(overview.URL) > 500 || utf8.RuneCountInString(overview.Heartbeat) > 2000 || utf8.RuneCountInString(overview.Auth.Description) > 500 {
		return nil, invalidErr()
	}
	if strings.ContainsAny(overview.URL, " \t\r\n") {
		return nil, invalidErr()
	}
	codes, err := normalizeCloseCodes(overview.CloseCodes)
	if err != nil {
		return nil, err
	}
	overview.URL = strings.TrimSpace(overview.URL)
	overview.Heartbeat = strings.TrimSpace(overview.Heartbeat)
	overview.CloseCodes = codes
	return json.Marshal(overview)
}

func NormalizeWebSocketPayload(raw json.RawMessage) (json.RawMessage, error) {
	var payload wsPayload
	if err := decodeStrict(raw, &payload); err != nil {
		return nil, invalidErr()
	}
	eventName := strings.TrimSpace(payload.EventName)
	if !validEventName(eventName) || utf8.RuneCountInString(payload.Description) > 2000 {
		return nil, invalidErr()
	}
	switch payload.Direction {
	case "CLIENT_TO_SERVER", "SERVER_TO_CLIENT", "BIDIRECTIONAL":
	default:
		return nil, invalidErr()
	}
	switch payload.MessageKind {
	case "REQUEST", "RESPONSE", "EVENT":
	default:
		return nil, invalidErr()
	}
	fields, err := normalizeFields(payload.Fields, 0)
	if err != nil {
		return nil, err
	}
	example, err := resolveExample(payload.ExampleMode, payload.Example, fields)
	if err != nil {
		return nil, err
	}
	if payload.RelatedItemUID != nil {
		related := strings.TrimSpace(*payload.RelatedItemUID)
		if !validItemUID(related) {
			return nil, invalidErr()
		}
		payload.RelatedItemUID = &related
	}
	payload.EventName = eventName
	payload.Description = strings.TrimSpace(payload.Description)
	payload.Fields = fields
	payload.ExampleMode = strings.ToUpper(strings.TrimSpace(payload.ExampleMode))
	payload.Example = example
	return json.Marshal(payload)
}

func normalizeCloseCodes(codes []closeCode) ([]closeCode, error) {
	if codes == nil {
		return []closeCode{}, nil
	}
	if len(codes) > 40 {
		return nil, invalidErr()
	}
	seen := map[int]bool{}
	out := make([]closeCode, 0, len(codes))
	for _, code := range codes {
		description := strings.TrimSpace(code.Description)
		if code.Code < 0 || code.Code > 4999 || seen[code.Code] || utf8.RuneCountInString(description) > 200 {
			return nil, invalidErr()
		}
		seen[code.Code] = true
		out = append(out, closeCode{Code: code.Code, Description: description})
	}
	return out, nil
}

func validEventName(name string) bool {
	if name == "" || utf8.RuneCountInString(name) > 200 || strings.ContainsAny(name, " \t\r\n") {
		return false
	}
	for _, char := range name {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '.' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return name[0] != '.' && name[len(name)-1] != '.' && !strings.Contains(name, "..")
}
