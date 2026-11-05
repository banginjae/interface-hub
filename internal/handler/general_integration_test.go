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

func TestGeneralDocumentsOnMariaDB(t *testing.T) {
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
	password := "docs-" + randomToken(t)
	accounts := service.NewAccountService(repository.NewUserRepository(gdb))
	creator := makeUser(t, accounts, "s4c"+suffix, "문서생성자", "MEMBER", password)
	reader := makeUser(t, accounts, "s4r"+suffix, "문서조회", "MEMBER", password)
	outsider := makeUser(t, accounts, "s4o"+suffix, "문서외부", "MEMBER", password)
	master := makeUser(t, accounts, "s4m"+suffix, "문서마스터", "MASTER", password)
	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)
	masterToken := loginEmployee(t, server.URL, master.EmployeeNo, password)

	createdProject := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title": "일반 문서 검증 " + suffix, "description": "docs-" + suffix,
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
	added := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{
		"employeeNo": reader.EmployeeNo, "permission": "READ",
	})
	if added.StatusCode != http.StatusCreated {
		t.Fatalf("member %d", added.StatusCode)
	}
	docsURL := base + "/general-docs"
	if sendJSON(t, http.MethodGet, docsURL, outsiderToken, nil).StatusCode != http.StatusForbidden {
		t.Fatal("outsider list")
	}
	if sendJSON(t, http.MethodPost, docsURL, readerToken, docBody("거절", "SW", "본문", "최초 작성")).StatusCode != http.StatusForbidden {
		t.Fatal("reader create")
	}

	sw := createGeneralDoc(t, docsURL, creatorToken, "설치 가이드", "SW", "## 준비\nSW 본문", "최초 작성")
	app := createGeneralDoc(t, docsURL, creatorToken, "화면 가이드", "APP", "APP 본문", "최초 작성")
	free := createGeneralDoc(t, docsURL, creatorToken, "품질 점검", "품질팀", "자유 부서 본문", "최초 작성")
	sameTitle := createGeneralDoc(t, docsURL, creatorToken, "설치 가이드", "HW", "같은 제목", "제목 중복 허용")
	if sw.ID == app.ID || sw.Version != 1 || app.Version != 1 || free.Version != 1 || sameTitle.Version != 1 {
		t.Fatalf("create versions %#v %#v %#v %#v", sw, app, free, sameTitle)
	}
	emptyTitle := sendJSON(t, http.MethodPost, docsURL, creatorToken, docBody("", "SW", "본문", "빈 제목"))
	if emptyTitle.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty title %d", emptyTitle.StatusCode)
	}
	tooLong := sendJSON(t, http.MethodPost, docsURL, creatorToken, docBody("너무 김", "SW", strings.Repeat("가", 200001), "상한"))
	if tooLong.StatusCode != http.StatusBadRequest {
		t.Fatalf("content limit %d", tooLong.StatusCode)
	}

	listBody := readBody(t, sendJSON(t, http.MethodGet, docsURL, readerToken, nil))
	for _, title := range []string{"설치 가이드", "화면 가이드", "품질 점검"} {
		if !strings.Contains(listBody, title) {
			t.Fatalf("list missing %s", title)
		}
	}
	if !strings.Contains(listBody, `"department":"품질팀"`) || !strings.Contains(listBody, `"department":"SW"`) {
		t.Fatalf("departments %s", listBody)
	}

	updated := sendJSON(t, http.MethodPut, docsURL+"/"+u64(sw.ID), creatorToken, docUpdate(1, "설치 가이드", "SW", "## 준비\nSW 본문 수정", "전원 순서 보완"))
	updatedBody := readBody(t, updated)
	if updated.StatusCode != http.StatusOK || fieldOf(t, updatedBody, "version") != "2" {
		t.Fatalf("update %d %s", updated.StatusCode, updatedBody)
	}
	if getGeneral(t, docsURL+"/"+u64(app.ID), readerToken).Version != 1 {
		t.Fatal("app version changed")
	}
	stale := sendJSON(t, http.MethodPut, docsURL+"/"+u64(sw.ID), creatorToken, docUpdate(1, "설치 가이드", "SW", "덮어쓰면 안 되는 초안", "늦은 저장"))
	staleBody := readBody(t, stale)
	if stale.StatusCode != http.StatusConflict || codeIn(t, staleBody) != "GENERAL_DOC_VERSION_CONFLICT" || fieldOf(t, staleBody, "currentVersion") != "2" {
		t.Fatalf("conflict %d %s", stale.StatusCode, staleBody)
	}
	visible := getGeneral(t, docsURL+"/"+u64(sw.ID), readerToken)
	if visible.Version != 2 || !strings.Contains(visible.Content, "SW 본문 수정") || strings.Contains(visible.Content, "덮어쓰면 안 되는 초안") {
		t.Fatalf("stale overwrite %#v", visible)
	}

	revisions := sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/revisions", readerToken, nil)
	revisionBody := readBody(t, revisions)
	if revisions.StatusCode != http.StatusOK || !strings.Contains(revisionBody, "전원 순서 보완") || !strings.Contains(revisionBody, "CREATE_DOCUMENT") {
		t.Fatalf("revisions %d %s", revisions.StatusCode, revisionBody)
	}
	compared := sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/revisions/compare?from=1&to=2", readerToken, nil)
	compareBody := readBody(t, compared)
	if compared.StatusCode != http.StatusOK || !strings.Contains(compareBody, "SW 본문") || !strings.Contains(compareBody, "SW 본문 수정") {
		t.Fatalf("compare %d %s", compared.StatusCode, compareBody)
	}

	markdown := sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/markdown", readerToken, nil)
	markdownBody := readBody(t, markdown)
	if markdown.StatusCode != http.StatusOK || !strings.Contains(markdown.Header.Get("Content-Type"), "text/markdown") || markdown.Header.Get("Content-Disposition") != "" {
		t.Fatalf("markdown %d", markdown.StatusCode)
	}
	if !strings.Contains(markdown.Header.Get("X-Markdown-Filename"), "general") || !strings.Contains(markdownBody, "문서 버전") || !strings.Contains(markdownBody, "담당 부서: SW") || !strings.Contains(markdownBody, "SW 본문 수정") {
		t.Fatal("markdown body")
	}
	if getGeneral(t, docsURL+"/"+u64(sw.ID), readerToken).Version != 2 {
		t.Fatal("markdown changed version")
	}
	if sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/markdown", outsiderToken, nil).StatusCode != http.StatusForbidden {
		t.Fatal("outsider markdown")
	}

	for _, kind := range []string{"API", "MQTT", "WEBSOCKET"} {
		created := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": kind, "title": kind + " 규격"})
		if created.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, created), "version") != "1" {
			t.Fatalf("spec %s %d", kind, created.StatusCode)
		}
	}
	device := sendJSON(t, http.MethodPost, base+"/specs", creatorToken, map[string]string{"kind": "DEVICE_PROTOCOL", "title": "장비"})
	if device.StatusCode != http.StatusCreated || fieldOf(t, readBody(t, device), "version") != "1" {
		t.Fatal("device protocol")
	}
	if getGeneral(t, docsURL+"/"+u64(free.ID), creatorToken).Version != 1 {
		t.Fatal("spec create changed general version")
	}

	archived := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{
		"version": project.Version, "title": "일반 문서 검증 " + suffix, "description": "docs-" + suffix, "status": "ARCHIVED",
	})
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d %s", archived.StatusCode, readBody(t, archived))
	}
	blocked := sendJSON(t, http.MethodPut, docsURL+"/"+u64(app.ID), creatorToken, docUpdate(1, "화면 가이드", "APP", "보관 중 수정", "보관"))
	if codeIn(t, readBody(t, blocked)) != "PROJECT_ARCHIVED" || getGeneral(t, docsURL+"/"+u64(app.ID), readerToken).Version != 1 {
		t.Fatal("archived write")
	}
	if sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/markdown", readerToken, nil).StatusCode != http.StatusOK {
		t.Fatal("archived markdown")
	}
	detail := sendJSON(t, http.MethodGet, base, creatorToken, nil)
	var current struct {
		Version uint `json:"version"`
	}
	if err := json.Unmarshal([]byte(readBody(t, detail)), &current); err != nil {
		t.Fatal(err)
	}
	restored := sendJSON(t, http.MethodPut, base, creatorToken, map[string]any{
		"version": current.Version, "title": "일반 문서 검증 " + suffix, "description": "docs-" + suffix, "status": "ACTIVE",
	})
	if restored.StatusCode != http.StatusOK {
		t.Fatalf("restore %d", restored.StatusCode)
	}

	removed := sendJSON(t, http.MethodDelete, docsURL+"/"+u64(sw.ID), creatorToken, map[string]any{
		"version": 2, "changeReason": "중복 문서 제거",
	})
	if removed.StatusCode != http.StatusOK || fieldOf(t, readBody(t, removed), "version") != "3" {
		t.Fatalf("delete %d", removed.StatusCode)
	}
	if sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID), readerToken, nil).StatusCode != http.StatusNotFound {
		t.Fatal("deleted document still visible")
	}
	afterList := readBody(t, sendJSON(t, http.MethodGet, docsURL, readerToken, nil))
	if strings.Contains(afterList, `"id":`+u64(sw.ID)+",") || !strings.Contains(afterList, "화면 가이드") {
		t.Fatalf("list after delete %s", afterList)
	}
	kept := readBody(t, sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/revisions", readerToken, nil))
	if !strings.Contains(kept, "DELETE_DOCUMENT") || !strings.Contains(kept, "중복 문서 제거") {
		t.Fatalf("history after delete %s", kept)
	}
	keptCompare := readBody(t, sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/revisions/compare?from=2&to=3", readerToken, nil))
	if !strings.Contains(keptCompare, "SW 본문 수정") {
		t.Fatal("snapshot dropped after delete")
	}
	if sendJSON(t, http.MethodGet, docsURL+"/"+u64(sw.ID)+"/markdown", readerToken, nil).StatusCode != http.StatusNotFound {
		t.Fatal("deleted markdown")
	}
	detail = sendJSON(t, http.MethodGet, base, creatorToken, nil)
	if fieldOf(t, readBody(t, detail), "generalDocumentCount") != "3" {
		t.Fatalf("count %s", readBody(t, detail))
	}
	for _, kind := range []string{"API", "MQTT", "WEBSOCKET"} {
		spec := sendJSON(t, http.MethodGet, base+"/specs/"+kind, creatorToken, nil)
		if fieldOf(t, readBody(t, spec), "version") != "1" {
			t.Fatalf("%s version changed", kind)
		}
	}

	masterDoc := createGeneralDoc(t, docsURL, masterToken, "마스터 확인", "GW", "전역 권한", "마스터 작성")
	masterDelete := sendJSON(t, http.MethodDelete, docsURL+"/"+u64(masterDoc.ID), masterToken, map[string]any{
		"version": 1, "changeReason": "검증 후 삭제",
	})
	if masterDelete.StatusCode != http.StatusOK {
		t.Fatalf("master delete %d", masterDelete.StatusCode)
	}
	if sendJSON(t, http.MethodDelete, docsURL+"/"+u64(app.ID), readerToken, map[string]any{
		"version": 1, "changeReason": "조회자가 삭제",
	}).StatusCode != http.StatusForbidden {
		t.Fatal("reader delete")
	}
}

type generalCreated struct {
	ID      uint64 `json:"id"`
	Version uint   `json:"version"`
}

type generalView struct {
	Version uint   `json:"version"`
	Content string `json:"content"`
}

func createGeneralDoc(t *testing.T, url, token, title, department, content, reason string) generalCreated {
	t.Helper()
	res := sendJSON(t, http.MethodPost, url, token, docBody(title, department, content, reason))
	body := readBody(t, res)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create doc %d %s", res.StatusCode, body)
	}
	var created generalCreated
	if err := json.Unmarshal([]byte(body), &created); err != nil || created.ID == 0 {
		t.Fatal(body)
	}
	return created
}

func getGeneral(t *testing.T, url, token string) generalView {
	t.Helper()
	res := sendJSON(t, http.MethodGet, url, token, nil)
	body := readBody(t, res)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get doc %d %s", res.StatusCode, body)
	}
	var doc generalView
	if err := json.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func docBody(title, department, content, reason string) map[string]string {
	return map[string]string{"title": title, "department": department, "content": content, "changeReason": reason}
}

func docUpdate(version uint, title, department, content, reason string) map[string]any {
	return map[string]any{"version": version, "title": title, "department": department, "content": content, "changeReason": reason}
}
