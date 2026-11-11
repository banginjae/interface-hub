package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/repository"
	"interface-hub/internal/service"

	"gorm.io/gorm"
)

func TestAPISpecStorageOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupSpecFixture(t, gdb, suffix) })
	password := "spec-" + randomToken(t)
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	creator := makeUser(t, accounts, "s4c"+suffix, "규격생성자", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "규격조회", "MEMBER", password)
	writer := makeUser(t, accounts, "s4w"+suffix, "규격편집", "MEMBER", password)
	outsider := makeUser(t, accounts, "s4o"+suffix, "규격외부", "MEMBER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	writerToken := loginEmployee(t, server.URL, writer.EmployeeNo, password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)

	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title": "규격 검증 " + suffix, "description": "spec-" + suffix,
	})
	projectBody := readBody(t, createdProject)
	if createdProject.StatusCode != http.StatusCreated {
		t.Fatalf("project %d", createdProject.StatusCode)
	}
	var project struct {
		ID      uint64 `json:"id"`
		Version uint   `json:"version"`
	}
	if err := json.Unmarshal([]byte(projectBody), &project); err != nil {
		t.Fatal(err)
	}
	base := projectURL(server.URL, project.ID)
	for _, employee := range []struct {
		no, permission string
	}{{reader.EmployeeNo, "READ"}, {writer.EmployeeNo, "WRITE"}} {
		added := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{
			"employeeNo": employee.no, "permission": employee.permission,
		})
		if added.StatusCode != http.StatusCreated {
			t.Fatalf("member %s %d", employee.permission, added.StatusCode)
		}
	}

	specURL := base + "/specs"
	created := sendJSON(t, http.MethodPost, specURL, creatorToken, map[string]string{"kind": "API", "title": "API 규격"})
	createdBody := readBody(t, created)
	if created.StatusCode != http.StatusCreated || fieldOf(t, createdBody, "version") != "1" {
		t.Fatalf("create spec %d %s", created.StatusCode, createdBody)
	}
	duplicate := sendJSON(t, http.MethodPost, specURL, creatorToken, map[string]string{"kind": "API", "title": "중복"})
	if codeIn(t, readBody(t, duplicate)) != "SPEC_KIND_ALREADY_EXISTS" {
		t.Fatalf("duplicate %d", duplicate.StatusCode)
	}
	device := sendJSON(t, http.MethodPost, specURL, creatorToken, map[string]string{"kind": "DEVICE_PROTOCOL", "title": "장비"})
	if device.StatusCode != http.StatusCreated {
		t.Fatalf("device protocol %d", device.StatusCode)
	}

	apiURL := specURL + "/API"
	speed := specField("speed", "integer", true, "10", []any{}, nil)
	nested := specField("params", "object", true, "", []any{speed}, nil)
	first := sendJSON(t, http.MethodPost, apiURL+"/items", creatorToken, itemBody(1, "중첩 Endpoint", endpointPayload("POST", "/devices", []any{nested}, "AUTO", nil)))
	firstBody := readBody(t, first)
	if first.StatusCode != http.StatusCreated {
		t.Fatalf("add nested %d %s", first.StatusCode, firstBody)
	}
	var createdItem struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(firstBody), &createdItem); err != nil || createdItem.Version != 2 || createdItem.ItemUID == "" {
		t.Fatalf("nested version %s", firstBody)
	}
	doc := getSpec(t, apiURL, creatorToken)
	if len(doc.Items) != 1 || doc.Items[0].Payload.RequestBody.Example["params"].(map[string]any)["speed"] != float64(10) {
		t.Fatalf("nested read %#v", doc.Items)
	}

	arrayItem := specField("item", "object", true, "", []any{specField("id", "string", true, "device-1", []any{}, nil)}, nil)
	arrayField := specField("items", "array", true, "", []any{}, arrayItem)
	second := sendJSON(t, http.MethodPost, apiURL+"/items", creatorToken, itemBody(createdItem.Version, "배열 Endpoint", endpointPayload("GET", "/devices", []any{arrayField}, "AUTO", nil)))
	secondBody := readBody(t, second)
	if second.StatusCode != http.StatusCreated {
		t.Fatalf("add array %d %s", second.StatusCode, secondBody)
	}
	var arrayItemResult struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(secondBody), &arrayItemResult); err != nil || arrayItemResult.Version != 3 {
		t.Fatal(secondBody)
	}
	doc = getSpec(t, apiURL, creatorToken)
	var arrayEndpoint specItemJSON
	for _, item := range doc.Items {
		if item.ItemUID == arrayItemResult.ItemUID {
			arrayEndpoint = item
		}
	}
	items, _ := arrayEndpoint.Payload.RequestBody.Example["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != "device-1" {
		t.Fatalf("array read %#v", arrayEndpoint.Payload.RequestBody.Example)
	}

	updatedPath := endpointPayload("PUT", "/devices/{deviceId}", []any{speed}, "AUTO", nil)
	updated := sendJSON(t, http.MethodPut, apiURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(arrayItemResult.Version, "수정 Endpoint", updatedPath))
	updatedBody := readBody(t, updated)
	if updated.StatusCode != http.StatusOK || fieldOf(t, updatedBody, "version") != "4" {
		t.Fatalf("update %d %s", updated.StatusCode, updatedBody)
	}
	doc = getSpec(t, apiURL, creatorToken)
	if doc.Version != 4 || itemByUID(doc, createdItem.ItemUID).Payload.Path != "/devices/{deviceId}" || itemByUID(doc, arrayItemResult.ItemUID).Payload.Path != "/devices" {
		t.Fatal("update replaced another item")
	}

	reordered := sendJSON(t, http.MethodPut, apiURL+"/items/order", creatorToken, map[string]any{
		"version": 4, "changeReason": "순서 변경", "itemUids": []string{arrayItemResult.ItemUID, createdItem.ItemUID},
	})
	if reordered.StatusCode != http.StatusOK {
		t.Fatalf("reorder %d %s", reordered.StatusCode, readBody(t, reordered))
	}
	doc = getSpec(t, apiURL, creatorToken)
	if doc.Version != 5 || doc.Items[0].ItemUID != arrayItemResult.ItemUID || doc.Items[1].ItemUID != createdItem.ItemUID {
		t.Fatal("order not applied")
	}
	partialOrder := sendJSON(t, http.MethodPut, apiURL+"/items/order", creatorToken, map[string]any{
		"version": doc.Version, "changeReason": "일부만", "itemUids": []string{createdItem.ItemUID},
	})
	if codeIn(t, readBody(t, partialOrder)) != "ITEM_SET_CHANGED" || getSpec(t, apiURL, creatorToken).Version != 5 || len(getSpec(t, apiURL, creatorToken).Items) != 2 {
		t.Fatal("partial order changed items")
	}

	missing := sendJSON(t, http.MethodPut, apiURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(5, "필수 누락", endpointPayload("PUT", "/devices/{deviceId}", []any{speed}, "MANUAL", map[string]any{})))
	if codeIn(t, readBody(t, missing)) != "EXAMPLE_SCHEMA_MISMATCH" || getSpec(t, apiURL, creatorToken).Version != 5 {
		t.Fatal("missing required was stored")
	}
	wrong := sendJSON(t, http.MethodPut, apiURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(5, "타입 불일치", endpointPayload("PUT", "/devices/{deviceId}", []any{speed}, "MANUAL", map[string]any{"speed": "fast"})))
	if codeIn(t, readBody(t, wrong)) != "EXAMPLE_SCHEMA_MISMATCH" {
		t.Fatal("type mismatch was stored")
	}
	unknown := sendJSON(t, http.MethodPut, apiURL+"/items/"+createdItem.ItemUID, creatorToken, itemBody(5, "없는 필드", endpointPayload("PUT", "/devices/{deviceId}", []any{speed}, "MANUAL", map[string]any{"speed": 10, "extra": true})))
	if codeIn(t, readBody(t, unknown)) != "EXAMPLE_SCHEMA_MISMATCH" || itemByUID(getSpec(t, apiURL, creatorToken), createdItem.ItemUID).Payload.Path != "/devices/{deviceId}" {
		t.Fatal("unknown field was stored")
	}
	codes := sendJSON(t, http.MethodPut, apiURL+"/items/"+createdItem.ItemUID, creatorToken, map[string]any{
		"version": 5, "changeReason": "코드", "name": "수정 Endpoint", "summary": "", "status": "ACTIVE",
		"payload": updatedPath, "errorCodeIds": []int{9},
	})
	if codes.StatusCode != http.StatusBadRequest {
		t.Fatal("error code ids accepted")
	}

	stale := sendJSON(t, http.MethodPut, apiURL+"/items/"+arrayItemResult.ItemUID, creatorToken, itemBody(4, "옛 버전", endpointPayload("DELETE", "/stale", []any{}, "AUTO", nil)))
	staleBody := readBody(t, stale)
	if codeIn(t, staleBody) != "DOCUMENT_VERSION_CONFLICT" || fieldOf(t, staleBody, "currentVersion") != "5" {
		t.Fatalf("conflict %s", staleBody)
	}
	doc = getSpec(t, apiURL, creatorToken)
	if doc.Version != 5 || itemByUID(doc, arrayItemResult.ItemUID).Payload.Method != "GET" {
		t.Fatal("conflict changed data")
	}

	var left, right struct {
		status int
		body   string
	}
	var wait sync.WaitGroup
	wait.Add(2)
	go func() {
		defer wait.Done()
		left.status, left.body = httpJSON(http.MethodPost, apiURL+"/items", creatorToken, itemBody(5, "동시 A", endpointPayload("POST", "/left", []any{}, "AUTO", nil)))
	}()
	go func() {
		defer wait.Done()
		right.status, right.body = httpJSON(http.MethodPost, apiURL+"/items", creatorToken, itemBody(5, "동시 B", endpointPayload("POST", "/right", []any{}, "AUTO", nil)))
	}()
	wait.Wait()
	success := 0
	conflict := 0
	for _, result := range []struct {
		status int
		body   string
	}{left, right} {
		if result.status == http.StatusCreated {
			success++
		}
		if codeIn(t, result.body) == "DOCUMENT_VERSION_CONFLICT" {
			conflict++
		}
	}
	doc = getSpec(t, apiURL, creatorToken)
	if success != 1 || conflict != 1 || doc.Version != 6 || len(doc.Items) != 3 {
		t.Fatalf("concurrent success %d conflict %d version %d items %d", success, conflict, doc.Version, len(doc.Items))
	}

	removedUID := arrayItemResult.ItemUID
	deleted := sendJSON(t, http.MethodDelete, apiURL+"/items/"+removedUID, creatorToken, map[string]any{
		"version": doc.Version, "changeReason": "항목 삭제",
	})
	if deleted.StatusCode != http.StatusOK {
		t.Fatalf("delete %d %s", deleted.StatusCode, readBody(t, deleted))
	}
	doc = getSpec(t, apiURL, creatorToken)
	if doc.Version != 7 || itemByUID(doc, removedUID).ItemUID != "" {
		t.Fatal("deleted item remains")
	}
	revisions := sendJSON(t, http.MethodGet, apiURL+"/revisions", readerToken, nil)
	revisionBody := readBody(t, revisions)
	if revisions.StatusCode != http.StatusOK || !containsText(revisionBody, "CREATE_DOCUMENT") || !containsText(revisionBody, "DELETE_ITEM") {
		t.Fatalf("revisions %d", revisions.StatusCode)
	}
	compare := sendJSON(t, http.MethodGet, apiURL+"/revisions/compare?from=1&to=2", readerToken, nil)
	compareBody := readBody(t, compare)
	if compare.StatusCode != http.StatusOK || !containsText(compareBody, createdItem.ItemUID) || !containsText(compareBody, `"items":[]`) {
		t.Fatalf("snapshot %d %s", compare.StatusCode, compareBody)
	}

	readerGet := sendJSON(t, http.MethodGet, apiURL, readerToken, nil)
	readerWrite := sendJSON(t, http.MethodPost, apiURL+"/items", readerToken, itemBody(doc.Version, "조회자 수정", endpointPayload("GET", "/reader", []any{}, "AUTO", nil)))
	if readerGet.StatusCode != http.StatusOK || readerWrite.StatusCode != http.StatusForbidden {
		t.Fatalf("reader get %d write %d", readerGet.StatusCode, readerWrite.StatusCode)
	}
	titleDenied := sendJSON(t, http.MethodPut, base, writerToken, map[string]any{
		"version": project.Version, "title": "편집자 제목", "description": "spec-" + suffix, "status": "ACTIVE",
	})
	writerItem := sendJSON(t, http.MethodPost, apiURL+"/items", writerToken, itemBody(doc.Version, "편집자 추가", endpointPayload("PATCH", "/writer", []any{}, "AUTO", nil)))
	if titleDenied.StatusCode != http.StatusForbidden || writerItem.StatusCode != http.StatusCreated {
		t.Fatalf("writer title %d spec %d", titleDenied.StatusCode, writerItem.StatusCode)
	}
	doc = getSpec(t, apiURL, writerToken)
	outsiderGet := sendJSON(t, http.MethodGet, apiURL, outsiderToken, nil)
	if outsiderGet.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider %d", outsiderGet.StatusCode)
	}
	overview := map[string]any{
		"baseUrl": "https://lab.local",
		"auth":    map[string]any{"type": "BEARER", "description": ""},
		"commonHeaders": []any{
			specField("Authorization", "string", true, "Bearer token", []any{}, nil),
		},
	}
	patched := sendJSON(t, http.MethodPatch, apiURL, writerToken, map[string]any{
		"version": doc.Version, "changeReason": "Base URL 변경", "title": "API 규격", "overview": overview,
	})
	if patched.StatusCode != http.StatusOK {
		t.Fatalf("overview %d %s", patched.StatusCode, readBody(t, patched))
	}
	staleOverview := sendJSON(t, http.MethodPatch, apiURL, writerToken, map[string]any{
		"version": doc.Version, "changeReason": "다시", "title": "API 규격", "overview": overview,
	})
	if codeIn(t, readBody(t, staleOverview)) != "DOCUMENT_VERSION_CONFLICT" {
		t.Fatal("overview conflict")
	}
	stored := readBody(t, sendJSON(t, http.MethodGet, apiURL, readerToken, nil))
	if !containsText(stored, "https://lab.local") || !containsText(stored, "Authorization") {
		t.Fatal("overview not stored")
	}
	doc = getSpec(t, apiURL, readerToken)
	markdownRes := sendJSON(t, http.MethodGet, apiURL+"/markdown", readerToken, nil)
	markdownBody := readBody(t, markdownRes)
	if markdownRes.StatusCode != http.StatusOK || !strings.Contains(markdownRes.Header.Get("Content-Type"), "text/markdown") {
		t.Fatalf("markdown %d %s", markdownRes.StatusCode, markdownRes.Header.Get("Content-Type"))
	}
	if markdownRes.Header.Get("Content-Disposition") != "" || !strings.Contains(markdownRes.Header.Get("X-Markdown-Filename"), "-API-v") {
		t.Fatalf("markdown header disposition %q filename %q", markdownRes.Header.Get("Content-Disposition"), markdownRes.Header.Get("X-Markdown-Filename"))
	}
	if !containsText(markdownBody, "https://lab.local") || !containsText(markdownBody, "PUT /devices/{deviceId}") || !containsText(markdownBody, "| speed |") || !containsText(markdownBody, "Authorization") {
		t.Fatalf("markdown body missing stored fields")
	}
	if containsText(markdownBody, "items[].id") {
		t.Fatal("markdown included a deleted endpoint")
	}
	if getSpec(t, apiURL, readerToken).Version != doc.Version {
		t.Fatal("markdown changed version")
	}
	if sendJSON(t, http.MethodGet, apiURL+"/markdown", outsiderToken, nil).StatusCode != http.StatusForbidden {
		t.Fatal("outsider markdown")
	}

	archived := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{
		"version": project.Version, "title": "규격 검증 " + suffix, "description": "spec-" + suffix, "status": "ARCHIVED",
	})
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d %s", archived.StatusCode, readBody(t, archived))
	}
	archivedWrite := sendJSON(t, http.MethodPost, apiURL+"/items", creatorToken, itemBody(doc.Version, "보관 중", endpointPayload("GET", "/archived", []any{}, "AUTO", nil)))
	archivedRead := sendJSON(t, http.MethodGet, apiURL, readerToken, nil)
	if codeIn(t, readBody(t, archivedWrite)) != "PROJECT_ARCHIVED" || archivedRead.StatusCode != http.StatusOK {
		t.Fatal("archived policy failed")
	}
	if sendJSON(t, http.MethodGet, apiURL+"/markdown", readerToken, nil).StatusCode != http.StatusOK {
		t.Fatal("archived markdown")
	}
	if sendJSON(t, http.MethodGet, apiURL+"/revisions", readerToken, nil).StatusCode != http.StatusOK {
		t.Fatal("archived revisions")
	}

	reopened, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("reopen")
	}
	defer repository.Close(reopened)
	again := newProjectServer(t, reopened)
	persisted := sendJSON(t, http.MethodGet, projectURL(again.URL, project.ID)+"/specs/API", loginEmployee(t, again.URL, reader.EmployeeNo, password), nil)
	persistedBody := readBody(t, persisted)
	if persisted.StatusCode != http.StatusOK || !containsText(persistedBody, "/writer") || !containsText(persistedBody, doc.Items[0].ItemUID) {
		t.Fatalf("persisted %d", persisted.StatusCode)
	}
}

