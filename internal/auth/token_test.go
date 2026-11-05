package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestTokenExpiresInEightHoursAndRejectsOtherAlgorithms(t *testing.T) {
	secret := "test-signing-secret"
	now := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	tokens := Tokens{Secret: secret, Expire: 8 * time.Hour}
	raw, expiresIn, err := tokens.Issue(7, "MASTER", now)
	if err != nil {
		t.Fatal(err)
	}
	if expiresIn != 28800 {
		t.Fatalf("expiresIn %d", expiresIn)
	}
	accountID, err := tokens.Parse(raw, now.Add(8*time.Hour-time.Second))
	if err != nil || accountID != 7 {
		t.Fatalf("parse %d %v", accountID, err)
	}
	if _, err := tokens.Parse(raw, now.Add(8*time.Hour+time.Second)); err == nil {
		t.Fatal("expired token was accepted")
	}
	if _, err := tokens.Parse(raw, now); err != nil {
		t.Fatal(err)
	}
	other := jwt.NewWithClaims(jwt.SigningMethodHS384, Claims{
		AccountID: 7,
		Role:      "MASTER",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	})
	signed, err := other.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tokens.Parse(signed, now); err == nil {
		t.Fatal("non HS256 token was accepted")
	}
}

func TestPasswordHashIsNotPlaintext(t *testing.T) {
	password := "memory-only-secret"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if hash == password || len(hash) < 20 || hash[:2] != "$2" {
		t.Fatal("hash was not bcrypt")
	}
	if !CheckPassword(hash, password) || CheckPassword(hash, "other-secret") || CheckPassword("", password) {
		t.Fatal("password check mismatch")
	}
}
