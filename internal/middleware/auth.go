package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/dto"
	"interface-hub/internal/model"

	"github.com/gin-gonic/gin"
)

type UserFinder interface {
	FindByID(ctx context.Context, id uint64) (model.User, error)
}

const currentUserKey = "currentUser"

func RequireAuth(tokens auth.Tokens, users UserFinder) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := bearerToken(c.GetHeader("Authorization"))
		if raw == "" {
			writeAuthError(c, http.StatusUnauthorized, "UNAUTHORIZED", "인증이 필요합니다.")
			return
		}
		accountID, err := tokens.Parse(raw, time.Now().UTC())
		if err != nil {
			writeAuthError(c, http.StatusUnauthorized, "UNAUTHORIZED", "인증이 필요합니다.")
			return
		}
		user, err := users.FindByID(c.Request.Context(), accountID)
		if err != nil || !user.Active {
			writeAuthError(c, http.StatusUnauthorized, "UNAUTHORIZED", "인증이 필요합니다.")
			return
		}
		user.PasswordHash = ""
		c.Set(currentUserKey, user)
		c.Next()
	}
}

func RequireMaster() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := CurrentUser(c)
		if !ok {
			writeAuthError(c, http.StatusUnauthorized, "UNAUTHORIZED", "인증이 필요합니다.")
			return
		}
		if user.Role != model.RoleMaster {
			writeAuthError(c, http.StatusForbidden, "FORBIDDEN", "권한이 없습니다.")
			return
		}
		c.Next()
	}
}

func CurrentUser(c *gin.Context) (model.User, bool) {
	value, ok := c.Get(currentUserKey)
	if !ok {
		return model.User{}, false
	}
	user, ok := value.(model.User)
	return user, ok
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

func writeAuthError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, dto.ErrorResponse{Code: code, Message: message})
}
