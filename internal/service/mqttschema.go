package service

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type mqttOverview struct {
	BrokerURL       string       `json:"brokerUrl"`
	ProtocolVersion string       `json:"protocolVersion"`
	Auth            overviewAuth `json:"auth"`
}

type mqttPayload struct {
	Topic          string          `json:"topic"`
	QoS            int             `json:"qos"`
	Retain         bool            `json:"retain"`
	Direction      string          `json:"direction"`
	Publishers     []string        `json:"publishers"`
	Subscribers    []string        `json:"subscribers"`
	Purpose        string          `json:"purpose"`
	PayloadFields  []fieldNode     `json:"payloadFields"`
	ExampleMode    string          `json:"exampleMode"`
	Example        json.RawMessage `json:"example"`
	RelatedItemUID *string         `json:"relatedItemUid"`
}

func EmptyMQTTOverview() json.RawMessage {
	raw, _ := json.Marshal(mqttOverview{
		Auth: overviewAuth{Type: "NONE"},
	})
	return raw
}

func NormalizeMQTTOverview(raw json.RawMessage) (json.RawMessage, error) {
	var overview mqttOverview
	if err := decodeStrict(raw, &overview); err != nil {
		return nil, invalidErr()
	}
	if !validAuthType(overview.Auth.Type) || utf8.RuneCountInString(overview.BrokerURL) > 500 || utf8.RuneCountInString(overview.ProtocolVersion) > 50 || utf8.RuneCountInString(overview.Auth.Description) > 500 {
		return nil, invalidErr()
	}
	overview.BrokerURL = strings.TrimSpace(overview.BrokerURL)
	overview.ProtocolVersion = strings.TrimSpace(overview.ProtocolVersion)
	return json.Marshal(overview)
}

func NormalizeMQTTPayload(raw json.RawMessage) (json.RawMessage, error) {
	var payload mqttPayload
	if err := decodeStrict(raw, &payload); err != nil {
		return nil, invalidErr()
	}
	topic := strings.TrimSpace(payload.Topic)
	if !validMQTTTopic(topic) || (payload.QoS != 0 && payload.QoS != 1 && payload.QoS != 2) {
		return nil, invalidErr()
	}
	switch payload.Direction {
	case "DEVICE_TO_SERVER", "SERVER_TO_DEVICE", "BIDIRECTIONAL":
	default:
		return nil, invalidErr()
	}
	if utf8.RuneCountInString(payload.Purpose) > 2000 {
		return nil, invalidErr()
	}
	publishers, err := normalizeActors(payload.Publishers)
	if err != nil {
		return nil, err
	}
	subscribers, err := normalizeActors(payload.Subscribers)
	if err != nil {
		return nil, err
	}
	fields, err := normalizeFields(payload.PayloadFields, 0)
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
	payload.Topic = topic
	payload.Purpose = strings.TrimSpace(payload.Purpose)
	payload.Publishers = publishers
	payload.Subscribers = subscribers
	payload.PayloadFields = fields
	payload.ExampleMode = strings.ToUpper(strings.TrimSpace(payload.ExampleMode))
	payload.Example = example
	return json.Marshal(payload)
}

func normalizeActors(values []string) ([]string, error) {
	if values == nil {
		return []string{}, nil
	}
	if len(values) > 30 {
		return nil, invalidErr()
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		text := strings.TrimSpace(value)
		if text == "" || utf8.RuneCountInString(text) > 100 || strings.ContainsAny(text, "\r\n\t") || seen[text] {
			return nil, invalidErr()
		}
		seen[text] = true
		out = append(out, text)
	}
	return out, nil
}

func validMQTTTopic(topic string) bool {
	if topic == "" || utf8.RuneCountInString(topic) > 300 || strings.ContainsAny(topic, " \t\r\n") {
		return false
	}
	parts := strings.Split(topic, "/")
	seenHash := false
	for index, part := range parts {
		if part == "" || seenHash {
			return false
		}
		if part == "#" {
			if index != len(parts)-1 {
				return false
			}
			seenHash = true
			continue
		}
		if strings.Contains(part, "#") || (strings.Contains(part, "+") && part != "+") {
			return false
		}
	}
	return true
}
