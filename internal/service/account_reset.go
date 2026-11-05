package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/model"
)

const (
	resetEmployeeLimit = 5
	resetIPLimit       = 20
	resetWindow        = 15 * time.Minute
	tempPasswordLength = 16
	tempAlphabet       = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
)

type resetLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newResetLimiter() *resetLimiter {
	return &resetLimiter{hits: map[string][]time.Time{}}
}

func (l *resetLimiter) allow(key string, limit int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-resetWindow)
	kept := l.hits[key][:0]
	for _, at := range l.hits[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= limit {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}

func (s *AccountService) RequestPasswordReset(ctx context.Context, employeeNo, clientIP string) (bool, error) {
	employeeNo = strings.TrimSpace(employeeNo)
	if employeeNo == "" {
		return false, ErrInvalid
	}
	now := s.now()
	if !s.resets.allow("ip:"+strings.TrimSpace(clientIP), resetIPLimit, now) || !s.resets.allow("no:"+employeeNo, resetEmployeeLimit, now) {
		return false, ErrRateLimited
	}
	if s.mailer == nil || !s.mailer.Enabled() {
		return false, ErrMailUnavailable
	}
	user, err := s.users.FindByEmployeeNo(ctx, employeeNo)
	if errors.Is(err, model.ErrNotFound) || (err == nil && !user.Active) {
		_, _ = temporaryPassword()
		_, _ = auth.HashPassword("timing-only-password")
		return false, nil
	}
	if err != nil {
		return false, err
	}
	temporary, err := temporaryPassword()
	if err != nil {
		return false, err
	}
	hash, err := auth.HashPassword(temporary)
	if err != nil {
		return false, err
	}
	previousHash := user.PasswordHash
	previousFlag := user.PasswordMustChange
	if err := s.users.UpdatePassword(ctx, user.ID, hash, true, now); err != nil {
		return false, err
	}
	body := fmt.Sprintf("Interface Hub 임시 비밀번호입니다.\n\n사번: %s\n임시 비밀번호: %s\n\n로그인한 뒤 비밀번호를 변경하세요.\n", user.EmployeeNo, temporary)
	if err := s.mailer.Send(ctx, user.Email, "Interface Hub 임시 비밀번호", body); err != nil {
		if restoreErr := s.users.UpdatePassword(ctx, user.ID, previousHash, previousFlag, s.now()); restoreErr != nil {
			return false, restoreErr
		}
		return true, nil
	}
	return false, nil
}

func (s *AccountService) ChangePassword(ctx context.Context, id uint64, current, next string) error {
	if id == 0 || !validPassword(next) || next == current {
		return ErrInvalid
	}
	user, err := s.users.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if !user.Active || !auth.CheckPassword(user.PasswordHash, current) {
		return ErrInvalid
	}
	hash, err := auth.HashPassword(next)
	if err != nil {
		return err
	}
	return s.users.UpdatePassword(ctx, user.ID, hash, false, s.now())
}

func temporaryPassword() (string, error) {
	raw := make([]byte, tempPasswordLength)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	out := make([]byte, tempPasswordLength)
	for i, value := range raw {
		out[i] = tempAlphabet[int(value)%len(tempAlphabet)]
	}
	return string(out), nil
}
