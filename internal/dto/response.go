package dto

type ErrorResponse struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	CurrentVersion *uint  `json:"currentVersion,omitempty"`
}

type HealthResponse struct {
	Status string `json:"status"`
}
