package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"interface-hub/internal/model"
)

func MarkdownFilename(projectTitle, kind string, version uint) string {
	safe := strings.TrimSpace(projectTitle)
	safe = strings.Map(func(char rune) rune {
		switch char {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\n', '\r', '\t':
			return '_'
		default:
			return char
		}
	}, safe)
	safe = strings.Trim(safe, " .")
	if safe == "" {
		safe = "project"
	}
	if strings.TrimSpace(kind) == "" {
		kind = "API"
	}
	return fmt.Sprintf("%s-%s-v%d.md", safe, kind, version)
}

func RenderAPIMarkdown(projectTitle string, doc model.SpecDocument, items []model.SpecItem) string {
	var overview apiOverview
	_ = json.Unmarshal(doc.Overview, &overview)
	var body strings.Builder
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = "API 규격"
	}
	fmt.Fprintf(&body, "# %s — %s\n\n", strings.TrimSpace(projectTitle), title)
	fmt.Fprintf(&body, "- 버전: %d\n", doc.Version)
	updated := doc.UpdatedAt.UTC().Format(time.RFC3339)
	if name := strings.TrimSpace(doc.Updater); name != "" {
		fmt.Fprintf(&body, "- 최종 수정: %s / %s\n", updated, name)
	} else {
		fmt.Fprintf(&body, "- 최종 수정: %s\n", updated)
	}
	baseURL := strings.TrimSpace(overview.BaseURL)
	if baseURL == "" {
		baseURL = "없음"
	}
	fmt.Fprintf(&body, "- Base URL: %s\n", baseURL)
	authType := strings.TrimSpace(overview.Auth.Type)
	if authType == "" {
		authType = "NONE"
	}
	fmt.Fprintf(&body, "- 공통 인증: %s\n", authType)
	if text := strings.TrimSpace(overview.Auth.Description); text != "" {
		fmt.Fprintf(&body, "- 공통 인증 설명: %s\n", text)
	}
	body.WriteString("\n### 공통 헤더\n\n")
	writeFieldTable(&body, overview.CommonHeaders)
	body.WriteString("\n## Endpoint 목록\n\n")
	if len(items) == 0 {
		body.WriteString("등록된 Endpoint가 없습니다.\n")
		return body.String()
	}
	for _, item := range items {
		payload := decodePayload(item.Payload)
		fmt.Fprintf(&body, "- `%s %s` — %s\n", payload.Method, payload.Path, item.Name)
	}
	body.WriteString("\n")
	for _, item := range items {
		writeEndpoint(&body, item)
	}
	return body.String()
}

func writeEndpoint(body *strings.Builder, item model.SpecItem) {
	payload := decodePayload(item.Payload)
	fmt.Fprintf(body, "## %s %s\n\n", payload.Method, payload.Path)
	if text := strings.TrimSpace(payload.Description); text != "" {
		body.WriteString(text)
		body.WriteString("\n\n")
	}
	fmt.Fprintf(body, "- 이름: %s\n", item.Name)
	if text := strings.TrimSpace(item.Summary); text != "" {
		fmt.Fprintf(body, "- 요약: %s\n", text)
	}
	if item.Status != "" && item.Status != "ACTIVE" {
		fmt.Fprintf(body, "- 상태: %s\n", item.Status)
	}
	authType := strings.TrimSpace(payload.Auth.Type)
	if authType == "" {
		authType = "NONE"
	}
	fmt.Fprintf(body, "- 인증: %s\n", authType)
	if text := strings.TrimSpace(payload.Auth.Description); text != "" {
		fmt.Fprintf(body, "- 인증 설명: %s\n", text)
	}
	if payload.Auth.UseDocumentAuth {
		body.WriteString("- 문서 공통 인증: 사용\n")
	}
	body.WriteString("\n### Headers\n\n")
	writeFieldTable(body, payload.Headers)
	body.WriteString("\n### Path Parameters\n\n")
	writeFieldTable(body, payload.PathParams)
	body.WriteString("\n### Query Parameters\n\n")
	writeFieldTable(body, payload.QueryParams)
	body.WriteString("\n### Request Body\n\n")
	if contentType := strings.TrimSpace(payload.RequestBody.ContentType); contentType != "" {
		fmt.Fprintf(body, "- Content-Type: %s\n\n", contentType)
	}
	writeFieldTable(body, payload.RequestBody.Fields)
	writeExample(body, payload.RequestBody.Example)
	if len(payload.Responses) == 0 {
		body.WriteString("\n### Response\n\n저장된 Response가 없습니다.\n")
	} else {
		for _, response := range payload.Responses {
			fmt.Fprintf(body, "\n### Response %d %s\n\n", response.Status, response.Name)
			if text := strings.TrimSpace(response.Description); text != "" {
				body.WriteString(text)
				body.WriteString("\n\n")
			}
			writeFieldTable(body, response.Fields)
			writeExample(body, response.Example)
		}
	}
	writeItemErrorCodes(body, item.ErrorCodes)
}

