package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"interface-hub/internal/model"
)

const generalContentLimit = 200_000

type GeneralStore interface {
	CountVisible(ctx context.Context, projectID uint64) (int, error)
	List(ctx context.Context, projectID uint64) ([]model.GeneralDocumentSummary, error)
	FindVisible(ctx context.Context, projectID, id uint64) (model.GeneralDocument, error)
	Create(ctx context.Context, projectID, actorID uint64, title, department, content, reason string, now time.Time) (model.GeneralDocument, error)
	Update(ctx context.Context, projectID, actorID, id uint64, version uint, title, department, content, reason string, now time.Time) (uint, error)
	SoftDelete(ctx context.Context, projectID, actorID, id uint64, version uint, reason string, now time.Time) (uint, error)
	ListRevisions(ctx context.Context, projectID, id uint64) ([]model.GeneralRevision, error)
	Revision(ctx context.Context, projectID, id uint64, version uint) (model.GeneralRevision, error)
}

type GeneralDocConflictError struct {
	Current uint
}

func (e GeneralDocConflictError) Error() string { return "general document version conflict" }

type GeneralWrite struct {
	Title        string `json:"title"`
	Department   string `json:"department"`
	Content      string `json:"content"`
	ChangeReason string `json:"changeReason"`
	Version      uint   `json:"version"`
}

type GeneralCompare struct {
	FromVersion uint
	ToVersion   uint
	Before      GeneralBody
	After       GeneralBody
}

type GeneralBody struct {
	Title      string
	Department string
	Content    string
}

type GeneralService struct {
	docs     GeneralStore
	projects ProjectStore
	now      func() time.Time
}

func NewGeneralService(docs GeneralStore, projects ProjectStore) *GeneralService {
	return &GeneralService{
		docs:     docs,
		projects: projects,
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Second) },
	}
}

func (s *GeneralService) Count(ctx context.Context, projectID uint64) (int, error) {
	return s.docs.CountVisible(ctx, projectID)
}

func (s *GeneralService) List(ctx context.Context, actor model.User, projectID uint64) ([]model.GeneralDocumentSummary, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	return s.docs.List(ctx, projectID)
}

func (s *GeneralService) Get(ctx context.Context, actor model.User, projectID, id uint64) (model.GeneralDocument, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return model.GeneralDocument{}, err
	}
	return s.docs.FindVisible(ctx, projectID, id)
}

func (s *GeneralService) Create(ctx context.Context, actor model.User, projectID uint64, write GeneralWrite) (model.GeneralDocument, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return model.GeneralDocument{}, err
	}
	title, department, content, reason, err := cleanGeneral(write, false)
	if err != nil {
		return model.GeneralDocument{}, err
	}
	doc, err := s.docs.Create(ctx, projectID, actor.ID, title, department, content, reason, s.now())
	return doc, mapGeneralErr(err)
}

func (s *GeneralService) Update(ctx context.Context, actor model.User, projectID, id uint64, write GeneralWrite) (uint, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	title, department, content, reason, err := cleanGeneral(write, true)
	if err != nil {
		return 0, err
	}
	version, err := s.docs.Update(ctx, projectID, actor.ID, id, write.Version, title, department, content, reason, s.now())
	return version, mapGeneralErr(err)
}

func (s *GeneralService) Delete(ctx context.Context, actor model.User, projectID, id uint64, version uint, reason string) (uint, error) {
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	clean, err := cleanReason(reason)
	if err != nil || version == 0 {
		return 0, ErrProjectInvalid
	}
	next, err := s.docs.SoftDelete(ctx, projectID, actor.ID, id, version, clean, s.now())
	return next, mapGeneralErr(err)
}

func (s *GeneralService) Revisions(ctx context.Context, actor model.User, projectID, id uint64) ([]model.GeneralRevision, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	return s.docs.ListRevisions(ctx, projectID, id)
}

func (s *GeneralService) Compare(ctx context.Context, actor model.User, projectID, id uint64, from, to uint) (GeneralCompare, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return GeneralCompare{}, err
	}
	if from == 0 || to == 0 {
		return GeneralCompare{}, model.ErrNotFound
	}
	before, err := s.docs.Revision(ctx, projectID, id, from)
	if err != nil {
		return GeneralCompare{}, mapGeneralErr(err)
	}
	after, err := s.docs.Revision(ctx, projectID, id, to)
	if err != nil {
		return GeneralCompare{}, mapGeneralErr(err)
	}
	beforeBody, err := decodeGeneralBody(before.Snapshot)
	if err != nil {
		return GeneralCompare{}, err
	}
	afterBody, err := decodeGeneralBody(after.Snapshot)
	if err != nil {
		return GeneralCompare{}, err
	}
	return GeneralCompare{FromVersion: from, ToVersion: to, Before: beforeBody, After: afterBody}, nil
}

func (s *GeneralService) Markdown(ctx context.Context, actor model.User, projectID, id uint64) (string, string, error) {
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return "", "", err
	}
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return "", "", err
	}
	doc, err := s.docs.FindVisible(ctx, projectID, id)
	if err != nil {
		return "", "", mapGeneralErr(err)
	}
	return RenderGeneralMarkdown(project.Title, doc), MarkdownFilename(project.Title, "general", doc.Version), nil
}

func (s *GeneralService) gate(ctx context.Context, actor model.User, projectID uint64, write bool) error {
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

func cleanGeneral(write GeneralWrite, requireVersion bool) (string, string, string, string, error) {
	title := strings.TrimSpace(write.Title)
	department := strings.TrimSpace(write.Department)
	if title == "" || utf8.RuneCountInString(title) > 200 || utf8.RuneCountInString(department) > 100 {
		return "", "", "", "", ErrProjectInvalid
	}
	if utf8.RuneCountInString(write.Content) > generalContentLimit {
		return "", "", "", "", ErrProjectInvalid
	}
	if requireVersion && write.Version == 0 {
		return "", "", "", "", ErrProjectInvalid
	}
	reason, err := cleanReason(write.ChangeReason)
	if err != nil {
		return "", "", "", "", err
	}
	return title, department, write.Content, reason, nil
}

func decodeGeneralBody(raw json.RawMessage) (GeneralBody, error) {
	var body GeneralBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return GeneralBody{}, ErrProjectInvalid
	}
	return body, nil
}

func mapGeneralErr(err error) error {
	if err == nil {
		return nil
	}
	var conflict model.SpecConflict
	if errors.As(err, &conflict) {
		return GeneralDocConflictError{Current: conflict.Current}
	}
	if errors.Is(err, model.ErrArchived) {
		return ErrProjectArchived
	}
	return err
}
