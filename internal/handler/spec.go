package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"interface-hub/internal/dto"
	"interface-hub/internal/model"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type SpecHandler struct {
	specs *service.SpecService
	log   *slog.Logger
}

func NewSpecHandler(specs *service.SpecService, log *slog.Logger) *SpecHandler {
	return &SpecHandler{specs: specs, log: log}
}

func (h *SpecHandler) Create(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var body struct {
		Kind  string `json:"kind"`
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeSpecInput(c)
		return
	}
	doc, err := h.specs.Create(c.Request.Context(), actor, projectID, body.Kind, body.Title)
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, specDocumentJSON(doc, nil))
}

func (h *SpecHandler) Get(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	doc, items, err := h.specs.Get(c.Request.Context(), actor, projectID, c.Param("kind"))
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, specDocumentJSON(doc, items))
}

func (h *SpecHandler) Patch(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var body struct {
		Version      uint            `json:"version"`
		ChangeReason string          `json:"changeReason"`
		Title        string          `json:"title"`
		Overview     json.RawMessage `json:"overview"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeSpecInput(c)
		return
	}
	version, err := h.specs.UpdateOverview(c.Request.Context(), actor, projectID, c.Param("kind"), service.SpecOverviewChange{
		Version: body.Version, ChangeReason: body.ChangeReason, Title: body.Title, Overview: body.Overview,
	})
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *SpecHandler) Reorder(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var body struct {
		Version      uint     `json:"version"`
		ChangeReason string   `json:"changeReason"`
		ItemUIDs     []string `json:"itemUids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ItemUIDs == nil {
		writeSpecInput(c)
		return
	}
	version, err := h.specs.Reorder(c.Request.Context(), actor, projectID, c.Param("kind"), body.Version, body.ChangeReason, body.ItemUIDs)
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *SpecHandler) CreateItem(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	change, ok := bindItemChange(c)
	if !ok {
		return
	}
	version, uid, err := h.specs.CreateItem(c.Request.Context(), actor, projectID, c.Param("kind"), change)
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"version": version, "itemUid": uid})
}

func (h *SpecHandler) UpdateItem(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	change, ok := bindItemChange(c)
	if !ok {
		return
	}
	version, err := h.specs.UpdateItem(c.Request.Context(), actor, projectID, c.Param("kind"), c.Param("itemUid"), change)
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *SpecHandler) DeleteItem(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var body struct {
		Version      uint   `json:"version"`
		ChangeReason string `json:"changeReason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeSpecInput(c)
		return
	}
	version, err := h.specs.DeleteItem(c.Request.Context(), actor, projectID, c.Param("kind"), c.Param("itemUid"), body.Version, body.ChangeReason)
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *SpecHandler) Revisions(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	rows, err := h.specs.Revisions(c.Request.Context(), actor, projectID, c.Param("kind"))
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, gin.H{
			"version":      row.Version,
			"changeReason": row.ChangeReason,
			"actor":        dto.ProjectPerson{ID: row.ActorID, Name: row.ActorName},
			"createdAt":    row.CreatedAt.UTC().Format(time.RFC3339),
			"summary":      json.RawMessage(row.Summary),
		})
	}
	c.JSON(http.StatusOK, gin.H{"revisions": out})
}

func (h *SpecHandler) Compare(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	from, fromErr := strconv.ParseUint(c.Query("from"), 10, 64)
	to, toErr := strconv.ParseUint(c.Query("to"), 10, 64)
	if fromErr != nil || toErr != nil || from == 0 || to == 0 {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
		return
	}
	result, err := h.specs.Compare(c.Request.Context(), actor, projectID, c.Param("kind"), uint(from), uint(to))
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"fromVersion":     result.FromVersion,
		"toVersion":       result.ToVersion,
		"overviewChanged": result.OverviewChanged,
		"added":           itemRefs(result.Added),
		"removed":         itemRefs(result.Removed),
		"updated":         itemRefs(result.Updated),
		"before":          json.RawMessage(result.Before),
		"after":           json.RawMessage(result.After),
	})
}

func (h *SpecHandler) Markdown(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	body, filename, err := h.specs.Markdown(c.Request.Context(), actor, projectID, c.Param("kind"))
	if err != nil {
		writeSpecError(c, h.log, err)
		return
	}
	c.Header("X-Markdown-Filename", url.PathEscape(filename))
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(body))
}

func bindItemChange(c *gin.Context) (service.SpecItemChange, bool) {
	var body struct {
		Version      uint            `json:"version"`
		ChangeReason string          `json:"changeReason"`
		Name         string          `json:"name"`
		Summary      string          `json:"summary"`
		Status       string          `json:"status"`
		Payload      json.RawMessage `json:"payload"`
		ErrorCodeIDs json.RawMessage `json:"errorCodeIds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Payload) == 0 {
		writeSpecInput(c)
		return service.SpecItemChange{}, false
	}
	codes := bytes.TrimSpace(body.ErrorCodeIDs)
	if len(codes) == 0 || codes[0] != '[' {
		writeSpecInput(c)
		return service.SpecItemChange{}, false
	}
	var ids []uint64
	if err := json.Unmarshal(codes, &ids); err != nil {
		writeSpecInput(c)
		return service.SpecItemChange{}, false
	}
	return service.SpecItemChange{
		Version: body.Version, ChangeReason: body.ChangeReason, Name: body.Name,
		Summary: body.Summary, Status: body.Status, Payload: body.Payload, ErrorCodeIDs: ids,
	}, true
}

