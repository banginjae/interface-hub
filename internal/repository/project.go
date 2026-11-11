package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"interface-hub/internal/model"

	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
)

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

func (r *ProjectRepository) List(ctx context.Context, actor model.User) ([]model.ProjectSummary, error) {
	type row struct {
		ID            uint64
		Title         string
		Status        string
		CreatedByID   uint64 `gorm:"column:created_by_id"`
		CreatedByName string `gorm:"column:created_by_name"`
		CreatedAt     time.Time
		MemberPerm    *string `gorm:"column:member_permission"`
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT p.id, p.title, p.status, p.created_at,
		       creator.id AS created_by_id, creator.name AS created_by_name,
		       m.permission AS member_permission
		FROM projects p
		JOIN users creator ON creator.id = p.created_by
		LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
		ORDER BY p.created_at DESC, p.id DESC
	`, actor.ID).Scan(&rows).Error
	if err != nil {
		return nil, mapProjectErr(err)
	}
	out := make([]model.ProjectSummary, 0, len(rows))
	for _, item := range rows {
		permission := model.PermissionNone
		if actor.Role == model.RoleMaster {
			permission = model.PermissionWrite
		} else if item.MemberPerm != nil {
			permission = *item.MemberPerm
		}
		out = append(out, model.ProjectSummary{
			ID:            item.ID,
			Title:         item.Title,
			Status:        item.Status,
			CreatedByID:   item.CreatedByID,
			CreatedByName: item.CreatedByName,
			CreatedAt:     item.CreatedAt,
			MyPermission:  permission,
		})
	}
	return out, nil
}

func (r *ProjectRepository) Find(ctx context.Context, id uint64) (model.Project, error) {
	var project model.Project
	err := r.db.WithContext(ctx).Where("id = ?", id).Take(&project).Error
	if err != nil {
		return model.Project{}, mapProjectErr(err)
	}
	return project, nil
}

func (r *ProjectRepository) CreateWithCreator(ctx context.Context, project model.Project) (model.Project, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&project).Error; err != nil {
			return err
		}
		member := model.ProjectMember{
			ProjectID:  project.ID,
			UserID:     project.CreatedBy,
			Permission: model.PermissionWrite,
			GrantedBy:  project.CreatedBy,
			CreatedAt:  project.CreatedAt,
			UpdatedAt:  project.UpdatedAt,
		}
		return tx.Create(&member).Error
	})
	if err != nil {
		return model.Project{}, mapProjectErr(err)
	}
	return project, nil
}

func (r *ProjectRepository) UpdateIfVersion(ctx context.Context, project model.Project, expected uint) (model.Project, bool, error) {
	res := r.db.WithContext(ctx).Model(&model.Project{}).
		Where("id = ? AND version = ?", project.ID, expected).
		Updates(map[string]any{
			"title":       project.Title,
			"description": project.Description,
			"status":      project.Status,
			"updated_by":  project.UpdatedBy,
			"updated_at":  project.UpdatedAt,
			"version":     expected + 1,
		})
	if res.Error != nil {
		return model.Project{}, false, mapProjectErr(res.Error)
	}
	if res.RowsAffected == 0 {
		return model.Project{}, false, nil
	}
	updated, err := r.Find(ctx, project.ID)
	return updated, true, err
}

func (r *ProjectRepository) ListMembers(ctx context.Context, projectID uint64) ([]model.MemberRecord, error) {
	var rows []model.MemberRecord
	err := r.db.WithContext(ctx).Raw(`
		SELECT m.user_id, u.employee_no, u.name, m.permission, u.active
		FROM project_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.project_id = ?
		ORDER BY m.created_at ASC, m.user_id ASC
	`, projectID).Scan(&rows).Error
	if err != nil {
		return nil, mapProjectErr(err)
	}
	if rows == nil {
		rows = []model.MemberRecord{}
	}
	return rows, nil
}

func (r *ProjectRepository) FindMember(ctx context.Context, projectID, userID uint64) (model.ProjectMember, error) {
	var member model.ProjectMember
	err := r.db.WithContext(ctx).Where("project_id = ? AND user_id = ?", projectID, userID).Take(&member).Error
	if err != nil {
		return model.ProjectMember{}, mapProjectErr(err)
	}
	return member, nil
}

func (r *ProjectRepository) MemberCandidates(ctx context.Context, projectID uint64, query string, limit int) ([]model.MemberCandidate, error) {
	pattern := "%" + likeEscaper.Replace(query) + "%"
	var rows []model.MemberCandidate
	err := r.db.WithContext(ctx).Raw(`
		SELECT u.id AS user_id, u.employee_no, u.name
		FROM users u
		WHERE u.active = 1
		  AND (u.name LIKE ? ESCAPE '!' OR u.employee_no LIKE ? ESCAPE '!')
		  AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.user_id = u.id)
		ORDER BY u.name ASC, u.employee_no ASC
		LIMIT ?
	`, pattern, pattern, projectID, limit).Scan(&rows).Error
	if err != nil {
		return nil, mapProjectErr(err)
	}
	if rows == nil {
		rows = []model.MemberCandidate{}
	}
	return rows, nil
}

var likeEscaper = strings.NewReplacer("!", "!!", "%", "!%", "_", "!_")

func (r *ProjectRepository) AddMember(ctx context.Context, member model.ProjectMember) error {
	return mapProjectErr(r.db.WithContext(ctx).Create(&member).Error)
}

func (r *ProjectRepository) UpdateMember(ctx context.Context, member model.ProjectMember) error {
	res := r.db.WithContext(ctx).Model(&model.ProjectMember{}).
		Where("project_id = ? AND user_id = ?", member.ProjectID, member.UserID).
		Updates(map[string]any{
			"permission": member.Permission,
			"granted_by": member.GrantedBy,
			"updated_at": member.UpdatedAt,
		})
	if res.Error != nil {
		return mapProjectErr(res.Error)
	}
	if res.RowsAffected == 0 {
		if _, err := r.FindMember(ctx, member.ProjectID, member.UserID); err != nil {
			return err
		}
	}
	return nil
}

func (r *ProjectRepository) DeleteMember(ctx context.Context, projectID, userID uint64) error {
	res := r.db.WithContext(ctx).Where("project_id = ? AND user_id = ?", projectID, userID).Delete(&model.ProjectMember{})
	if res.Error != nil {
		return mapProjectErr(res.Error)
	}
	if res.RowsAffected == 0 {
		return model.ErrNotFound
	}
	return nil
}

func mapProjectErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.ErrNotFound
	}
	var mysqlErr *mysqldriver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return model.ErrMemberExists
	}
	return ErrDatabase
}