func writeFieldTable(body *strings.Builder, fields []fieldNode) {
	rows := flattenMarkdownFields(fields, "")
	if len(rows) == 0 {
		body.WriteString("없습니다.\n")
		return
	}
	body.WriteString("| 이름 | 타입 | 필수 | 설명 | 예시 |\n")
	body.WriteString("| --- | --- | --- | --- | --- |\n")
	for _, row := range rows {
		fmt.Fprintf(body, "| %s | %s | %s | %s | %s |\n", cell(row.path), cell(row.typeLabel), yesNo(row.required), cell(row.description), cell(row.example))
	}
}

func writeExample(body *strings.Builder, raw json.RawMessage) {
	text, ok := prettyJSON(raw)
	if !ok {
		body.WriteString("\n저장된 JSON 예시가 없습니다.\n")
		return
	}
	body.WriteString("\n```json\n")
	body.WriteString(text)
	if !strings.HasSuffix(text, "\n") {
		body.WriteString("\n")
	}
	body.WriteString("```\n")
}

type markdownField struct {
	path        string
	typeLabel   string
	required    bool
	description string
	example     string
}

func flattenMarkdownFields(fields []fieldNode, prefix string) []markdownField {
	rows := make([]markdownField, 0)
	for _, field := range fields {
		name := strings.TrimSpace(field.Name)
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		rows = append(rows, markdownField{
			path: path, typeLabel: typeLabel(field), required: field.Required,
			description: field.Description, example: field.Example,
		})
		if field.Type == "object" {
			rows = append(rows, flattenMarkdownFields(field.Children, path)...)
		}
		if field.Type == "array" && field.ArrayItem != nil {
			item := field.ArrayItem
			if item.Type == "object" {
				rows = append(rows, flattenMarkdownFields(item.Children, path+"[]")...)
			} else {
				rows = append(rows, markdownField{
					path: path + "[]", typeLabel: typeLabel(*item), required: item.Required,
					description: item.Description, example: item.Example,
				})
			}
		}
	}
	return rows
}

