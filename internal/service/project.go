package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"interface-hub/internal/model"
)

var (
	ErrProjectInvalid   = errors.New("invalid project request")
	ErrProjectForbidden = errors.New("project forbidden")
	ErrProjectArchived  = errors.New("project archived")
	ErrCreatorLocked    = errors.New("creator permission locked")
	ErrMemberInactive   = errors.New("member account inactive")
)

const memberCandidateLimit = 20

type VersionConflictError struct {
	Current uint
}

func (e VersionConflictError) Error() string {
	return "project version conflict"
}

type ProjectStore interface {
	List(ctx context.Context, actor model.User) ([]model.ProjectSummary, error)
	Find(ctx context.Context, id uint64) (model.Project, error)
	CreateWithCreator(ctx context.Context, project model.Project) (model.Project, error)
	UpdateIfVersion(ctx context.Context, project model.Project, expected uint) (model.Project, bool, error)
	ListMembers(ctx context.Context, projectID uint64) ([]model.MemberRecord, error)
	FindMember(ctx context.Context, projectID, userID uint64) (model.ProjectMember, error)
	AddMember(ctx context.Context, member model.ProjectMember) error
	MemberCandidates(ctx context.Context, projectID uint64, query string, limit int) ([]model.MemberCandidate, error)
	UpdateMember(ctx context.Context, member model.ProjectMember) error
	DeleteMember(ctx context.Context, projectID, userID uint64) error
}

type ProjectService struct {
	projects ProjectStore
	users    UserStore
	now      func() time.Time
}

type ProjectInput struct {
	Title       string
	Description string
}

type ProjectChange struct {
	Version     uint
	Title       string
	Description string
	Status      string
}

type ProjectView struct {
	Project      model.Project
	CreatorName  string
	MyPermission string
}

func NewProjectService(projects ProjectStore, users UserStore) *ProjectService {
	return &ProjectService{
		projects: projects,
		users:    users,
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Second) },
	}
}

func (s *ProjectService) List(ctx context.Context, actor model.User) ([]model.ProjectSummary, error) {
	if !actor.Active {
		return nil, ErrUnauthorized
	}
	return s.projects.List(ctx, actor)
}

func (s *ProjectService) Create(ctx context.Context, actor model.User, input ProjectInput) (ProjectView, error) {
	if !actor.Active {
		return ProjectView{}, ErrUnauthorized
	}
	title, description, err := normalizeProjectText(input.Title, input.Description)
	if err != nil {
		return ProjectView{}, err
	}
	now := s.now()
	created, err := s.projects.CreateWithCreator(ctx, model.Project{
		Title:       title,
		Description: description,
		Status:      model.ProjectActive,
		CreatedBy:   actor.ID,
		UpdatedBy:   actor.ID,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1,
	})
	if err != nil {
		return ProjectView{}, err
	}
	return s.view(ctx, created, model.PermissionWrite)
}

func (s *ProjectService) Detail(ctx context.Context, actor model.User, projectID uint64) (ProjectView, error) {
	project, permission, err := s.readable(ctx, actor, projectID)
	if err != nil {
		return ProjectView{}, err
	}
	return s.view(ctx, project, permission)
}

func (s *ProjectService) Update(ctx context.Context, actor model.User, projectID uint64, change ProjectChange) (ProjectView, error) {
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return ProjectView{}, err
	}
	if !isProjectAdmin(actor, project) {
		return ProjectView{}, ErrProjectForbidden
	}
	title, description, err := normalizeProjectText(change.Title, change.Description)
	if err != nil || !validProjectStatus(change.Status) || change.Version == 0 {
		return ProjectView{}, ErrProjectInvalid
	}
	if project.Status == model.ProjectArchived {
		restoring := change.Status == model.ProjectActive && title == project.Title && description == project.Description
		if !restoring {
			return ProjectView{}, ErrProjectArchived
		}
	}
	project.Title = title
	project.Description = description
	project.Status = change.Status
	project.UpdatedBy = actor.ID
	project.UpdatedAt = s.now()
	updated, ok, err := s.projects.UpdateIfVersion(ctx, project, change.Version)
	if err != nil {
		return ProjectView{}, err
	}
	if !ok {
		current, findErr := s.projects.Find(ctx, projectID)
		if findErr != nil {
			return ProjectView{}, findErr
		}
		return ProjectView{}, VersionConflictError{Current: current.Version}
	}
	return s.view(ctx, updated, model.PermissionWrite)
}

func (s *ProjectService) view(ctx context.Context, project model.Project, permission string) (ProjectView, error) {
	creator, err := s.users.FindByID(ctx, project.CreatedBy)
	if err != nil {
		return ProjectView{}, err
	}
	return ProjectView{Project: project, CreatorName: creator.Name, MyPermission: permission}, nil
}

func (s *ProjectService) Members(ctx context.Context, actor model.User, projectID uint64) (model.Project, []model.MemberRecord, error) {
	project, _, err := s.readable(ctx, actor, projectID)
	if err != nil {
		return model.Project{}, nil, err
	}
	members, err := s.projects.ListMembers(ctx, projectID)
	if err != nil {
		return model.Project{}, nil, err
	}
	return project, members, nil
}

