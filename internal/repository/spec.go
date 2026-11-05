package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"interface-hub/internal/model"

	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
)

type SpecRepository struct {
	db *gorm.DB
}

func NewSpecRepository(db *gorm.DB) *SpecRepository {
	return &SpecRepository{db: db}
}

func (r *SpecRepository) ListSummaries(ctx context.Context, projectID uint64) ([]model.SpecSummaryRow, error) {
	type row struct {
		Kind          string
		Version       uint
		UpdatedAt     time.Time
		UpdatedByName string `gorm:"column:updated_by_name"`
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT d.kind, d.version, d.updated_at, u.name AS updated_by_name
		FROM spec_documents d
		JOIN users u ON u.id = d.updated_by
		WHERE d.project_id = ?
	`, projectID).Scan(&rows).Error
	if err != nil {
		return nil, ErrDatabase
	}
	out := make([]model.SpecSummaryRow, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.SpecSummaryRow{
			Kind: item.Kind, Version: item.Version, UpdatedAt: item.UpdatedAt, UpdatedByName: item.UpdatedByName,
		})
	}
	return out, nil
}

func (r *SpecRepository) FindDocument(ctx context.Context, projectID uint64, kind string) (model.SpecDocument, []model.SpecItem, error) {
	var doc model.SpecDocument
	var items []model.SpecItem
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		doc, err = findDocument(tx, projectID, kind)
		if err != nil {
			return err
		}
		items, err = loadItems(tx, doc.ID)
		return err
	})
	if err != nil {
		return model.SpecDocument{}, nil, err
	}
	return doc, items, nil
}

func (r *SpecRepository) CreateDocument(ctx context.Context, projectID, actorID uint64, kind, title, overview string, now time.Time) (model.SpecDocument, error) {
	if kind != model.SpecKindAPI && kind != model.SpecKindMQTT && kind != model.SpecKindWebSocket && kind != model.SpecKindDevice {
		return model.SpecDocument{}, model.ErrNotFound
	}
	var doc model.SpecDocument
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		result := tx.Exec(`
			INSERT INTO spec_documents
			(project_id, kind, title, overview, version, created_by, updated_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
		`, projectID, kind, title, overview, actorID, actorID, now, now)
		if result.Error != nil {
			if isDuplicate(result.Error) {
				return model.ErrSpecKindExists
			}
			return result.Error
		}
		var id uint64
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Row().Scan(&id); err != nil {
			return err
		}
		snapshot, err := snapshotJSON(title, overview, nil)
		if err != nil {
			return err
		}
		if err := insertRevision(tx, id, 1, "최초 작성", actorID, "CREATE_DOCUMENT", "", "", snapshot, now); err != nil {
			return err
		}
		doc, err = findDocument(tx, projectID, kind)
		return err
	})
	if err != nil {
		if errors.Is(err, model.ErrNotFound) || errors.Is(err, model.ErrArchived) || errors.Is(err, model.ErrSpecKindExists) {
			return model.SpecDocument{}, err
		}
		return model.SpecDocument{}, ErrDatabase
	}
	return doc, nil
}

func (r *SpecRepository) UpdateOverview(ctx context.Context, projectID, actorID uint64, kind string, version uint, title, overview, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, kind, version, func(tx *gorm.DB, doc lockedDocument) (string, string, string, error) {
		if err := tx.Exec(`
			UPDATE spec_documents SET title = ?, overview = ? WHERE id = ?
		`, title, overview, doc.ID).Error; err != nil {
			return "", "", "", err
		}
		return "UPDATE_OVERVIEW", "", title, nil
	}, actorID, reason, now)
}

func (r *SpecRepository) CreateItem(ctx context.Context, projectID, actorID uint64, kind string, version uint, itemUID string, item model.SpecItemWrite, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, kind, version, func(tx *gorm.DB, doc lockedDocument) (string, string, string, error) {
		if err := mqttRelatedExists(tx, kind, doc.ID, itemUID, item.Payload); err != nil {
			return "", "", "", err
		}
		var maxOrder int
		if err := tx.Raw("SELECT COALESCE(MAX(sort_order), 0) FROM spec_items WHERE document_id = ?", doc.ID).Row().Scan(&maxOrder); err != nil {
			return "", "", "", err
		}
		result := tx.Exec(`
			INSERT INTO spec_items
			(document_id, item_uid, sort_order, name, summary, status, payload, created_by, updated_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, doc.ID, itemUID, maxOrder+1, item.Name, item.Summary, item.Status, item.Payload, actorID, actorID, now, now)
		if result.Error != nil {
			return "", "", "", result.Error
		}
		var itemID uint64
		if err := tx.Raw("SELECT LAST_INSERT_ID()").Row().Scan(&itemID); err != nil {
			return "", "", "", err
		}
		if err := replaceItemErrorCodes(tx, projectID, itemID, item.ErrorCodeIDs); err != nil {
			return "", "", "", err
		}
		return "CREATE_ITEM", itemUID, item.Name, nil
	}, actorID, reason, now)
}

