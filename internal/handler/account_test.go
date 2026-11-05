package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/dto"
	"interface-hub/internal/handler"
	"interface-hub/internal/middleware"
	"interface-hub/internal/model"
	"interface-hub/internal/router"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type memUsers struct {
	next  uint64
	users []model.User
}

func (m *memUsers) FindByEmployeeNo(_ context.Context, employeeNo string) (model.User, error) {
	for _, user := range m.users {
		if user.EmployeeNo == employeeNo {
			return user, nil
		}
	}
	return model.User{}, model.ErrNotFound
}

func (m *memUsers) FindByID(_ context.Context, id uint64) (model.User, error) {
	for _, user := range m.users {
		if user.ID == id {
			return user, nil
		}
	}
	return model.User{}, model.ErrNotFound
}

func (m *memUsers) List(context.Context) ([]model.User, error) {
	out := make([]model.User, len(m.users))
	copy(out, m.users)
	return out, nil
}

func (m *memUsers) Create(_ context.Context, user model.User) (model.User, error) {
	for _, existing := range m.users {
		if existing.EmployeeNo == user.EmployeeNo {
			return model.User{}, model.ErrEmployeeTaken
		}
	}
	m.next++
	user.ID = m.next
	m.users = append(m.users, user)
	return user, nil
}

func (m *memUsers) UpdatePassword(_ context.Context, id uint64, hash string, mustChange bool, updatedAt time.Time) error {
	for i := range m.users {
		if m.users[i].ID == id {
			m.users[i].PasswordHash = hash
			m.users[i].PasswordMustChange = mustChange
			m.users[i].UpdatedAt = updatedAt
			return nil
		}
	}
	return model.ErrNotFound
}

func (m *memUsers) Update(_ context.Context, user model.User) (model.User, error) {
	for i := range m.users {
		if m.users[i].ID == user.ID {
			user.PasswordHash = m.users[i].PasswordHash
			m.users[i] = user
			return user, nil
		}
	}
	return model.User{}, model.ErrNotFound
}

func TestAccountHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &memUsers{}
	accounts := service.NewAccountService(store)
	tokens := auth.Tokens{Secret: "handler-test-secret", Expire: 8 * time.Hour}
	engine := router.New(router.Params{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Health:        handler.NewHealthHandler(),
		Account:       handler.NewAccountHandler(accounts, tokens, nil),
		Authenticate:  middleware.RequireAuth(tokens, store),
		RequireMaster: middleware.RequireMaster(),
	})
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)

	masterPassword := "master-secret"
	memberPassword := "member-secret"
	createMaster(t, accounts, masterPassword)
	masterToken := login(t, server.URL, "2001", masterPassword)

	missing := getAuth(t, server.URL+"/api/me", "")
	if missing.StatusCode != http.StatusUnauthorized || codeOf(t, missing) != "UNAUTHORIZED" {
		t.Fatalf("missing token %d", missing.StatusCode)
	}

	wrong := postJSON(t, server.URL+"/api/auth/login", "", map[string]string{"employeeNo": "2001", "password": "wrong-secret"})
	unknown := postJSON(t, server.URL+"/api/auth/login", "", map[string]string{"employeeNo": "no-such", "password": "wrong-secret"})
	wrongBody := bodyText(t, wrong)
	unknownBody := bodyText(t, unknown)
	if wrong.StatusCode != http.StatusUnauthorized || unknown.StatusCode != http.StatusUnauthorized || wrongBody != unknownBody || strings.Contains(wrongBody, masterPassword) {
		t.Fatalf("login mismatch %d %d", wrong.StatusCode, unknown.StatusCode)
	}

	me := getAuth(t, server.URL+"/api/me", masterToken)
	if me.StatusCode != http.StatusOK || strings.Contains(bodyText(t, me), masterPassword) || strings.Contains(bodyText(t, me), "passwordHash") {
		t.Fatalf("me status %d", me.StatusCode)
	}

	created := postJSON(t, server.URL+"/api/master/users", masterToken, map[string]string{
		"employeeNo": "2002",
		"name":       "이직원",
		"email":      "lee@example.com",
		"password":   memberPassword,
		"role":       "MEMBER",
	})
	createdBody := bodyText(t, created)
	if created.StatusCode != http.StatusCreated || strings.Contains(createdBody, memberPassword) || strings.Contains(createdBody, "passwordHash") {
		t.Fatalf("create status %d", created.StatusCode)
	}
	var member dto.AccountUser
	if err := json.Unmarshal([]byte(createdBody), &member); err != nil {
		t.Fatal(err)
	}
	memberToken := login(t, server.URL, "2002", memberPassword)
	forbidden := getAuth(t, server.URL+"/api/master/users", memberToken)
	if forbidden.StatusCode != http.StatusForbidden || codeOf(t, forbidden) != "FORBIDDEN" {
		t.Fatalf("member list %d", forbidden.StatusCode)
	}

	updated := putJSON(t, server.URL+"/api/master/users/"+itoa(member.ID), masterToken, map[string]any{
		"name":   "이직원",
		"email":  "lee@example.com",
		"role":   "MEMBER",
		"active": false,
	})
	if updated.StatusCode != http.StatusOK || strings.Contains(bodyText(t, updated), `"active":true`) {
		t.Fatalf("deactivate %d %s", updated.StatusCode, bodyText(t, updated))
	}
	rejected := postJSON(t, server.URL+"/api/auth/login", "", map[string]string{"employeeNo": "2002", "password": memberPassword})
	if rejected.StatusCode != http.StatusUnauthorized || bodyText(t, rejected) != wrongBody {
		t.Fatalf("inactive login %d", rejected.StatusCode)
	}
}

