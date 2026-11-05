package handler_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/config"
	"interface-hub/internal/dto"
	"interface-hub/internal/handler"
	"interface-hub/internal/middleware"
	"interface-hub/internal/model"
	"interface-hub/internal/repository"
	"interface-hub/internal/router"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestProjectPermissionsOnMariaDB(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	suffix := randomToken(t)
	t.Cleanup(func() { cleanupProjectFixture(gdb, suffix) })
	password := "project-" + randomToken(t)
	description := "desc-marker-" + suffix
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	master := makeUser(t, accounts, "p3m"+suffix, "검증마스터", model.RoleMaster, password)
	creator := makeUser(t, accounts, "p3c"+suffix, "검증생성자", model.RoleMember, password)
	reader := makeUser(t, accounts, "p3r"+suffix, "검증조회", model.RoleMember, password)
	writer := makeUser(t, accounts, "p3w"+suffix, "검증편집", model.RoleMember, password)
	outsider := makeUser(t, accounts, "p3o"+suffix, "검증외부", model.RoleMember, password)

	server := newProjectServer(t, gdb)
	masterToken := loginEmployee(t, server.URL, master.EmployeeNo, password)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	writerToken := loginEmployee(t, server.URL, writer.EmployeeNo, password)
	outsiderToken := loginEmployee(t, server.URL, outsider.EmployeeNo, password)

	created := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{
		"title":       "검증 프로젝트 " + suffix,
		"description": description,
	})
	createdBody := readBody(t, created)
	if created.StatusCode != http.StatusCreated || strings.Contains(createdBody, password) {
		t.Fatalf("create status %d", created.StatusCode)
	}
	var project dto.ProjectDetail
	if err := json.Unmarshal([]byte(createdBody), &project); err != nil {
		t.Fatal(err)
	}
	if project.MyPermission != "WRITE" || project.CreatedBy.ID != creator.ID || project.Version != 1 || project.Description != description {
		t.Fatalf("created permission %s version %d", project.MyPermission, project.Version)
	}
	members := memberList(t, server.URL, creatorToken, project.ID)
	if len(members.Members) != 1 || !members.Members[0].Creator || members.Members[0].Permission != "WRITE" || members.Members[0].UserID != creator.ID {
		t.Fatalf("creator member count %d", len(members.Members))
	}

	listed := sendJSON(t, http.MethodGet, server.URL+"/api/projects", outsiderToken, nil)
	listBody := readBody(t, listed)
	if listed.StatusCode != http.StatusOK || strings.Contains(listBody, description) || strings.Contains(listBody, "description") {
		t.Fatalf("list leaked description status %d", listed.StatusCode)
	}
	var list dto.ProjectListResponse
	if err := json.Unmarshal([]byte(listBody), &list); err != nil {
		t.Fatal(err)
	}
	var seen *dto.ProjectSummary
	for i := range list.Projects {
		if list.Projects[i].ID == project.ID {
			seen = &list.Projects[i]
		}
	}
	if seen == nil || seen.MyPermission != "NONE" || seen.CreatedBy.Name != "검증생성자" {
		t.Fatal("outsider list row")
	}

	denied := sendJSON(t, http.MethodGet, projectURL(server.URL, project.ID), outsiderToken, nil)
	deniedBody := readBody(t, denied)
	if denied.StatusCode != http.StatusForbidden || strings.Contains(deniedBody, description) || codeIn(t, deniedBody) != "FORBIDDEN" {
		t.Fatalf("outsider detail %d", denied.StatusCode)
	}

	addReader := sendJSON(t, http.MethodPost, projectURL(server.URL, project.ID)+"/members", creatorToken, map[string]string{
		"employeeNo": reader.EmployeeNo,
		"permission": "READ",
	})
	if addReader.StatusCode != http.StatusCreated {
		t.Fatalf("add reader %d", addReader.StatusCode)
	}
	readerDetail := sendJSON(t, http.MethodGet, projectURL(server.URL, project.ID), readerToken, nil)
	readerBody := readBody(t, readerDetail)
	if readerDetail.StatusCode != http.StatusOK || !strings.Contains(readerBody, description) {
		t.Fatalf("reader detail %d", readerDetail.StatusCode)
	}
	readerUpdate := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), readerToken, map[string]any{
		"version": project.Version, "title": "조회자 수정", "description": description, "status": "ACTIVE",
	})
	if readerUpdate.StatusCode != http.StatusForbidden {
		t.Fatalf("reader update %d", readerUpdate.StatusCode)
	}

	creatorUpdate := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), creatorToken, map[string]any{
		"version": project.Version, "title": "생성자 수정", "description": description, "status": "ACTIVE",
	})
	creatorBody := readBody(t, creatorUpdate)
	if creatorUpdate.StatusCode != http.StatusOK {
		t.Fatalf("creator update %d", creatorUpdate.StatusCode)
	}
	if err := json.Unmarshal([]byte(creatorBody), &project); err != nil {
		t.Fatal(err)
	}
	if project.Title != "생성자 수정" || project.Version != 2 {
		t.Fatalf("updated version %d", project.Version)
	}

	addWriter := sendJSON(t, http.MethodPost, projectURL(server.URL, project.ID)+"/members", creatorToken, map[string]string{
		"employeeNo": writer.EmployeeNo, "permission": "WRITE",
	})
	if addWriter.StatusCode != http.StatusCreated {
		t.Fatalf("add writer %d", addWriter.StatusCode)
	}
	writerAdmin := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID)+"/members/"+u64(reader.ID), writerToken, map[string]string{"permission": "WRITE"})
	if writerAdmin.StatusCode != http.StatusForbidden {
		t.Fatalf("writer member admin %d", writerAdmin.StatusCode)
	}
	writerProject := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), writerToken, map[string]any{
		"version": project.Version, "title": "편집자 수정", "description": description, "status": "ACTIVE",
	})
	if writerProject.StatusCode != http.StatusForbidden {
		t.Fatalf("writer project update %d", writerProject.StatusCode)
	}

	changed := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID)+"/members/"+u64(reader.ID), creatorToken, map[string]string{"permission": "WRITE"})
	if changed.StatusCode != http.StatusOK {
		t.Fatalf("change reader %d", changed.StatusCode)
	}
	removed := sendJSON(t, http.MethodDelete, projectURL(server.URL, project.ID)+"/members/"+u64(writer.ID), creatorToken, nil)
	if removed.StatusCode != http.StatusNoContent {
		t.Fatalf("remove writer %d", removed.StatusCode)
	}
	lockDelete := sendJSON(t, http.MethodDelete, projectURL(server.URL, project.ID)+"/members/"+u64(creator.ID), masterToken, nil)
	lockDemote := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID)+"/members/"+u64(creator.ID), masterToken, map[string]string{"permission": "READ"})
	if codeIn(t, readBody(t, lockDelete)) != "CREATOR_PERMISSION_LOCKED" || codeIn(t, readBody(t, lockDemote)) != "CREATOR_PERMISSION_LOCKED" {
		t.Fatal("creator permission was not locked")
	}

	masterDetail := sendJSON(t, http.MethodGet, projectURL(server.URL, project.ID), masterToken, nil)
	masterBody := readBody(t, masterDetail)
	var masterView dto.ProjectDetail
	if err := json.Unmarshal([]byte(masterBody), &masterView); err != nil {
		t.Fatal(err)
	}
	if masterDetail.StatusCode != http.StatusOK || masterView.MyPermission != "WRITE" || !strings.Contains(masterBody, description) {
		t.Fatalf("master detail %d", masterDetail.StatusCode)
	}

	archived := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), creatorToken, map[string]any{
		"version": project.Version, "title": project.Title, "description": description, "status": "ARCHIVED",
	})
	archivedBody := readBody(t, archived)
	if archived.StatusCode != http.StatusOK {
		t.Fatalf("archive %d", archived.StatusCode)
	}
	if err := json.Unmarshal([]byte(archivedBody), &project); err != nil || project.Status != "ARCHIVED" {
		t.Fatal("archive body")
	}
	blocked := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), creatorToken, map[string]any{
		"version": project.Version, "title": "보관 중 수정", "description": description, "status": "ARCHIVED",
	})
	memberBlocked := sendJSON(t, http.MethodPost, projectURL(server.URL, project.ID)+"/members", masterToken, map[string]string{
		"employeeNo": outsider.EmployeeNo, "permission": "READ",
	})
	if codeIn(t, readBody(t, blocked)) != "PROJECT_ARCHIVED" || codeIn(t, readBody(t, memberBlocked)) != "PROJECT_ARCHIVED" {
		t.Fatal("archived project accepted a change")
	}
	restored := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), masterToken, map[string]any{
		"version": project.Version, "title": project.Title, "description": description, "status": "ACTIVE",
	})
	restoredBody := readBody(t, restored)
	if restored.StatusCode != http.StatusOK {
		t.Fatalf("restore %d", restored.StatusCode)
	}
	if err := json.Unmarshal([]byte(restoredBody), &project); err != nil {
		t.Fatal(err)
	}
	reused := sendJSON(t, http.MethodPut, projectURL(server.URL, project.ID), creatorToken, map[string]any{
		"version": project.Version, "title": "복구 후 수정", "description": description, "status": "ACTIVE",
	})
	if reused.StatusCode != http.StatusOK {
		t.Fatalf("update after restore %d", reused.StatusCode)
	}

	reopened, err := repository.Open(cfg.Database)
	if err != nil {
		t.Fatal("reopen")
	}
	defer repository.Close(reopened)
	again := newProjectServer(t, reopened)
	againToken := loginEmployee(t, again.URL, creator.EmployeeNo, password)
	persisted := sendJSON(t, http.MethodGet, projectURL(again.URL, project.ID), againToken, nil)
	persistedBody := readBody(t, persisted)
	if persisted.StatusCode != http.StatusOK || !strings.Contains(persistedBody, "복구 후 수정") {
		t.Fatalf("persisted detail %d", persisted.StatusCode)
	}
	persistedMembers := memberList(t, again.URL, againToken, project.ID)
	if len(persistedMembers.Members) < 2 {
		t.Fatalf("persisted members %d", len(persistedMembers.Members))
	}
}

