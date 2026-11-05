package dto

type LoginRequest struct {
	EmployeeNo string `json:"employeeNo"`
	Password   string `json:"password"`
}

type LoginResponse struct {
	AccessToken string      `json:"accessToken"`
	ExpiresIn   int         `json:"expiresIn"`
	User        SessionUser `json:"user"`
}

type SessionUser struct {
	ID         uint64 `json:"id"`
	EmployeeNo string `json:"employeeNo"`
	Name       string `json:"name"`
	Role       string `json:"role"`
}

type AccountUser struct {
	ID                 uint64 `json:"id"`
	EmployeeNo         string `json:"employeeNo"`
	Name               string `json:"name"`
	Email              string `json:"email"`
	Role               string `json:"role"`
	Active             bool   `json:"active"`
	PasswordMustChange bool   `json:"passwordMustChange"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

type PasswordResetRequest struct {
	EmployeeNo string `json:"employeeNo"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type UpdateProfileRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type CreateUserRequest struct {
	EmployeeNo string `json:"employeeNo"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	Role       string `json:"role"`
}

type UpdateUserRequest struct {
	Name   string `json:"name"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Active *bool  `json:"active"`
}
