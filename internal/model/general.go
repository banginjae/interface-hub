package model

import (
	"encoding/json"
	"time"
)

type GeneralDocument struct {
	ID         uint64
	ProjectID  uint64
	Title      string
	Department string
	Content    string
	Version    uint
	CreatedBy  uint64
	UpdatedBy  uint64
	Author     string
	Updater    string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	DeletedAt  *time.Time
}

type GeneralDocumentSummary struct {
	ID         uint64
	Title      string
	Department string
	Version    uint
	UpdatedBy  uint64
	Updater    string
	UpdatedAt  time.Time
}

type GeneralRevision struct {
	Version      uint
	ChangeReason string
	ActorID      uint64
	ActorName    string
	Summary      json.RawMessage
	Snapshot     json.RawMessage
	CreatedAt    time.Time
}