func (r *SpecRepository) UpdateItem(ctx context.Context, projectID, actorID uint64, kind, itemUID string, version uint, item model.SpecItemWrite, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, kind, version, func(tx *gorm.DB, doc lockedDocument) (string, string, string, error) {
		if err := mqttRelatedExists(tx, kind, doc.ID, itemUID, item.Payload); err != nil {
			return "", "", "", err
		}
		result := tx.Exec(`
			UPDATE spec_items
			SET name = ?, summary = ?, status = ?, payload = ?, updated_by = ?, updated_at = ?
			WHERE document_id = ? AND item_uid = ?
		`, item.Name, item.Summary, item.Status, item.Payload, actorID, now, doc.ID, itemUID)
		if result.Error != nil {
			return "", "", "", result.Error
		}
		if result.RowsAffected == 0 {
			var count int
			if err := tx.Raw("SELECT COUNT(*) FROM spec_items WHERE document_id = ? AND item_uid = ?", doc.ID, itemUID).Row().Scan(&count); err != nil {
				return "", "", "", err
			}
			if count == 0 {
				return "", "", "", model.ErrNotFound
			}
		}
		var itemID uint64
		if err := tx.Raw("SELECT id FROM spec_items WHERE document_id = ? AND item_uid = ?", doc.ID, itemUID).Row().Scan(&itemID); err != nil {
			return "", "", "", err
		}
		if err := replaceItemErrorCodes(tx, projectID, itemID, item.ErrorCodeIDs); err != nil {
			return "", "", "", err
		}
		return "UPDATE_ITEM", itemUID, item.Name, nil
	}, actorID, reason, now)
}

func (r *SpecRepository) DeleteItem(ctx context.Context, projectID, actorID uint64, kind, itemUID string, version uint, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, kind, version, func(tx *gorm.DB, doc lockedDocument) (string, string, string, error) {
		var name string
		err := tx.Raw("SELECT name FROM spec_items WHERE document_id = ? AND item_uid = ?", doc.ID, itemUID).Row().Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", model.ErrNotFound
		}
		if err != nil {
			return "", "", "", err
		}
		if err := mqttReferenceBlocksDelete(tx, kind, doc.ID, itemUID); err != nil {
			return "", "", "", err
		}
		result := tx.Exec("DELETE FROM spec_items WHERE document_id = ? AND item_uid = ?", doc.ID, itemUID)
		if result.Error != nil {
			return "", "", "", result.Error
		}
		if result.RowsAffected != 1 {
			return "", "", "", model.ErrNotFound
		}
		return "DELETE_ITEM", itemUID, name, nil
	}, actorID, reason, now)
}

func (r *SpecRepository) Reorder(ctx context.Context, projectID, actorID uint64, kind string, version uint, uids []string, reason string, now time.Time) (uint, error) {
	return r.mutate(ctx, projectID, kind, version, func(tx *gorm.DB, doc lockedDocument) (string, string, string, error) {
		items, err := loadItems(tx, doc.ID)
		if err != nil {
			return "", "", "", err
		}
		if !sameUIDSet(items, uids) {
			return "", "", "", model.SpecConflict{Current: doc.Version, ItemSet: true}
		}
		for index, uid := range uids {
			result := tx.Exec(`
				UPDATE spec_items SET sort_order = ?, updated_at = ?
				WHERE document_id = ? AND item_uid = ?
			`, index+1, now, doc.ID, uid)
			if result.Error != nil {
				return "", "", "", result.Error
			}
			if result.RowsAffected == 0 {
				var count int
				if err := tx.Raw("SELECT COUNT(*) FROM spec_items WHERE document_id = ? AND item_uid = ?", doc.ID, uid).Row().Scan(&count); err != nil {
					return "", "", "", err
				}
				if count != 1 {
					return "", "", "", model.SpecConflict{Current: doc.Version, ItemSet: true}
				}
			}
		}
		return "REORDER_ITEMS", "", "", nil
	}, actorID, reason, now)
}

