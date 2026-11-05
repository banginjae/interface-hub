package middleware

import (
	"log/slog"
	"net/http"

	"interface-hub/internal/dto"

	"github.com/gin-gonic/gin"
)

func Recovery(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recover() != nil {
				if log != nil {
					log.Error("panic recovered")
				}
				c.AbortWithStatusJSON(http.StatusInternalServerError, dto.ErrorResponse{
					Code:    "INTERNAL_ERROR",
					Message: "서버 오류가 발생했습니다.",
				})
			}
		}()
		c.Next()
	}
}
