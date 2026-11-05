# Interface Hub - Architecture

## 1. 문서 상태

정책은 `docs/requirements.md`가 기준이다. 테이블과 Migration 절차의 기준은 `docs/database.md`다. HTTP 형태는 `docs/api.md`다. 화면은 `docs/ui-design.md`다.

기존 `AI_seminar`는 읽기 전용으로 분석했다. 이 단계에서는 코드를 추가하거나 실행하지 않는다.

---

## 2. 기술 스택

| 구분 | 선택 |
|---|---|
| Backend | Go, Gin, GORM |
| Database | MariaDB 10.2.1 이상, `utf8mb4` |
| Frontend | React 18, TypeScript, Vite |
| API | JSON REST, prefix `/api` |
| 인증 | JWT Access Token 8시간, HS256만 허용. Refresh Token 없음 |
| 비밀번호 | bcrypt |
| 설정 | YAML. 비밀값은 Git에 넣지 않음 |
| 로그 | `log/slog` |
| 메일 | SMTP. 비밀번호 초기화에만 사용 |

Go 모듈 경로는 `interface-hub`다.

화면이 많으므로 Frontend 라우팅은 `react-router`를 쓴다. 재사용할 부분은 라우팅 라이브러리가 아니라 API 호출, `sessionStorage` 토큰, 오류 코드 표시다.

---

## 3. 재사용할 골격

| 영역 | 기존 위치 | 가져올 내용 |
|---|---|---|
| 계층 | handler, service, repository | Handler는 HTTP, Service는 권한과 규칙, Repository는 DB |
| 라우터 | `internal/router` | `gin.New()`. `/api`와 정적 파일을 분리 |
| 정적 파일 | `internal/router/static.go` | `web/index.html`, `/assets`, 그 외 경로는 `index.html`. `/api` 미일치는 JSON 404 |
| Windows Service | `cmd/server/service_windows.go` | 서비스 감지와 종료. 이름은 `interface_hub` |
| 설정 | `internal/config` | YAML 검증. 설정 객체 전체를 로그에 찍지 않음 |
| 로그 | `internal/logger` | method, 매칭된 route, status, latency_ms |
| 오류 형식 | `internal/handler/respond.go` | `code`, `message`. 내부 상세는 숨김 |
| JWT | `internal/auth/jwt.go` | HS256, Bearer |
| 비밀번호 | bcrypt | 최소 8자. 해시는 JSON에서 제외 |
| 메일 | `internal/mail` | 본문과 수신 주소를 로그에 남기지 않음 |
| 테스트 | 별도 test DB | 개발 DB 이름과 테스트 DB 이름을 섞지 않음 |
| 진행 | Task 단위 승인 | 승인 전 다음 기능 진행 금지 |

가져오지 않을 것은 익명 게시글, 댓글, 추천, 신고, 미디어, 카테고리, 게시물 비밀번호, Post Access Token, 비로그인 작성, 기동 시 고정 MASTER 생성이다.

기존 서버는 시작 시 SQL을 실행하고 이미 존재한다는 오류를 무시한다. 그 방식은 쓰지 않는다. Migration은 7장을 따른다. GORM AutoMigrate는 쓰지 않는다.

---

## 4. 시스템 구성

```text
Browser
  React SPA
        │
        ▼
Go server (Gin)
  JWT
  프로젝트 권한
  항목 단위 저장
  Optimistic Lock
  Markdown 생성
        │
        ▼
MariaDB  interface_hub
        │
        └─ SMTP   비밀번호 초기화 메일만. DB 트랜잭션 밖
```

MariaDB 프로세스(포트 3306)는 익명 게시판과 같은 인스턴스를 쓸 수 있다. database 이름과 DB 계정은 분리한다.

---

## 5. 디렉터리

구현이 시작되면 목표 구조는 다음과 같다. 지금은 `docs/`와 저장소 초기 파일만 있다.

```text
interface-hub/
├─ cmd/server/
├─ cmd/create-master/
├─ cmd/migrate/
├─ internal/
│  ├─ auth/ config/ dto/ handler/ logger/ mail/
│  ├─ markdown/ middleware/ model/ repository/ router/ service/
├─ migrations/
├─ config/config.example.yaml
├─ docs/
└─ web/
```

`cmd/migrate`만 SQL을 실행한다. `cmd/server`는 스키마가 기대와 같은지 확인하고, 다르면 기동을 멈춘다. Task 01은 이 명령과 `schema_migrations` SQL 파일을 두지만, 승인 전에는 그 명령을 실행하지 않는다.

