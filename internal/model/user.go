package model

import (
	"errors"
	"time"
)

const (
	RoleMaster = "MASTER"
	RoleMember = "MEMBER"
)

var (
	ErrNotFound      = errors.New("user not found")
	ErrEmployeeTaken = errors.New("employee number taken")
	ErrMemberExists  = errors.New("project member exists")
)

type User struct {
	ID                 uint64    `gorm:"primaryKey;column:id"`
	EmployeeNo         string    `gorm:"column:employee_no"`
	Name               string    `gorm:"column:name"`
	Email              string    `gorm:"column:email"`
	PasswordHash       string    `gorm:"column:password_hash"`
	PasswordMustChange bool      `gorm:"column:password_must_change"`
	Role               string    `gorm:"column:role"`
	Active             bool      `gorm:"column:active"`
	CreatedAt          time.Time `gorm:"column:created_at"`
	UpdatedAt          time.Time `gorm:"column:updated_at"`
}

func (User) TableName() string {
	return "users"
}
