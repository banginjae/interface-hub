package middleware

import (
	"log/slog"
	"time"

	"interface-hub/internal/logger"

	"github.com/gin-gonic/gin"
)

func AccessLog(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		path := c.FullPath()
		if path == "" {
			path = "unmatched"
		}
		logger.Request(log, c.Request.Method, path, c.Writer.Status(), time.Since(start))
	}
}
