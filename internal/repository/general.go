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

type GeneralRepository struct {
	db *gorm.DB
}

func NewGeneralRepository(db *gorm.DB) *GeneralRepository {
	return &GeneralRepository{db: db}
}

func (r *GeneralRepository) CountVisible(ctx context.Context, projectID uint64) (int, error) {
	var count int
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM general_documents WHERE project_id = ? AND deleted_at IS NULL
	`, projectID).Row().Scan(&count)
	if err != nil {
		return 0, ErrDatabase
	}
	return count, nil
}

func (r *GeneralRepository) List(ctx context.Context, projectID uint64) ([]model.GeneralDocumentSummary, error) {
	type row struct {
		ID         uint64
		Title      string
		Department string
		Version    uint
		UpdatedBy  uint64 `gorm:"column:updated_by"`
		Updater    string
		UpdatedAt  time.Time
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.id, d.title, IFNULL(d.department, '') AS department, d.version,
		       d.updated_by, u.name AS updater, d.updated_at
		FROM general_documents d
		JOIN users u ON u.id = d.updated_by
		WHERE d.project_id = ? AND d.deleted_at IS NULL
		ORDER BY d.updated_at DESC, d.id DESC
	`, projectID).Scan(&rows).Error
	if err != nil {
		return nil, ErrDatabase
	}
	out := make([]model.GeneralDocumentSummary, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.GeneralDocumentSummary{
			ID: item.ID, Title: item.Title, Department: item.Department, Version: item.Version,
			UpdatedBy: item.UpdatedBy, Updater: item.Updater, UpdatedAt: item.UpdatedAt,
		})
	}
	return out, nil
}

func (r *GeneralRepository) FindVisible(ctx context.Context, projectID, id uint64) (model.GeneralDocument, error) {
	doc, err := r.find(ctx, projectID, id, true)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return model.GeneralDocument{}, err
		}
		return model.GeneralDocument{}, ErrDatabase
	}
	return doc, nil
}

func (r *GeneralRepository) FindAny(ctx context.Context, projectID, id uint64) (model.GeneralDocument, error) {
	doc, err := r.find(ctx, projectID, id, false)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return model.GeneralDocument{}, err
		}
		return model.GeneralDocument{}, ErrDatabase
	}
	return doc, nil
}

func (r *GeneralRepository) find(ctx context.Context, projectID, id uint64, visibleOnly bool) (model.GeneralDocument, error) {
	query := `
		SELECT d.id, d.project_id, d.title, IFNULL(d.department, '') AS department, d.content, d.version,
		       d.created_by, cu.name AS author, d.updated_by, uu.name AS updater,
		       d.created_at, d.updated_at, d.deleted_at
		FROM general_documents d
		JOIN users cu ON cu.id = d.created_by
		JOIN users uu ON uu.id = d.updated_by
		WHERE d.project_id = ? AND d.id = ?
	`
	if visibleOnly {
		query += " AND d.deleted_at IS NULL"
	}
	type row struct {
		ID         uint64
		ProjectID  uint64 `gorm:"column:project_id"`
		Title      string
		Department string
		Content    string
		Version    uint
		CreatedBy  uint64 `gorm:"column:created_by"`
		Author     string
		UpdatedBy  uint64 `gorm:"column:updated_by"`
		Updater    string
		CreatedAt  time.Time
		UpdatedAt  time.Time
		DeletedAt  *time.Time
	}
	var item row
	err := r.db.WithContext(ctx).Raw(query, projectID, id).Scan(&item).Error
	if err != nil {
		return model.GeneralDocument{}, err
	}
	if item.ID == 0 {
		return model.GeneralDocument{}, model.ErrNotFound
	}
	return model.GeneralDocument{
		ID: item.ID, ProjectID: item.ProjectID, Title: item.Title, Department: item.Department,
		Content: item.Content, Version: item.Version, CreatedBy: item.CreatedBy, Author: item.Author,
		UpdatedBy: item.UpdatedBy, Updater: item.Updater, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
		DeletedAt: item.DeletedAt,
	}, nil
}