type specDocumentJSON struct {
	Version uint           `json:"version"`
	Items   []specItemJSON `json:"items"`
}

type specItemJSON struct {
	ItemUID string `json:"itemUid"`
	Payload struct {
		Method      string `json:"method"`
		Path        string `json:"path"`
		RequestBody struct {
			Example map[string]any `json:"example"`
		} `json:"requestBody"`
	} `json:"payload"`
}

func getSpec(t *testing.T, url, token string) specDocumentJSON {
	t.Helper()
	res := sendJSON(t, http.MethodGet, url, token, nil)
	body := readBody(t, res)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get spec %d %s", res.StatusCode, body)
	}
	var doc specDocumentJSON
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func itemByUID(doc specDocumentJSON, uid string) specItemJSON {
	for _, item := range doc.Items {
		if item.ItemUID == uid {
			return item
		}
	}
	return specItemJSON{}
}

func itemBody(version uint, name string, payload any) map[string]any {
	return map[string]any{
		"version": version, "changeReason": name, "name": name, "summary": "", "status": "ACTIVE",
		"payload": payload, "errorCodeIds": []any{},
	}
}

func endpointPayload(method, path string, fields []any, mode string, example any) map[string]any {
	return map[string]any{
		"method": method, "path": path, "description": "",
		"auth":        map[string]any{"type": "NONE", "description": "", "useDocumentAuth": false},
		"headers":     []any{},
		"pathParams":  []any{},
		"queryParams": []any{},
		"requestBody": map[string]any{"contentType": "application/json", "fields": fields, "exampleMode": mode, "example": example},
		"responses":   []any{map[string]any{"name": "성공", "status": 200, "description": "", "fields": []any{}, "exampleMode": "AUTO", "example": nil}},
	}
}

