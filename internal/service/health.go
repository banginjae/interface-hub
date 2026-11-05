package service

import "interface-hub/internal/dto"

type HealthService struct{}

func (HealthService) Status() dto.HealthResponse {
	return dto.HealthResponse{Status: "ok"}
}
