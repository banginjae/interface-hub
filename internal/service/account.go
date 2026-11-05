package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"interface-hub/internal/auth"
	"interface-hub/internal/model"
)

var (
	ErrInvalid         = errors.New("invalid account request")
	ErrUnauthorized    = errors.New("unauthorized")
	ErrRateLimited     = errors.New("password reset rate limited")
	ErrMailUnavailable = errors.New("password reset mail unavailable")
)

type UserStore interface {
	FindByEmployeeNo(ctx context.Context, employeeNo string) (model.User, error)
	FindByID(ctx context.Context, id uint64) (model.User, error)
	List(ctx context.Context) ([]model.User, error)
	Create(ctx context.Context, user model.User) (model.User, error)
	Update(ctx context.Context, user model.User) (model.User, error)
	UpdatePassword(ctx context.Context, id uint64, hash string, mustChange bool, updatedAt time.Time) error
}

type ResetMailer interface {
	Enabled() bool
	Send(ctx context.Context, to, subject, body string) error
}

type AccountService struct {
	users  UserStore
	now    func() time.Time
	mailer ResetMailer
	resets *resetLimiter
}

type NewUser struct {
	EmployeeNo string
	Name       string
	Email      string
	Password   string
	Role       string
}

type UserChange struct {
	Name   string
	Email  string
	Role   string
	Active bool
}

func NewAccountService(users UserStore) *AccountService {
	return &AccountService{
		users:  users,
		now:    func() time.Time { return time.Now().UTC().Truncate(time.Second) },
		resets: newResetLimiter(),
	}
}

func (s *AccountService) SetResetMailer(mailer ResetMailer) {
	s.mailer = mailer
}

func (s *AccountService) Login(ctx context.Context, employeeNo, password string) (model.User, error) {
	employeeNo = strings.TrimSpace(employeeNo)
	if employeeNo == "" || password == "" {
		return model.User{}, ErrInvalid
	}
	user, err := s.users.FindByEmployeeNo(ctx, employeeNo)
	if errors.Is(err, model.ErrNotFound) {
		auth.CheckPassword("", password)
		return model.User{}, ErrUnauthorized
	}
	if err != nil {
		return model.User{}, err
	}
	if !auth.CheckPassword(user.PasswordHash, password) || !user.Active {
		return model.User{}, ErrUnauthorized
	}
	user.PasswordHash = ""
	return user, nil
}

func (s *AccountService) Current(ctx context.Context, id uint64) (model.User, error) {
	user, err := s.users.FindByID(ctx, id)
	if err != nil {
		return model.User{}, err
	}
	if !user.Active {
		return model.User{}, ErrUnauthorized
	}
	user.PasswordHash = ""
	return user, nil
}

func (s *AccountService) List(ctx context.Context) ([]model.User, error) {
	users, err := s.users.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range users {
		users[i].PasswordHash = ""
	}
	return users, nil
}

func (s *AccountService) Create(ctx context.Context, input NewUser) (model.User, error) {
	user, err := s.prepareNew(input)
	if err != nil {
		return model.User{}, err
	}
	created, err := s.users.Create(ctx, user)
	if err != nil {
		return model.User{}, err
	}
	created.PasswordHash = ""
	return created, nil
}

func (s *AccountService) UpdateProfile(ctx context.Context, id uint64, name, email string) (model.User, error) {
	if id == 0 || !validName(name) || !validEmail(email) {
		return model.User{}, ErrInvalid
	}
	current, err := s.users.FindByID(ctx, id)
	if err != nil {
		return model.User{}, err
	}
	if !current.Active {
		return model.User{}, ErrUnauthorized
	}
	current.Name = strings.TrimSpace(name)
	current.Email = strings.TrimSpace(email)
	current.UpdatedAt = s.now()
	updated, err := s.users.Update(ctx, current)
	if err != nil {
		return model.User{}, err
	}
	updated.PasswordHash = ""
	return updated, nil
}

func (s *AccountService) Update(ctx context.Context, id uint64, change UserChange) (model.User, error) {
	if id == 0 || !validName(change.Name) || !validEmail(change.Email) || !validRole(change.Role) {
		return model.User{}, ErrInvalid
	}
	current, err := s.users.FindByID(ctx, id)
	if err != nil {
		return model.User{}, err
	}
	current.Name = strings.TrimSpace(change.Name)
	current.Email = strings.TrimSpace(change.Email)
	current.Role = change.Role
	current.Active = change.Active
	current.UpdatedAt = s.now()
	updated, err := s.users.Update(ctx, current)
	if err != nil {
		return model.User{}, err
	}
	updated.PasswordHash = ""
	return updated, nil
}

func (s *AccountService) prepareNew(input NewUser) (model.User, error) {
	employeeNo := strings.TrimSpace(input.EmployeeNo)
	name := strings.TrimSpace(input.Name)
	email := strings.TrimSpace(input.Email)
	if !validEmployeeNo(employeeNo) || !validName(name) || !validEmail(email) || !validRole(input.Role) || !validPassword(input.Password) {
		return model.User{}, ErrInvalid
	}
	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return model.User{}, err
	}
	now := s.now()
	return model.User{
		EmployeeNo:   employeeNo,
		Name:         name,
		Email:        email,
		PasswordHash: hash,
		Role:         input.Role,
		Active:       true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

func validEmployeeNo(value string) bool {
	if value == "" || utf8.RuneCountInString(value) > 32 {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
	}
	return true
}

func validName(value string) bool {
	count := utf8.RuneCountInString(strings.TrimSpace(value))
	return count >= 1 && count <= 100
}

func validEmail(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 255 || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	at := strings.LastIndex(value, "@")
	if at <= 0 || at >= len(value)-1 {
		return false
	}
	domain := value[at+1:]
	return strings.Contains(domain, ".") && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}

func validRole(role string) bool {
	return role == model.RoleMaster || role == model.RoleMember
}

func validPassword(password string) bool {
	return len(password) >= 8 && len(password) <= 72
}
