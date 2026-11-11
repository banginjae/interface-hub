package dto

type ProjectPerson struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type ProjectSummary struct {
	ID           uint64        `json:"id"`
	Title        string        `json:"title"`
	Status       string        `json:"status"`
	CreatedBy    ProjectPerson `json:"createdBy"`
	CreatedAt    string        `json:"createdAt"`
	MyPermission string        `json:"myPermission"`
}

type ProjectListResponse struct {
	Projects []ProjectSummary `json:"projects"`
}

type SpecSummary struct {
	Kind          string `json:"kind"`
	Exists        bool   `json:"exists"`
	Version       *uint  `json:"version,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
	UpdatedByName string `json:"updatedByName,omitempty"`
}

type ProjectDetail struct {
	ID                   uint64        `json:"id"`
	Title                string        `json:"title"`
	Description          string        `json:"description"`
	Status               string        `json:"status"`
	Version              uint          `json:"version"`
	CreatedBy            ProjectPerson `json:"createdBy"`
	CreatedAt            string        `json:"createdAt"`
	MyPermission         string        `json:"myPermission"`
	SpecSummaries        []SpecSummary `json:"specSummaries"`
	GeneralDocumentCount int           `json:"generalDocumentCount"`
	ErrorCodeCount       int           `json:"errorCodeCount"`
}

type CreateProjectRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type UpdateProjectRequest struct {
	Version     uint   `json:"version"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

type Member struct {
	UserID     uint64 `json:"userId"`
	EmployeeNo string `json:"employeeNo"`
	Name       string `json:"name"`
	Permission string `json:"permission"`
	Creator    bool   `json:"creator"`
}

type MemberListResponse struct {
	Members []Member `json:"members"`
}

type MemberCandidate struct {
	UserID     uint64 `json:"userId"`
	EmployeeNo string `json:"employeeNo"`
	Name       string `json:"name"`
}

type MemberCandidateListResponse struct {
	Candidates []MemberCandidate `json:"candidates"`
}

type AddMemberRequest struct {
	EmployeeNo string `json:"employeeNo"`
	Permission string `json:"permission"`
}

type UpdateMemberRequest struct {
	Permission string `json:"permission"`
}
