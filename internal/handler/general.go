package handler

import (
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

type GeneralHandler struct {
	docs *service.GeneralService
	log  *slog.Logger
}

func NewGeneralHandler(docs *service.GeneralService, log *slog.Logger) *GeneralHandler {
	return &GeneralHandler{docs: docs, log: log}
}

func (h *GeneralHandler) List(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	rows, err := h.docs.List(c.Request.Context(), actor, projectID)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, gin.H{
			"id":         row.ID,
			"title":      row.Title,
			"department": row.Department,
			"version":    row.Version,
			"updatedBy":  dto.ProjectPerson{ID: row.UpdatedBy, Name: row.Updater},
			"updatedAt":  row.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}
	c.JSON(http.StatusOK, gin.H{"documents": out})
}

func (h *GeneralHandler) Create(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	write, ok := bindGeneralWrite(c, false)
	if !ok {
		return
	}
	doc, err := h.docs.Create(c.Request.Context(), actor, projectID, write)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": doc.ID, "version": doc.Version})
}

func (h *GeneralHandler) Get(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	doc, err := h.docs.Get(c.Request.Context(), actor, projectID, docID)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, generalDocumentJSON(doc))
}

func (h *GeneralHandler) Update(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	write, ok := bindGeneralWrite(c, true)
	if !ok {
		return
	}
	version, err := h.docs.Update(c.Request.Context(), actor, projectID, docID, write)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *GeneralHandler) Delete(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	var body struct {
		Version      uint   `json:"version"`
		ChangeReason string `json:"changeReason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeGeneralInput(c)
		return
	}
	version, err := h.docs.Delete(c.Request.Context(), actor, projectID, docID, body.Version, body.ChangeReason)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

func (h *GeneralHandler) Revisions(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	rows, err := h.docs.Revisions(c.Request.Context(), actor, projectID, docID)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		out = append(out, gin.H{
			"version":      row.Version,
			"changeReason": row.ChangeReason,
			"actor":        dto.ProjectPerson{ID: row.ActorID, Name: row.ActorName},
			"createdAt":    row.CreatedAt.UTC().Format(time.RFC3339),
			"summary":      row.Summary,
		})
	}
	c.JSON(http.StatusOK, gin.H{"revisions": out})
}

func (h *GeneralHandler) Compare(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	from, fromErr := strconv.ParseUint(c.Query("from"), 10, 64)
	to, toErr := strconv.ParseUint(c.Query("to"), 10, 64)
	if fromErr != nil || toErr != nil || from == 0 || to == 0 {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
		return
	}
	result, err := h.docs.Compare(c.Request.Context(), actor, projectID, docID, uint(from), uint(to))
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"fromVersion": result.FromVersion,
		"toVersion":   result.ToVersion,
		"before":      gin.H{"title": result.Before.Title, "department": result.Before.Department, "content": result.Before.Content},
		"after":       gin.H{"title": result.After.Title, "department": result.After.Department, "content": result.After.Content},
	})
}

func (h *GeneralHandler) Markdown(c *gin.Context) {
	actor, projectID, docID, ok := actorProjectDoc(c)
	if !ok {
		return
	}
	body, filename, err := h.docs.Markdown(c.Request.Context(), actor, projectID, docID)
	if err != nil {
		writeGeneralError(c, h.log, err)
		return
	}
	c.Header("X-Markdown-Filename", url.PathEscape(filename))
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(body))
}

func actorProjectDoc(c *gin.Context) (model.User, uint64, uint64, bool) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return model.User{}, 0, 0, false
	}
	docID, ok := pathUint(c, "docId")
	if !ok {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
		return model.User{}, 0, 0, false
	}
	return actor, projectID, docID, true
}

func bindGeneralWrite(c *gin.Context, withVersion bool) (service.GeneralWrite, bool) {
	var body service.GeneralWrite
	if err := c.ShouldBindJSON(&body); err != nil {
		writeGeneralInput(c)
		return service.GeneralWrite{}, false
	}
	if withVersion && body.Version == 0 {
		writeGeneralInput(c)
		return service.GeneralWrite{}, false
	}
	return body, true
}

func generalDocumentJSON(doc model.GeneralDocument) gin.H {
	return gin.H{
		"id":         doc.ID,
		"title":      doc.Title,
		"department": doc.Department,
		"content":    doc.Content,
		"version":    doc.Version,
		"createdBy":  dto.ProjectPerson{ID: doc.CreatedBy, Name: doc.Author},
		"updatedBy":  dto.ProjectPerson{ID: doc.UpdatedBy, Name: doc.Updater},
		"createdAt":  doc.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":  doc.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func writeGeneralInput(c *gin.Context) {
	c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "요청 정보가 올바르지 않습니다."})
}

func writeGeneralError(c *gin.Context, log *slog.Logger, err error) {
	var conflict service.GeneralDocConflictError
	switch {
	case errors.As(err, &conflict):
		current := conflict.Current
		c.JSON(http.StatusConflict, dto.ErrorResponse{
			Code: "GENERAL_DOC_VERSION_CONFLICT", Message: "다른 사용자가 먼저 저장했습니다.", CurrentVersion: &current,
		})
	case errors.Is(err, service.ErrProjectInvalid):
		writeGeneralInput(c)
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
			log.Error("general document request failed")
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Code: "INTERNAL", Message: "요청을 처리하지 못했습니다."})
	}
}
