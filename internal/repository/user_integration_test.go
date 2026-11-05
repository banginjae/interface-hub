package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"testing"

	"interface-hub/internal/config"
	"interface-hub/internal/model"
	"interface-hub/internal/service"
)

func TestUserSurvivesReconnect(t *testing.T) {
	cfg, err := config.Load("../../config/config.yaml")
	if err != nil {
		t.Skip("local config is not available")
	}
	password := "reconnect-" + randomHex(t)
	employeeNo := "itest-" + randomHex(t)
	ctx := context.Background()

	first, err := Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	store := NewUserRepository(first)
	accounts := service.NewAccountService(store)
	created, err := accounts.Create(ctx, service.NewUser{
		EmployeeNo: employeeNo,
		Name:       "검증사용자",
		Email:      employeeNo + "@example.com",
		Password:   password,
		Role:       model.RoleMember,
	})
	Close(first)
	if err != nil {
		t.Fatal("create")
	}

	second, err := Open(cfg.Database)
	if err != nil {
		t.Fatal("database")
	}
	t.Cleanup(func() {
		sqlDB, sqlErr := SQLDB(second)
		if sqlErr == nil {
			_, _ = sqlDB.ExecContext(context.Background(), "DELETE FROM users WHERE employee_no = ?", employeeNo)
		}
		Close(second)
	})
	reopened := service.NewAccountService(NewUserRepository(second))
	found, err := reopened.Login(ctx, employeeNo, password)
	if err != nil || found.ID != created.ID {
		t.Fatal("reconnect login")
	}
	stored, err := NewUserRepository(second).FindByEmployeeNo(ctx, employeeNo)
	if err != nil || stored.PasswordHash == password || len(stored.PasswordHash) < 4 || stored.PasswordHash[:2] != "$2" {
		t.Fatal("stored hash")
	}
	if _, err := reopened.Update(ctx, created.ID, service.UserChange{
		Name:   "검증사용자",
		Email:  employeeNo + "@example.com",
		Role:   model.RoleMember,
		Active: false,
	}); err != nil {
		t.Fatal("deactivate")
	}
	if _, err := reopened.Login(ctx, employeeNo, password); err == nil {
		t.Fatal("inactive login succeeded")
	}
}

func randomHex(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(buf)
}