func TestUpdateOwnProfileIgnoresRoleAndEmployeeNo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &memUsers{}
	accounts := service.NewAccountService(store)
	tokens := auth.Tokens{Secret: "handler-test-secret", Expire: 8 * time.Hour}
	engine := router.New(router.Params{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Account:       handler.NewAccountHandler(accounts, tokens, nil),
		Authenticate:  middleware.RequireAuth(tokens, store),
		RequireMaster: middleware.RequireMaster(),
	})
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)
	createMaster(t, accounts, "master-secret")
	token := login(t, server.URL, "2001", "master-secret")

	updated := putJSON(t, server.URL+"/api/me", token, map[string]string{
		"name":       "새관리자",
		"email":      "next@example.com",
		"employeeNo": "9999",
		"role":       "MEMBER",
	})
	body := bodyText(t, updated)
	if updated.StatusCode != http.StatusOK {
		t.Fatalf("profile status %d %s", updated.StatusCode, body)
	}
	var user dto.AccountUser
	if err := json.Unmarshal([]byte(body), &user); err != nil {
		t.Fatal(err)
	}
	if user.Name != "새관리자" || user.Email != "next@example.com" || user.EmployeeNo != "2001" || user.Role != model.RoleMaster {
		t.Fatalf("profile changed protected fields %+v", user)
	}
	if login(t, server.URL, "2001", "master-secret") == "" {
		t.Fatal("password changed")
	}
	invalid := putJSON(t, server.URL+"/api/me", token, map[string]string{"name": "새관리자", "email": "bad"})
	if invalid.StatusCode != http.StatusBadRequest || codeOf(t, invalid) != "INVALID_REQUEST" {
		t.Fatalf("invalid profile %d", invalid.StatusCode)
	}
}

func createMaster(t *testing.T, accounts *service.AccountService, password string) {
	t.Helper()
	_, err := accounts.Create(context.Background(), service.NewUser{
		EmployeeNo: "2001",
		Name:       "관리자",
		Email:      "master@example.com",
		Password:   password,
		Role:       model.RoleMaster,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func login(t *testing.T, base, employeeNo, password string) string {
	t.Helper()
	res := postJSON(t, base+"/api/auth/login", "", map[string]string{"employeeNo": employeeNo, "password": password})
	body := bodyText(t, res)
	if res.StatusCode != http.StatusOK || strings.Contains(body, password) {
		t.Fatalf("login status %d", res.StatusCode)
	}
	var payload dto.LoginResponse
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ExpiresIn != 28800 || payload.AccessToken == "" {
		t.Fatalf("token expiry %d", payload.ExpiresIn)
	}
	return payload.AccessToken
}

func getAuth(t *testing.T, url, token string) *http.Response {
	t.Helper()
	return sendJSON(t, http.MethodGet, url, token, nil)
}

func postJSON(t *testing.T, url, token string, payload any) *http.Response {
	t.Helper()
	return sendJSON(t, http.MethodPost, url, token, payload)
}

func putJSON(t *testing.T, url, token string, payload any) *http.Response {
	t.Helper()
	return sendJSON(t, http.MethodPut, url, token, payload)
}

func sendJSON(t *testing.T, method, url, token string, payload any) *http.Response {
	t.Helper()
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func bodyText(t *testing.T, res *http.Response) string {
	t.Helper()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func codeOf(t *testing.T, res *http.Response) string {
	t.Helper()
	var problem dto.ErrorResponse
	if err := json.Unmarshal([]byte(bodyText(t, res)), &problem); err != nil {
		t.Fatal(err)
	}
	return problem.Code
}

func itoa(id uint64) string {
	return strconvFormat(id)
}

func strconvFormat(id uint64) string {
	const digits = "0123456789"
	if id == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for id > 0 {
		i--
		buf[i] = digits[id%10]
		id /= 10
	}
	return string(buf[i:])
}
