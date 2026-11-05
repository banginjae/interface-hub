package model

import (
	"encoding/json"
	"errors"
	"time"
)

const (
	SpecKindAPI       = "API"
	SpecKindMQTT      = "MQTT"
	SpecKindWebSocket = "WEBSOCKET"
	SpecKindDevice    = "DEVICE_PROTOCOL"
)

var (
	ErrSpecKindExists = errors.New("spec kind exists")
	ErrArchived       = errors.New("project archived")
	ErrSpecInput      = errors.New("spec input")
)

type SpecConflict struct {
	Current uint
	ItemSet bool
}

func (e SpecConflict) Error() string { return "spec conflict" }

type SpecDocument struct {
	ID        uint64
	ProjectID uint64
	Kind      string
	Title     string
	Overview  json.RawMessage
	Version   uint
	CreatedBy uint64
	UpdatedBy uint64
	CreatedAt time.Time
	UpdatedAt time.Time
	Updater   string
}

type SpecItem struct {
	ItemUID    string
	SortOrder  int
	Name       string
	Summary    string
	Status     string
	Payload    json.RawMessage
	ErrorCodes []ErrorCodeCopy
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type ErrorCodeCopy struct {
	ID            uint64 `json:"id"`
	Code          string `json:"code"`
	Category      string `json:"category"`
	Description   string `json:"description"`
	ConditionText string `json:"conditionText"`
	Handling      string `json:"handling"`
}

type SpecRevision struct {
	Version      uint
	ChangeReason string
	ActorID      uint64
	ActorName    string
	Summary      json.RawMessage
	Snapshot     json.RawMessage
	CreatedAt    time.Time
}

type SpecItemWrite struct {
	Name         string
	Summary      string
	Status       string
	Payload      string
	ErrorCodeIDs []uint64
}

type SpecSummaryRow struct {
	Kind          string
	Version       uint
	UpdatedAt     time.Time
	UpdatedByName string
}
