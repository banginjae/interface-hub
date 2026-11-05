package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"interface-hub/internal/model"

	"gorm.io/gorm"
)

type ErrorCodeRepository struct {
	db *gorm.DB
}

func NewErrorCodeRepository(db *gorm.DB) *ErrorCodeRepository {
	return &ErrorCodeRepository{db: db}
}

func (r *ErrorCodeRepository) CountVisible(ctx context.Context, projectID uint64) (int, error) {
	var count int
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM error_codes WHERE project_id = ? AND deleted_at IS NULL
	`, projectID).Row().Scan(&count)
	if err != nil {
		return 0, ErrDatabase
	}
	return count, nil
}

func (r *ErrorCodeRepository) List(ctx context.Context, projectID uint64) ([]model.ErrorCode, error) {
	rows, err := r.listRows(ctx, projectID, 0)
	if err != nil {
		return nil, err
	}
	if err := r.attachUsages(ctx, rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *ErrorCodeRepository) FindVisible(ctx context.Context, projectID, id uint64) (model.ErrorCode, error) {
	rows, err := r.listRows(ctx, projectID, id)
	if err != nil {
		return model.ErrorCode{}, err
	}
	if len(rows) == 0 {
		return model.ErrorCode{}, model.ErrNotFound
	}
	if err := r.attachUsages(ctx, rows); err != nil {
		return model.ErrorCode{}, err
	}
	return rows[0], nil
}

func (r *ErrorCodeRepository) Create(ctx context.Context, projectID, actorID uint64, code model.ErrorCode, reason string, now time.Time) (model.ErrorCode, error) {
	var created model.ErrorCode
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		result := tx.Exec(`
			INSERT INTO error_codes
			(project_id, code, category, description, condition_text, handling, version, created_by, updated_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
		`, projectID, code.Code, code.Category, code.Description, code.ConditionText, code.Handling, actorID, actorID, now, now)
		if result.Error != nil {
			if isDuplicate(result.Error) {
				return model.ErrErrorCodeTaken
			}
			return result.Error
		}
		var id uint64
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Row().Scan(&id); err != nil {
			return err
		}
		created = code
		created.ID = id
		created.ProjectID = projectID
		created.Version = 1
		created.CreatedBy = actorID
		created.UpdatedBy = actorID
		created.CreatedAt = now
		created.UpdatedAt = now
		return insertErrorRevision(tx, created, 1, reason, actorID, "CREATE", now)
	})
	return created, mapErrorCodeErr(err)
}

func (r *ErrorCodeRepository) Update(ctx context.Context, projectID, actorID, id uint64, version uint, code model.ErrorCode, reason string, now time.Time) (uint, error) {
	var next uint
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		current, err := lockErrorCode(tx, projectID, id)
		if err != nil {
			return err
		}
		if current != version {
			return model.SpecConflict{Current: current}
		}
		result := tx.Exec(`
			UPDATE error_codes
			SET code = ?, category = ?, description = ?, condition_text = ?, handling = ?,
			    version = version + 1, updated_by = ?, updated_at = ?
			WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND version = ?
		`, code.Code, code.Category, code.Description, code.ConditionText, code.Handling, actorID, now, id, projectID, version)
		if result.Error != nil {
			if isDuplicate(result.Error) {
				return model.ErrErrorCodeTaken
			}
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.SpecConflict{Current: current}
		}
		code.ID = id
		code.ProjectID = projectID
		code.Version = version + 1
		next = code.Version
		return insertErrorRevision(tx, code, next, reason, actorID, "UPDATE", now)
	})
	return next, mapErrorCodeErr(err)
}

func (r *ErrorCodeRepository) SoftDelete(ctx context.Context, projectID, actorID, id uint64, version uint, reason string, now time.Time) (uint, error) {
	var next uint
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		current, err := lockErrorCode(tx, projectID, id)
		if err != nil {
			return err
		}
		if current != version {
			return model.SpecConflict{Current: current}
		}
		var refs int
		if err := tx.Raw(`SELECT COUNT(*) FROM spec_item_error_codes WHERE error_code_id = ?`, id).Row().Scan(&refs); err != nil {
			return err
		}
		if refs > 0 {
			return model.ErrErrorCodeInUse
		}
		var row struct {
			ID            uint64
			ProjectID     uint64 `gorm:"column:project_id"`
			Code          string
			Category      string
			Description   string
			ConditionText string `gorm:"column:condition_text"`
			Handling      string
		}
		err = tx.Raw(`
			SELECT id, project_id, code, category, description, IFNULL(condition_text, '') AS condition_text, IFNULL(handling, '') AS handling
			FROM error_codes WHERE id = ? AND project_id = ? AND deleted_at IS NULL
		`, id, projectID).Scan(&row).Error
		if err != nil {
			return err
		}
		if row.ID == 0 {
			return model.ErrNotFound
		}
		saved := model.ErrorCode{
			ID: row.ID, ProjectID: row.ProjectID, Code: row.Code, Category: row.Category,
			Description: row.Description, ConditionText: row.ConditionText, Handling: row.Handling,
		}
		result := tx.Exec(`
			UPDATE error_codes
			SET deleted_at = ?, version = version + 1, updated_by = ?, updated_at = ?
			WHERE id = ? AND project_id = ? AND deleted_at IS NULL AND version = ?
		`, now, actorID, now, id, projectID, version)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.SpecConflict{Current: current}
		}
		saved.Version = version + 1
		next = saved.Version
		return insertErrorRevision(tx, saved, next, reason, actorID, "DELETE", now)
	})
	return next, mapErrorCodeErr(err)
}

func (r *ErrorCodeRepository) ListRevisions(ctx context.Context, projectID, id uint64) ([]model.ErrorCodeRevision, error) {
	return r.revisions(ctx, projectID, id, 0)
}

func (r *ErrorCodeRepository) Revision(ctx context.Context, projectID, id uint64, version uint) (model.ErrorCodeRevision, error) {
	rows, err := r.revisions(ctx, projectID, id, version)
	if err != nil {
		return model.ErrorCodeRevision{}, err
	}
	if len(rows) == 0 {
		return model.ErrorCodeRevision{}, model.ErrNotFound
	}
	return rows[0], nil
}

func (r *ErrorCodeRepository) listRows(ctx context.Context, projectID, id uint64) ([]model.ErrorCode, error) {
	query := `
		SELECT d.id, d.project_id, d.code, d.category, d.description,
		       IFNULL(d.condition_text, '') AS condition_text, IFNULL(d.handling, '') AS handling, d.version,
		       d.created_by, cu.name AS author, d.updated_by, uu.name AS updater, d.created_at, d.updated_at
		FROM error_codes d
		JOIN users cu ON cu.id = d.created_by
		JOIN users uu ON uu.id = d.updated_by
		WHERE d.project_id = ? AND d.deleted_at IS NULL
	`
	args := []any{projectID}
	if id > 0 {
		query += " AND d.id = ?"
		args = append(args, id)
	}
	query += " ORDER BY d.code ASC, d.id ASC"
	type row struct {
		ID            uint64
		ProjectID     uint64 `gorm:"column:project_id"`
		Code          string
		Category      string
		Description   string
		ConditionText string `gorm:"column:condition_text"`
		Handling      string
		Version       uint
		CreatedBy     uint64 `gorm:"column:created_by"`
		Author        string
		UpdatedBy     uint64 `gorm:"column:updated_by"`
		Updater       string
		CreatedAt     time.Time
		UpdatedAt     time.Time
	}
	var rows []row
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, ErrDatabase
	}
	out := make([]model.ErrorCode, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.ErrorCode{
			ID: item.ID, ProjectID: item.ProjectID, Code: item.Code, Category: item.Category,
			Description: item.Description, ConditionText: item.ConditionText, Handling: item.Handling,
			Version: item.Version, CreatedBy: item.CreatedBy, Author: item.Author,
			UpdatedBy: item.UpdatedBy, Updater: item.Updater, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
		})
	}
	return out, nil
}

func (r *ErrorCodeRepository) attachUsages(ctx context.Context, codes []model.ErrorCode) error {
	if len(codes) == 0 {
		return nil
	}
	ids := make([]uint64, 0, len(codes))
	index := map[uint64]int{}
	for i, code := range codes {
		ids = append(ids, code.ID)
		index[code.ID] = i
		codes[i].Usages = []model.ErrorCodeUsage{}
	}
	type row struct {
		ErrorCodeID uint64 `gorm:"column:error_code_id"`
		Kind        string
		Title       string
		ItemUID     string `gorm:"column:item_uid"`
		ItemName    string `gorm:"column:item_name"`
	}
	var rows []row
	if err := r.db.WithContext(ctx).Raw(`
		SELECT l.error_code_id, d.kind, d.title, i.item_uid, i.name AS item_name
		FROM spec_item_error_codes l
		JOIN spec_items i ON i.id = l.spec_item_id
		JOIN spec_documents d ON d.id = i.document_id
		WHERE l.error_code_id IN ?
		ORDER BY d.kind ASC, i.sort_order ASC, i.id ASC
	`, ids).Scan(&rows).Error; err != nil {
		return ErrDatabase
	}
	for _, item := range rows {
		at, ok := index[item.ErrorCodeID]
		if !ok {
			continue
		}
		codes[at].Usages = append(codes[at].Usages, model.ErrorCodeUsage{
			Kind: item.Kind, Title: item.Title, ItemUID: item.ItemUID, ItemName: item.ItemName,
		})
		codes[at].ReferenceCount = len(codes[at].Usages)
	}
	return nil
}

func (r *ErrorCodeRepository) revisions(ctx context.Context, projectID, id uint64, version uint) ([]model.ErrorCodeRevision, error) {
	var exists int
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM error_codes WHERE project_id = ? AND id = ?`, projectID, id).Row().Scan(&exists); err != nil {
		return nil, ErrDatabase
	}
	if exists != 1 {
		return nil, model.ErrNotFound
	}
	query := `
		SELECT r.version, r.change_reason, r.actor_id, u.name AS actor_name, r.summary_json, r.snapshot_json, r.created_at
		FROM error_code_revisions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.error_code_id = ?
	`
	args := []any{id}
	if version > 0 {
		query += " AND r.version = ?"
		args = append(args, version)
	}
	query += " ORDER BY r.version DESC"
	type row struct {
		Version      uint
		ChangeReason string `gorm:"column:change_reason"`
		ActorID      uint64 `gorm:"column:actor_id"`
		ActorName    string `gorm:"column:actor_name"`
		Summary      string `gorm:"column:summary_json"`
		Snapshot     string `gorm:"column:snapshot_json"`
		CreatedAt    time.Time
	}
	var rows []row
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, ErrDatabase
	}
	out := make([]model.ErrorCodeRevision, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.ErrorCodeRevision{
			Version: item.Version, ChangeReason: item.ChangeReason, ActorID: item.ActorID, ActorName: item.ActorName,
			Summary: []byte(item.Summary), Snapshot: []byte(item.Snapshot), CreatedAt: item.CreatedAt,
		})
	}
	return out, nil
}