func newProjectServer(t *testing.T, gdb *gorm.DB) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	projectRepo := repository.NewProjectRepository(gdb)
	projects := service.NewProjectService(projectRepo, users)
	specs := service.NewSpecService(repository.NewSpecRepository(gdb), projectRepo)
	generalDocs := service.NewGeneralService(repository.NewGeneralRepository(gdb), projectRepo)
	errorCodes := service.NewErrorCodeService(repository.NewErrorCodeRepository(gdb), projectRepo)
	projectHandler := handler.NewProjectHandler(projects, nil)
	projectHandler.AttachSpecs(specs)
	projectHandler.AttachDocuments(generalDocs)
	projectHandler.AttachErrorCodes(errorCodes)
	tokens := auth.Tokens{Secret: "project-test-secret", Expire: 8 * time.Hour}
	engine := router.New(router.Params{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Health:        handler.NewHealthHandler(),
		Account:       handler.NewAccountHandler(accounts, tokens, nil),
		Project:       projectHandler,
		Spec:          handler.NewSpecHandler(specs, nil),
		General:       handler.NewGeneralHandler(generalDocs, nil),
		ErrorCode:     handler.NewErrorCodeHandler(errorCodes, nil),
		Authenticate:  middleware.RequireAuth(tokens, users),
		RequireMaster: middleware.RequireMaster(),
	})
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)
	return server
}