P0 서버는 `kind=API`만 연다. 나머지 규격과 일반 문서, 에러 코드 경로는 P1에서 등록한다. 그 전에는 JSON 404다. `spec_documents.kind` 허용 값에는 네 종류를 넣어 P1에서 테이블을 다시 만들지 않게 한다.

---

## 6. 인증

`GET /api/health`만 비인증이다.

로그인 성공 시 JWT에 `account_id`, `role`, `iat`, `exp`를 넣는다. 만료는 8시간이다. secret은 설정 파일이며 익명 게시판과 다른 값이다.

토큰은 `sessionStorage`에 둔다.

로그인 실패 문구는 사번 존재 여부를 구분하지 않는다.

비밀번호 초기화의 원문 토큰은 저장하지 않는다. SHA-256 해시만 저장한다. Access Log는 query를 남기지 않는다. 배포 절차에서 프록시 로그의 URL query도 남기지 않도록 적는다.

### 6.1 비밀번호 초기화와 메일

SMTP 전송은 되돌릴 수 없다. DB 트랜잭션 안에서 메일을 보내지 않고, 메일 실패로 DB를 롤백한다고 가정하지 않는다. 메시지 큐와 별도 메일 워커는 만들지 않는다.

순서는 다음과 같다.

1. SMTP가 꺼져 있거나 `public_url`이 비어 있으면 DB에 토큰을 만들지 않고 실패를 반환한다.
2. 짧은 트랜잭션에서 그 사용자의 아직 쓸 수 있는 토큰을 취소하고, 새 토큰 해시를 넣는다. 만료는 30분이다. 커밋한 뒤에 트랜잭션을 끝낸다.
3. 트랜잭션 밖에서 설정 링크 메일을 보낸다.
4. 발송에 성공하면 짧은 트랜잭션으로 `sent_at`만 기록한다. 이 갱신이 실패해도 토큰은 유효하다. 사용자는 링크로 비밀번호를 바꿀 수 있다.
5. 발송에 실패하면 짧은 트랜잭션으로 그 토큰의 `revoked_at`을 기록한다. 비밀번호는 그대로다. MASTER 화면에는 실패만 알린다. 링크 URL은 보여 주지 않는다.
6. 5번 취소가 실패하면 토큰은 최대 30분 뒤 만료된다. 원문 토큰은 메일에만 있었고 발송은 실패한 상태다. MASTER가 다시 시도하면 이전 미사용 토큰을 먼저 취소한다.
7. 프로세스가 2번과 3번 사이에서 죽으면 토큰은 남아 있고 메일은 없다. 30분 뒤 만료된다. MASTER가 다시 시도한다.

비밀번호를 실제로 바꾸는 요청은 따로다. 해시가 맞고, 만료 전이며, `used_at`과 `revoked_at`이 비어 있을 때만 비밀번호를 바꾸고 `used_at`을 같은 트랜잭션에서 기록한다. 이 요청에는 메일이 없다.

---

## 7. Migration 실행

MariaDB에서 `CREATE TABLE`, `ALTER TABLE` 같은 DDL은 암묵적 COMMIT을 일으킬 수 있다. Migration 파일 전체를 하나의 DML 트랜잭션으로 묶어 실패 시 롤백된다고 가정하지 않는다.

운영 방식은 다음으로 고정한다.

