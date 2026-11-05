package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"interface-hub/internal/model"
)

func TestRenderAPIMarkdownKeepsNestedFieldsAndStoredExample(t *testing.T) {
	overview, _ := json.Marshal(apiOverview{
		BaseURL: "https://lab.example",
		Auth:    overviewAuth{Type: "BEARER", Description: "연구소 토큰"},
		CommonHeaders: []fieldNode{{
			Name: "X-Request-Id", Type: "string", Required: false, Description: "요청 추적", Example: "req-1",
		}},
	})
	payload, _ := json.Marshal(apiPayload{
		Method: "POST", Path: "/devices/{deviceId}/commands", Description: "장비에 명령을 전달한다.",
		Auth: apiAuth{Type: "BEARER", Description: "호출 토큰"},
		Headers: []fieldNode{{
			Name: "X-Request-Id", Type: "string", Required: false, Description: "요청 추적", Example: "req-1",
		}},
		PathParams: []fieldNode{{
			Name: "deviceId", Type: "string", Required: true, Description: "장비 식별자", Example: "dev-01",
		}},
		QueryParams: []fieldNode{{
			Name: "dryRun", Type: "boolean", Required: false, Description: "실행 없이 검증", Example: "false",
		}},
		RequestBody: apiExampleBody{
			ContentType: "application/json",
			Fields: []fieldNode{{
				Name: "command", Type: "string", Required: true, Description: "명령 이름", Example: "start",
			}, {
				Name: "params", Type: "object", Required: true,
				Children: []fieldNode{{
					Name: "speed", Type: "integer", Required: false, Description: "속도", Example: "10",
				}},
			}, {
				Name: "tags", Type: "array", Required: false,
				ArrayItem: &fieldNode{
					Name: "item", Type: "object",
					Children: []fieldNode{{
						Name: "code", Type: "string", Required: true, Description: "태그", Example: "line",
					}},
				},
			}},
			ExampleMode: "AUTO",
			Example:     json.RawMessage(`{"command":"start","params":{"speed":10},"tags":[{"code":"line"}]}`),
		},
		Responses: []apiResponseBody{{
			Name: "성공", Status: 200, Description: "접수 결과",
			Fields: []fieldNode{{
				Name: "accepted", Type: "boolean", Required: true, Description: "접수 여부", Example: "true",
			}},
			ExampleMode: "AUTO",
			Example:     json.RawMessage(`{"accepted":true}`),
		}},
	})
	doc := model.SpecDocument{
		Title: "API 규격", Overview: overview, Version: 12,
		UpdatedAt: time.Date(2026, 11, 3, 6, 20, 0, 0, time.UTC), Updater: "홍길동",
	}
	text := RenderAPIMarkdown("포장 라인", doc, []model.SpecItem{{
		Name: "명령 전송", Summary: "즉시 전달", Status: "ACTIVE", Payload: payload,
	}})
	for _, part := range []string{
		"# 포장 라인 — API 규격",
		"- 버전: 12",
		"- 최종 수정: 2026-11-03T06:20:00Z / 홍길동",
		"- Base URL: https://lab.example",
		"- 공통 인증: BEARER",
		"- 공통 인증 설명: 연구소 토큰",
		"| X-Request-Id | string | 아니오 | 요청 추적 | req-1 |",
		"## Endpoint 목록",
		"- `POST /devices/{deviceId}/commands` — 명령 전송",
		"장비에 명령을 전달한다.",
		"- 요약: 즉시 전달",
		"| params.speed | integer | 아니오 | 속도 | 10 |",
		"| tags[].code | string | 예 | 태그 | line |",
		"```json",
		`"speed": 10`,
		"### Response 200 성공",
		`"accepted": true`,
	} {
		if !strings.Contains(text, part) {
			t.Fatalf("missing %s\n%s", part, text)
		}
	}
	if strings.Contains(text, "DEVICE_OFFLINE") || !strings.Contains(text, "### 에러 코드\n\n없습니다.") {
		t.Fatal("markdown invented error codes")
	}
}

func TestRenderGeneralMarkdownUsesStoredBody(t *testing.T) {
	doc := model.GeneralDocument{
		Title: "설치 가이드", Department: "FW", Content: "## 준비\n전원 순서", Version: 3,
		UpdatedAt: time.Date(2026, 11, 3, 6, 20, 0, 0, time.UTC), Updater: "홍길동",
	}
	text := RenderGeneralMarkdown("포장 라인", doc)
	for _, part := range []string{
		"# 포장 라인 — 설치 가이드",
		"- 문서 버전: 3",
		"- 담당 부서: FW",
		"- 최종 수정: 2026-11-03T06:20:00Z / 홍길동",
		"## 준비",
		"전원 순서",
	} {
		if !strings.Contains(text, part) {
			t.Fatalf("missing %s\n%s", part, text)
		}
	}
	name := MarkdownFilename("포장 라인", "general", 3)
	if name != "포장 라인-general-v3.md" {
		t.Fatal(name)
	}
}

func TestMarkdownFilenameReplacesPathCharacters(t *testing.T) {
	name := MarkdownFilename(`포장/라인:A`, "API", 3)
	if name != "포장_라인_A-API-v3.md" {
		t.Fatal(name)
	}
	if MarkdownFilename("  ", "API", 1) != "project-API-v1.md" {
		t.Fatal(MarkdownFilename("  ", "API", 1))
	}
}
