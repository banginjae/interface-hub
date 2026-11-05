package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"interface-hub/internal/dto"
	"interface-hub/internal/model"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type ErrorCodeHandler struct {
	codes *service.ErrorCodeService
	log   *slog.Logger
}

func NewErrorCodeHandler(codes *service.ErrorCodeService, log *slog.Logger) *ErrorCodeHandler {
	return &ErrorCodeHandler{codes: codes, log: log}
}

func (h *ErrorCodeHandler) List(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	rows, err := h.codes.List(c.Request.Context(), actor, projectID)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, errorCodeJSON(row))
	}
	c.JSON(http.StatusOK, gin.H{"errorCodes": out})
}

func (h *ErrorCodeHandler) Create(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	write, ok := bindErrorCodeWrite(c, false)
	if !ok {
		return
	}
	created, err := h.codes.Create(c.Request.Context(), actor, projectID, write)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": created.ID, "version": created.Version})
}

func (h *ErrorCodeHandler) Get(c *gin.Context) {
	actor, projectID, id, ok := actorProjectErrorCode(c)
	if !ok {
		return
	}
	row, err := h.codes.Get(c.Request.Context(), actor, projectID, id)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, errorCodeJSON(row))
}

func (h *ErrorCodeHandler) Update(c *gin.Context) {
	actor, projectID, id, ok := actorProjectErrorCode(c)
	if !ok {
		return
	}
	write, ok := bindErrorCodeWrite(c, true)
	if !ok {
		return
	}
	version, err := h.codes.Update(c.Request.Context(), actor, projectID, id, write)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *ErrorCodeHandler) Delete(c *gin.Context) {
	actor, projectID, id, ok := actorProjectErrorCode(c)
	if !ok {
		return
	}
	var body struct {
		Version      uint   `json:"version"`
		ChangeReason string `json:"changeReason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeErrorCodeInput(c)
		return
	}
	version, err := h.codes.Delete(c.Request.Context(), actor, projectID, id, body.Version, body.ChangeReason)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version, "deleted": true})
}

func (h *ErrorCodeHandler) Revisions(c *gin.Context) {
	actor, projectID, id, ok := actorProjectErrorCode(c)
	if !ok {
		return
	}
	rows, err := h.codes.Revisions(c.Request.Context(), actor, projectID, id)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, gin.H{
			"version":      row.Version,
			"changeReason": row.ChangeReason,
			"actor":        dto.ProjectPerson{ID: row.ActorID, Name: row.ActorName},
			"createdAt":    row.CreatedAt.UTC().Format(time.RFC3339),
			"summary":      jsonRaw(row.Summary),
		})
	}
	c.JSON(http.StatusOK, gin.H{"revisions": out})
}

func (h *ErrorCodeHandler) Compare(c *gin.Context) {
	actor, projectID, id, ok := actorProjectErrorCode(c)
	if !ok {
		return
	}
	from, fromOK := queryUint(c, "from")
	to, toOK := queryUint(c, "to")
	if !fromOK || !toOK {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
		return
	}
	result, err := h.codes.Compare(c.Request.Context(), actor, projectID, id, from, to)
	if err != nil {
		writeErrorCodeError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"fromVersion": result.FromVersion,
		"toVersion":   result.ToVersion,
		"before":      result.Before,
		"after":       result.After,
	})
}

func errorCodeJSON(row model.ErrorCode) gin.H {
	usages := make([]gin.H, 0, len(row.Usages))
	for _, usage := range row.Usages {
		usages = append(usages, gin.H{
			"kind": usage.Kind, "title": usage.Title, "itemUid": usage.ItemUID, "itemName": usage.ItemName,
		})
	}
	return gin.H{
		"id": row.ID, "code": row.Code, "category": row.Category, "description": row.Description,
		"conditionText": row.ConditionText, "handling": row.Handling, "version": row.Version,
		"referenceCount": row.ReferenceCount, "usages": usages,
		"createdBy": dto.ProjectPerson{ID: row.CreatedBy, Name: row.Author},
		"updatedBy": dto.ProjectPerson{ID: row.UpdatedBy, Name: row.Updater},
		"createdAt": row.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt": row.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func actorProjectErrorCode(c *gin.Context) (model.User, uint64, uint64, bool) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return model.User{}, 0, 0, false
	}
	id, err := strconv.ParseUint(c.Param("errorCodeId"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
		return model.User{}, 0, 0, false
	}
	return actor, projectID, id, true
}

func bindErrorCodeWrite(c *gin.Context, withVersion bool) (service.ErrorCodeWrite, bool) {
	var body service.ErrorCodeWrite
	if err := c.ShouldBindJSON(&body); err != nil {
		writeErrorCodeInput(c)
		return service.ErrorCodeWrite{}, false
	}
	if withVersion && body.Version == 0 {
		writeErrorCodeInput(c)
		return service.ErrorCodeWrite{}, false
	}
	return body, true
}

func queryUint(c *gin.Context, name string) (uint, bool) {
	value, err := strconv.ParseUint(c.Query(name), 10, 64)
	if err != nil || value == 0 || value > uint64(^uint(0)) {
		return 0, false
	}
	return uint(value), true
}

func jsonRaw(raw []byte) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{}
	}
	return value
}

func writeErrorCodeInput(c *gin.Context) {
	c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "요청 정보가 올바르지 않습니다."})
}

func writeErrorCodeError(c *gin.Context, log *slog.Logger, err error) {
	var conflict service.ErrorCodeConflictError
	switch {
	case errors.As(err, &conflict):
		current := conflict.Current
		c.JSON(http.StatusConflict, dto.ErrorResponse{
			Code: "ERROR_CODE_VERSION_CONFLICT", Message: "다른 사용자가 먼저 저장했습니다.", CurrentVersion: &current,
		})
	case errors.Is(err, model.ErrErrorCodeTaken):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "ERROR_CODE_TAKEN", Message: "같은 코드가 이미 있습니다."})
	case errors.Is(err, model.ErrErrorCodeInUse):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "ERROR_CODE_IN_USE", Message: "참조 중인 오류 코드는 삭제할 수 없습니다."})
	case errors.Is(err, service.ErrProjectInvalid):
		writeErrorCodeInput(c)
	case errors.Is(err, service.ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "인증이 필요합니다."})
	case errors.Is(err, service.ErrProjectForbidden):
		c.JSON(http.StatusForbidden, dto.ErrorResponse{Code: "FORBIDDEN", Message: "권한이 없습니다."})
	case errors.Is(err, service.ErrProjectArchived):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "PROJECT_ARCHIVED", Message: "보관된 프로젝트는 수정할 수 없습니다."})
	case errors.Is(err, model.ErrNotFound):
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
	default:
		if log != nil {
			log.Error("error code request failed")
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Code: "INTERNAL_ERROR", Message: "요청을 처리하지 못했습니다."})
	}
}