func RenderMQTTMarkdown(projectTitle string, doc model.SpecDocument, items []model.SpecItem) string {
	var overview mqttOverview
	_ = json.Unmarshal(doc.Overview, &overview)
	var body strings.Builder
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = "MQTT 규격"
	}
	fmt.Fprintf(&body, "# %s — %s\n\n", strings.TrimSpace(projectTitle), title)
	fmt.Fprintf(&body, "- 버전: %d\n", doc.Version)
	updated := doc.UpdatedAt.UTC().Format(time.RFC3339)
	if name := strings.TrimSpace(doc.Updater); name != "" {
		fmt.Fprintf(&body, "- 최종 수정: %s / %s\n", updated, name)
	} else {
		fmt.Fprintf(&body, "- 최종 수정: %s\n", updated)
	}
	broker := strings.TrimSpace(overview.BrokerURL)
	if broker == "" {
		broker = "없음"
	}
	fmt.Fprintf(&body, "- 브로커: %s\n", broker)
	if version := strings.TrimSpace(overview.ProtocolVersion); version != "" {
		fmt.Fprintf(&body, "- 프로토콜: %s\n", version)
	}
	authType := strings.TrimSpace(overview.Auth.Type)
	if authType == "" {
		authType = "NONE"
	}
	fmt.Fprintf(&body, "- 공통 인증: %s\n", authType)
	if text := strings.TrimSpace(overview.Auth.Description); text != "" {
		fmt.Fprintf(&body, "- 공통 인증 설명: %s\n", text)
	}
	body.WriteString("\n## Topic 목록\n\n")
	if len(items) == 0 {
		body.WriteString("등록된 Topic이 없습니다.\n")
		return body.String()
	}
	decoded := make([]mqttPayload, len(items))
	for index, item := range items {
		_ = json.Unmarshal(item.Payload, &decoded[index])
		fmt.Fprintf(&body, "- `%s` — %s\n", decoded[index].Topic, item.Name)
	}
	body.WriteString("\n")
	for index, item := range items {
		writeMQTTTopic(&body, item, decoded[index], items)
	}
	return body.String()
}

func writeMQTTTopic(body *strings.Builder, item model.SpecItem, payload mqttPayload, items []model.SpecItem) {
	fmt.Fprintf(body, "## %s\n\n", payload.Topic)
	fmt.Fprintf(body, "- 이름: %s\n", item.Name)
	if text := strings.TrimSpace(item.Summary); text != "" {
		fmt.Fprintf(body, "- 요약: %s\n", text)
	}
	fmt.Fprintf(body, "- QoS: %d\n", payload.QoS)
	fmt.Fprintf(body, "- Retain: %t\n", payload.Retain)
	fmt.Fprintf(body, "- 방향: %s\n", mqttDirectionLabel(payload.Direction))
	fmt.Fprintf(body, "- Publisher: %s\n", actorList(payload.Publishers))
	fmt.Fprintf(body, "- Subscriber: %s\n", actorList(payload.Subscribers))
	if text := strings.TrimSpace(payload.Purpose); text != "" {
		fmt.Fprintf(body, "- 용도: %s\n", text)
	}
	if payload.RelatedItemUID != nil {
		fmt.Fprintf(body, "- 대응 Topic: %s\n", relatedTopicLabel(*payload.RelatedItemUID, items))
	}
	if item.Status != "" && item.Status != "ACTIVE" {
		fmt.Fprintf(body, "- 상태: %s\n", item.Status)
	}
	body.WriteString("\n### Payload\n\n")
	writeFieldTable(body, payload.PayloadFields)
	writeExample(body, payload.Example)
	writeItemErrorCodes(body, item.ErrorCodes)
}

func RenderWebSocketMarkdown(projectTitle string, doc model.SpecDocument, items []model.SpecItem) string {
	var overview wsOverview
	_ = json.Unmarshal(doc.Overview, &overview)
	var body strings.Builder
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = "WebSocket 규격"
	}
	fmt.Fprintf(&body, "# %s — %s\n\n", strings.TrimSpace(projectTitle), title)
	fmt.Fprintf(&body, "- 버전: %d\n", doc.Version)
	updated := doc.UpdatedAt.UTC().Format(time.RFC3339)
	if name := strings.TrimSpace(doc.Updater); name != "" {
		fmt.Fprintf(&body, "- 최종 수정: %s / %s\n", updated, name)
	} else {
		fmt.Fprintf(&body, "- 최종 수정: %s\n", updated)
	}
	url := strings.TrimSpace(overview.URL)
	if url == "" {
		url = "없음"
	}
	fmt.Fprintf(&body, "- 연결 URL: %s\n", url)
	authType := strings.TrimSpace(overview.Auth.Type)
	if authType == "" {
		authType = "NONE"
	}
	fmt.Fprintf(&body, "- 인증: %s\n", authType)
	if text := strings.TrimSpace(overview.Auth.Description); text != "" {
		fmt.Fprintf(&body, "- 인증 설명: %s\n", text)
	}
	heartbeat := strings.TrimSpace(overview.Heartbeat)
	if heartbeat == "" {
		heartbeat = "없음"
	}
	fmt.Fprintf(&body, "- 하트비트: %s\n", heartbeat)
	body.WriteString("\n### 종료 코드\n\n")
	if len(overview.CloseCodes) == 0 {
		body.WriteString("없습니다.\n")
	} else {
		body.WriteString("| 코드 | 설명 |\n| --- | --- |\n")
		for _, code := range overview.CloseCodes {
			fmt.Fprintf(&body, "| %d | %s |\n", code.Code, cell(code.Description))
		}
	}
	body.WriteString("\n## 메시지 목록\n\n")
	if len(items) == 0 {
		body.WriteString("등록된 메시지가 없습니다.\n")
		return body.String()
	}
	decoded := make([]wsPayload, len(items))
	for index, item := range items {
		_ = json.Unmarshal(item.Payload, &decoded[index])
		fmt.Fprintf(&body, "- `%s` — %s\n", decoded[index].EventName, item.Name)
	}
	body.WriteString("\n")
	for index, item := range items {
		writeWebSocketMessage(&body, item, decoded[index], items)
	}
	return body.String()
}