func specField(name, kind string, required bool, example string, children []any, arrayItem any) map[string]any {
	return map[string]any{
		"name": name, "type": kind, "required": required, "nullable": false,
		"description": "", "example": example, "format": "", "enum": []any{},
		"children": children, "arrayItem": arrayItem,
	}
}

func fieldOf(t *testing.T, body, key string) string {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	return stringify(payload[key])
}

func stringify(value any) string {
	raw, _ := json.Marshal(value)
	if len(raw) >= 2 && raw[0] == '"' {
		var text string
		_ = json.Unmarshal(raw, &text)
		return text
	}
	return string(raw)
}

func containsText(body, part string) bool {
	return bytes.Contains([]byte(body), []byte(part))
}

func httpJSON(method, url, token string, payload any) (int, string) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, ""
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(raw))
	if err != nil {
		return 0, ""
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, ""
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body)
}

func TestMQTTSpecOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupSpecFixture(t, gdb, suffix) })
	password := "mqtt-" + randomToken(t)
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	creator := makeUser(t, accounts, "s4c"+suffix, "MQTT생성", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "MQTT조회", "MEMBER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title": "MQTT 검증 " + suffix, "description": "mqtt-" + suffix,
	})
	if createdProject.StatusCode != http.StatusCreated {
		t.Fatalf("project %d", createdProject.StatusCode)
	}
	var project struct {
		ID uint64 `json:"id"`
	}
	if err := json.Unmarshal([]byte(readBody(t, createdProject)), &project); err != nil {
		t.Fatal(err)
	}
	base := projectURL(server.URL, project.ID)
	added := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{"employeeNo": reader.EmployeeNo, "permission": "READ"})
	if added.StatusCode != http.StatusCreated {
		t.Fatal(readBody(t, added))
	}
	api := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "API", "title": "API 규격"})
	if api.StatusCode != http.StatusCreated {
		t.Fatal(readBody(t, api))
	}
	apiItem := sendJSON(t, http.MethodPost, base+"/specs/API/items", creatorToken, itemBody(1, "기존 API", endpointPayload("GET", "/health", []any{}, "AUTO", nil)))
	if apiItem.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, apiItem), "version") != "2" {
		t.Fatalf("api item %d %s", apiItem.StatusCode, readBody(t, apiItem))
	}

	created := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "MQTT", "title": "MQTT 규격"})
	if created.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, created), "version") != "1" {
		t.Fatalf("mqtt document %d %s", created.StatusCode, readBody(t, created))
	}
	duplicate := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "MQTT", "title": "중복"})
	if codeIn(t, readBody(t, duplicate)) != "SPEC_KIND_ALREADY_EXISTS" {
		t.Fatal("duplicate mqtt")
	}
	heartbeat := sendJSON(t, http.MethodPost, base+"/specs/MQTT/items", creatorToken, mqttBody(1, "heartbeat", "gateway/+/heartbeat", 0, false, "DEVICE_TO_SERVER", nil))
	heartbeatBody := readBody(t, heartbeat)
	if heartbeat.StatusCode != http.StatusCreated {
		t.Fatalf("heartbeat %d %s", heartbeat.StatusCode, heartbeatBody)
	}
	var first struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(heartbeatBody), &first); err != nil || first.Version != 2 {
		t.Fatal(heartbeatBody)
	}
	event := sendJSON(t, http.MethodPost, base+"/specs/MQTT/items", creatorToken, mqttBody(first.Version, "event", "gateway/+/doorlock/+/event", 1, false, "DEVICE_TO_SERVER", first.ItemUID))
	eventBody := readBody(t, event)
	if event.StatusCode != http.StatusCreated {
		t.Fatalf("event %d %s", event.StatusCode, eventBody)
	}
	var second struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(eventBody), &second); err != nil || second.Version != 3 {
		t.Fatal(eventBody)
	}
	command := sendJSON(t, http.MethodPost, base+"/specs/MQTT/items", creatorToken, mqttBody(second.Version, "command", "gateway/{gatewayId}/doorlock/{doorlockcd}/command", 2, true, "SERVER_TO_DEVICE", nil))
	if command.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, command), "version") != "4" {
		t.Fatalf("command %d %s", command.StatusCode, readBody(t, command))
	}
	doc := getSpec(t, base+"/specs/MQTT", creatorToken)
	if doc.Version != 4 || len(doc.Items) != 3 || getSpec(t, base+"/specs/API", creatorToken).Version != 2 {
		t.Fatalf("versions mqtt=%d api=%d", doc.Version, getSpec(t, base+"/specs/API", creatorToken).Version)
	}
	stored := itemByUID(doc, second.ItemUID)
	device, _ := stored.Payload.RequestBody.Example["device"].(map[string]any)
	if stored.Payload.Path != "" || device != nil {
		t.Fatal("mqtt item was read as an api payload")
	}
	raw := sendJSON(t, http.MethodGet, base+"/specs/MQTT", creatorToken, nil)
	body := readBody(t, raw)
	if !containsText(body, "gateway/+/doorlock/+/event") || !containsText(body, `"qos":1`) || !containsText(body, `"retain":false`) {
		t.Fatalf("stored mqtt %s", body)
	}
	updated := sendJSON(t, http.MethodPut, base+"/specs/MQTT/items/"+first.ItemUID, creatorToken, mqttBody(4, "heartbeat", "gateway/+/heartbeat", 1, true, "DEVICE_TO_SERVER", nil))
	if updated.StatusCode != http.StatusOK || fieldOf(t, readBody(t, updated), "version") != "5" {
		t.Fatalf("update %d %s", updated.StatusCode, readBody(t, updated))
	}
	blockedDelete := sendJSON(t, http.MethodDelete, base+"/specs/MQTT/items/"+first.ItemUID, creatorToken, map[string]any{"version": 5, "changeReason": "참조 중 삭제"})
	if blockedDelete.StatusCode != http.StatusBadRequest || getSpec(t, base+"/specs/MQTT", creatorToken).Version != 5 {
		t.Fatalf("referenced delete %d", blockedDelete.StatusCode)
	}
	current := getSpec(t, base+"/specs/MQTT", creatorToken)
	uids := []string{current.Items[2].ItemUID, current.Items[1].ItemUID, current.Items[0].ItemUID}
	reordered := sendJSON(t, http.MethodPut, base+"/specs/MQTT/items/order", creatorToken, map[string]any{"version": current.Version, "changeReason": "순서", "itemUids": uids})
	if reordered.StatusCode != http.StatusOK {
		t.Fatalf("reorder %d %s", reordered.StatusCode, readBody(t, reordered))
	}
	current = getSpec(t, base+"/specs/MQTT", creatorToken)
	removed := sendJSON(t, http.MethodDelete, base+"/specs/MQTT/items/"+current.Items[0].ItemUID, creatorToken, map[string]any{"version": current.Version, "changeReason": "command 삭제"})
	if removed.StatusCode != http.StatusOK {
		t.Fatalf("delete %d %s", removed.StatusCode, readBody(t, removed))
	}
	if getSpec(t, base+"/specs/API", creatorToken).Version != 2 {
		t.Fatal("api version changed")
	}
	stale := sendJSON(t, http.MethodPut, base+"/specs/MQTT/items/"+second.ItemUID, creatorToken, mqttBody(1, "event", "gateway/+/doorlock/+/event", 1, false, "DEVICE_TO_SERVER", first.ItemUID))
	if codeIn(t, readBody(t, stale)) != "DOCUMENT_VERSION_CONFLICT" {
		t.Fatal("conflict")
	}
	markdownVersion := getSpec(t, base+"/specs/MQTT", creatorToken).Version
	status, markdown := httpJSON(http.MethodGet, base+"/specs/MQTT/markdown", readerToken, nil)
	if status != http.StatusOK || !containsText(markdown, "gateway/+/heartbeat") || !containsText(markdown, "QoS: 1") || !containsText(markdown, "Retain: true") || !containsText(markdown, "device.locks[].code") {
		t.Fatalf("markdown %d %s", status, markdown)
	}
	if getSpec(t, base+"/specs/MQTT", readerToken).Version != markdownVersion {
		t.Fatal("markdown changed version")
	}
	outsider := makeUser(t, accounts, "s4o"+suffix, "MQTT외부", "MEMBER", password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)
	if status, _ := httpJSON(http.MethodGet, base+"/specs/MQTT", outsiderToken, nil); status != http.StatusForbidden {
		t.Fatalf("outsider %d", status)
	}
	archived := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{"version": 1, "title": "MQTT 검증 " + suffix, "description": "mqtt-" + suffix, "status": "ARCHIVED"})
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d %s", archived.StatusCode, readBody(t, archived))
	}
	write := sendJSON(t, http.MethodPost, base+"/specs/MQTT/items", creatorToken, mqttBody(markdownVersion, "blocked", "lab/blocked", 0, false, "BIDIRECTIONAL", nil))
	if codeIn(t, readBody(t, write)) != "PROJECT_ARCHIVED" || getSpec(t, base+"/specs/MQTT", readerToken).Version != markdownVersion {
		t.Fatal("archived write")
	}
}

