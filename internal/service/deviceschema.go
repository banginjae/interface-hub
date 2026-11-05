package service

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type deviceOverview struct {
	Transport     string `json:"transport"`
	DefaultEndian string `json:"defaultEndian"`
	Framing       string `json:"framing"`
}

type devicePayload struct {
	CommandID      string          `json:"commandId"`
	Direction      string          `json:"direction"`
	Description    string          `json:"description"`
	Fields         []fieldNode     `json:"fields"`
	ExampleHex     string          `json:"exampleHex"`
	ExampleMode    string          `json:"exampleMode"`
	ExampleJSON    json.RawMessage `json:"exampleJson"`
	RelatedItemUID *string         `json:"relatedItemUid"`
}

func EmptyDeviceOverview() json.RawMessage {
	raw, _ := json.Marshal(deviceOverview{Transport: "TCP", DefaultEndian: "BIG"})
	return raw
}

func NormalizeDeviceOverview(raw json.RawMessage) (json.RawMessage, error) {
	var overview deviceOverview
	if err := decodeStrict(raw, &overview); err != nil {
		return nil, invalidErr()
	}
	switch overview.Transport {
	case "TCP", "UDP", "UART", "RS485", "OTHER":
	default:
		return nil, invalidErr()
	}
	switch overview.DefaultEndian {
	case "BIG", "LITTLE":
	default:
		return nil, invalidErr()
	}
	if utf8.RuneCountInString(overview.Framing) > 2000 {
		return nil, invalidErr()
	}
	overview.Framing = strings.TrimSpace(overview.Framing)
	return json.Marshal(overview)
}

func NormalizeDevicePayload(raw json.RawMessage) (json.RawMessage, error) {
	var payload devicePayload
	if err := decodeStrict(raw, &payload); err != nil {
		return nil, invalidErr()
	}
	commandID := strings.TrimSpace(payload.CommandID)
	if commandID == "" || utf8.RuneCountInString(commandID) > 100 || strings.ContainsAny(commandID, "\r\n\t") {
		return nil, invalidErr()
	}
	switch payload.Direction {
	case "REQUEST", "RESPONSE", "EVENT":
	default:
		return nil, invalidErr()
	}
	if utf8.RuneCountInString(payload.Description) > 2000 {
		return nil, invalidErr()
	}
	fields, err := normalizeDeviceFields(payload.Fields, 0)
	if err != nil {
		return nil, err
	}
	hexText, err := normalizeExampleHex(payload.ExampleHex)
	if err != nil {
		return nil, err
	}
	example, err := resolveExample(payload.ExampleMode, payload.ExampleJSON, fields)
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
	payload.CommandID = commandID
	payload.Description = strings.TrimSpace(payload.Description)
	payload.Fields = fields
	payload.ExampleHex = hexText
	payload.ExampleMode = strings.ToUpper(strings.TrimSpace(payload.ExampleMode))
	payload.ExampleJSON = example
	return json.Marshal(payload)
}

func normalizeExampleHex(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	var digits strings.Builder
	for _, char := range trimmed {
		switch {
		case char == ' ' || char == '\t':
			continue
		case char >= '0' && char <= '9', char >= 'a' && char <= 'f', char >= 'A' && char <= 'F':
			digits.WriteRune(char)
		default:
			return "", invalidErr()
		}
	}
	compact := strings.ToUpper(digits.String())
	if len(compact) == 0 || len(compact)%2 != 0 || len(compact) > 8000 {
		return "", invalidErr()
	}
	parts := make([]string, 0, len(compact)/2)
	for index := 0; index < len(compact); index += 2 {
		parts = append(parts, compact[index:index+2])
	}
	return strings.Join(parts, " "), nil
}

func normalizeDeviceLayout(field *fieldNode) error {
	var mode string
	if field.LengthMode != nil {
		mode = strings.ToUpper(strings.TrimSpace(*field.LengthMode))
		if mode != "FIXED" && mode != "VARIABLE" {
			return invalidErr()
		}
		field.LengthMode = &mode
	}
	if field.Endian != nil {
		endian := strings.ToUpper(strings.TrimSpace(*field.Endian))
		if endian != "BIG" && endian != "LITTLE" {
			return invalidErr()
		}
		field.Endian = &endian
	}
	var encoding string
	if field.Encoding != nil {
		encoding = strings.ToUpper(strings.TrimSpace(*field.Encoding))
		switch encoding {
		case "UINT8", "UINT16", "UINT32", "INT8", "INT16", "INT32", "BYTES", "ASCII", "UTF8", "BCD", "BITFIELD":
		default:
			return invalidErr()
		}
		field.Encoding = &encoding
	}
	if mode == "" {
		if field.ByteOffset != nil || field.ByteLength != nil || field.Endian != nil || field.Encoding != nil || field.BitOffset != nil || field.BitLength != nil {
			return invalidErr()
		}
		return nil
	}
	if encoding == "BITFIELD" {
		if mode != "FIXED" || field.BitOffset == nil || field.BitLength == nil || field.ByteOffset == nil || field.ByteLength == nil {
			return invalidErr()
		}
		if *field.BitOffset < 0 || *field.BitLength < 1 || *field.ByteOffset < 0 || *field.ByteLength < 1 {
			return invalidErr()
		}
		if *field.BitOffset+*field.BitLength > *field.ByteLength*8 {
			return invalidErr()
		}
	} else if field.BitOffset != nil || field.BitLength != nil {
		return invalidErr()
	}
	if mode == "VARIABLE" {
		if field.ByteLength != nil {
			return invalidErr()
		}
		if field.ByteOffset != nil && *field.ByteOffset < 0 {
			return invalidErr()
		}
		return nil
	}
	if field.ByteOffset == nil && field.ByteLength == nil {
		return nil
	}
	if field.ByteOffset == nil || field.ByteLength == nil || *field.ByteOffset < 0 || *field.ByteLength < 1 {
		return invalidErr()
	}
	return nil
}

type fixedRange struct {
	start int
	end   int
}

func fixedRangesOverlap(fields []fieldNode) bool {
	ranges := collectFixedRanges(fields)
	for left := 0; left < len(ranges); left++ {
		for right := left + 1; right < len(ranges); right++ {
			if ranges[left].start < ranges[right].end && ranges[right].start < ranges[left].end {
				return true
			}
		}
	}
	return false
}

func collectFixedRanges(fields []fieldNode) []fixedRange {
	var ranges []fixedRange
	var walk func([]fieldNode)
	walk = func(nodes []fieldNode) {
		for _, field := range nodes {
			if field.LengthMode != nil && *field.LengthMode == "FIXED" && field.ByteOffset != nil && field.ByteLength != nil {
				ranges = append(ranges, fixedRange{start: *field.ByteOffset, end: *field.ByteOffset + *field.ByteLength})
			}
			if len(field.Children) > 0 {
				walk(field.Children)
			}
			if field.ArrayItem != nil {
				walk([]fieldNode{*field.ArrayItem})
			}
		}
	}
	walk(fields)
	return ranges
}
