//go:build windows

package main

import (
	"context"
	"net"
	"net/http"
	"time"

	"interface-hub/internal/logger"

	"golang.org/x/sys/windows/svc"
)

const windowsServiceName = "interface_hub"

func runWindowsService() bool {
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		return false
	}
	_ = svc.Run(windowsServiceName, &windowsService{})
	return true
}

type windowsService struct{}

func (windowsService) Execute(_ []string, reqs <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	changes <- svc.Status{State: svc.StartPending}
	log := logger.Server()
	srv, cleanup, err := buildServer()
	if err != nil {
		log.Error("windows service startup failed")
		return true, 1
	}
	defer cleanup()
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		log.Error("http listen failed")
		return true, 1
	}
	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Serve(ln)
	}()
	changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case err := <-errCh:
			if err != nil && err != http.ErrServerClosed {
				log.Error("http server stopped")
				return true, 1
			}
			return false, 0
		case c := <-reqs:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				log.Info("windows service stopping")
				changes <- svc.Status{State: svc.StopPending}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = srv.Shutdown(ctx)
				cancel()
				<-errCh
				return false, 0
			default:
				changes <- c.CurrentStatus
			}
		}
	}
}