- 적용 이력은 `schema_migrations`다. 컬럼은 파일명, SHA-256 체크섬, 적용 시각이다.
- 이미 적용된 파일은 다시 실행하지 않는다.
- 파일 내용의 체크섬이 기록과 다르면 서버와 migrate 명령 모두 즉시 멈춘다. 적용된 파일을 고치지 않는다.
- SQL 실행은 `cmd/migrate`만 한다. 서버 기동은 대기 중인 파일이 있으면 적용하지 않고 종료한다.
- GORM AutoMigrate는 쓰지 않는다.
- `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `ALTER TABLE ... DROP`이 들어 있는 파일은 migrate가 실행을 거부한다. 1차 스키마 변경은 새 테이블과 컬럼 추가로 해결한다.
- 파괴적인 SQL을 서버 재시작으로 자동 실행하지 않는다.
- "이미 존재" 오류를 무시하고 성공으로 처리하지 않는다.
- migrate는 database 이름이 `anonymous_board` 또는 `anonymous_board_test`이면 거부한다.

한 파일의 실행은 statement를 순서대로 `Exec`한다. 트랜잭션으로 감싸지 않는다.

실패하면 그 파일명을 `schema_migrations`에 넣지 않고 명령을 종료한다. 화면과 로그에 파일명, 실패한 statement 번호, DB 오류를 남긴다. 이미 커밋된 DDL은 자동으로 되돌리지 않는다.

복구는 사람이 한다.

1. 운영 적용 전에는 `interface_hub`만 백업한다. `anonymous_board`는 백업 대상에 넣더라도 이 명령이 그 DB에 접속하지 않게 한다.
2. 실패한 파일이 만든 객체를 확인한다.
3. 그 객체를 손으로 제거해 파일 실행 전 상태로 되돌리거나, 이미 맞는 객체는 남기고 파일의 남은 부분만 새 번호의 파일로 작성한다.
4. 같은 실패 파일을 고친 뒤 재실행하는 경우는, 부분 생성된 객체를 먼저 제거했을 때로 한정한다. 체크섬이 기록된 파일은 수정하지 않는다.
5. 자동 `DROP`으로 복구하지 않는다.

자세한 테이블 정의는 `docs/database.md` 5장이다.

---

## 8. 권한

미들웨어는 로그인 여부와 MASTER 역할만 본다.

프로젝트 권한은 Service가 검사한다.

```text
RequireProject(user, projectID, READ 또는 WRITE)
  MASTER는 멤버 행이 없어도 통과
  그 외에는 project_members를 본다
  WRITE 검사가 필요하면 permission = WRITE
```

멤버 변경과 프로젝트 제목·설명·보관·복구는 별도의 `RequireProjectAdmin`을 쓴다. 통과 조건은 MASTER이거나 `projects.created_by`가 자신인 경우다. WRITE만으로는 통과하지 못한다.

생성자의 멤버 행을 지우거나 READ로 바꾸는 요청은 `CREATOR_PERMISSION_LOCKED`로 거절한다.

`projects.status = ARCHIVED`이면 문서, 항목, 일반 문서, 에러 코드, 멤버, 제목 변경을 `PROJECT_ARCHIVED`로 거절한다. 조회와 Markdown은 허용한다. 상태를 ACTIVE로 바꾸는 복구만 예외다.

권한이 없는 상세 요청은 403이다.

DB Model을 그대로 JSON으로 반환하지 않는다.

---

## 9. 규격 문서와 항목 저장

공식 문서 1건이 version의 단위다. 항목 UUID는 서버가 만든다. 경로, Topic, Command ID는 기본 키가 아니다.

편집기의 기본 저장은 항목 하나, 문서 상단 정보, 항목 순서 중 하나다. 클라이언트가 전체 항목 배열을 보내 기존 행을 교체하는 API는 만들지 않는다.

### 9.1 항목 수정

```text
BEGIN
  SELECT version FROM spec_documents WHERE id = ? FOR UPDATE

  요청 version과 다르면 ROLLBACK → 409 DOCUMENT_VERSION_CONFLICT
  프로젝트가 ARCHIVED면 ROLLBACK → 409 PROJECT_ARCHIVED

  UPDATE spec_items
    대상 item_uid 한 행의 name, summary, status, sort_order, payload
  그 항목의 spec_item_error_codes만 교체

  대상 행이 없으면 ROLLBACK → 404

  UPDATE spec_documents
    SET version = version + 1
    WHERE id = ? AND version = 요청 version

  서버가 DB에서 문서 전체를 다시 읽어 스냅샷을 만든다
  INSERT spec_document_revisions
    summary: UPDATE_ITEM, item_uid, name