func mqttBody(version uint, name, topic string, qos int, retain bool, direction string, related any) map[string]any {
	lock := specField("code", "string", true, "OPEN", []any{}, nil)
	locks := specField("locks", "array", true, "", []any{}, specField("item", "object", true, "", []any{lock}, nil))
	device := specField("device", "object", true, "", []any{locks}, nil)
	return map[string]any{
		"version": version, "changeReason": name, "name": name, "summary": topic, "status": "ACTIVE", "errorCodeIds": []any{},
		"payload": map[string]any{
			"topic": topic, "qos": qos, "retain": retain, "direction": direction,
			"publishers": []string{"gateway"}, "subscribers": []string{"server"}, "purpose": "검증",
			"payloadFields": []any{device}, "exampleMode": "AUTO", "example": nil, "relatedItemUid": related,
		},
	}
}

func TestWebSocketSpecOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupSpecFixture(t, gdb, suffix) })
	password := "ws-" + randomToken(t)
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	creator := makeUser(t, accounts, "s4c"+suffix, "WS생성", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "WS조회", "MEMBER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title": "WS 검증 " + suffix, "description": "ws-" + suffix,
	})
	if createdProject.StatusCode != http.StatusCreated {
		t.Fatalf("project %d", createdProject.StatusCode)
	}
	var project struct {
		ID uint64 `json:"id"`
	}
	if err := json.Unmarshal([]byte(readBody(t, createdProject)), &project); err != nil {
		t.Fatal(err)
	}
	base := projectURL(server.URL, project.ID)
	if sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{"employeeNo": reader.EmployeeNo, "permission": "READ"}).StatusCode != http.StatusCreated {
		t.Fatal("member")
	}
	if sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "API", "title": "API 규격"}).StatusCode != http.StatusCreated {
		t.Fatal("api doc")
	}
	if sendJSON(t, http.MethodPost, base+"/specs/API/items", creatorToken, itemBody(1, "기존 API", endpointPayload("GET", "/health", []any{}, "AUTO", nil))).StatusCode != http.StatusCreated {
		t.Fatal("api item")
	}
	if sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "MQTT", "title": "MQTT 규격"}).StatusCode != http.StatusCreated {
		t.Fatal("mqtt doc")
	}
	if sendJSON(t, http.MethodPost, base+"/specs/MQTT/items", creatorToken, mqttBody(1, "heartbeat", "lab/status", 0, false, "DEVICE_TO_SERVER", nil)).StatusCode != http.StatusCreated {
		t.Fatal("mqtt item")
	}
	created := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "WEBSOCKET", "title": "WebSocket 규격"})
	if created.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, created), "version") != "1" {
		t.Fatalf("ws document %d %s", created.StatusCode, readBody(t, created))
	}
	if codeIn(t, readBody(t, sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "WEBSOCKET", "title": "중복"}))) != "SPEC_KIND_ALREADY_EXISTS" {
		t.Fatal("duplicate websocket")
	}
	overview := sendJSON(t, http.MethodPatch, base+"/specs/WEBSOCKET", creatorToken, map[string]any{
		"version": 1, "changeReason": "연결", "title": "WebSocket 규격",
		"overview": map[string]any{
			"url": "wss://lab.example/ws", "heartbeat": "30초마다 ping",
			"auth":       map[string]string{"type": "BEARER", "description": "연결 토큰"},
			"closeCodes": []any{map[string]any{"code": 4001, "description": "인증 만료"}},
		},
	})
	if overview.StatusCode != http.StatusOK || fieldOf(t, readBody(t, overview), "version") != "2" {
		t.Fatalf("overview %d %s", overview.StatusCode, readBody(t, overview))
	}
	execute := sendJSON(t, http.MethodPost, base+"/specs/WEBSOCKET/items", creatorToken, wsBody(2, "명령 실행", "command.execute", "CLIENT_TO_SERVER", "REQUEST", nil))
	executeBody := readBody(t, execute)
	if execute.StatusCode != http.StatusCreated {
		t.Fatalf("execute %d %s", execute.StatusCode, executeBody)
	}
	var first struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(executeBody), &first); err != nil || first.Version != 3 {
		t.Fatal(executeBody)
	}
	result := sendJSON(t, http.MethodPost, base+"/specs/WEBSOCKET/items", creatorToken, wsBody(first.Version, "명령 결과", "command.result", "SERVER_TO_CLIENT", "RESPONSE", first.ItemUID))
	resultBody := readBody(t, result)
	if result.StatusCode != http.StatusCreated {
		t.Fatalf("result %d %s", result.StatusCode, resultBody)
	}
	var second struct {
		Version uint   `json:"version"`
		ItemUID string `json:"itemUid"`
	}
	if err := json.Unmarshal([]byte(resultBody), &second); err != nil || second.Version != 4 {
		t.Fatal(resultBody)
	}
	ping := sendJSON(t, http.MethodPost, base+"/specs/WEBSOCKET/items", creatorToken, wsBody(second.Version, "세션 ping", "session.ping", "CLIENT_TO_SERVER", "EVENT", nil))
	if ping.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, ping), "version") != "5" {
		t.Fatalf("ping %d %s", ping.StatusCode, readBody(t, ping))
	}
	if getSpec(t, base+"/specs/API", creatorToken).Version != 2 || getSpec(t, base+"/specs/MQTT", creatorToken).Version != 2 {
		t.Fatal("other versions changed")
	}
	raw := readBody(t, sendJSON(t, http.MethodGet, base+"/specs/WEBSOCKET", creatorToken, nil))
	if !containsText(raw, "command.execute") || !containsText(raw, "SERVER_TO_CLIENT") || !containsText(raw, `"messageKind":"EVENT"`) {
		t.Fatalf("stored %s", raw)
	}
	executeUpdate := wsBody(5, "명령 실행", "command.execute", "CLIENT_TO_SERVER", "REQUEST", nil)
	executeUpdate["summary"] = "명령 실행 요청"
	updated := sendJSON(t, http.MethodPut, base+"/specs/WEBSOCKET/items/"+first.ItemUID, creatorToken, executeUpdate)
	if updated.StatusCode != http.StatusOK || fieldOf(t, readBody(t, updated), "version") != "6" {
		t.Fatalf("update %d %s", updated.StatusCode, readBody(t, updated))
	}
	blocked := sendJSON(t, http.MethodDelete, base+"/specs/WEBSOCKET/items/"+first.ItemUID, creatorToken, map[string]any{"version": 6, "changeReason": "참조 중 삭제"})
	if blocked.StatusCode != http.StatusBadRequest || getSpec(t, base+"/specs/WEBSOCKET", creatorToken).Version != 6 {
		t.Fatalf("referenced delete %d", blocked.StatusCode)
	}
	current := getSpec(t, base+"/specs/WEBSOCKET", creatorToken)
	uids := []string{current.Items[2].ItemUID, current.Items[1].ItemUID, current.Items[0].ItemUID}
	reordered := sendJSON(t, http.MethodPut, base+"/specs/WEBSOCKET/items/order", creatorToken, map[string]any{"version": current.Version, "changeReason": "순서", "itemUids": uids})
	if reordered.StatusCode != http.StatusOK {
		t.Fatalf("reorder %d %s", reordered.StatusCode, readBody(t, reordered))
	}
	current = getSpec(t, base+"/specs/WEBSOCKET", creatorToken)
	removed := sendJSON(t, http.MethodDelete, base+"/specs/WEBSOCKET/items/"+current.Items[0].ItemUID, creatorToken, map[string]any{"version": current.Version, "changeReason": "ping 삭제"})
	if removed.StatusCode != http.StatusOK {
		t.Fatalf("delete %d %s", removed.StatusCode, readBody(t, removed))
	}
	stale := sendJSON(t, http.MethodPut, base+"/specs/WEBSOCKET/items/"+second.ItemUID, creatorToken, wsBody(1, "명령 결과", "command.result", "SERVER_TO_CLIENT", "RESPONSE", first.ItemUID))
	if codeIn(t, readBody(t, stale)) != "DOCUMENT_VERSION_CONFLICT" {
		t.Fatal("conflict")
	}
	markdownVersion := getSpec(t, base+"/specs/WEBSOCKET", creatorToken).Version
	status, markdown := httpJSON(http.MethodGet, base+"/specs/WEBSOCKET/markdown", readerToken, nil)
	if status != http.StatusOK || !containsText(markdown, "wss://lab.example/ws") || !containsText(markdown, "클라이언트 → 서버") || !containsText(markdown, "command.args[].name") || !containsText(markdown, "4001") {
		t.Fatalf("markdown %d %s", status, markdown)
	}
	if getSpec(t, base+"/specs/WEBSOCKET", readerToken).Version != markdownVersion || getSpec(t, base+"/specs/API", creatorToken).Version != 2 || getSpec(t, base+"/specs/MQTT", creatorToken).Version != 2 {
		t.Fatal("version changed")
	}
	outsider := makeUser(t, accounts, "s4o"+suffix, "WS외부", "MEMBER", password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)
	if status, _ := httpJSON(http.MethodGet, base+"/specs/WEBSOCKET", outsiderToken, nil); status != http.StatusForbidden {
		t.Fatalf("outsider %d", status)
	}
	archived := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{"version": 1, "title": "WS 검증 " + suffix, "description": "ws-" + suffix, "status": "ARCHIVED"})
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d %s", archived.StatusCode, readBody(t, archived))
	}
	write := sendJSON(t, http.MethodPost, base+"/specs/WEBSOCKET/items", creatorToken, wsBody(markdownVersion, "막힘", "lab.blocked", "BIDIRECTIONAL", "EVENT", nil))
	if codeIn(t, readBody(t, write)) != "PROJECT_ARCHIVED" {
		t.Fatal("archived write")
	}
}

