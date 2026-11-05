package repository

import (
	"context"
	"errors"
	"time"

	"interface-hub/internal/model"

	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) FindByEmployeeNo(ctx context.Context, employeeNo string) (model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("employee_no = ?", employeeNo).Take(&user).Error
	if err != nil {
		return model.User{}, mapUserErr(err)
	}
	return user, nil
}

func (r *UserRepository) FindByID(ctx context.Context, id uint64) (model.User, error) {
	var user model.User
	err := r.db.WithContext(ctx).Where("id = ?", id).Take(&user).Error
	if err != nil {
		return model.User{}, mapUserErr(err)
	}
	return user, nil
}

func (r *UserRepository) List(ctx context.Context) ([]model.User, error) {
	var users []model.User
	err := r.db.WithContext(ctx).Order("id asc").Find(&users).Error
	if err != nil {
		return nil, mapUserErr(err)
	}
	return users, nil
}

func (r *UserRepository) Create(ctx context.Context, user model.User) (model.User, error) {
	err := r.db.WithContext(ctx).Create(&user).Error
	if err != nil {
		return model.User{}, mapUserErr(err)
	}
	return user, nil
}

func (r *UserRepository) UpdatePassword(ctx context.Context, id uint64, hash string, mustChange bool, updatedAt time.Time) error {
	err := r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{
		"password_hash":        hash,
		"password_must_change": mustChange,
		"updated_at":           updatedAt,
	}).Error
	if err != nil {
		return mapUserErr(err)
	}
	return nil
}

func (r *UserRepository) Update(ctx context.Context, user model.User) (model.User, error) {
	err := r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", user.ID).Updates(map[string]any{
		"name":       user.Name,
		"email":      user.Email,
		"role":       user.Role,
		"active":     user.Active,
		"updated_at": user.UpdatedAt,
	}).Error
	if err != nil {
		return model.User{}, mapUserErr(err)
	}
	return r.FindByID(ctx, user.ID)
}

func mapUserErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.ErrNotFound
	}
	var mysqlErr *mysqldriver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return model.ErrEmployeeTaken
	}
	return ErrDatabase
}