func lockErrorCode(tx *gorm.DB, projectID, id uint64) (uint, error) {
	var version uint
	var deleted sql.NullTime
	err := tx.Raw(`
		SELECT version, deleted_at FROM error_codes WHERE project_id = ? AND id = ? FOR UPDATE
	`, projectID, id).Row().Scan(&version, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, model.ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if deleted.Valid {
		return 0, model.ErrNotFound
	}
	return version, nil
}

func insertErrorRevision(tx *gorm.DB, code model.ErrorCode, version uint, reason string, actorID uint64, op string, now time.Time) error {
	summary, err := json.Marshal(map[string]string{"op": op, "code": code.Code})
	if err != nil {
		return err
	}
	snapshot, err := json.Marshal(map[string]any{
		"code": code.Code, "category": code.Category, "description": code.Description,
		"conditionText": code.ConditionText, "handling": code.Handling,
	})
	if err != nil {
		return err
	}
	return tx.Exec(`
		INSERT INTO error_code_revisions
		(error_code_id, version, change_reason, actor_id, summary_json, snapshot_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, code.ID, version, reason, actorID, string(summary), string(snapshot), now).Error
}

func mapErrorCodeErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, model.ErrNotFound) || errors.Is(err, model.ErrArchived) || errors.Is(err, model.ErrErrorCodeTaken) || errors.Is(err, model.ErrErrorCodeInUse) {
		return err
	}
	var conflict model.SpecConflict
	if errors.As(err, &conflict) {
		return err
	}
	return ErrDatabase
}
