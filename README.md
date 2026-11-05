# Interface Hub

연구소 내부용 통합 개발 규격 및 산출물 관리 시스템입니다.

한 프로젝트의 API, MQTT, WebSocket, 장비 프로토콜 공식 규격과 부서별 기술 문서를 한곳에서 작성하고 조회합니다.

OQ-01부터 OQ-18은 유지합니다. TASK-001부터 API 규격 편집·조회(TASK-005), 변경 이력과 버전 비교(TASK-006), Markdown 복사·다운로드(TASK-007)까지 구현되어 있고, TASK-008에서 로컬 운영 빌드 통합 검증을 마쳤습니다. MQTT 규격 편집·조회·이력·Markdown은 TASK-009입니다. WebSocket 규격 편집·조회·이력·Markdown은 TASK-010입니다. 부서별 일반 Markdown 문서의 작성·이력·Markdown은 TASK-011입니다. 장비 프로토콜의 명령·바이트 배치·HEX·이력·Markdown은 TASK-012입니다. 프로젝트 공통 오류 코드와 규격 참조는 TASK-013입니다. 비밀번호 변경과 초기화 메일은 TASK-018입니다. 다음 구현은 개발자 확인 후입니다.

## 로컬 실행

예시 설정을 복사해 로컬 값만 채웁니다. `config/config.yaml`은 Git에 포함하지 않습니다.

```text
config/config.example.yaml
```

MariaDB에 migration을 적용하는 명령은 `go run ./cmd/migrate -config config/config.yaml`입니다. 개발 DB 적용은 별도 승인 후에만 실행합니다. 서버는 스키마가 파일과 같아야 포트 8090에서 시작합니다.

```text
go run ./cmd/server -config config/config.yaml
```

최초 MASTER는 서버가 만들지 않습니다. 비밀번호는 표준 입력으로 두 번 받으며 출력하지 않습니다.

```text
go run ./cmd/create-master -config config/config.yaml -employee-no <사번> -name <성명> -email <이메일>
```

Frontend 개발 서버는 `web`에서 `npm run dev`이며 포트는 487입니다. 운영에서는 `npm run build` 결과인 `web/dist`를 Go 서버가 제공합니다.

## 문서

- `docs/requirements.md` — 확정 정책과 범위
- `docs/architecture.md` — 구조, 항목 단위 잠금, 메일, Migration 실행
- `docs/database.md` — 테이블, JSON, 체크섬 Migration
- `docs/ui-design.md` — 규격 편집기, 조회, 충돌 UX
- `docs/api.md` — HTTP 초안

구현은 위 문서가 확정된 뒤 Task 단위로 진행합니다. 개발자 승인 없이 다음 Task로 넘어가지 않습니다.

## 기존 시스템과의 관계

개발 프로세스와 서버 골격은 `AI_seminar` 익명 게시판에서 검증한 방식을 재사용합니다. 익명 게시판 기능 자체는 가져오지 않습니다. 기존 서버의 포트, 서비스 이름, DB, 설정, 로그는 분리합니다.