func (r *SpecRepository) ListRevisions(ctx context.Context, projectID uint64, kind string) ([]model.SpecRevision, error) {
	doc, err := r.findHead(ctx, projectID, kind)
	if err != nil {
		return nil, err
	}
	rows, err := r.revisions(ctx, doc.ID, 0)
	if err != nil {
		return nil, ErrDatabase
	}
	return rows, nil
}

func (r *SpecRepository) Revision(ctx context.Context, projectID uint64, kind string, version uint) (model.SpecRevision, error) {
	doc, err := r.findHead(ctx, projectID, kind)
	if err != nil {
		return model.SpecRevision{}, err
	}
	rows, err := r.revisions(ctx, doc.ID, version)
	if err != nil {
		return model.SpecRevision{}, ErrDatabase
	}
	if len(rows) != 1 {
		return model.SpecRevision{}, model.ErrNotFound
	}
	return rows[0], nil
}

func (r *SpecRepository) findHead(ctx context.Context, projectID uint64, kind string) (model.SpecDocument, error) {
	var doc model.SpecDocument
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		doc, err = findDocument(tx, projectID, kind)
		return err
	})
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return model.SpecDocument{}, err
		}
		return model.SpecDocument{}, ErrDatabase
	}
	return doc, nil
}

func (r *SpecRepository) revisions(ctx context.Context, documentID uint64, version uint) ([]model.SpecRevision, error) {
	type row struct {
		Version      uint
		ChangeReason string `gorm:"column:change_reason"`
		ActorID      uint64 `gorm:"column:actor_id"`
		ActorName    string `gorm:"column:actor_name"`
		Summary      string `gorm:"column:summary_json"`
		Snapshot     string `gorm:"column:snapshot_json"`
		CreatedAt    time.Time
	}
	query := `
		SELECT r.version, r.change_reason, r.actor_id, u.name AS actor_name,
		       r.summary_json, r.snapshot_json, r.created_at
		FROM spec_document_revisions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.document_id = ?
	`
	args := []any{documentID}
	if version > 0 {
		query += " AND r.version = ?"
		args = append(args, version)
	}
	query += " ORDER BY r.version DESC"
	var rows []row
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.SpecRevision, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.SpecRevision{
			Version: item.Version, ChangeReason: item.ChangeReason,
			ActorID: item.ActorID, ActorName: item.ActorName,
			Summary: json.RawMessage(item.Summary), Snapshot: json.RawMessage(item.Snapshot),
			CreatedAt: item.CreatedAt,
		})
	}
	return out, nil
}

type itemChange func(tx *gorm.DB, doc lockedDocument) (op, itemUID, name string, err error)

func (r *SpecRepository) mutate(ctx context.Context, projectID uint64, kind string, version uint, change itemChange, actorID uint64, reason string, now time.Time) (uint, error) {
	var next uint
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := lockProject(tx, projectID); err != nil {
			return err
		}
		doc, err := lockDocument(tx, projectID, kind)
		if err != nil {
			return err
		}
		if doc.Version != version {
			return model.SpecConflict{Current: doc.Version}
		}
		op, itemUID, name, err := change(tx, doc)
		if err != nil {
			return err
		}
		result := tx.Exec(`
			UPDATE spec_documents
			SET version = version + 1, updated_by = ?, updated_at = ?
			WHERE id = ? AND version = ?
		`, actorID, now, doc.ID, version)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return model.SpecConflict{Current: doc.Version}
		}
		fresh, err := findDocument(tx, projectID, kind)
		if err != nil {
			return err
		}
		items, err := loadItems(tx, fresh.ID)
		if err != nil {
			return err
		}
		snapshot, err := snapshotJSON(fresh.Title, string(fresh.Overview), items)
		if err != nil {
			return err
		}
		next = version + 1
		return insertRevision(tx, fresh.ID, next, reason, actorID, op, itemUID, name, snapshot, now)
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

type lockedDocument struct {
	ID      uint64
	Version uint
	Title   string
}

func lockProject(tx *gorm.DB, projectID uint64) (string, error) {
	var status string
	err := tx.Raw("SELECT status FROM projects WHERE id = ? FOR UPDATE", projectID).Row().Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return "", model.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if status != model.ProjectActive {
		return "", model.ErrArchived
	}
	return status, nil
}

func lockDocument(tx *gorm.DB, projectID uint64, kind string) (lockedDocument, error) {
	var doc lockedDocument
	err := tx.Raw(`
		SELECT id, version, title FROM spec_documents
		WHERE project_id = ? AND kind = ? FOR UPDATE
	`, projectID, kind).Row().Scan(&doc.ID, &doc.Version, &doc.Title)
	if errors.Is(err, sql.ErrNoRows) {
		return lockedDocument{}, model.ErrNotFound
	}
	if err != nil {
		return lockedDocument{}, err
	}
	return doc, nil
}

