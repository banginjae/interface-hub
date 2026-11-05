package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/model"
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

func TestLoginHidesUnknownWrongAndInactive(t *testing.T) {
	store := &memUsers{}
	accounts := NewAccountService(store)
	password := "correct-horse"
	created, err := accounts.Create(context.Background(), NewUser{
		EmployeeNo: "1001",
		Name:       "김개발",
		Email:      "kim@example.com",
		Password:   password,
		Role:       model.RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.PasswordHash != "" {
		t.Fatal("create returned a hash")
	}
	if store.users[0].PasswordHash == password || store.users[0].PasswordHash[:2] != "$2" {
		t.Fatal("stored password was not a bcrypt hash")
	}

	unknown, unknownErr := accounts.Login(context.Background(), "missing", "whatever1")
	wrong, wrongErr := accounts.Login(context.Background(), "1001", "wrong-pass")
	if !errors.Is(unknownErr, ErrUnauthorized) || !errors.Is(wrongErr, ErrUnauthorized) || unknown.ID != 0 || wrong.ID != 0 {
		t.Fatalf("login errors %v %v", unknownErr, wrongErr)
	}

	okUser, err := accounts.Login(context.Background(), "1001", password)
	if err != nil || okUser.EmployeeNo != "1001" || okUser.PasswordHash != "" {
		t.Fatalf("login user %v", err)
	}

	inactive, err := accounts.Update(context.Background(), created.ID, UserChange{
		Name:   "김개발",
		Email:  "kim@example.com",
		Role:   model.RoleMember,
		Active: false,
	})
	if err != nil || inactive.Active {
		t.Fatal(err)
	}
	if _, err := accounts.Login(context.Background(), "1001", password); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("inactive login %v", err)
	}
}

type fakeMailer struct {
	enabled bool
	fail    bool
	sent    int
	body    string
}

func (m *fakeMailer) Enabled() bool { return m.enabled }

func (m *fakeMailer) Send(_ context.Context, _, _, body string) error {
	m.sent++
	m.body = body
	if m.fail {
		return errors.New("mail failed")
	}
	return nil
}

func TestPasswordResetKeepsUnknownAndRestoresFailedMail(t *testing.T) {
	store := &memUsers{}
	accounts := NewAccountService(store)
	mailer := &fakeMailer{enabled: true}
	accounts.SetResetMailer(mailer)
	created, err := accounts.Create(context.Background(), NewUser{
		EmployeeNo: "1001",
		Name:       "김개발",
		Email:      "kim@example.com",
		Password:   "correct-horse",
		Role:       model.RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	original := store.users[0].PasswordHash
	if failed, err := accounts.RequestPasswordReset(context.Background(), "missing", "127.0.0.1"); err != nil || failed || mailer.sent != 0 {
		t.Fatalf("unknown reset %v sent %d", err, mailer.sent)
	}
	if store.users[0].PasswordHash != original {
		t.Fatal("unknown reset changed a password")
	}
	mailer.fail = true
	failed, err := accounts.RequestPasswordReset(context.Background(), "1001", "127.0.0.1")
	if err != nil || !failed || mailer.sent != 1 {
		t.Fatalf("failed mail %v %v", failed, err)
	}
	if store.users[0].PasswordHash != original || store.users[0].PasswordMustChange {
		t.Fatal("failed mail kept the temporary password")
	}
	mailer.fail = false
	failed, err = accounts.RequestPasswordReset(context.Background(), "1001", "127.0.0.1")
	if err != nil || failed || mailer.sent != 2 {
		t.Fatalf("sent mail %v %v", failed, err)
	}
	if !store.users[0].PasswordMustChange || store.users[0].PasswordHash == original || !auth.CheckPassword(store.users[0].PasswordHash, passwordFromMail(mailer.body)) {
		t.Fatal("temporary password was not stored")
	}
	if stringsContainMailAddress(mailer.body) {
		t.Fatal("reset mail included the address")
	}
	if err := accounts.ChangePassword(context.Background(), created.ID, "wrong-pass", "new-password"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("wrong current %v", err)
	}
	if err := accounts.ChangePassword(context.Background(), created.ID, passwordFromMail(mailer.body), "new-password"); err != nil {
		t.Fatal(err)
	}
	if store.users[0].PasswordMustChange || !auth.CheckPassword(store.users[0].PasswordHash, "new-password") {
		t.Fatal("password change did not clear the prompt")
	}
	accounts.SetResetMailer(&fakeMailer{enabled: false})
	before := store.users[0].PasswordHash
	if _, err := accounts.RequestPasswordReset(context.Background(), "1001", "10.0.0.8"); !errors.Is(err, ErrMailUnavailable) || store.users[0].PasswordHash != before {
		t.Fatal("disabled mail changed a password")
	}
}

func TestPasswordResetRateLimit(t *testing.T) {
	accounts := NewAccountService(&memUsers{})
	accounts.SetResetMailer(&fakeMailer{enabled: true})
	for i := 0; i < 5; i++ {
		if _, err := accounts.RequestPasswordReset(context.Background(), "missing", "10.1.1.1"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := accounts.RequestPasswordReset(context.Background(), "missing", "10.1.1.1"); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("rate %v", err)
	}
}

func passwordFromMail(body string) string {
	const marker = "임시 비밀번호: "
	start := stringsIndex(body, marker)
	if start < 0 {
		return ""
	}
	rest := body[start+len(marker):]
	end := stringsIndex(rest, "\n")
	if end < 0 {
		return rest
	}
	return rest[:end]
}

func stringsIndex(value, part string) int {
	return len([]rune(value[:]))*0 + indexOf(value, part)
}

func indexOf(value, part string) int {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}

func stringsContainMailAddress(body string) bool {
	return indexOf(body, "@") >= 0
}

func TestDuplicateEmployeeIsRejected(t *testing.T) {
	accounts := NewAccountService(&memUsers{})
	input := NewUser{EmployeeNo: "1001", Name: "김개발", Email: "kim@example.com", Password: "correct-horse", Role: model.RoleMaster}
	if _, err := accounts.Create(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.Create(context.Background(), input); !errors.Is(err, model.ErrEmployeeTaken) {
		t.Fatalf("duplicate %v", err)
	}
}

func TestUpdateProfileKeepsRoleAndPassword(t *testing.T) {
	store := &memUsers{}
	accounts := NewAccountService(store)
	created, err := accounts.Create(context.Background(), NewUser{
		EmployeeNo: "1001", Name: "김개발", Email: "kim@example.com", Password: "correct-horse", Role: model.RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	before := store.users[0].PasswordHash
	updated, err := accounts.UpdateProfile(context.Background(), created.ID, " 김수정 ", "kim2@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "김수정" || updated.Email != "kim2@example.com" || updated.Role != model.RoleMember || updated.EmployeeNo != "1001" || updated.PasswordHash != "" {
		t.Fatalf("profile %+v", updated)
	}
	if store.users[0].PasswordHash != before || store.users[0].Role != model.RoleMember || !store.users[0].Active {
		t.Fatalf("stored account changed beyond name and email")
	}
	if _, err := accounts.UpdateProfile(context.Background(), created.ID, "김수정", "not-an-email"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid email %v", err)
	}
	if store.users[0].Email != "kim2@example.com" {
		t.Fatalf("email changed after invalid request")
	}
}