func writeWebSocketMessage(body *strings.Builder, item model.SpecItem, payload wsPayload, items []model.SpecItem) {
	fmt.Fprintf(body, "## %s\n\n", payload.EventName)
	fmt.Fprintf(body, "- 이름: %s\n", item.Name)
	if text := strings.TrimSpace(item.Summary); text != "" {
		fmt.Fprintf(body, "- 요약: %s\n", text)
	}
	fmt.Fprintf(body, "- 방향: %s\n", wsDirectionLabel(payload.Direction))
	fmt.Fprintf(body, "- 종류: %s\n", wsKindLabel(payload.MessageKind))
	if text := strings.TrimSpace(payload.Description); text != "" {
		fmt.Fprintf(body, "- 설명: %s\n", text)
	}
	if payload.RelatedItemUID != nil {
		fmt.Fprintf(body, "- 대응 메시지: %s\n", relatedEventLabel(*payload.RelatedItemUID, items))
	}
	if item.Status != "" && item.Status != "ACTIVE" {
		fmt.Fprintf(body, "- 상태: %s\n", item.Status)
	}
	body.WriteString("\n### Payload\n\n")
	writeFieldTable(body, payload.Fields)
	writeExample(body, payload.Example)
	writeItemErrorCodes(body, item.ErrorCodes)
}

func wsDirectionLabel(direction string) string {
	switch direction {
	case "CLIENT_TO_SERVER":
		return "클라이언트 → 서버"
	case "SERVER_TO_CLIENT":
		return "서버 → 클라이언트"
	case "BIDIRECTIONAL":
		return "양방향"
	default:
		return direction
	}
}

func wsKindLabel(kind string) string {
	switch kind {
	case "REQUEST":
		return "Request"
	case "RESPONSE":
		return "Response"
	case "EVENT":
		return "Event"
	default:
		return kind
	}
}

func relatedEventLabel(uid string, items []model.SpecItem) string {
	for _, item := range items {
		if item.ItemUID != uid {
			continue
		}
		var payload wsPayload
		_ = json.Unmarshal(item.Payload, &payload)
		if payload.EventName != "" {
			return payload.EventName
		}
		return item.Name
	}
	return uid
}

func mqttDirectionLabel(direction string) string {
	switch direction {
	case "DEVICE_TO_SERVER":
		return "장비 → 서버"
	case "SERVER_TO_DEVICE":
		return "서버 → 장비"
	case "BIDIRECTIONAL":
		return "양방향"
	default:
		return direction
	}
}

func actorList(values []string) string {
	if len(values) == 0 {
		return "없음"
	}
	return strings.Join(values, ", ")
}

