package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/dto"
	"interface-hub/internal/middleware"
	"interface-hub/internal/model"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type AccountHandler struct {
	accounts *service.AccountService
	tokens   auth.Tokens
	log      *slog.Logger
}

func NewAccountHandler(accounts *service.AccountService, tokens auth.Tokens, log *slog.Logger) *AccountHandler {
	return &AccountHandler{accounts: accounts, tokens: tokens, log: log}
}

func (h *AccountHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	user, err := h.accounts.Login(c.Request.Context(), req.EmployeeNo, req.Password)
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	token, expiresIn, err := h.tokens.Issue(user.ID, user.Role, time.Now().UTC())
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, dto.LoginResponse{
		AccessToken: token,
		ExpiresIn:   expiresIn,
		User: dto.SessionUser{
			ID:         user.ID,
			EmployeeNo: user.EmployeeNo,
			Name:       user.Name,
			Role:       user.Role,
		},
	})
}

func (h *AccountHandler) RequestPasswordReset(c *gin.Context) {
	var req dto.PasswordResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	mailFailed, err := h.accounts.RequestPasswordReset(c.Request.Context(), req.EmployeeNo, c.ClientIP())
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	if mailFailed && h.log != nil {
		h.log.Info("password reset mail was not delivered")
	}
	c.JSON(http.StatusOK, gin.H{"status": "ACCEPTED"})
}

func (h *AccountHandler) ChangePassword(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		writeAuthRequired(c)
		return
	}
	var req dto.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	if err := h.accounts.ChangePassword(c.Request.Context(), user.ID, req.CurrentPassword, req.NewPassword); err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AccountHandler) UpdateMe(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		writeAuthRequired(c)
		return
	}
	var req dto.UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	updated, err := h.accounts.UpdateProfile(c.Request.Context(), user.ID, req.Name, req.Email)
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, accountUser(updated))
}

func (h *AccountHandler) Me(c *gin.Context) {
	user, ok := middleware.CurrentUser(c)
	if !ok {
		writeAuthRequired(c)
		return
	}
	c.JSON(http.StatusOK, accountUser(user))
}

func (h *AccountHandler) List(c *gin.Context) {
	users, err := h.accounts.List(c.Request.Context())
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	out := make([]dto.AccountUser, 0, len(users))
	for _, user := range users {
		out = append(out, accountUser(user))
	}
	c.JSON(http.StatusOK, out)
}

func (h *AccountHandler) Create(c *gin.Context) {
	var req dto.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	user, err := h.accounts.Create(c.Request.Context(), service.NewUser{
		EmployeeNo: req.EmployeeNo,
		Name:       req.Name,
		Email:      req.Email,
		Password:   req.Password,
		Role:       req.Role,
	})
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	c.JSON(http.StatusCreated, accountUser(user))
}

func (h *AccountHandler) Update(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "사용자를 찾을 수 없습니다."})
		return
	}
	var req dto.UpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Active == nil {
		writeAccountError(c, h.log, service.ErrInvalid)
		return
	}
	user, err := h.accounts.Update(c.Request.Context(), id, service.UserChange{
		Name:   req.Name,
		Email:  req.Email,
		Role:   req.Role,
		Active: *req.Active,
	})
	if err != nil {
		writeAccountError(c, h.log, err)
		return
	}
	c.JSON(http.StatusOK, accountUser(user))
}

func accountUser(user model.User) dto.AccountUser {
	return dto.AccountUser{
		ID:                 user.ID,
		EmployeeNo:         user.EmployeeNo,
		Name:               user.Name,
		Email:              user.Email,
		Role:               user.Role,
		Active:             user.Active,
		PasswordMustChange: user.PasswordMustChange,
		CreatedAt:          user.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          user.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func writeAuthRequired(c *gin.Context) {
	c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "인증이 필요합니다."})
}

func writeAccountError(c *gin.Context, log *slog.Logger, err error) {
	switch {
	case errors.Is(err, service.ErrInvalid):
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "요청 정보가 올바르지 않습니다."})
	case errors.Is(err, service.ErrMailUnavailable):
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Code: "INVALID_REQUEST", Message: "메일을 보내지 못했습니다."})
	case errors.Is(err, service.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, dto.ErrorResponse{Code: "RATE_LIMITED", Message: "요청이 많습니다. 잠시 후 다시 시도하세요."})
	case errors.Is(err, service.ErrUnauthorized):
		c.JSON(http.StatusUnauthorized, dto.ErrorResponse{Code: "UNAUTHORIZED", Message: "사번 또는 비밀번호가 올바르지 않습니다."})
	case errors.Is(err, model.ErrEmployeeTaken):
		c.JSON(http.StatusConflict, dto.ErrorResponse{Code: "EMPLOYEE_NO_TAKEN", Message: "이미 등록된 사번입니다."})
	case errors.Is(err, model.ErrNotFound):
		c.JSON(http.StatusNotFound, dto.ErrorResponse{Code: "NOT_FOUND", Message: "사용자를 찾을 수 없습니다."})
	default:
		if log != nil {
			log.Error("account request failed")
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Code: "INTERNAL_ERROR", Message: "요청을 처리하지 못했습니다."})
	}
}