func (r *GeneralRepository) Create(ctx context.Context, projectID, actorID uint64, title, department, content, reason string, now time.Time) (model.GeneralDocument, error) {
	var doc model.GeneralDocument
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		result := tx.Exec(`
			INSERT INTO general_documents
			(project_id, title, department, content, version, created_by, updated_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
		`, projectID, title, nullableDepartment(department), content, actorID, actorID, now, now)
		if result.Error != nil {
			return result.Error
		}
		var id uint64
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Row().Scan(&id); err != nil {
			return err
		}
		snapshot, err := generalSnapshot(title, department, content, false)
		if err != nil {
			return err
		}
		if err := insertGeneralRevision(tx, id, 1, reason, actorID, "CREATE_DOCUMENT", title, snapshot, now); err != nil {
			return err
		}
		loaded, err := findGeneral(tx, projectID, id, true)
		if err != nil {
			return err
		}
		doc = loaded
		return nil
	})
	if err != nil {
		if errors.Is(err, model.ErrNotFound) || errors.Is(err, model.ErrArchived) {
			return model.GeneralDocument{}, err
		}
		return model.GeneralDocument{}, ErrDatabase
	}
	return doc, nil
}

func (r *GeneralRepository) Update(ctx context.Context, projectID, actorID, id uint64, version uint, title, department, content, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, actorID, id, version, reason, now, func(tx *gorm.DB, doc lockedGeneral) error {
		var stored struct{ Title, Department, Content string }
		if err := tx.Raw(`
			SELECT title, IFNULL(department, ''), content FROM general_documents WHERE id = ? AND deleted_at IS NULL
		`, doc.ID).Row().Scan(&stored.Title, &stored.Department, &stored.Content); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return model.ErrNotFound
			}
			return err
		}
		if stored.Title == title && stored.Department == department && stored.Content == content {
			return errNoChange
		}
		result := tx.Exec(`
			UPDATE general_documents
			SET title = ?, department = ?, content = ?
			WHERE id = ? AND deleted_at IS NULL
		`, title, nullableDepartment(department), content, doc.ID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.ErrNotFound
		}
		return nil
	}, "UPDATE_DOCUMENT")
}

func (r *GeneralRepository) SoftDelete(ctx context.Context, projectID, actorID, id uint64, version uint, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, actorID, id, version, reason, now, func(tx *gorm.DB, doc lockedGeneral) error {
		result := tx.Exec(`
			UPDATE general_documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
		`, now, doc.ID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.ErrNotFound
		}
		return nil
	}, "DELETE_DOCUMENT")
}

func (r *GeneralRepository) mutate(ctx context.Context, projectID, actorID, id uint64, version uint, reason string, now time.Time, change func(*gorm.DB, lockedGeneral) error, op string) (uint, error) {
	var next uint
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		doc, err := lockGeneral(tx, projectID, id)
		if err != nil {
			return err
		}
		if doc.Version != version {
			return model.SpecConflict{Current: doc.Version}
		}
		if err := change(tx, doc); err != nil {
			if errors.Is(err, errNoChange) {
				next = version
				return nil
			}
			return err
		}
		if err := requireReason(reason); err != nil {
			return err
		}
		result := tx.Exec(`
			UPDATE general_documents
			SET version = version + 1, updated_by = ?, updated_at = ?
			WHERE id = ? AND version = ?
		`, actorID, now, doc.ID, version)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.SpecConflict{Current: doc.Version}
		}
		fresh, err := findGeneral(tx, projectID, id, false)
		if err != nil {
			return err
		}
		snapshot, err := generalSnapshot(fresh.Title, fresh.Department, fresh.Content, fresh.DeletedAt != nil)
		if err != nil {
			return err
		}
		next = version + 1
		return insertGeneralRevision(tx, id, next, reason, actorID, op, fresh.Title, snapshot, now)
	})
	if err != nil {
		var conflict model.SpecConflict
		if errors.As(err, &conflict) || errors.Is(err, model.ErrNotFound) || errors.Is(err, model.ErrArchived) || errors.Is(err, model.ErrSpecInput) {
			return 0, err
		}
		return 0, ErrDatabase
	}
	return next, nil
}