COMMIT
```

생성과 삭제도 같은 잠금을 쓴다. 삭제는 그 `item_uid` 행과 그 항목의 에러 코드 연결만 지운다. 다른 항목 행은 `UPDATE`하거나 `DELETE`하지 않는다.

스냅샷은 이력 비교용이다. 다음 저장의 입력으로 클라이언트 스냅샷을 신뢰하지 않는다.

### 9.2 순서 변경

요청은 version과 `item_uid` 배열이다. 배열의 집합이 DB의 현재 항목 집합과 다르면 409 `ITEM_SET_CHANGED`를 반환하고 순서를 바꾸지 않는다. 새로 생긴 항목이 요청에서 빠지는 경우 그 항목을 삭제하지 않기 위해서다.

### 9.3 문서 상단

제목과 `overview` 저장은 항목 행을 건드리지 않는다. version 검사와 이력 INSERT는 같다. summary는 `UPDATE_OVERVIEW`다.

### 9.4 충돌 후 재저장

409가 나도 서버는 작성 중 내용을 저장하지 않는다. 클라이언트가 최신 문서를 조회한 뒤, 사용자가 명시적으로 다시 저장할 때만 새 version으로 항목 하나의 요청을 보낸다.

다른 항목을 같이 보내지 않으므로, 그 사이에 저장된 다른 Endpoint나 Topic은 유지된다.

같은 항목을 다시 저장하면 그 항목은 요청 내용으로 바뀐다. 화면에서 그 사실을 알려 준다. 서버가 필드 단위로 병합하지 않는다.

### 9.5 만들지 않는 API

- 공식 규격 문서 삭제
- 공식 규격 문서 초기화
- 항목 배열 전체 교체

문서가 없는 것과 문서가 있는 것은 `spec_documents` 행의 유무로 구분한다. 1차에는 초기화로 항목을 비우는 상태가 없다.

---

## 10. 409 응답

```json
{
  "code": "DOCUMENT_VERSION_CONFLICT",
  "message": "다른 사용자가 먼저 저장했습니다.",
  "currentVersion": 6
}
```

`currentVersion`만 추가로 준다. 최신 본문은 `GET`으로 받는다.

클라이언트는 편집 상태를 메모리에 두고, 문서 ID, 항목 UUID, 기준 version을 키로 `sessionStorage`에 초안을 남긴다. 409여도 그 초안을 지우지 않는다. 비밀번호와 토큰은 초안에 넣지 않는다.

---

## 11. 이력 비교

비교 API는 두 스냅샷의 항목 UUID를 맞춘다.

- 이후에만 있는 UUID는 추가
- 이전에만 있는 UUID는 삭제
- 양쪽에 있고 payload, 이름, 상태, 에러 코드 연결이 다르면 수정
- `overview` 또는 제목이 다르면 문서 상단 변경

조회 화면은 이 세 묶음을 먼저 보여 주고, 수정된 항목은 이전과 이후를 나란히 보여 준다.

---

## 12. Markdown

READ 이상과 MASTER가 호출한다. 본문은 서버가 최신 행과 최신 에러 코드 설명으로 만든다. 화면의 복사와 다운로드는 같은 API다.

필드 트리가 구조의 기준이다. 사람이 붙인 JSON 예시는 검증을 통과한 것만 저장되므로, Markdown의 예시와 표가 서로 다른 구조를 가리키지 않는다. 장비 프로토콜의 HEX는 표와 별도로 그대로 싣는다.

형식은 `docs/ui-design.md`의 예시를 따른다.

---

## 13. 에러 코드

코드 행은 자신의 version으로 잠근다. 이 저장은 규격 문서 version을 올리지 않는다.

항목 저장이 `errorCodeIds`를 바꾸면 9.1의 항목 트랜잭션 안에서 그 항목의 연결만 바꾸고 문서 version을 올린다.

참조가 남은 코드 삭제는 409 `ERROR_CODE_IN_USE`다.

---

## 14. 검증

Service가 종류별 JSON을 검사한다. 통과한 값만 저장하므로 다시 열 때 필드가 사라지지 않는다.

공통 한계는 중첩 8단, 문서당 항목 500개, 같은 부모 안의 이름 중복 금지, 배열의 요소 스키마는 1개다.

JSON 예시는 문자열이 아니라 구조화된 값으로 저장한다. 직접 입력 모드에서 문법 오류이거나 필드 트리와 구조가 다르면 저장하지 않는다. 자동 생성 모드에서는 서버가 필드 예시로 예시를 만들어 저장한다. 기준은 `docs/database.md` 13장과 `docs/ui-design.md` 6장이다.

장비 프로토콜은 `encoding`, `byteOffset`, `byteLength`, `endian`을 필드에 저장한다. HEX 예시는 공백을 무시한 16진 문자이고 길이는 짝수여야 한다. HEX가 비어 있는 저장은 허용한다. HEX와 바이트 합이 달라도 1차에서는 저장을 막지 않고, 조회 화면에 경고만 남긴다. 바이트 합 자동 일치는 구현 비용이 커서 1차 범위에서 뺀다.

---

## 15. HTTP 상태

| 상태 | 사용 |
|---|---|
| 200 | 조회, 수정 |
| 201 | 생성 |
| 200 | 조회, 수정, 항목 삭제, 일반 문서 숨김. 삭제 응답에도 새 version을 포함한다 |
| 400 | 형식·검증 오류 |
| 401 | 인증 실패 |
| 403 | 권한 없음 |
| 404 | 대상 없음 |
| 409 | version 충돌, 항목 집합 불일치, 규격 중복, 사번 중복, 코드 중복, 참조 중 삭제, 보관 중 수정, 생성자 권한 잠금 |
| 500 | 내부 오류. 고정 메시지 |

시각은 UTC로 저장하고 RFC3339로 응답한다.

---

## 16. 로깅

Access Log는 method, 매칭된 route, status, latency_ms만 남긴다.

남기지 않을 값은 비밀번호, 해시, Authorization, JWT, 재설정 토큰, 메일 본문, 수신 주소, 문서 본문, 규격 JSON, Markdown 전문, 설정 전체, DB 비밀번호, JWT secret, SMTP 비밀번호, query string이다.

감사 기록은 이력 테이블의 수정자, 시각, 사유, 스냅샷이다.

---

## 17. 설정

```yaml
server:
  port: 8090
  public_url: ""