func specDocumentJSON(doc model.SpecDocument, items []model.SpecItem) gin.H {
	list := make([]gin.H, 0, len(items))
	for _, item := range items {
		list = append(list, gin.H{
			"itemUid":    item.ItemUID,
			"sortOrder":  item.SortOrder,
			"name":       item.Name,
			"summary":    item.Summary,
			"status":     item.Status,
			"payload":    json.RawMessage(item.Payload),
			"errorCodes": item.ErrorCodes,
		})
	}
	return gin.H{
		"id":        doc.ID,
		"kind":      doc.Kind,
		"title":     doc.Title,
		"overview":  json.RawMessage(doc.Overview),
		"version":   doc.Version,
		"updatedBy": dto.ProjectPerson{ID: doc.UpdatedBy, Name: doc.Updater},
		"updatedAt": doc.UpdatedAt.UTC().Format(time.RFC3339),
		"items":     list,
	}
}

func itemRefs(items []service.SpecItemRef) []gin.H {
	out := make([]gin.H, 0, len(items))
	for _, item := range items {
		out = append(out, gin.H{"itemUid": item.ItemUID, "name": item.Name})
	}
	return out
}

func writeSpecInput(c *gin.Context) {
	c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "요청 정보가 올바르지 않습니다."})
}

func writeSpecError(c *gin.Context, log *slog.Logger, err error) {
	var document service.DocumentConflictError
	var itemSet service.ItemSetError
	var input service.SpecInputError
	switch {
	case errors.As(err, &document):
		current := document.Current
		c.JSON(http.StatusConflict, dto.ErrorResponse{
			Code: "DOCUMENT_VERSION_CONFLICT", Message: "다른 사용자가 먼저 저장했습니다.", CurrentVersion: &current,
		})
	case errors.As(err, &itemSet):
		current := itemSet.Current
		c.JSON(http.StatusConflict, dto.ErrorResponse{
			Code: "ITEM_SET_CHANGED", Message: "항목 목록이 변경되었습니다.", CurrentVersion: &current,
		})
	case errors.As(err, &input) && input.Code == "EXAMPLE_SCHEMA_MISMATCH":
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "EXAMPLE_SCHEMA_MISMATCH", Message: "예시가 필드 구조와 맞지 않습니다."})
	case errors.As(err, &input):
		writeSpecInput(c)
	case errors.Is(err, service.ErrProjectInvalid):
		writeSpecInput(c)
	case errors.Is(err, service.ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "인증이 필요합니다."})
	case errors.Is(err, service.ErrProjectForbidden):
		c.JSON(http.StatusForbidden, dto.ErrorResponse{Code: "FORBIDDEN", Message: "권한이 없습니다."})
	case errors.Is(err, service.ErrProjectArchived):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "PROJECT_ARCHIVED", Message: "보관된 프로젝트는 수정할 수 없습니다."})
	case errors.Is(err, model.ErrSpecKindExists):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "SPEC_KIND_ALREADY_EXISTS", Message: "같은 종류의 규격 문서가 이미 있습니다."})
	case errors.Is(err, model.ErrNotFound):
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
	default:
		if log != nil {
			log.Error("spec request failed")
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Code: "INTERNAL_ERROR", Message: "요청을 처리하지 못했습니다."})
	}
}
