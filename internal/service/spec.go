package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"interface-hub/internal/model"
)

type SpecStore interface {
	ListSummaries(ctx context.Context, projectID uint64) ([]model.SpecSummaryRow, error)
	FindDocument(ctx context.Context, projectID uint64, kind string) (model.SpecDocument, []model.SpecItem, error)
	CreateDocument(ctx context.Context, projectID, actorID uint64, kind, title, overview string, now time.Time) (model.SpecDocument, error)
	UpdateOverview(ctx context.Context, projectID, actorID uint64, kind string, version uint, title, overview, reason string, now time.Time) (uint, error)
	CreateItem(ctx context.Context, projectID, actorID uint64, kind string, version uint, itemUID string, item model.SpecItemWrite, reason string, now time.Time) (uint, error)
	UpdateItem(ctx context.Context, projectID, actorID uint64, kind, itemUID string, version uint, item model.SpecItemWrite, reason string, now time.Time) (uint, error)
	DeleteItem(ctx context.Context, projectID, actorID uint64, kind, itemUID string, version uint, reason string, now time.Time) (uint, error)
	Reorder(ctx context.Context, projectID, actorID uint64, kind string, version uint, uids []string, reason string, now time.Time) (uint, error)
	ListRevisions(ctx context.Context, projectID uint64, kind string) ([]model.SpecRevision, error)
	Revision(ctx context.Context, projectID uint64, kind string, version uint) (model.SpecRevision, error)
}

type DocumentConflictError struct {
	Current uint
}

func (e DocumentConflictError) Error() string { return "document version conflict" }

type ItemSetError struct {
	Current uint
}

func (e ItemSetError) Error() string { return "item set changed" }

type SpecService struct {
	specs    SpecStore
	projects ProjectStore
	now      func() time.Time
}

func NewSpecService(specs SpecStore, projects ProjectStore) *SpecService {
	return &SpecService{
		specs:    specs,
		projects: projects,
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Second) },
	}
}

type SpecItemChange struct {
	Version      uint
	ChangeReason string
	Name         string
	Summary      string
	Status       string
	Payload      json.RawMessage
	ErrorCodeIDs []uint64
}

type SpecOverviewChange struct {
	Version      uint
	ChangeReason string
	Title        string
	Overview     json.RawMessage
}

type SpecItemRef struct {
	ItemUID string
	Name    string
}

type SpecCompare struct {
	FromVersion     uint
	ToVersion       uint
	OverviewChanged bool
	Added           []SpecItemRef
	Removed         []SpecItemRef
	Updated         []SpecItemRef
	Before          json.RawMessage
	After           json.RawMessage
}

func (s *SpecService) Summaries(ctx context.Context, projectID uint64) ([]model.SpecSummaryRow, error) {
	return s.specs.ListSummaries(ctx, projectID)
}