func (s *ProjectService) AddMember(ctx context.Context, actor model.User, projectID uint64, employeeNo, permission string) (model.MemberRecord, error) {
	project, err := s.editableAdmin(ctx, actor, projectID)
	if err != nil {
		return model.MemberRecord{}, err
	}
	if !validMemberPermission(permission) {
		return model.MemberRecord{}, ErrProjectInvalid
	}
	employeeNo = strings.TrimSpace(employeeNo)
	user, err := s.users.FindByEmployeeNo(ctx, employeeNo)
	if err != nil {
		return model.MemberRecord{}, err
	}
	if !user.Active {
		return model.MemberRecord{}, ErrMemberInactive
	}
	now := s.now()
	err = s.projects.AddMember(ctx, model.ProjectMember{
		ProjectID:  project.ID,
		UserID:     user.ID,
		Permission: permission,
		GrantedBy:  actor.ID,
		CreatedAt:  now,
		UpdatedAt:  now,
	})
	if err != nil {
		return model.MemberRecord{}, err
	}
	return model.MemberRecord{
		UserID:     user.ID,
		EmployeeNo: user.EmployeeNo,
		Name:       user.Name,
		Permission: permission,
		Active:     user.Active,
	}, nil
}

func (s *ProjectService) MemberCandidates(ctx context.Context, actor model.User, projectID uint64, query string) ([]model.MemberCandidate, error) {
	project, err := s.editableAdmin(ctx, actor, projectID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return []model.MemberCandidate{}, nil
	}
	if utf8.RuneCountInString(query) > 50 {
		return nil, ErrProjectInvalid
	}
	return s.projects.MemberCandidates(ctx, project.ID, query, memberCandidateLimit)
}

func (s *ProjectService) UpdateMember(ctx context.Context, actor model.User, projectID, userID uint64, permission string) (model.MemberRecord, error) {
	project, err := s.editableAdmin(ctx, actor, projectID)
	if err != nil {
		return model.MemberRecord{}, err
	}
	if !validMemberPermission(permission) {
		return model.MemberRecord{}, ErrProjectInvalid
	}
	if userID == project.CreatedBy && permission != model.PermissionWrite {
		return model.MemberRecord{}, ErrCreatorLocked
	}
	if _, err := s.projects.FindMember(ctx, project.ID, userID); err != nil {
		return model.MemberRecord{}, err
	}
	err = s.projects.UpdateMember(ctx, model.ProjectMember{
		ProjectID:  project.ID,
		UserID:     userID,
		Permission: permission,
		GrantedBy:  actor.ID,
		UpdatedAt:  s.now(),
	})
	if err != nil {
		return model.MemberRecord{}, err
	}
	return s.memberRecord(ctx, project, userID, permission)
}

func (s *ProjectService) RemoveMember(ctx context.Context, actor model.User, projectID, userID uint64) error {
	project, err := s.editableAdmin(ctx, actor, projectID)
	if err != nil {
		return err
	}
	if userID == project.CreatedBy {
		return ErrCreatorLocked
	}
	return s.projects.DeleteMember(ctx, project.ID, userID)
}

func (s *ProjectService) readable(ctx context.Context, actor model.User, projectID uint64) (model.Project, string, error) {
	if !actor.Active {
		return model.Project{}, "", ErrUnauthorized
	}
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return model.Project{}, "", err
	}
	var member *model.ProjectMember
	if actor.Role != model.RoleMaster {
		found, findErr := s.projects.FindMember(ctx, project.ID, actor.ID)
		if findErr == nil {
			member = &found
		} else if !errors.Is(findErr, model.ErrNotFound) {
			return model.Project{}, "", findErr
		}
	}
	permission := permissionFor(actor, project, member)
	if permission == model.PermissionNone {
		return model.Project{}, "", ErrProjectForbidden
	}
	return project, permission, nil
}

func (s *ProjectService) editableAdmin(ctx context.Context, actor model.User, projectID uint64) (model.Project, error) {
	if !actor.Active {
		return model.Project{}, ErrUnauthorized
	}
	project, err := s.projects.Find(ctx, projectID)
	if err != nil {
		return model.Project{}, err
	}
	if !isProjectAdmin(actor, project) {
		return model.Project{}, ErrProjectForbidden
	}
	if project.Status != model.ProjectActive {
		return model.Project{}, ErrProjectArchived
	}
	return project, nil
}

func (s *ProjectService) memberRecord(ctx context.Context, project model.Project, userID uint64, permission string) (model.MemberRecord, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return model.MemberRecord{}, err
	}
	return model.MemberRecord{
		UserID:     user.ID,
		EmployeeNo: user.EmployeeNo,
		Name:       user.Name,
		Permission: permission,
		Active:     user.Active,
	}, nil
}

func permissionFor(actor model.User, project model.Project, member *model.ProjectMember) string {
	if !actor.Active {
		return model.PermissionNone
	}
	if actor.Role == model.RoleMaster {
		return model.PermissionWrite
	}
	if member == nil {
		return model.PermissionNone
	}
	return member.Permission
}

func isProjectAdmin(actor model.User, project model.Project) bool {
	return actor.Active && (actor.Role == model.RoleMaster || actor.ID == project.CreatedBy)
}

func normalizeProjectText(title, description string) (string, string, error) {
	title = strings.TrimSpace(title)
	description = strings.TrimSpace(description)
	if title == "" || utf8.RuneCountInString(title) > 200 || utf8.RuneCountInString(description) > 20000 {
		return "", "", ErrProjectInvalid
	}
	return title, description, nil
}

func validProjectStatus(status string) bool {
	return status == model.ProjectActive || status == model.ProjectArchived
}

func validMemberPermission(permission string) bool {
	return permission == model.PermissionRead || permission == model.PermissionWrite
}

func SpecKinds() []string {
	return []string{"API", "MQTT", "WEBSOCKET", "DEVICE_PROTOCOL"}
}
