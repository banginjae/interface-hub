package auth

import (
	"errors"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrToken = errors.New("token invalid")

type Claims struct {
	AccountID uint64 `json:"account_id"`
	Role      string `json:"role"`
	jwt.RegisteredClaims
}

type Tokens struct {
	Secret string
	Expire time.Duration
}

func (t Tokens) Issue(accountID uint64, role string, now time.Time) (string, int, error) {
	if t.Secret == "" || accountID == 0 || t.Expire <= 0 {
		return "", 0, ErrToken
	}
	expires := now.Add(t.Expire)
	raw, err := Sign(t.Secret, accountID, role, now, expires)
	if err != nil {
		return "", 0, err
	}
	return raw, int(t.Expire.Seconds()), nil
}

func Sign(secret string, accountID uint64, role string, issued, expires time.Time) (string, error) {
	if secret == "" || accountID == 0 {
		return "", ErrToken
	}
	claims := Claims{
		AccountID: accountID,
		Role:      role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatUint(accountID, 10),
			IssuedAt:  jwt.NewNumericDate(issued),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func (t Tokens) Parse(raw string, now time.Time) (uint64, error) {
	if t.Secret == "" || raw == "" {
		return 0, ErrToken
	}
	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrToken
		}
		return []byte(t.Secret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithTimeFunc(func() time.Time {
		return now
	}))
	if err != nil || !parsed.Valid || claims.AccountID == 0 {
		return 0, ErrToken
	}
	return claims.AccountID, nil
}
