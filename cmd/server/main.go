package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"interface-hub/internal/auth"
	"interface-hub/internal/config"
	"interface-hub/internal/handler"
	"interface-hub/internal/logger"
	"interface-hub/internal/mail"
	"interface-hub/internal/middleware"
	"interface-hub/internal/repository"
	"interface-hub/internal/router"
	"interface-hub/internal/schema"
	"interface-hub/internal/service"

	"github.com/gin-gonic/gin"
)

func main() {
	if runWindowsService() {
		logger.CloseServer()
		return
	}
	if err := serveConsole(); err != nil {
		logger.Server().Error("server stopped", "reason", err.Error())
		logger.CloseServer()
		os.Exit(1)
	}
	logger.CloseServer()
}

func serveConsole() error {
	srv, cleanup, err := buildServer()
	if err != nil {
		return err
	}
	defer cleanup()

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.ListenAndServe()
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
		err := <-errCh
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

func buildServer() (*http.Server, func(), error) {
	configPath := parseConfigPath()
	log := logger.Server()
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "설정 파일을 확인하세요. 예시는 config/config.example.yaml 입니다.")
		return nil, func() {}, err
	}

	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		log.Error("database connection failed")
		return nil, func() {}, err
	}
	cleanup := func() { repository.Close(gdb) }
	sqlDB, err := repository.SQLDB(gdb)
	if err != nil {
		cleanup()
		return nil, func() {}, err
	}
	checkCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	err = schema.VerifyDB(checkCtx, sqlDB)
	cancel()
	if err != nil {
		cleanup()
		fmt.Fprintln(os.Stderr, "스키마가 최신이 아닙니다. cmd/migrate 를 승인한 뒤 실행하세요.")
		log.Error("schema check failed")
		return nil, func() {}, err
	}

	users := repository.NewUserRepository(gdb)
	accounts := service.NewAccountService(users)
	accounts.SetResetMailer(mail.New(cfg.SMTP))
	projectRepo := repository.NewProjectRepository(gdb)
	projects := service.NewProjectService(projectRepo, users)
	specs := service.NewSpecService(repository.NewSpecRepository(gdb), projectRepo)
	generalDocs := service.NewGeneralService(repository.NewGeneralRepository(gdb), projectRepo)
	errorCodes := service.NewErrorCodeService(repository.NewErrorCodeRepository(gdb), projectRepo)
	projectHandler := handler.NewProjectHandler(projects, log)
	projectHandler.AttachSpecs(specs)
	projectHandler.AttachDocuments(generalDocs)
	projectHandler.AttachErrorCodes(errorCodes)
	tokens := auth.Tokens{Secret: cfg.JWT.Secret, Expire: time.Duration(cfg.JWT.ExpireHours) * time.Hour}
	gin.SetMode(gin.ReleaseMode)
	engine := router.New(router.Params{
		Logger:        log,
		Health:        handler.NewHealthHandler(),
		Account:       handler.NewAccountHandler(accounts, tokens, log),
		Project:       projectHandler,
		Spec:          handler.NewSpecHandler(specs, log),
		General:       handler.NewGeneralHandler(generalDocs, log),
		ErrorCode:     handler.NewErrorCodeHandler(errorCodes, log),
		Authenticate:  middleware.RequireAuth(tokens, users),
		RequireMaster: middleware.RequireMaster(),
	})
	if webRoot := router.FindWebRoot(executableDir(), cwdDir()); webRoot != "" {
		router.MountStatic(engine, webRoot)
		log.Info("static web enabled")
	} else {
		log.Info("static web missing")
	}

	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Info("server starting", "addr", addr)
	return &http.Server{
		Addr:              addr,
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
	}, cleanup, nil
}

func parseConfigPath() string {
	if !flag.Parsed() {
		flag.String("config", config.DefaultPath, "config file path")
		flag.Parse()
	}
	return flag.Lookup("config").Value.String()
}

func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Dir(exe)
}

func cwdDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return cwd
}