func makeUser(t *testing.T, accounts *service.AccountService, employeeNo, name, role, password string) model.User {
	t.Helper()
	user, err := accounts.Create(context.Background(), service.NewUser{
		EmployeeNo: employeeNo,
		Name:       name,
		Email:      employeeNo + "@example.com",
		Password:   password,
		Role:       role,
	})
	if err != nil {
		t.Fatal("user")
	}
	return user
}

func loginEmployee(t *testing.T, base, employeeNo, password string) string {
	t.Helper()
	res := sendJSON(t, http.MethodPost, base+"/api/auth/login", "", map[string]string{
		"employeeNo": employeeNo,
		"password":   password,
	})
	body := readBody(t, res)
	if res.StatusCode != http.StatusOK || strings.Contains(body, password) {
		t.Fatalf("login status %d", res.StatusCode)
	}
	var payload dto.LoginResponse
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.AccessToken
}

func memberList(t *testing.T, base, token string, projectID uint64) dto.MemberListResponse {
	t.Helper()
	res := sendJSON(t, http.MethodGet, projectURL(base, projectID)+"/members", token, nil)
	body := readBody(t, res)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("members %d", res.StatusCode)
	}
	var payload dto.MemberListResponse
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func projectURL(base string, id uint64) string {
	return base + "/api/projects/" + u64(id)
}

func u64(id uint64) string {
	return strconvFormat(id)
}

func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func codeIn(t *testing.T, body string) string {
	t.Helper()
	var problem dto.ErrorResponse
	if err := json.Unmarshal([]byte(body), &problem); err != nil {
		t.Fatal(err)
	}
	return problem.Code
}

func randomToken(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(buf)
}

func cleanupProjectFixture(gdb *gorm.DB, suffix string) {
	sqlDB, err := repository.SQLDB(gdb)
	if err != nil {
		repository.Close(gdb)
		return
	}
	ctx := context.Background()
	pattern := "p3%" + suffix
	_, _ = sqlDB.ExecContext(ctx, `
		DELETE FROM project_members
		WHERE project_id IN (
			SELECT id FROM (
				SELECT p.id FROM projects p JOIN users u ON u.id = p.created_by WHERE u.employee_no LIKE ?
			) AS project_ids
		)`, pattern)
	_, _ = sqlDB.ExecContext(ctx, `
		DELETE FROM projects
		WHERE created_by IN (SELECT id FROM (SELECT id FROM users WHERE employee_no LIKE ?) AS user_ids)`, pattern)
	_, _ = sqlDB.ExecContext(ctx, "DELETE FROM users WHERE employee_no LIKE ?", pattern)
	repository.Close(gdb)
}
