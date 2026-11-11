package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"interface-hub/internal/model"
)

const errorTextLimit = 4000

type ErrorCodeStore interface {
	CountVisible(ctx context.Context, projectID uint64) (int, error)
	List(ctx context.Context, projectID uint64) ([]model.ErrorCode, error)
	FindVisible(ctx context.Context, projectID, id uint64) (model.ErrorCode, error)
	Create(ctx context.Context, projectID, actorID uint64, code model.ErrorCode, reason string, now time.Time) (model.ErrorCode, error)
	Update(ctx context.Context, projectID, actorID, id uint64, version uint, code model.ErrorCode, reason string, now time.Time) (uint, error)
	SoftDelete(ctx context.Context, projectID, actorID, id uint64, version uint, reason string, now time.Time) (uint, error)
	ListRevisions(ctx context.Context, projectID, id uint64) ([]model.ErrorCodeRevision, error)
	Revision(ctx context.Context, projectID, id uint64, version uint) (model.ErrorCodeRevision, error)
}

type ErrorCodeWrite struct {
	Code          string `json:"code"`
	Category      string `json:"category"`
	Description   string `json:"description"`
	ConditionText string `json:"conditionText"`
	Handling      string `json:"handling"`
	ChangeReason  string `json:"changeReason"`
	Version       uint   `json:"version"`
}

type ErrorCodeConflictError struct {
	Current uint
}

func (e ErrorCodeConflictError) Error() string { return "error code version conflict" }

type ErrorCodeBody struct {
	Code          string `json:"code"`
	Category      string `json:"category"`
	Description   string `json:"description"`
	ConditionText string `json:"conditionText"`
	Handling      string `json:"handling"`
}

type ErrorCodeCompare struct {
	FromVersion uint
	ToVersion   uint
	Before      ErrorCodeBody
	After       ErrorCodeBody
}

type ErrorCodeService struct {
	codes    ErrorCodeStore
	projects ProjectStore
	now      func() time.Time
}

func NewErrorCodeService(codes ErrorCodeStore, projects ProjectStore) *ErrorCodeService {
	return &ErrorCodeService{codes: codes, projects: projects, now: func() time.Time { return time.Now().UTC().Truncate(time.Second) }}
}

func (s *ErrorCodeService) Count(ctx context.Context, projectID uint64) (int, error) {
	return s.codes.CountVisible(ctx, projectID)
}

func (s *ErrorCodeService) List(ctx context.Context, actor model.User, projectID uint64) ([]model.ErrorCode, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	return s.codes.List(ctx, projectID)
}

func (s *ErrorCodeService) Get(ctx context.Context, actor model.User, projectID, id uint64) (model.ErrorCode, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return model.ErrorCode{}, err
	}
	return s.codes.FindVisible(ctx, projectID, id)
}

func (s *ErrorCodeService) Create(ctx context.Context, actor model.User, projectID uint64, write ErrorCodeWrite) (model.ErrorCode, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return model.ErrorCode{}, err
	}
	code, reason, err := cleanErrorCode(write, false)
	if err != nil {
		return model.ErrorCode{}, err
	}
	created, err := s.codes.Create(ctx, projectID, actor.ID, code, reason, s.now())
	return created, mapErrorCodeServiceErr(err)
}

func (s *ErrorCodeService) Update(ctx context.Context, actor model.User, projectID, id uint64, write ErrorCodeWrite) (uint, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	code, reason, err := cleanErrorCode(write, true)
	if err != nil {
		return 0, err
	}
	version, err := s.codes.Update(ctx, projectID, actor.ID, id, write.Version, code, reason, s.now())
	return version, mapErrorCodeServiceErr(err)
}

func (s *ErrorCodeService) Delete(ctx context.Context, actor model.User, projectID, id uint64, version uint, reason string) (uint, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	clean, err := cleanReason(reason)
	if err != nil || version == 0 {
		return 0, ErrProjectInvalid
	}
	next, err := s.codes.SoftDelete(ctx, projectID, actor.ID, id, version, clean, s.now())
	return next, mapErrorCodeServiceErr(err)
}

