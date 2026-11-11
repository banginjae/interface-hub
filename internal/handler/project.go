package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"interface-hub/internal/dto"
	"interface-hub/internal/middleware"
	"interface-hub/internal/model"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type documentCounter interface {
	Count(ctx context.Context, projectID uint64) (int, error)
}

type ProjectHandler struct {
	projects  *service.ProjectService
	specs     *service.SpecService
	documents documentCounter
	codes     documentCounter
	log       *slog.Logger
}

func NewProjectHandler(projects *service.ProjectService, log *slog.Logger) *ProjectHandler {
	return &ProjectHandler{projects: projects, log: log}
}

func (h *ProjectHandler) AttachSpecs(specs *service.SpecService) {
	h.specs = specs
}

func (h *ProjectHandler) AttachDocuments(counter documentCounter) {
	h.documents = counter
}

func (h *ProjectHandler) AttachErrorCodes(counter documentCounter) {
	h.codes = counter
}

func (h *ProjectHandler) List(c *gin.Context) {
	actor, ok := currentActor(c)
	if !ok {
		return
	}
	items, err := h.projects.List(c.Request.Context(), actor)
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	out := make([]dto.ProjectSummary, 0, len(items))
	for _, item := range items {
		out = append(out, dto.ProjectSummary{
			ID:           item.ID,
			Title:        item.Title,
			Status:       item.Status,
			CreatedBy:    dto.ProjectPerson{ID: item.CreatedByID, Name: item.CreatedByName},
			CreatedAt:    item.CreatedAt.UTC().Format(time.RFC3339),
			MyPermission: item.MyPermission,
		})
	}
	c.JSON(http.StatusOK, dto.ProjectListResponse{Projects: out})
}

func (h *ProjectHandler) Create(c *gin.Context) {
	actor, ok := currentActor(c)
	if !ok {
		return
	}
	var req dto.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeProjectError(c, h.log, service.ErrProjectInvalid)
		return
	}
	view, err := h.projects.Create(c.Request.Context(), actor, service.ProjectInput{
		Title:       req.Title,
		Description: req.Description,
	})
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	h.respondDetail(c, http.StatusCreated, view)
}

func (h *ProjectHandler) Detail(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	view, err := h.projects.Detail(c.Request.Context(), actor, projectID)
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	h.respondDetail(c, http.StatusOK, view)
}

func (h *ProjectHandler) Update(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var req dto.UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeProjectError(c, h.log, service.ErrProjectInvalid)
		return
	}
	view, err := h.projects.Update(c.Request.Context(), actor, projectID, service.ProjectChange{
		Version:     req.Version,
		Title:       req.Title,
		Description: req.Description,
		Status:      req.Status,
	})
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	h.respondDetail(c, http.StatusOK, view)
}

func (h *ProjectHandler) Members(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	project, members, err := h.projects.Members(c.Request.Context(), actor, projectID)
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	out := make([]dto.Member, 0, len(members))
	for _, member := range members {
		out = append(out, dto.Member{
			UserID:     member.UserID,
			EmployeeNo: member.EmployeeNo,
			Name:       member.Name,
			Permission: member.Permission,
			Creator:    member.UserID == project.CreatedBy,
		})
	}
	c.JSON(http.StatusOK, dto.MemberListResponse{Members: out})
}

func (h *ProjectHandler) AddMember(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	var req dto.AddMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeProjectError(c, h.log, service.ErrProjectInvalid)
		return
	}
	member, err := h.projects.AddMember(c.Request.Context(), actor, projectID, req.EmployeeNo, req.Permission)
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, dto.Member{
		UserID:     member.UserID,
		EmployeeNo: member.EmployeeNo,
		Name:       member.Name,
		Permission: member.Permission,
		Creator:    false,
	})
}

func (h *ProjectHandler) MemberCandidates(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	rows, err := h.projects.MemberCandidates(c.Request.Context(), actor, projectID, c.Query("q"))
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	out := make([]dto.MemberCandidate, 0, len(rows))
	for _, row := range rows {
		out = append(out, dto.MemberCandidate{UserID: row.UserID, EmployeeNo: row.EmployeeNo, Name: row.Name})
	}
	c.JSON(http.StatusOK, dto.MemberCandidateListResponse{Candidates: out})
}

func (h *ProjectHandler) UpdateMember(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	userID, ok := pathUint(c, "userId")
	if !ok {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "멤버를 찾을 수 없습니다."})
		return
	}
	var req dto.UpdateMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeProjectError(c, h.log, service.ErrProjectInvalid)
		return
	}
	member, err := h.projects.UpdateMember(c.Request.Context(), actor, projectID, userID, req.Permission)
	if err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, dto.Member{
		UserID:     member.UserID,
		EmployeeNo: member.EmployeeNo,
		Name:       member.Name,
		Permission: member.Permission,
		Creator:    false,
	})
}