func wsBody(version uint, name, eventName, direction, kind string, related any) map[string]any {
	arg := specField("name", "string", true, "start", []any{}, nil)
	args := specField("args", "array", true, "", []any{}, specField("item", "object", true, "", []any{arg}, nil))
	command := specField("command", "object", true, "", []any{args}, nil)
	return map[string]any{
		"version": version, "changeReason": name, "name": name, "summary": eventName, "status": "ACTIVE", "errorCodeIds": []any{},
		"payload": map[string]any{
			"eventName": eventName, "direction": direction, "messageKind": kind,
			"description": "클라이언트가 명령을 보낼 때", "fields": []any{command},
			"exampleMode": "AUTO", "example": nil, "relatedItemUid": related,
		},
	}
}

func cleanupSpecFixture(t *testing.T, gdb *gorm.DB, suffix string) {
	t.Helper()
	sqlDB, err := repository.SQLDB(gdb)
	if err != nil {
		repository.Close(gdb)
		return
	}
	ctx := context.Background()
	pattern := "s4%" + suffix
	statements := []string{
		`DELETE FROM spec_item_error_codes WHERE spec_item_id IN (
			SELECT id FROM (
				SELECT i.id FROM spec_items i
				JOIN spec_documents d ON d.id = i.document_id
				JOIN projects p ON p.id = d.project_id
				JOIN users u ON u.id = p.created_by
				WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM error_code_revisions WHERE error_code_id IN (
			SELECT id FROM (
				SELECT e.id FROM error_codes e
				JOIN projects p ON p.id = e.project_id
				JOIN users u ON u.id = p.created_by
				WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM error_codes WHERE project_id IN (
			SELECT id FROM (
				SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM general_document_revisions WHERE document_id IN (
			SELECT id FROM (
				SELECT d.id FROM general_documents d
				JOIN projects p ON p.id = d.project_id
				JOIN users u ON u.id = p.created_by
				WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM general_documents WHERE project_id IN (
			SELECT id FROM (
				SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM spec_document_revisions WHERE document_id IN (
			SELECT id FROM (
				SELECT d.id FROM spec_documents d
				JOIN projects p ON p.id = d.project_id
				JOIN users u ON u.id = p.created_by
				WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM spec_items WHERE document_id IN (
			SELECT id FROM (
				SELECT d.id FROM spec_documents d
				JOIN projects p ON p.id = d.project_id
				JOIN users u ON u.id = p.created_by
				WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM spec_documents WHERE project_id IN (
			SELECT id FROM (
				SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM project_members WHERE project_id IN (
			SELECT id FROM (
				SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.employee_no LIKE ?
			) AS ids)`,
		`DELETE FROM projects WHERE created_by IN (SELECT id FROM (SELECT id FROM users WHERE employee_no LIKE ?) AS ids)`,
		`DELETE FROM users WHERE employee_no LIKE ?`,
	}
	for _, statement := range statements {
		if _, err := sqlDB.ExecContext(ctx, statement, pattern); err != nil {
			t.Errorf("cleanup failed")
		}
	}
	repository.Close(gdb)
}