func findDocument(tx *gorm.DB, projectID uint64, kind string) (model.SpecDocument, error) {
	var row struct {
		ID        uint64
		ProjectID uint64 `gorm:"column:project_id"`
		Kind      string
		Title     string
		Overview  string
		Version   uint
		CreatedBy uint64 `gorm:"column:created_by"`
		UpdatedBy uint64 `gorm:"column:updated_by"`
		CreatedAt time.Time
		UpdatedAt time.Time
		Updater   string
	}
	err := tx.Raw(`
		SELECT d.id, d.project_id, d.kind, d.title, d.overview, d.version,
		       d.created_by, d.updated_by, d.created_at, d.updated_at, u.name AS updater
		FROM spec_documents d
		JOIN users u ON u.id = d.updated_by
		WHERE d.project_id = ? AND d.kind = ?
	`, projectID, kind).Scan(&row).Error
	if err != nil {
		return model.SpecDocument{}, err
	}
	if row.ID == 0 {
		return model.SpecDocument{}, model.ErrNotFound
	}
	return model.SpecDocument{
		ID: row.ID, ProjectID: row.ProjectID, Kind: row.Kind, Title: row.Title,
		Overview: json.RawMessage(row.Overview), Version: row.Version,
		CreatedBy: row.CreatedBy, UpdatedBy: row.UpdatedBy,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Updater: row.Updater,
	}, nil
}

func loadItems(tx *gorm.DB, documentID uint64) ([]model.SpecItem, error) {
	type row struct {
		ItemUID   string `gorm:"column:item_uid"`
		SortOrder int    `gorm:"column:sort_order"`
		Name      string
		Summary   string
		Status    string
		Payload   string
		CreatedAt time.Time
		UpdatedAt time.Time
	}
	var rows []row
	if err := tx.Raw(`
		SELECT item_uid, sort_order, name, summary, status, payload, created_at, updated_at
		FROM spec_items WHERE document_id = ? ORDER BY sort_order ASC, id ASC
	`, documentID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.SpecItem, 0, len(rows))
	for _, item := range rows {
		out = append(out, model.SpecItem{
			ItemUID: item.ItemUID, SortOrder: item.SortOrder, Name: item.Name,
			Summary: item.Summary, Status: item.Status, Payload: json.RawMessage(item.Payload),
			ErrorCodes: []model.ErrorCodeCopy{},
			CreatedAt:  item.CreatedAt, UpdatedAt: item.UpdatedAt,
		})
	}
	if err := attachItemErrorCodes(tx, documentID, out); err != nil {
		return nil, err
	}
	return out, nil
}

func attachItemErrorCodes(tx *gorm.DB, documentID uint64, items []model.SpecItem) error {
	if len(items) == 0 {
		return nil
	}
	type row struct {
		ItemUID       string `gorm:"column:item_uid"`
		ID            uint64
		Code          string
		Category      string
		Description   string
		ConditionText string `gorm:"column:condition_text"`
		Handling      string
	}
	var rows []row
	if err := tx.Raw(`
		SELECT i.item_uid, e.id, e.code, e.category, e.description,
		       IFNULL(e.condition_text, '') AS condition_text, IFNULL(e.handling, '') AS handling
		FROM spec_item_error_codes l
		JOIN spec_items i ON i.id = l.spec_item_id
		JOIN error_codes e ON e.id = l.error_code_id
		WHERE i.document_id = ?
		ORDER BY e.code ASC, e.id ASC
	`, documentID).Scan(&rows).Error; err != nil {
		return err
	}
	index := map[string]int{}
	for i, item := range items {
		index[item.ItemUID] = i
	}
	for _, row := range rows {
		at, ok := index[row.ItemUID]
		if !ok {
			continue
		}
		items[at].ErrorCodes = append(items[at].ErrorCodes, model.ErrorCodeCopy{
			ID: row.ID, Code: row.Code, Category: row.Category, Description: row.Description,
			ConditionText: row.ConditionText, Handling: row.Handling,
		})
	}
	return nil
}