func (h *ProjectHandler) RemoveMember(c *gin.Context) {
	actor, projectID, ok := actorAndProject(c)
	if !ok {
		return
	}
	userID, ok := pathUint(c, "userId")
	if !ok {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "멤버를 찾을 수 없습니다."})
		return
	}
	if err := h.projects.RemoveMember(c.Request.Context(), actor, projectID, userID); err != nil {
		writeProjectError(c, h.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *ProjectHandler) respondDetail(c *gin.Context, status int, view service.ProjectView) {
	body := projectDetail(view)
	if h.specs != nil {
		rows, err := h.specs.Summaries(c.Request.Context(), view.Project.ID)
		if err != nil {
			writeProjectError(c, h.log, err)
			return
		}
		found := map[string]model.SpecSummaryRow{}
		for _, row := range rows {
			found[row.Kind] = row
		}
		for index, summary := range body.SpecSummaries {
			row, ok := found[summary.Kind]
			if !ok {
				continue
			}
			version := row.Version
			body.SpecSummaries[index].Exists = true
			body.SpecSummaries[index].Version = &version
			body.SpecSummaries[index].UpdatedAt = row.UpdatedAt.UTC().Format(time.RFC3339)
			body.SpecSummaries[index].UpdatedByName = row.UpdatedByName
		}
	}
	if h.documents != nil {
		count, err := h.documents.Count(c.Request.Context(), view.Project.ID)
		if err != nil {
			writeProjectError(c, h.log, err)
			return
		}
		body.GeneralDocumentCount = count
	}
	if h.codes != nil {
		count, err := h.codes.Count(c.Request.Context(), view.Project.ID)
		if err != nil {
			writeProjectError(c, h.log, err)
			return
		}
		body.ErrorCodeCount = count
	}
	c.JSON(status, body)
}

func projectDetail(view service.ProjectView) dto.ProjectDetail {
	kinds := service.SpecKinds()
	summaries := make([]dto.SpecSummary, 0, len(kinds))
	for _, kind := range kinds {
		summaries = append(summaries, dto.SpecSummary{Kind: kind, Exists: false})
	}
	project := view.Project
	return dto.ProjectDetail{
		ID:          project.ID,
		Title:       project.Title,
		Description: project.Description,
		Status:      project.Status,
		Version:     project.Version,
		CreatedBy: dto.ProjectPerson{
			ID:   project.CreatedBy,
			Name: view.CreatorName,
		},
		CreatedAt:            project.CreatedAt.UTC().Format(time.RFC3339),
		MyPermission:         view.MyPermission,
		SpecSummaries:        summaries,
		GeneralDocumentCount: 0,
		ErrorCodeCount:       0,
	}
}

func currentActor(c *gin.Context) (model.User, bool) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "인증이 필요합니다."})
		return model.User{}, false
	}
	return user, true
}

func actorAndProject(c *gin.Context) (model.User, uint64, bool) {
	user, ok := currentActor(c)
	if !ok {
		return model.User{}, 0, false
	}
	projectID, ok := pathUint(c, "id")
	if !ok {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "프로젝트를 찾을 수 없습니다."})
		return model.User{}, 0, false
	}
	return user, projectID, true
}

func pathUint(c *gin.Context, name string) (uint64, bool) {
	id, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil || id == 0 {
		return 0, false
	}
	return id, true
}

func writeProjectError(c *gin.Context, log *slog.Logger, err error) {
	var conflict service.VersionConflictError
	switch {
	case errors.As(err, &conflict):
		current := conflict.Current
		c.JSON(http.StatusConflict, dto.ErrorResponse{
			Code:           "PROJECT_VERSION_CONFLICT",
			Message:        "다른 사용자가 먼저 저장했습니다.",
			CurrentVersion: &current,
		})
	case errors.Is(err, service.ErrProjectInvalid):
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "요청 정보가 올바르지 않습니다."})
	case errors.Is(err, service.ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "인증이 필요합니다."})
	case errors.Is(err, service.ErrProjectForbidden):
		c.JSON(http.StatusForbidden, dto.ErrorResponse{Code: "FORBIDDEN", Message: "권한이 없습니다."})
	case errors.Is(err, service.ErrProjectArchived):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "PROJECT_ARCHIVED", Message: "보관된 프로젝트는 수정할 수 없습니다."})
	case errors.Is(err, service.ErrCreatorLocked):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "CREATOR_PERMISSION_LOCKED", Message: "생성자 권한은 변경할 수 없습니다."})
	case errors.Is(err, service.ErrMemberInactive):
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "MEMBER_INACTIVE", Message: "비활성 계정은 멤버로 추가할 수 없습니다."})
	case errors.Is(err, model.ErrMemberExists):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "MEMBER_ALREADY_EXISTS", Message: "이미 등록된 멤버입니다."})
	case errors.Is(err, model.ErrNotFound):
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "요청한 대상을 찾을 수 없습니다."})
	default:
		if log != nil {
			log.Error("project request failed")
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Code: "INTERNAL_ERROR", Message: "요청을 처리하지 못했습니다."})
	}
}