database:
  host: localhost
  port: 3306
  name: interface_hub
  user: interface_hub
  password: ""

jwt:
  secret: ""
  expire_hours: 8

smtp:
  enabled: false
  host: ""
  port: 587
  username: ""
  password: ""
  from_address: ""
```

`server.port` 기본 예시는 8090이다. `jwt.secret`은 비어 있으면 실패한다. SMTP를 켤 때는 host, port, from_address가 필수다.

예시 파일은 구현 Task에서 추가한다. 이번 단계에서는 만들지 않는다.

---

## 18. 배포 분리

| 항목 | 기존 익명 게시판 | Interface Hub |
|---|---|---|
| Backend 포트 | 8080 | 8090 |
| Vite 개발 포트 | 486, proxy `127.0.0.1:8080` | 487, proxy `127.0.0.1:8090` |
| 테스트용 포트 | 18080 | 18090 |
| Windows Service | `ai_seminar_anonymous_board` | `interface_hub` |
| 실행 파일 | `anonymous-board-server.exe` | `interface-hub-server.exe` |
| DB | `anonymous_board` | `interface_hub` |
| 테스트 DB | `anonymous_board_test` | `interface_hub_test` |
| 로그 | 접두어 `anonymous_board` | 별도 설치 폴더, 접두어 `interface_hub` |
| 설정과 정적 파일 | 게시판 배포 폴더 | `C:\services\interface-hub\` |

개발 PC에서 예전에 본 포트 상태는 운영 서버의 상태가 아니다. 배포 승인 후 운영 서버에서 서비스 이름과 포트를 확인하고, 그 전에 서비스를 등록하지 않는다.

Go 프로세스에 TLS를 넣지 않는다. 기존 사이트의 바인딩은 바꾸지 않는다.

---

## 19. 보안

- 비밀번호 원문과 재설정 토큰 원문을 저장하거나 로그에 남기지 않는다.
- 권한은 Backend에서 검사한다.
- SQL 파라미터를 바인딩한다. 사용자 입력을 SQL 문자열에 붙이지 않는다.
- DB 식별자는 허용 문자만 인용한다.
- 소스에 고정된 초기 비밀번호를 두지 않는다.
- 테스트와 migrate는 `anonymous_board`에 접속하지 않는다.

---

## 20. 테스트 원칙

구현이 시작되면 `go test ./...`는 외부 DB 없이 통과해야 한다. MariaDB 통합 테스트는 `interface_hub_test`일 때만 실행한다.

항목 저장 테스트에는 다음을 포함한다.

- version이 다르면 409이고 다른 항목 행이 그대로다.
- 같은 version으로 서로 다른 항목을 순서대로 저장하면 둘 다 남는다.
- 순서 변경 요청의 UUID 집합이 다르면 항목이 줄지 않는다.
- ARCHIVED에서는 항목 저장이 거절된다.
- 생성자 권한 행은 삭제되지 않는다.

화면이 있는 Task는 조회, 항목 편집, 409 후 재저장, 권한 없는 접근을 확인한다.

---

## 21. 원칙

1. 작성과 조회 사용성이 부가 기능보다 우선한다.
2. 공식 규격은 프로젝트와 종류당 1개다.
3. 저장은 바뀐 항목만 DB에 반영한다.
4. 권한과 보관 상태는 Backend가 검사한다.
5. 이력은 저장 성공 트랜잭션 안에서만 만든다.
6. DDL Migration의 자동 롤백을 전제로 하지 않는다.
7. 메일은 DB 트랜잭션 밖에서 보내고, 실패하면 토큰을 취소한다.
8. 기존 게시판의 포트, DB, 서비스, 로그, secret을 공유하지 않는다.