func replaceItemErrorCodes(tx *gorm.DB, projectID, itemID uint64, ids []uint64) error {
	if err := tx.Exec("DELETE FROM spec_item_error_codes WHERE spec_item_id = ?", itemID).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	var found int
	if err := tx.Raw(`
		SELECT COUNT(*) FROM error_codes
		WHERE project_id = ? AND deleted_at IS NULL AND id IN ?
	`, projectID, ids).Row().Scan(&found); err != nil {
		return err
	}
	if found != len(ids) {
		return model.ErrSpecInput
	}
	for _, id := range ids {
		if err := tx.Exec(`
			INSERT INTO spec_item_error_codes (spec_item_id, error_code_id) VALUES (?, ?)
		`, itemID, id).Error; err != nil {
			return err
		}
	}
	return nil
}

func snapshotJSON(title, overview string, items []model.SpecItem) (string, error) {
	type snapItem struct {
		ItemUID      string                `json:"itemUid"`
		Name         string                `json:"name"`
		Summary      string                `json:"summary"`
		Status       string                `json:"status"`
		SortOrder    int                   `json:"sortOrder"`
		Payload      json.RawMessage       `json:"payload"`
		ErrorCodeIDs []uint64              `json:"errorCodeIds"`
		ErrorCodes   []model.ErrorCodeCopy `json:"errorCodes"`
	}
	body := struct {
		Title    string          `json:"title"`
		Overview json.RawMessage `json:"overview"`
		Items    []snapItem      `json:"items"`
	}{Title: title, Overview: json.RawMessage(overview), Items: []snapItem{}}
	for _, item := range items {
		codes := item.ErrorCodes
		if codes == nil {
			codes = []model.ErrorCodeCopy{}
		}
		ids := make([]uint64, 0, len(codes))
		for _, code := range codes {
			ids = append(ids, code.ID)
		}
		body.Items = append(body.Items, snapItem{
			ItemUID: item.ItemUID, Name: item.Name, Summary: item.Summary, Status: item.Status,
			SortOrder: item.SortOrder, Payload: item.Payload, ErrorCodeIDs: ids, ErrorCodes: codes,
		})
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func insertRevision(tx *gorm.DB, documentID uint64, version uint, reason string, actorID uint64, op, itemUID, name, snapshot string, now time.Time) error {
	summary, err := json.Marshal(struct {
		Op      string `json:"op"`
		ItemUID string `json:"itemUid,omitempty"`
		Name    string `json:"name,omitempty"`
	}{Op: op, ItemUID: itemUID, Name: name})
	if err != nil {
		return err
	}
	return tx.Exec(`
		INSERT INTO spec_document_revisions
		(document_id, version, change_reason, actor_id, summary_json, snapshot_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, documentID, version, reason, actorID, string(summary), snapshot, now).Error
}

func sameUIDSet(items []model.SpecItem, uids []string) bool {
	if len(items) != len(uids) {
		return false
	}
	seen := map[string]int{}
	for _, item := range items {
		seen[item.ItemUID]++
	}
	for _, uid := range uids {
		seen[uid]--
	}
	for _, count := range seen {
		if count != 0 {
			return false
		}
	}
	return true
}

func isDuplicate(err error) bool {
	var mysqlErr *mysqldriver.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}

func mqttRelatedExists(tx *gorm.DB, kind string, documentID uint64, self, payload string) error {
	related, ok, err := mqttRelatedUID(kind, payload)
	if err != nil || !ok {
		return err
	}
	if related == self {
		return model.ErrSpecInput
	}
	var count int
	if err := tx.Raw("SELECT COUNT(*) FROM spec_items WHERE document_id = ? AND item_uid = ?", documentID, related).Row().Scan(&count); err != nil {
		return err
	}
	if count != 1 {
		return model.ErrSpecInput
	}
	return nil
}

func mqttReferenceBlocksDelete(tx *gorm.DB, kind string, documentID uint64, itemUID string) error {
	if kind != model.SpecKindMQTT && kind != model.SpecKindWebSocket && kind != model.SpecKindDevice {
		return nil
	}
	items, err := loadItems(tx, documentID)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.ItemUID == itemUID {
			continue
		}
		related, ok, err := mqttRelatedUID(kind, string(item.Payload))
		if err != nil {
			return err
		}
		if ok && related == itemUID {
			return model.ErrSpecInput
		}
	}
	return nil
}

func mqttRelatedUID(kind, payload string) (string, bool, error) {
	if kind != model.SpecKindMQTT && kind != model.SpecKindWebSocket && kind != model.SpecKindDevice {
		return "", false, nil
	}
	var body struct {
		Related *string `json:"relatedItemUid"`
	}
	if err := json.Unmarshal([]byte(payload), &body); err != nil {
		return "", false, model.ErrSpecInput
	}
	if body.Related == nil || *body.Related == "" {
		return "", false, nil
	}
	return *body.Related, true, nil
}