func (s *SpecService) Create(ctx context.Context, actor model.User, projectID uint64, kind, title string) (model.SpecDocument, error) {
	if !supportedSpecKind(kind) {
		return model.SpecDocument{}, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return model.SpecDocument{}, err
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 200 {
		return model.SpecDocument{}, ErrProjectInvalid
	}
	overview := emptyOverview(kind)
	doc, err := s.specs.CreateDocument(ctx, projectID, actor.ID, kind, title, string(overview), s.now())
	return doc, mapSpecErr(err)
}

func (s *SpecService) Get(ctx context.Context, actor model.User, projectID uint64, kind string) (model.SpecDocument, []model.SpecItem, error) {
	if !supportedSpecKind(kind) {
		return model.SpecDocument{}, nil, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return model.SpecDocument{}, nil, err
	}
	doc, items, err := s.specs.FindDocument(ctx, projectID, kind)
	return doc, items, mapSpecErr(err)
}

func (s *SpecService) UpdateOverview(ctx context.Context, actor model.User, projectID uint64, kind string, change SpecOverviewChange) (uint, error) {
	if !supportedSpecKind(kind) {
		return 0, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	if change.Version < 1 {
		return 0, ErrProjectInvalid
	}
	reason, err := cleanReason(change.ChangeReason)
	if err != nil {
		return 0, err
	}
	title := strings.TrimSpace(change.Title)
	if title == "" || utf8.RuneCountInString(title) > 200 {
		return 0, ErrProjectInvalid
	}
	overview, err := normalizeOverview(kind, change.Overview)
	if err != nil {
		return 0, err
	}
	version, err := s.specs.UpdateOverview(ctx, projectID, actor.ID, kind, change.Version, title, string(overview), reason, s.now())
	return version, mapSpecErr(err)
}

func (s *SpecService) CreateItem(ctx context.Context, actor model.User, projectID uint64, kind string, change SpecItemChange) (uint, string, error) {
	if !supportedSpecKind(kind) {
		return 0, "", model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, "", err
	}
	item, reason, err := s.prepareItem(kind, change)
	if err != nil {
		return 0, "", err
	}
	uid, err := newItemUID()
	if err != nil {
		return 0, "", err
	}
	version, err := s.specs.CreateItem(ctx, projectID, actor.ID, kind, change.Version, uid, item, reason, s.now())
	return version, uid, mapSpecErr(err)
}

func (s *SpecService) UpdateItem(ctx context.Context, actor model.User, projectID uint64, kind, itemUID string, change SpecItemChange) (uint, error) {
	if !supportedSpecKind(kind) || !validItemUID(itemUID) {
		return 0, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	item, reason, err := s.prepareItem(kind, change)
	if err != nil {
		return 0, err
	}
	version, err := s.specs.UpdateItem(ctx, projectID, actor.ID, kind, itemUID, change.Version, item, reason, s.now())
	return version, mapSpecErr(err)
}

func (s *SpecService) DeleteItem(ctx context.Context, actor model.User, projectID uint64, kind, itemUID string, version uint, reason string) (uint, error) {
	if !supportedSpecKind(kind) || !validItemUID(itemUID) {
		return 0, model.ErrNotFound
	}
	if version < 1 {
		return 0, ErrProjectInvalid
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	clean, err := cleanReason(reason)
	if err != nil {
		return 0, err
	}
	next, err := s.specs.DeleteItem(ctx, projectID, actor.ID, kind, itemUID, version, clean, s.now())
	return next, mapSpecErr(err)
}

func (s *SpecService) Reorder(ctx context.Context, actor model.User, projectID uint64, kind string, version uint, reason string, uids []string) (uint, error) {
	if !supportedSpecKind(kind) {
		return 0, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, true); err != nil {
		return 0, err
	}
	if version < 1 {
		return 0, ErrProjectInvalid
	}
	clean, err := cleanReason(reason)
	if err != nil {
		return 0, err
	}
	for _, uid := range uids {
		if !validItemUID(uid) {
			return 0, ErrProjectInvalid
		}
	}
	next, err := s.specs.Reorder(ctx, projectID, actor.ID, kind, version, uids, clean, s.now())
	return next, mapSpecErr(err)
}

func (s *SpecService) Revisions(ctx context.Context, actor model.User, projectID uint64, kind string) ([]model.SpecRevision, error) {
	if !supportedSpecKind(kind) {
		return nil, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return nil, err
	}
	rows, err := s.specs.ListRevisions(ctx, projectID, kind)
	return rows, mapSpecErr(err)
}

func (s *SpecService) Compare(ctx context.Context, actor model.User, projectID uint64, kind string, from, to uint) (SpecCompare, error) {
	if !supportedSpecKind(kind) || from < 1 || to < 1 {
		return SpecCompare{}, model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return SpecCompare{}, err
	}
	before, err := s.specs.Revision(ctx, projectID, kind, from)
	if err != nil {
		return SpecCompare{}, mapSpecErr(err)
	}
	after, err := s.specs.Revision(ctx, projectID, kind, to)
	if err != nil {
		return SpecCompare{}, mapSpecErr(err)
	}
	result, err := compareSnapshots(from, to, before.Snapshot, after.Snapshot)
	if err != nil {
		return SpecCompare{}, err
	}
	return result, nil
}

func (s *SpecService) Markdown(ctx context.Context, actor model.User, projectID uint64, kind string) (string, string, error) {
	if !supportedSpecKind(kind) {
		return "", "", model.ErrNotFound
	}
	if err := s.gate(ctx, actor, projectID, false); err != nil {
		return "", "", err
	}
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return "", "", err
	}
	doc, items, err := s.specs.FindDocument(ctx, projectID, kind)
	if err != nil {
		return "", "", mapSpecErr(err)
	}
	return renderMarkdown(kind, project.Title, doc, items), MarkdownFilename(project.Title, kind, doc.Version), nil
}

func (s *SpecService) prepareItem(kind string, change SpecItemChange) (model.SpecItemWrite, string, error) {
	if !supportedSpecKind(kind) {
		return model.SpecItemWrite{}, "", model.ErrNotFound
	}
	if change.Version < 1 {
		return model.SpecItemWrite{}, "", ErrProjectInvalid
	}
	reason, err := cleanReason(change.ChangeReason)
	if err != nil {
		return model.SpecItemWrite{}, "", err
	}
	name := strings.TrimSpace(change.Name)
	summary := strings.TrimSpace(change.Summary)
	if name == "" || utf8.RuneCountInString(name) > 300 || utf8.RuneCountInString(summary) > 500 {
		return model.SpecItemWrite{}, "", ErrProjectInvalid
	}
	if change.Status != "ACTIVE" && change.Status != "DEPRECATED" {
		return model.SpecItemWrite{}, "", ErrProjectInvalid
	}
	payload, err := normalizePayload(kind, change.Payload)
	if err != nil {
		return model.SpecItemWrite{}, "", err
	}
	ids, err := uniqueErrorCodeIDs(change.ErrorCodeIDs)
	if err != nil {
		return model.SpecItemWrite{}, "", err
	}
	return model.SpecItemWrite{Name: name, Summary: summary, Status: change.Status, Payload: string(payload), ErrorCodeIDs: ids}, reason, nil
}

func uniqueErrorCodeIDs(ids []uint64) ([]uint64, error) {
	if ids == nil {
		return []uint64{}, nil
	}
	seen := map[uint64]struct{}{}
	out := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, ErrProjectInvalid
		}
		if _, ok := seen[id]; ok {
			return nil, ErrProjectInvalid
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

func (s *SpecService) gate(ctx context.Context, actor model.User, projectID uint64, write bool) error {
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

func cleanReason(value string) (string, error) {
	reason := strings.TrimSpace(value)
	if reason == "" || utf8.RuneCountInString(reason) > 500 {
		return "", ErrProjectInvalid
	}
	return reason, nil
}

func mapSpecErr(err error) error {
	if err == nil {
		return nil
	}
	var conflict model.SpecConflict
	if errors.As(err, &conflict) {
		if conflict.ItemSet {
			return ItemSetError{Current: conflict.Current}
		}
		return DocumentConflictError{Current: conflict.Current}
	}
	if errors.Is(err, model.ErrArchived) {
		return ErrProjectArchived
	}
	if errors.Is(err, model.ErrSpecInput) {
		return ErrProjectInvalid
	}
	return err
}

func supportedSpecKind(kind string) bool {
	return kind == model.SpecKindAPI || kind == model.SpecKindMQTT || kind == model.SpecKindWebSocket || kind == model.SpecKindDevice
}

func emptyOverview(kind string) json.RawMessage {
	switch kind {
	case model.SpecKindMQTT:
		return EmptyMQTTOverview()
	case model.SpecKindWebSocket:
		return EmptyWebSocketOverview()
	case model.SpecKindDevice:
		return EmptyDeviceOverview()
	default:
		return EmptyAPIOverview()
	}
}

func normalizeOverview(kind string, raw json.RawMessage) (json.RawMessage, error) {
	switch kind {
	case model.SpecKindMQTT:
		return NormalizeMQTTOverview(raw)
	case model.SpecKindWebSocket:
		return NormalizeWebSocketOverview(raw)
	case model.SpecKindDevice:
		return NormalizeDeviceOverview(raw)
	default:
		return NormalizeAPIOverview(raw)
	}
}

func normalizePayload(kind string, raw json.RawMessage) (json.RawMessage, error) {
	switch kind {
	case model.SpecKindMQTT:
		return NormalizeMQTTPayload(raw)
	case model.SpecKindWebSocket:
		return NormalizeWebSocketPayload(raw)
	case model.SpecKindDevice:
		return NormalizeDevicePayload(raw)
	default:
		return NormalizeAPIPayload(raw)
	}
}

func renderMarkdown(kind, projectTitle string, doc model.SpecDocument, items []model.SpecItem) string {
	switch kind {
	case model.SpecKindMQTT:
		return RenderMQTTMarkdown(projectTitle, doc, items)
	case model.SpecKindWebSocket:
		return RenderWebSocketMarkdown(projectTitle, doc, items)
	case model.SpecKindDevice:
		return RenderDeviceMarkdown(projectTitle, doc, items)
	default:
		return RenderAPIMarkdown(projectTitle, doc, items)
	}
}

func newItemUID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}

func validItemUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
				return false
			}
		}
	}
	return true
}

