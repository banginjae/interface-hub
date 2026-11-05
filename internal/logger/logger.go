package logger

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const logFilePrefix = "interface_hub"

var (
	serverOnce   sync.Once
	serverLogger *slog.Logger
	serverCloser func()
)

func New(w io.Writer) *slog.Logger {
	if w == nil {
		w = os.Stdout
	}
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func Server() *slog.Logger {
	serverOnce.Do(func() {
		serverLogger, serverCloser = openBesideExecutable()
	})
	return serverLogger
}

func CloseServer() {
	if serverCloser != nil {
		serverCloser()
	}
}

func openBesideExecutable() (*slog.Logger, func()) {
	exe, err := os.Executable()
	if err != nil {
		return New(os.Stdout), func() {}
	}
	day := time.Now().In(seoul()).Format("20060102")
	dir := filepath.Join(filepath.Dir(exe), "log", day)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return New(os.Stdout), func() {}
	}
	path := filepath.Join(dir, logFilePrefix+"_"+day+".log")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return New(os.Stdout), func() {}
	}
	return New(io.MultiWriter(os.Stdout, file)), func() {
		_ = file.Sync()
		_ = file.Close()
	}
}

func seoul() *time.Location {
	loc, err := time.LoadLocation("Asia/Seoul")
	if err != nil {
		return time.FixedZone("KST", 9*3600)
	}
	return loc
}

func Request(log *slog.Logger, method, path string, status int, latency time.Duration) {
	if log == nil {
		return
	}
	log.Info("http_request",
		"method", method,
		"path", path,
		"status", status,
		"latency_ms", latency.Milliseconds(),
	)
}
