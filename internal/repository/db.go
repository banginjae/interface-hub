package repository

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"strconv"
	"time"

	"interface-hub/internal/config"

	mysqldriver "github.com/go-sql-driver/mysql"
	gormmysql "gorm.io/driver/mysql"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

const (
	maxOpenConns    = 10
	maxIdleConns    = 5
	connMaxLifetime = 30 * time.Minute
)

var ErrDatabase = errors.New("database connection failed")

func Open(cfg config.DatabaseConfig) (*gorm.DB, error) {
	gdb, err := gorm.Open(gormmysql.Open(dsn(cfg)), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		return nil, ErrDatabase
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		_ = closeSilent(gdb)
		return nil, ErrDatabase
	}
	sqlDB.SetMaxOpenConns(maxOpenConns)
	sqlDB.SetMaxIdleConns(maxIdleConns)
	sqlDB.SetConnMaxLifetime(connMaxLifetime)
	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		_ = sqlDB.Close()
		return nil, ErrDatabase
	}
	return gdb, nil
}

func Close(gdb *gorm.DB) {
	_ = closeSilent(gdb)
}

func closeSilent(gdb *gorm.DB) error {
	if gdb == nil {
		return nil
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func SQLDB(gdb *gorm.DB) (*sql.DB, error) {
	if gdb == nil {
		return nil, ErrDatabase
	}
	return gdb.DB()
}

func dsn(cfg config.DatabaseConfig) string {
	mysqlCfg := mysqldriver.NewConfig()
	mysqlCfg.User = cfg.User
	mysqlCfg.Passwd = cfg.Password
	mysqlCfg.Net = "tcp"
	mysqlCfg.Addr = net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	mysqlCfg.DBName = cfg.Name
	mysqlCfg.ParseTime = true
	mysqlCfg.Timeout = 5 * time.Second
	mysqlCfg.Params = map[string]string{
		"charset": "utf8mb4",
		"loc":     "UTC",
	}
	return mysqlCfg.FormatDSN()
}
