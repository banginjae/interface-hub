package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/dto"
	"interface-hub/internal/model"
	"interface-hub/internal/repository"
	"interface-hub/internal/service"
)

func TestMemberCandidatesOnMariaDB(t *testing.T) {
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
	password := "candidate-" + randomToken(t)
	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	creator := makeUser(t, accounts, "p3c"+suffix, "후보생성자", model.RoleMember, password)
	reader := makeUser(t, accounts, "p3r"+suffix, "후보조회", model.RoleMember, password)
	target := makeUser(t, accounts, "p3t"+suffix, "후보대상"+suffix, model.RoleMember, password)
	member := makeUser(t, accounts, "p3m"+suffix, "후보멤버"+suffix, model.RoleMember, password)
	inactive := makeUser(t, accounts, "p3i"+suffix, "후보비활성"+suffix, model.RoleMember, password)
	if _, err := accounts.Update(context.Background(), inactive.ID, service.UserChange{
		Name: inactive.Name, Email: inactive.Email, Role: model.RoleMember, Active: false,
	}); err != nil {
		t.Fatal(err)
	}

	server := newProjectServer(t, gdb)
	creatorToken := loginEmployee(t, server.URL, creator.EmployeeNo, password)
	readerToken := loginEmployee(t, server.URL, reader.EmployeeNo, password)
	created := sendJSON(t, http.MethodPost, server.URL+"/api/projects", creatorToken, map[string]string{"title": "후보 검색 " + suffix, "description": ""})
	var project dto.ProjectDetail
	if err := json.Unmarshal([]byte(readBody(t, created)), &project); err != nil {
		t.Fatal(err)
	}
	base := projectURL(server.URL, project.ID)
	for _, add := range []struct{ employeeNo, permission string }{{reader.EmployeeNo, "READ"}, {member.EmployeeNo, "READ"}} {
		if res := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{"employeeNo": add.employeeNo, "permission": add.permission}); res.StatusCode != http.StatusCreated {
			t.Fatalf("add member %d", res.StatusCode)
		}
	}

	search := func(token, query string) (int, dto.MemberCandidateListResponse) {
		res := sendJSON(t, http.MethodGet, base+"/member-candidates?q="+url.QueryEscape(query), token, nil)
		body := readBody(t, res)
		var payload dto.MemberCandidateListResponse
		if res.StatusCode == http.StatusOK {
			if err := json.Unmarshal([]byte(body), &payload); err != nil {
				t.Fatal(err)
			}
		}
		if strings.Contains(body, password) || strings.Contains(body, "@example.com") {
			t.Fatal("candidate response leaked account details")
		}
		return res.StatusCode, payload
	}

	status, found := search(creatorToken, suffix)
	if status != http.StatusOK || len(found.Candidates) != 1 || found.Candidates[0].UserID != target.ID || found.Candidates[0].EmployeeNo != target.EmployeeNo {
		t.Fatalf("name search status %d count %d", status, len(found.Candidates))
	}
	if status, byNo := search(creatorToken, target.EmployeeNo); status != http.StatusOK || len(byNo.Candidates) != 1 || byNo.Candidates[0].UserID != target.ID {
		t.Fatalf("employee number search status %d", status)
	}
	if status, wildcard := search(creatorToken, "%"); status != http.StatusOK || len(wildcard.Candidates) != 0 {
		t.Fatalf("wildcard search status %d count %d", status, len(wildcard.Candidates))
	}
	if status, _ := search(readerToken, suffix); status != http.StatusForbidden {
		t.Fatalf("reader search status %d", status)
	}

	blocked := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{"employeeNo": inactive.EmployeeNo, "permission": "READ"})
	if body := readBody(t, blocked); blocked.StatusCode != http.StatusBadRequest || codeIn(t, body) != "MEMBER_INACTIVE" {
		t.Fatalf("inactive add %d", blocked.StatusCode)
	}
	added := sendJSON(t, http.MethodPost, base+"/members", creatorToken, map[string]string{"employeeNo": target.EmployeeNo, "permission": "WRITE"})
	if added.StatusCode != http.StatusCreated {
		t.Fatalf("add candidate %d", added.StatusCode)
	}
	if status, after := search(creatorToken, suffix); status != http.StatusOK || len(after.Candidates) != 0 {
		t.Fatalf("added member still listed %d", len(after.Candidates))
	}
}
