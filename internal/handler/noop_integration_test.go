package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/repository"
	"interface-hub/internal/service"
)

func TestNoOpSaveOnMariaDB(t *testing.T) {
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
	password := "noop-" + randomToken(t)
	accounts := service.NewAccountService(repository.NewUserRepository(gdb))
	owner := makeUser(t, accounts, "s4n"+suffix, "무변경 검증", "MEMBER", password)
	server := newProjectServer(t, gdb)
	token := loginEmployee(t, server.URL, owner.EmployeeNo, password)

	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", token, map[string]string{
		"title": "무변경 저장 " + suffix, "description": "noop-" + suffix,
	})
	var project struct {
		ID uint64 `json:"id"`
	}
	if createdProject.StatusCode != http.StatusCreated || json.Unmarshal([]byte(readBody(t, createdProject)), &project) != nil {
		t.Fatalf("project %d", createdProject.StatusCode)
	}
	base := projectURL(server.URL, project.ID)
	if res := sendJSON(t, http.MethodPost, base+"/specs", token, map[string]string{"kind": "API", "title": "API"}); res.StatusCode != http.StatusCreated {
		t.Fatalf("spec %d", res.StatusCode)
	}
	apiURL := base + "/specs/API"
	revisionCount := func(url string) int {
		t.Helper()
		status, body := httpJSON(http.MethodGet, url, token, nil)
		var out struct {
			Revisions []json.RawMessage `json:"revisions"`
		}
		if status != http.StatusOK || json.Unmarshal([]byte(body), &out) != nil {
			t.Fatalf("revisions %d %s", status, body)
		}
		return len(out.Revisions)
	}
	versionOf := func(status int, body string, want int) uint {
		t.Helper()
		if status != want {
			t.Fatalf("status %d want %d: %s", status, want, body)
		}
		var out struct {
			Version uint `json:"version"`
		}
		if want == http.StatusOK || want == http.StatusCreated {
			if err := json.Unmarshal([]byte(body), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out.Version
	}

	payload := endpointPayload("POST", "/noop", []any{specField("id", "string", true, "a-1", []any{}, nil)}, "AUTO", nil)
	status, body := httpJSON(http.MethodPost, apiURL+"/items", token, itemBody(1, "첫 Endpoint", payload))
	version := versionOf(status, body, http.StatusCreated)
	var created struct {
		ItemUID string `json:"itemUid"`
	}
	_ = json.Unmarshal([]byte(body), &created)
	status, body = httpJSON(http.MethodPost, apiURL+"/items", token, itemBody(version, "둘째 Endpoint", endpointPayload("GET", "/noop", []any{}, "AUTO", nil)))
	version = versionOf(status, body, http.StatusCreated)
	var second struct {
		ItemUID string `json:"itemUid"`
	}
	_ = json.Unmarshal([]byte(body), &second)
	itemURL := apiURL + "/items/" + created.ItemUID
	revisions := revisionCount(apiURL + "/revisions")

	same := itemBody(version, "첫 Endpoint", payload)
	same["changeReason"] = ""
	same["name"] = "  첫 Endpoint  "
	status, body = httpJSON(http.MethodPut, itemURL, token, same)
	if got := versionOf(status, body, http.StatusOK); got != version {
		t.Fatalf("no-op item bumped version %d -> %d", version, got)
	}
	if revisionCount(apiURL+"/revisions") != revisions {
		t.Fatal("no-op item wrote a revision")
	}

	stale := itemBody(version-1, "첫 Endpoint", payload)
	stale["changeReason"] = ""
	status, body = httpJSON(http.MethodPut, itemURL, token, stale)
	versionOf(status, body, http.StatusConflict)

	changed := itemBody(version, "바뀐 Endpoint", payload)
	changed["changeReason"] = " "
	status, body = httpJSON(http.MethodPut, itemURL, token, changed)
	versionOf(status, body, http.StatusBadRequest)

	changed["changeReason"] = "이름 변경"
	status, body = httpJSON(http.MethodPut, itemURL, token, changed)
	if got := versionOf(status, body, http.StatusOK); got != version+1 {
		t.Fatalf("real change version %d", got)
	}
	version++
	if revisionCount(apiURL+"/revisions") != revisions+1 {
		t.Fatal("real change did not write a revision")
	}
	revisions++

	status, body = httpJSON(http.MethodGet, apiURL, token, nil)
	var doc struct {
		Title    string          `json:"title"`
		Overview json.RawMessage `json:"overview"`
	}
	if status != http.StatusOK || json.Unmarshal([]byte(body), &doc) != nil {
		t.Fatalf("get spec %d", status)
	}
	status, body = httpJSON(http.MethodPatch, apiURL, token, map[string]any{
		"version": version, "changeReason": "", "title": doc.Title, "overview": doc.Overview,
	})
	if got := versionOf(status, body, http.StatusOK); got != version {
		t.Fatalf("no-op overview bumped version %d", got)
	}
	status, body = httpJSON(http.MethodPut, apiURL+"/items/order", token, map[string]any{
		"version": version, "changeReason": "", "itemUids": []string{created.ItemUID, second.ItemUID},
	})
	if got := versionOf(status, body, http.StatusOK); got != version {
		t.Fatalf("no-op reorder bumped version %d", got)
	}
	status, body = httpJSON(http.MethodPut, apiURL+"/items/order", token, map[string]any{
		"version": version, "changeReason": "순서 변경", "itemUids": []string{second.ItemUID, created.ItemUID},
	})
	if got := versionOf(status, body, http.StatusOK); got != version+1 {
		t.Fatalf("real reorder version %d", got)
	}
	if revisionCount(apiURL+"/revisions") != revisions+1 {
		t.Fatal("no-op overview or reorder wrote a revision")
	}

	errorCode := map[string]any{
		"code": "NOOP_" + suffix, "category": "검증", "description": "무변경", "conditionText": "", "handling": "",
		"changeReason": "생성", "version": 0,
	}
	status, body = httpJSON(http.MethodPost, base+"/error-codes", token, errorCode)
	codeVersion := versionOf(status, body, http.StatusCreated)
	var codeRow struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal([]byte(body), &codeRow)
	codeURL := base + "/error-codes/" + u64(codeRow.ID)
	errorCode["version"] = codeVersion
	errorCode["changeReason"] = ""
	errorCode["description"] = " 무변경 "
	status, body = httpJSON(http.MethodPut, codeURL, token, errorCode)
	if got := versionOf(status, body, http.StatusOK); got != codeVersion {
		t.Fatalf("no-op error code bumped version %d", got)
	}
	if revisionCount(codeURL+"/revisions") != 1 {
		t.Fatal("no-op error code wrote a revision")
	}
	errorCode["version"] = codeVersion + 5
	status, body = httpJSON(http.MethodPut, codeURL, token, errorCode)
	versionOf(status, body, http.StatusConflict)
	errorCode["version"] = codeVersion
	errorCode["handling"] = "재시도"
	status, body = httpJSON(http.MethodPut, codeURL, token, errorCode)
	versionOf(status, body, http.StatusBadRequest)

	general := map[string]any{"title": "무변경 문서", "department": "", "content": "본문", "changeReason": "생성", "version": 0}
	status, body = httpJSON(http.MethodPost, base+"/general-docs", token, general)
	docVersion := versionOf(status, body, http.StatusCreated)
	var docRow struct {
		ID uint64 `json:"id"`
	}
	_ = json.Unmarshal([]byte(body), &docRow)
	docURL := base + "/general-docs/" + u64(docRow.ID)
	general["version"] = docVersion
	general["changeReason"] = ""
	status, body = httpJSON(http.MethodPut, docURL, token, general)
	if got := versionOf(status, body, http.StatusOK); got != docVersion {
		t.Fatalf("no-op general doc bumped version %d", got)
	}
	if revisionCount(docURL+"/revisions") != 1 {
		t.Fatal("no-op general doc wrote a revision")
	}
	general["content"] = "바뀐 본문"
	general["changeReason"] = "본문 수정"
	status, body = httpJSON(http.MethodPut, docURL, token, general)
	if got := versionOf(status, body, http.StatusOK); got != docVersion+1 {
		t.Fatalf("real general change version %d", got)
	}
}