func (r *GeneralRepository) ListRevisions(ctx context.Context, projectID, id uint64) ([]model.GeneralRevision, error) {
	if _, err := r.FindAny(ctx, projectID, id); err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return nil, err
		}
		return nil, ErrDatabase
	}
	type row struct {
		Version      uint
		ChangeReason string `gorm:"column:change_reason"`
		ActorID      uint64 `gorm:"column:actor_id"`
		ActorName    string
		Summary      string
		Snapshot     string
		CreatedAt    time.Time
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT r.version, r.change_reason, r.actor_id, u.name AS actor_name,
		       r.summary_json AS summary, r.snapshot_json AS snapshot, r.created_at
		FROM general_document_revisions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.document_id = ?
		ORDER BY r.version DESC
	`, id).Scan(&rows).Error
	if err != nil {
		return nil, ErrDatabase
	}
	out := make([]model.GeneralRevision, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.GeneralRevision{
			Version: item.Version, ChangeReason: item.ChangeReason, ActorID: item.ActorID, ActorName: item.ActorName,
			Summary: json.RawMessage(item.Summary), Snapshot: json.RawMessage(item.Snapshot), CreatedAt: item.CreatedAt,
		})
	}
	return out, nil
}

func (r *GeneralRepository) Revision(ctx context.Context, projectID, id uint64, version uint) (model.GeneralRevision, error) {
	rows, err := r.ListRevisions(ctx, projectID, id)
	if err != nil {
		return model.GeneralRevision{}, err
	}
	for _, row := range rows {
		if row.Version == version {
			return row, nil
		}
	}
	return model.GeneralRevision{}, model.ErrNotFound
}

type lockedGeneral struct {
	ID      uint64
	Version uint
}

func lockGeneral(tx *gorm.DB, projectID, id uint64) (lockedGeneral, error) {
	var doc lockedGeneral
	var deleted sql.NullTime
	err := tx.Raw(`
		SELECT id, version, deleted_at FROM general_documents
		WHERE project_id = ? AND id = ? FOR UPDATE
	`, projectID, id).Row().Scan(&doc.ID, &doc.Version, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return lockedGeneral{}, model.ErrNotFound
	}
	if err != nil {
		return lockedGeneral{}, err
	}
	if deleted.Valid {
		return lockedGeneral{}, model.ErrNotFound
	}
	return doc, nil
}

func findGeneral(tx *gorm.DB, projectID, id uint64, visibleOnly bool) (model.GeneralDocument, error) {
	query := `
		SELECT d.id, d.project_id, d.title, IFNULL(d.department, '') AS department, d.content, d.version,
		       d.created_by, cu.name AS author, d.updated_by, uu.name AS updater,
		       d.created_at, d.updated_at, d.deleted_at
		FROM general_documents d
		JOIN users cu ON cu.id = d.created_by
		JOIN users uu ON uu.id = d.updated_by
		WHERE d.project_id = ? AND d.id = ?
	`
	if visibleOnly {
		query += " AND d.deleted_at IS NULL"
	}
	type row struct {
		ID         uint64
		ProjectID  uint64 `gorm:"column:project_id"`
		Title      string
		Department string
		Content    string
		Version    uint
		CreatedBy  uint64 `gorm:"column:created_by"`
		Author     string
		UpdatedBy  uint64 `gorm:"column:updated_by"`
		Updater    string
		CreatedAt  time.Time
		UpdatedAt  time.Time
		DeletedAt  *time.Time
	}
	var item row
	if err := tx.Raw(query, projectID, id).Scan(&item).Error; err != nil {
		return model.GeneralDocument{}, err
	}
	if item.ID == 0 {
		return model.GeneralDocument{}, model.ErrNotFound
	}
	return model.GeneralDocument{
		ID: item.ID, ProjectID: item.ProjectID, Title: item.Title, Department: item.Department,
		Content: item.Content, Version: item.Version, CreatedBy: item.CreatedBy, Author: item.Author,
		UpdatedBy: item.UpdatedBy, Updater: item.Updater, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
		DeletedAt: item.DeletedAt,
	}, nil
}

func nullableDepartment(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func generalSnapshot(title, department, content string, deleted bool) (string, error) {
	raw, err := json.Marshal(struct {
		Title      string `json:"title"`
		Department string `json:"department"`
		Content    string `json:"content"`
		Deleted    bool   `json:"deleted"`
	}{Title: title, Department: department, Content: content, Deleted: deleted})
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func insertGeneralRevision(tx *gorm.DB, documentID uint64, version uint, reason string, actorID uint64, op, title, snapshot string, now time.Time) error {
	summary, err := json.Marshal(struct {
		Op    string `json:"op"`
		Title string `json:"title"`
	}{Op: op, Title: title})
	if err != nil {
		return err
	}
	return tx.Exec(`
		INSERT INTO general_document_revisions
		(document_id, version, change_reason, actor_id, summary_json, snapshot_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, documentID, version, reason, actorID, string(summary), snapshot, now).Error
}