func (s *ErrorCodeService) Revisions(ctx context.Context, actor model.User, projectID, id uint64) ([]model.ErrorCodeRevision, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	return s.codes.ListRevisions(ctx, projectID, id)
}

func (s *ErrorCodeService) Compare(ctx context.Context, actor model.User, projectID, id uint64, from, to uint) (ErrorCodeCompare, error) {
	if from < 1 || to < 1 {
		return ErrorCodeCompare{}, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return ErrorCodeCompare{}, err
	}
	before, err := s.codes.Revision(ctx, projectID, id, from)
	if err != nil {
		return ErrorCodeCompare{}, mapErrorCodeServiceErr(err)
	}
	after, err := s.codes.Revision(ctx, projectID, id, to)
	if err != nil {
		return ErrorCodeCompare{}, mapErrorCodeServiceErr(err)
	}
	left, err := decodeErrorCodeBody(before.Snapshot)
	if err != nil {
		return ErrorCodeCompare{}, err
	}
	right, err := decodeErrorCodeBody(after.Snapshot)
	if err != nil {
		return ErrorCodeCompare{}, err
	}
	return ErrorCodeCompare{FromVersion: from, ToVersion: to, Before: left, After: right}, nil
}

func (s *ErrorCodeService) gate(ctx context.Context, actor model.User, projectID uint64, write bool) error {
	if !actor.Active {
		return ErrUnauthorized
	}
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return err
	}
	permission := model.PermissionNone
	if actor.Role == model.RoleMaster {
		permission = model.PermissionWrite
	} else {
		member, memberErr := s.projects.FindMember(ctx, projectID, actor.ID)
		if memberErr == nil {
			permission = member.Permission
		} else if !errors.Is(memberErr, model.ErrNotFound) {
			return memberErr
		}
	}
	if permission == model.PermissionNone {
		return ErrProjectForbidden
	}
	if write && permission != model.PermissionWrite {
		return ErrProjectForbidden
	}
	if write && project.Status != model.ProjectActive {
		return ErrProjectArchived
	}
	return nil
}

func cleanErrorCode(write ErrorCodeWrite, requireVersion bool) (model.ErrorCode, string, error) {
	code := strings.TrimSpace(write.Code)
	category := strings.TrimSpace(write.Category)
	description := strings.TrimSpace(write.Description)
	condition := strings.TrimSpace(write.ConditionText)
	handling := strings.TrimSpace(write.Handling)
	if code == "" || utf8.RuneCountInString(code) > 64 || category == "" || utf8.RuneCountInString(category) > 100 {
		return model.ErrorCode{}, "", ErrProjectInvalid
	}
	if description == "" || utf8.RuneCountInString(description) > errorTextLimit || utf8.RuneCountInString(condition) > errorTextLimit || utf8.RuneCountInString(handling) > errorTextLimit {
		return model.ErrorCode{}, "", ErrProjectInvalid
	}
	for _, char := range code {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return model.ErrorCode{}, "", ErrProjectInvalid
		}
	}
	if requireVersion && write.Version == 0 {
		return model.ErrorCode{}, "", ErrProjectInvalid
	}
	clean := cleanReason
	if requireVersion {
		clean = cleanUpdateReason
	}
	reason, err := clean(write.ChangeReason)
	if err != nil {
		return model.ErrorCode{}, "", err
	}
	return model.ErrorCode{
		Code: code, Category: category, Description: description, ConditionText: condition, Handling: handling,
	}, reason, nil
}

func decodeErrorCodeBody(raw []byte) (ErrorCodeBody, error) {
	var body ErrorCodeBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return ErrorCodeBody{}, ErrProjectInvalid
	}
	return body, nil
}

func mapErrorCodeServiceErr(err error) error {
	if err == nil {
		return nil
	}
	var conflict model.SpecConflict
	if errors.As(err, &conflict) {
		return ErrorCodeConflictError{Current: conflict.Current}
	}
	if errors.Is(err, model.ErrArchived) {
		return ErrProjectArchived
	}
	if errors.Is(err, model.ErrSpecInput) {
		return ErrProjectInvalid
	}
	return err
}
