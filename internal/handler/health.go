package handler

import (
	"net/http"

	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

type HealthHandler struct {
	health service.HealthService
}

func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

func (h *HealthHandler) Get(c *gin.Context) {
	c.JSON(http.StatusOK, h.health.Status())
}