func relatedTopicLabel(uid string, items []model.SpecItem) string {
	for _, item := range items {
		if item.ItemUID != uid {
			continue
		}
		var payload mqttPayload
		_ = json.Unmarshal(item.Payload, &payload)
		if payload.Topic != "" {
			return payload.Topic
		}
		return item.Name
	}
	return uid
}

func typeLabel(field fieldNode) string {
	label := field.Type
	if field.Type == "enum" && len(field.Enum) > 0 {
		label = "enum (" + strings.Join(field.Enum, ", ") + ")"
	}
	if field.Format != "" {
		label += " (" + field.Format + ")"
	}
	if field.Nullable {
		label += ", nullable"
	}
	return label
}

func decodePayload(raw json.RawMessage) apiPayload {
	var payload apiPayload
	_ = json.Unmarshal(raw, &payload)
	return payload
}

func prettyJSON(raw json.RawMessage) (string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", false
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, trimmed, "", "  "); err != nil {
		return string(trimmed), true
	}
	return buf.String(), true
}

func yesNo(value bool) string {
	if value {
		return "예"
	}
	return "아니오"
}

func RenderDeviceMarkdown(projectTitle string, doc model.SpecDocument, items []model.SpecItem) string {
	var overview deviceOverview
	_ = json.Unmarshal(doc.Overview, &overview)
	var body strings.Builder
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = "장비 프로토콜"
	}
	fmt.Fprintf(&body, "# %s — %s\n\n", strings.TrimSpace(projectTitle), title)
	fmt.Fprintf(&body, "- 버전: %d\n", doc.Version)
	updated := doc.UpdatedAt.UTC().Format(time.RFC3339)
	if name := strings.TrimSpace(doc.Updater); name != "" {
		fmt.Fprintf(&body, "- 최종 수정: %s / %s\n", updated, name)
	} else {
		fmt.Fprintf(&body, "- 최종 수정: %s\n", updated)
	}
	fmt.Fprintf(&body, "- 전송: %s\n", overview.Transport)
	fmt.Fprintf(&body, "- 기본 엔디언: %s\n", overview.DefaultEndian)
	framing := strings.TrimSpace(overview.Framing)
	if framing == "" {
		framing = "없음"
	}
	fmt.Fprintf(&body, "- 프레이밍: %s\n", framing)
	body.WriteString("\n## 명령 목록\n\n")
	if len(items) == 0 {
		body.WriteString("등록된 명령이 없습니다.\n")
		return body.String()
	}
	decoded := make([]devicePayload, len(items))
	for index, item := range items {
		_ = json.Unmarshal(item.Payload, &decoded[index])
		fmt.Fprintf(&body, "- `%s` — %s\n", decoded[index].CommandID, item.Name)
	}
	body.WriteString("\n")
	for index, item := range items {
		writeDeviceCommand(&body, item, decoded[index], items)
	}
	return body.String()
}

