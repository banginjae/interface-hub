package router

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"interface-hub/internal/dto"
	"interface-hub/internal/handler"
	"interface-hub/internal/middleware"

	"github.com/gin-gonic/gin"
)

type Params struct {
	Logger        *slog.Logger
	Health        *handler.HealthHandler
	Account       *handler.AccountHandler
	Project       *handler.ProjectHandler
	Spec          *handler.SpecHandler
	General       *handler.GeneralHandler
	ErrorCode     *handler.ErrorCodeHandler
	Authenticate  gin.HandlerFunc
	RequireMaster gin.HandlerFunc
}

func New(p Params) *gin.Engine {
	engine := gin.New()
	engine.Use(middleware.Recovery(p.Logger))
	engine.Use(middleware.AccessLog(p.Logger))
	api := engine.Group("/api")
	api.GET("/health", p.Health.Get)
	if p.Account != nil {
		api.POST("/auth/login", p.Account.Login)
		api.POST("/auth/password-reset/request", p.Account.RequestPasswordReset)
	}
	if p.Authenticate != nil && (p.Account != nil || p.Project != nil || p.Spec != nil || p.General != nil || p.ErrorCode != nil) {
		authed := api.Group("")
		authed.Use(p.Authenticate)
		if p.Account != nil && p.RequireMaster != nil {
			authed.GET("/me", p.Account.Me)
			authed.PUT("/me", p.Account.UpdateMe)
			authed.PUT("/me/password", p.Account.ChangePassword)
			master := authed.Group("")
			master.Use(p.RequireMaster)
			master.GET("/master/users", p.Account.List)
			master.POST("/master/users", p.Account.Create)
			master.PUT("/master/users/:id", p.Account.Update)
		}
		if p.Project != nil {
			authed.GET("/projects", p.Project.List)
			authed.POST("/projects", p.Project.Create)
			authed.GET("/projects/:id", p.Project.Detail)
			authed.PUT("/projects/:id", p.Project.Update)
			authed.GET("/projects/:id/members", p.Project.Members)
			authed.POST("/projects/:id/members", p.Project.AddMember)
			authed.PUT("/projects/:id/members/:userId", p.Project.UpdateMember)
			authed.DELETE("/projects/:id/members/:userId", p.Project.RemoveMember)
		}
		if p.Spec != nil {
			authed.POST("/projects/:id/specs", p.Spec.Create)
			authed.GET("/projects/:id/specs/:kind", p.Spec.Get)
			authed.PATCH("/projects/:id/specs/:kind", p.Spec.Patch)
			authed.PUT("/projects/:id/specs/:kind/items/order", p.Spec.Reorder)
			authed.POST("/projects/:id/specs/:kind/items", p.Spec.CreateItem)
			authed.PUT("/projects/:id/specs/:kind/items/:itemUid", p.Spec.UpdateItem)
			authed.DELETE("/projects/:id/specs/:kind/items/:itemUid", p.Spec.DeleteItem)
			authed.GET("/projects/:id/specs/:kind/revisions", p.Spec.Revisions)
			authed.GET("/projects/:id/specs/:kind/revisions/compare", p.Spec.Compare)
			authed.GET("/projects/:id/specs/:kind/markdown", p.Spec.Markdown)
		}
		if p.General != nil {
			authed.GET("/projects/:id/general-docs", p.General.List)
			authed.POST("/projects/:id/general-docs", p.General.Create)
			authed.GET("/projects/:id/general-docs/:docId", p.General.Get)
			authed.PUT("/projects/:id/general-docs/:docId", p.General.Update)
			authed.DELETE("/projects/:id/general-docs/:docId", p.General.Delete)
			authed.GET("/projects/:id/general-docs/:docId/revisions", p.General.Revisions)
			authed.GET("/projects/:id/general-docs/:docId/revisions/compare", p.General.Compare)
			authed.GET("/projects/:id/general-docs/:docId/markdown", p.General.Markdown)
		}
		if p.ErrorCode != nil {
			authed.GET("/projects/:id/error-codes", p.ErrorCode.List)
			authed.POST("/projects/:id/error-codes", p.ErrorCode.Create)
			authed.GET("/projects/:id/error-codes/:errorCodeId", p.ErrorCode.Get)
			authed.PUT("/projects/:id/error-codes/:errorCodeId", p.ErrorCode.Update)
			authed.DELETE("/projects/:id/error-codes/:errorCodeId", p.ErrorCode.Delete)
			authed.GET("/projects/:id/error-codes/:errorCodeId/revisions", p.ErrorCode.Revisions)
			authed.GET("/projects/:id/error-codes/:errorCodeId/revisions/compare", p.ErrorCode.Compare)
		}
	}
	return engine
}

func FindWebRoot(exeDir, cwd string) string {
	candidates := []string{
		filepath.Join(exeDir, "web"),
		filepath.Join(exeDir, "..", "web"),
		filepath.Join(cwd, "web", "dist"),
		filepath.Join(cwd, "web"),
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, err := os.Stat(filepath.Join(abs, "index.html")); err == nil {
			return abs
		}
	}
	return ""
}

func MountStatic(engine *gin.Engine, webRoot string) {
	if engine == nil || strings.TrimSpace(webRoot) == "" {
		return
	}
	index := filepath.Join(webRoot, "index.html")
	if _, err := os.Stat(index); err != nil {
		return
	}
	if info, err := os.Stat(filepath.Join(webRoot, "assets")); err == nil && info.IsDir() {
		engine.Static("/assets", filepath.Join(webRoot, "assets"))
	}
	engine.GET("/", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.File(index)
	})
	engine.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/api" || strings.HasPrefix(path, "/api/") {
			c.JSON(http.StatusNotFound, dto.ErrorResponse{
				Code:    "NOT_FOUND",
				Message: "요청한 경로를 찾을 수 없습니다.",
			})
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.File(index)
	})
}
