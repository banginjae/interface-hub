package model

import "time"

type ProjectSummary struct {
	ID            uint64
	Title         string
	Status        string
	CreatedByID   uint64
	CreatedByName string
	CreatedAt     time.Time
	MyPermission  string
}

type MemberRecord struct {
	UserID     uint64
	EmployeeNo string
	Name       string
	Permission string
	Active     bool
}

const (
	ProjectActive   = "ACTIVE"
	ProjectArchived = "ARCHIVED"
	PermissionNone  = "NONE"
	PermissionRead  = "READ"
	PermissionWrite = "WRITE"
)

type Project struct {
	ID          uint64    `gorm:"primaryKey;column:id"`
	Title       string    `gorm:"column:title"`
	Description string    `gorm:"column:description"`
	Status      string    `gorm:"column:status"`
	CreatedBy   uint64    `gorm:"column:created_by"`
	UpdatedBy   uint64    `gorm:"column:updated_by"`
	CreatedAt   time.Time `gorm:"column:created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at"`
	Version     uint      `gorm:"column:version"`
}

func (Project) TableName() string {
	return "projects"
}

type ProjectMember struct {
	ProjectID  uint64    `gorm:"primaryKey;column:project_id"`
	UserID     uint64    `gorm:"primaryKey;column:user_id"`
	Permission string    `gorm:"column:permission"`
	GrantedBy  uint64    `gorm:"column:granted_by"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
}

func (ProjectMember) TableName() string {
	return "project_members"
}