func writeDeviceCommand(body *strings.Builder, item model.SpecItem, payload devicePayload, items []model.SpecItem) {
	fmt.Fprintf(body, "## %s\n\n", item.Name)
	fmt.Fprintf(body, "- Command ID: %s\n", payload.CommandID)
	fmt.Fprintf(body, "- 방향: %s\n", deviceDirectionLabel(payload.Direction))
	if text := strings.TrimSpace(payload.Description); text != "" {
		fmt.Fprintf(body, "- 설명: %s\n", text)
	}
	if payload.RelatedItemUID != nil {
		fmt.Fprintf(body, "- 대응 명령: %s\n", relatedCommandLabel(*payload.RelatedItemUID, items))
	}
	body.WriteString("\n### 필드\n\n")
	body.WriteString("| 이름 | 타입 | 필수 | Offset | Length | Endian | Encoding | 설명 | 예시 |\n")
	body.WriteString("| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
	writeDeviceFieldRows(body, payload.Fields, "")
	body.WriteString("\n### HEX\n\n```text\n")
	if payload.ExampleHex == "" {
		body.WriteString("\n")
	} else {
		body.WriteString(payload.ExampleHex)
		body.WriteString("\n")
	}
	body.WriteString("```\n\n### 해석 JSON\n\n")
	if pretty, ok := prettyJSON(payload.ExampleJSON); ok {
		fmt.Fprintf(body, "```json\n%s\n```\n\n", pretty)
	} else {
		body.WriteString("없습니다.\n\n")
	}
	writeItemErrorCodes(body, item.ErrorCodes)
}

func writeItemErrorCodes(body *strings.Builder, codes []model.ErrorCodeCopy) {
	body.WriteString("\n### 에러 코드\n\n")
	if len(codes) == 0 {
		body.WriteString("없습니다.\n\n")
		return
	}
	body.WriteString("| 코드 | 설명 | 발생 조건 | 처리 |\n")
	body.WriteString("| --- | --- | --- | --- |\n")
	for _, code := range codes {
		fmt.Fprintf(body, "| %s | %s | %s | %s |\n", cell(code.Code), cell(code.Description), cell(code.ConditionText), cell(code.Handling))
	}
	body.WriteString("\n")
}

func writeDeviceFieldRows(body *strings.Builder, fields []fieldNode, prefix string) {
	for _, field := range fields {
		path := field.Name
		if prefix != "" {
			path = prefix + "." + field.Name
		}
		offset, length, endian := "", "", ""
		if field.ByteOffset != nil {
			offset = fmt.Sprintf("%d", *field.ByteOffset)
		}
		if field.ByteLength != nil {
			length = fmt.Sprintf("%d", *field.ByteLength)
		}
		if field.Endian != nil {
			endian = *field.Endian
		}
		encoding := ""
		if field.Encoding != nil {
			encoding = *field.Encoding
			if *field.Encoding == "BITFIELD" && field.BitOffset != nil && field.BitLength != nil {
				encoding = fmt.Sprintf("BITFIELD bit %d len %d", *field.BitOffset, *field.BitLength)
			}
		}
		required := "아니오"
		if field.Required {
			required = "예"
		}
		fmt.Fprintf(body, "| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",
			cell(path), field.Type, required, offset, length, endian, cell(encoding), cell(field.Description), cell(field.Example))
		if len(field.Children) > 0 {
			writeDeviceFieldRows(body, field.Children, path)
		}
		if field.ArrayItem != nil {
			writeDeviceFieldRows(body, []fieldNode{*field.ArrayItem}, path+"[]")
		}
	}
}

func relatedCommandLabel(uid string, items []model.SpecItem) string {
	for _, item := range items {
		if item.ItemUID != uid {
			continue
		}
		var payload devicePayload
		_ = json.Unmarshal(item.Payload, &payload)
		if payload.CommandID != "" {
			return payload.CommandID + " " + item.Name
		}
		return item.Name
	}
	return uid
}

func deviceDirectionLabel(direction string) string {
	switch direction {
	case "REQUEST":
		return "요청"
	case "RESPONSE":
		return "응답"
	case "EVENT":
		return "이벤트"
	default:
		return direction
	}
}

func RenderGeneralMarkdown(projectTitle string, doc model.GeneralDocument) string {
	title := strings.TrimSpace(doc.Title)
	if title == "" {
		title = "일반 문서"
	}
	project := strings.TrimSpace(projectTitle)
	if project == "" {
		project = "프로젝트"
	}
	var body strings.Builder
	fmt.Fprintf(&body, "# %s — %s\n\n", project, title)
	fmt.Fprintf(&body, "- 문서 버전: %d\n", doc.Version)
	fmt.Fprintf(&body, "- 담당 부서: %s\n", strings.TrimSpace(doc.Department))
	fmt.Fprintf(&body, "- 최종 수정: %s / %s\n\n", doc.UpdatedAt.UTC().Format(time.RFC3339), strings.TrimSpace(doc.Updater))
	body.WriteString(doc.Content)
	if !strings.HasSuffix(doc.Content, "\n") {
		body.WriteString("\n")
	}
	return body.String()
}

func cell(value string) string {
	value = strings.ReplaceAll(value, "\r\n", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "|", "\\|")
	return value
}
