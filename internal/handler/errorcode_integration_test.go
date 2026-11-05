package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/repository"
	"interface-hub/internal/service"
)

func TestErrorCodesOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	if (cfg.Database.Host != "127.0.0.1" && cfg.Database.Host != "localhost") || cfg.Database.Name != "interface_hub" {
		t.Fatal("refusing to run outside local interface_hub")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupSpecFixture(t, gdb, suffix) })
	password := "err-" + randomToken(t)
	accounts := service.NewAccountService(repository.NewUserRepository(gdb))
	creator := makeUser(t, accounts, "s4c"+suffix, "코드생성", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "코드조회", "MEMBER", password)
	outsider := makeUser(t, accounts, "s4o"+suffix, "코드외부", "MEMBER", password)
	other := makeUser(t, accounts, "s4a"+suffix, "다른프로젝트", "MEMBER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)
	otherToken := loginEmployee(t, server.URL, other.EmployeeNo, password)

	firstProject := createNamedProject(t, server.URL, creatorToken, "오류 코드 "+suffix)
	secondProject := createNamedProject(t, server.URL, otherToken, "다른 오류 "+suffix)
	base := projectURL(server.URL, firstProject.ID)
	otherBase := projectURL(server.URL, secondProject.ID)
	if sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{
		"employeeNo": reader.EmployeeNo, "permission": "READ",
	}).StatusCode != http.StatusCreated {
		t.Fatal("member")
	}
	for _, kind := range []string{"API", "MQTT", "WEBSOCKET", "DEVICE_PROTOCOL"} {
		if sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": kind, "title": kind}).StatusCode != http.StatusCreated {
			t.Fatalf("spec %s", kind)
		}
	}
	general := createGeneralDoc(t, base+"/general-docs", creatorToken, "메모", "SW", "유지", "최초 작성")

	codesURL := base + "/error-codes"
	created := sendJSON(t, http.MethodPost, codesURL, creatorToken, errorCodeBody("DEVICE_OFFLINE", "장비", "연결 없음", "offline", "재시도", "최초 작성", 0))
	createdBody := readBody(t, created)
	if created.StatusCode != http.StatusCreated || fieldOf(t, createdBody, "version") != "1" {
		t.Fatalf("create %d %s", created.StatusCode, createdBody)
	}
	var code struct {
		ID      uint64 `json:"id"`
		Version uint   `json:"version"`
	}
	if err := json.Unmarshal([]byte(createdBody), &code); err != nil {
		t.Fatal(err)
	}
	duplicate := sendJSON(t, http.MethodPost, codesURL, creatorToken, errorCodeBody("DEVICE_OFFLINE", "장비", "중복", "", "", "중복", 0))
	if codeIn(t, readBody(t, duplicate)) != "ERROR_CODE_TAKEN" {
		t.Fatal("duplicate accepted")
	}
	otherCode := sendJSON(t, http.MethodPost, otherBase+"/error-codes", otherToken, errorCodeBody("DEVICE_OFFLINE", "장비", "다른 프로젝트", "", "", "최초 작성", 0))
	if otherCode.StatusCode != http.StatusCreated {
		t.Fatalf("other project %d", otherCode.StatusCode)
	}
	var foreign struct {
		ID uint64 `json:"id"`
	}
	if err := json.Unmarshal([]byte(readBody(t, otherCode)), &foreign); err != nil {
		t.Fatal(err)
	}

	updated := sendJSON(t, http.MethodPut, codesURL+"/"+u64(code.ID), creatorToken, errorCodeBody("DEVICE_OFFLINE", "장비", "장비가 연결되어 있지 않다", "연결 상태 offline", "연결 후 재시도", "설명 수정", 1))
	if updated.StatusCode != http.StatusOK || fieldOf(t, readBody(t, updated), "version") != "2" {
		t.Fatalf("update %d", updated.StatusCode)
	}
	for _, kind := range []string{"API", "MQTT", "WEBSOCKET", "DEVICE_PROTOCOL"} {
		if getSpec(t, base+"/specs/"+kind, creatorToken).Version != 1 {
			t.Fatalf("%s version changed by code edit", kind)
		}
	}
	if getGeneral(t, base+"/general-docs/"+u64(general.ID), creatorToken).Version != 1 {
		t.Fatal("general version changed")
	}

	apiItem := sendJSON(t, http.MethodPost, base+"/specs/API/items", creatorToken, itemBody(1, "상태", endpointPayload("GET", "/health", []any{}, "AUTO", nil)))
	if apiItem.StatusCode != http.StatusCreated {
		t.Fatal("api item")
	}
	var apiRef struct {
		ItemUID string `json:"itemUid"`
		Version uint   `json:"version"`
	}
	if err := json.Unmarshal([]byte(readBody(t, apiItem)), &apiRef); err != nil {
		t.Fatal(err)
	}
	linked := sendJSON(t, http.MethodPut, base+"/specs/API/items/"+apiRef.ItemUID, creatorToken, map[string]any{
		"version": apiRef.Version, "changeReason": "코드 연결", "name": "상태", "summary": "", "status": "ACTIVE",
		"payload": endpointPayload("GET", "/health", []any{}, "AUTO", nil), "errorCodeIds": []uint64{code.ID},
	})
	if linked.StatusCode != http.StatusOK || fieldOf(t, readBody(t, linked), "version") != "3" {
		t.Fatalf("link %d %s", linked.StatusCode, readBody(t, linked))
	}
	stored := readBody(t, sendJSON(t, http.MethodGet, base+"/specs/API", readerToken, nil))
	if !strings.Contains(stored, `"code":"DEVICE_OFFLINE"`) || !strings.Contains(stored, "장비가 연결되어 있지 않다") {
		t.Fatal("stored link")
	}
	missing := sendJSON(t, http.MethodPut, base+"/specs/API/items/"+apiRef.ItemUID, creatorToken, map[string]any{
		"version": 3, "changeReason": "없는 코드", "name": "상태", "summary": "", "status": "ACTIVE",
		"payload": endpointPayload("GET", "/health", []any{}, "AUTO", nil), "errorCodeIds": []uint64{code.ID + 900000},
	})
	if missing.StatusCode != http.StatusBadRequest || getSpec(t, base+"/specs/API", creatorToken).Version != 3 {
		t.Fatal("missing code accepted")
	}
	foreignLink := sendJSON(t, http.MethodPut, base+"/specs/API/items/"+apiRef.ItemUID, creatorToken, map[string]any{
		"version": 3, "changeReason": "다른 프로젝트", "name": "상태", "summary": "", "status": "ACTIVE",
		"payload": endpointPayload("GET", "/health", []any{}, "AUTO", nil), "errorCodeIds": []uint64{foreign.ID},
	})
	if foreignLink.StatusCode != http.StatusBadRequest {
		t.Fatal("foreign code accepted")
	}
	extras := []struct {
		kind string
		uid  string
	}{}
	for _, spec := range []struct {
		kind string
		body map[string]any
	}{
		{"MQTT", mqttBody(1, "상태", "lab/ui013/status", 0, false, "DEVICE_TO_SERVER", nil)},
		{"WEBSOCKET", wsBody(1, "상태", "session.ready", "CLIENT_TO_SERVER", "EVENT", nil)},
		{"DEVICE_PROTOCOL", itemBody(1, "시작", deviceCommand("0x10", "REQUEST", "", nil, deviceField("commandId", "integer", "16", 0, 1, "BIG", "UINT8")))},
	} {
		createdItem := sendJSON(t, http.MethodPost, base+"/specs/"+spec.kind+"/items", creatorToken, spec.body)
		if createdItem.StatusCode != http.StatusCreated {
			t.Fatalf("%s item %d %s", spec.kind, createdItem.StatusCode, readBody(t, createdItem))
		}
		var ref struct {
			ItemUID string `json:"itemUid"`
			Version uint   `json:"version"`
		}
		if err := json.Unmarshal([]byte(readBody(t, createdItem)), &ref); err != nil {
			t.Fatal(err)
		}
		spec.body["version"] = ref.Version
		spec.body["errorCodeIds"] = []uint64{code.ID}
		spec.body["changeReason"] = "코드 연결"
		linkedItem := sendJSON(t, http.MethodPut, base+"/specs/"+spec.kind+"/items/"+ref.ItemUID, creatorToken, spec.body)
		if linkedItem.StatusCode != http.StatusOK || !strings.Contains(readBody(t, sendJSON(t, http.MethodGet, base+"/specs/"+spec.kind, readerToken, nil)), `"code":"DEVICE_OFFLINE"`) {
			t.Fatalf("%s link %d", spec.kind, linkedItem.StatusCode)
		}
		extras = append(extras, struct {
			kind string
			uid  string
		}{spec.kind, ref.ItemUID})
	}
	inUse := sendJSON(t, http.MethodDelete, codesURL+"/"+u64(code.ID), creatorToken, map[string]any{"version": 2, "changeReason": "삭제"})
	if codeIn(t, readBody(t, inUse)) != "ERROR_CODE_IN_USE" {
		t.Fatal("in use delete")
	}
	markdown := readBody(t, sendJSON(t, http.MethodGet, base+"/specs/API/markdown", readerToken, nil))
	if !strings.Contains(markdown, "DEVICE_OFFLINE") || !strings.Contains(markdown, "연결 후 재시도") {
		t.Fatal("markdown")
	}
	sendJSON(t, http.MethodPut, codesURL+"/"+u64(code.ID), creatorToken, errorCodeBody("DEVICE_OFFLINE", "장비", "최신 설명", "연결 상태 offline", "연결 후 재시도", "설명만 변경", 2))
	if getSpec(t, base+"/specs/API", creatorToken).Version != 3 {
		t.Fatal("description changed spec version")
	}
	for _, extra := range extras {
		if getSpec(t, base+"/specs/"+extra.kind, creatorToken).Version != 3 {
			t.Fatalf("%s version changed by description", extra.kind)
		}
	}
	latestMarkdown := readBody(t, sendJSON(t, http.MethodGet, base+"/specs/API/markdown", readerToken, nil))
	if !strings.Contains(latestMarkdown, "최신 설명") {
		t.Fatal("markdown not current")
	}
	compare := readBody(t, sendJSON(t, http.MethodGet, base+"/specs/API/revisions/compare?from=2&to=3", readerToken, nil))
	if !strings.Contains(compare, "장비가 연결되어 있지 않다") || strings.Contains(compare, "최신 설명") {
		t.Fatal("snapshot followed current description")
	}

	cleared := sendJSON(t, http.MethodPut, base+"/specs/API/items/"+apiRef.ItemUID, creatorToken, map[string]any{
		"version": 3, "changeReason": "연결 해제", "name": "상태", "summary": "", "status": "ACTIVE",
		"payload": endpointPayload("GET", "/health", []any{}, "AUTO", nil), "errorCodeIds": []uint64{},
	})
	if cleared.StatusCode != http.StatusOK {
		t.Fatal("unlink")
	}
	for _, extra := range extras {
		body := map[string]any{"version": 3, "changeReason": "연결 해제", "name": "연결 해제", "summary": "", "status": "ACTIVE", "errorCodeIds": []uint64{}}
		switch extra.kind {
		case "MQTT":
			body = mqttBody(3, "상태", "lab/ui013/status", 0, false, "DEVICE_TO_SERVER", nil)
		case "WEBSOCKET":
			body = wsBody(3, "상태", "session.ready", "CLIENT_TO_SERVER", "EVENT", nil)
		default:
			body = itemBody(3, "시작", deviceCommand("0x10", "REQUEST", "", nil, deviceField("commandId", "integer", "16", 0, 1, "BIG", "UINT8")))
		}
		body["errorCodeIds"] = []uint64{}
		body["changeReason"] = "연결 해제"
		if sendJSON(t, http.MethodPut, base+"/specs/"+extra.kind+"/items/"+extra.uid, creatorToken, body).StatusCode != http.StatusOK {
			t.Fatalf("unlink %s", extra.kind)
		}
	}
	deleted := sendJSON(t, http.MethodDelete, codesURL+"/"+u64(code.ID), creatorToken, map[string]any{"version": 3, "changeReason": "미사용 정리"})
	deletedBody := readBody(t, deleted)
	if deleted.StatusCode != http.StatusOK || fieldOf(t, deletedBody, "version") != "4" {
		t.Fatalf("delete %d %s", deleted.StatusCode, deletedBody)
	}
	if strings.Contains(readBody(t, sendJSON(t, http.MethodGet, codesURL, readerToken, nil)), "DEVICE_OFFLINE") {
		t.Fatal("deleted code listed")
	}
	history := sendJSON(t, http.MethodGet, codesURL+"/"+u64(code.ID)+"/revisions", readerToken, nil)
	historyBody := readBody(t, history)
	if history.StatusCode != http.StatusOK || !strings.Contains(historyBody, "DELETE") {
		t.Fatal("history after delete")
	}
	if sendJSON(t, http.MethodPost, codesURL, readerToken, errorCodeBody("READ_ONLY", "권한", "조회", "", "", "시도", 0)).StatusCode != http.StatusForbidden {
		t.Fatal("reader write")
	}
	if sendJSON(t, http.MethodGet, codesURL, outsiderToken, nil).StatusCode != http.StatusForbidden {
		t.Fatal("outsider")
	}
	if sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{
		"version": firstProject.Version, "title": "오류 코드 " + suffix, "description": "codes", "status": "ARCHIVED",
	}).StatusCode != http.StatusOK {
		t.Fatal("archive")
	}
	if codeIn(t, readBody(t, sendJSON(t, http.MethodPost, codesURL, creatorToken, errorCodeBody("ARCHIVED", "보관", "금지", "", "", "시도", 0)))) != "PROJECT_ARCHIVED" {
		t.Fatal("archived write")
	}
	if sendJSON(t, http.MethodGet, codesURL+"/"+u64(code.ID)+"/revisions/compare?from=1&to=2", readerToken, nil).StatusCode != http.StatusOK {
		t.Fatal("archived compare")
	}
}

func createNamedProject(t *testing.T, base, token, title string) struct {
	ID      uint64 `json:"id"`
	Version uint   `json:"version"`
} {
	t.Helper()
	response := sendJSON(t, http.MethodPost, base+"/api/projects", token, map[string]string{"title": title, "description": "codes"})
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("project %d", response.StatusCode)
	}
	var project struct {
		ID      uint64 `json:"id"`
		Version uint   `json:"version"`
	}
	if err := json.Unmarshal([]byte(readBody(t, response)), &project); err != nil {
		t.Fatal(err)
	}
	return project
}

func errorCodeBody(code, category, description, condition, handling, reason string, version uint) map[string]any {
	body := map[string]any{
		"code": code, "category": category, "description": description,
		"conditionText": condition, "handling": handling, "changeReason": reason,
	}
	if version > 0 {
		body["version"] = version
	}
	return body
}