type snapshotBody struct {
	Title    string          `json:"title"`
	Overview json.RawMessage `json:"overview"`
	Items    []snapshotItem  `json:"items"`
}

type snapshotItem struct {
	ItemUID      string                `json:"itemUid"`
	Name         string                `json:"name"`
	Summary      string                `json:"summary"`
	Status       string                `json:"status"`
	SortOrder    int                   `json:"sortOrder"`
	Payload      json.RawMessage       `json:"payload"`
	ErrorCodeIDs []uint64              `json:"errorCodeIds"`
	ErrorCodes   []model.ErrorCodeCopy `json:"errorCodes"`
}

func compareSnapshots(from, to uint, beforeRaw, afterRaw json.RawMessage) (SpecCompare, error) {
	var before snapshotBody
	var after snapshotBody
	if err := json.Unmarshal(beforeRaw, &before); err != nil {
		return SpecCompare{}, err
	}
	if err := json.Unmarshal(afterRaw, &after); err != nil {
		return SpecCompare{}, err
	}
	result := SpecCompare{
		FromVersion: from, ToVersion: to,
		OverviewChanged: before.Title != after.Title || canonical(before.Overview) != canonical(after.Overview),
		Added:           []SpecItemRef{}, Removed: []SpecItemRef{}, Updated: []SpecItemRef{},
		Before: beforeRaw, After: afterRaw,
	}
	previous := map[string]snapshotItem{}
	for _, item := range before.Items {
		previous[item.ItemUID] = item
	}
	current := map[string]bool{}
	for _, item := range after.Items {
		current[item.ItemUID] = true
		old, ok := previous[item.ItemUID]
		if !ok {
			result.Added = append(result.Added, SpecItemRef{ItemUID: item.ItemUID, Name: item.Name})
			continue
		}
		if itemChanged(old, item) {
			result.Updated = append(result.Updated, SpecItemRef{ItemUID: item.ItemUID, Name: item.Name})
		}
	}
	for _, item := range before.Items {
		if !current[item.ItemUID] {
			result.Removed = append(result.Removed, SpecItemRef{ItemUID: item.ItemUID, Name: item.Name})
		}
	}
	return result, nil
}

func itemChanged(left, right snapshotItem) bool {
	if left.Name != right.Name || left.Summary != right.Summary || left.Status != right.Status {
		return true
	}
	if canonical(left.Payload) != canonical(right.Payload) {
		return true
	}
	leftCodes, _ := json.Marshal(left.ErrorCodeIDs)
	rightCodes, _ := json.Marshal(right.ErrorCodeIDs)
	return string(leftCodes) != string(rightCodes)
}

func canonical(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return string(raw)
	}
	return string(encoded)
}
