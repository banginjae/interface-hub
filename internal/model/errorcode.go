package model

import "time"

var (
	ErrErrorCodeTaken = errString("error code taken")
	ErrErrorCodeInUse = errString("error code in use")
)

type errString string

func (e errString) Error() string { return string(e) }

type ErrorCode struct {
	ID             uint64
	ProjectID      uint64
	Code           string
	Category       string
	Description    string
	ConditionText  string
	Handling       string
	Version        uint
	CreatedBy      uint64
	UpdatedBy      uint64
	Author         string
	Updater        string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ReferenceCount int
	Usages         []ErrorCodeUsage
}

type ErrorCodeUsage struct {
	Kind     string
	Title    string
	ItemUID  string
	ItemName string
}

type ErrorCodeRevision struct {
	Version      uint
	ChangeReason string
	ActorID      uint64
	ActorName    string
	Summary      []byte
	Snapshot     []byte
	CreatedAt    time.Time
}
