# Interface Hub - Tasks

## 1. 사용 방법

이 문서가 구현 순서와 완료 상태의 기준이다.

- P0를 위에서 아래로 진행한다.
- 한 Task가 끝나면 보고하고 멈춘다. 개발자 확인 없이 다음 Task를 시작하지 않는다.
- P1은 P0가 끝난 뒤, 남은 시간과 개발자 승인으로 순서를 바꿀 수 있다.
- P2는 세미나 이후다.
- 설계 문서의 P1, P2 요구는 삭제하지 않는다. 이 목록은 구현 시점만 정한다.
- 체크박스는 검증한 항목만 완료로 표시한다. DB에 적용하지 않은 Migration은 완료로 표시하지 않는다.

상태 값: `대기`, `진행 중`, `검증 대기`, `완료`.

---

## 2. P0

세미나에서 보여줄 범위다. API 규격의 작성, 조회, 이력, Markdown이 MariaDB에 실제로 저장되어야 한다.

### TASK-001 프로젝트 골격

상태: `완료`

목적: 이후 기능이 붙는 Go 서버, Migration 명령, React 빌드, 정적 파일 제공을 만든다. 로그인과 문서는 만들지 않는다.

Backend:

- Go 모듈, Gin, 설정 검증, 로거, Recovery
- `GET /api/health`는 DB를 조회하지 않는다
- 서버는 기동 시 스키마가 파일과 일치하는지만 확인하고, 다르면 SQL을 실행하지 않고 종료한다
- 콘솔 인터럽트와 Windows Service 중지 시 HTTP를 닫는다

Database:

- `migrations/000001_create_schema_migrations.up.sql`
- `cmd/migrate`만 SQL을 실행할 수 있다
- 체크섬이 다르면 재실행하지 않는다
- 파괴적 SQL은 거부한다
- GORM AutoMigrate를 호출하지 않는다
- 로컬 개발 DB 적용은 승인 후 `cmd/migrate`로만 했다

Frontend:

- Vite 개발 포트 487, `/api` 프록시 대상 `127.0.0.1:8090`
- Health 확인 화면만 둔다
- 운영 빌드는 Go가 `web/dist`를 제공한다
- `/api` 밖 경로는 `index.html`, `/api` 미일치는 JSON 404

변경 파일: `cmd/`, `internal/`, `migrations/`, `config/config.example.yaml`, `web/`, `README.md`. 기존 `AI_seminar`는 변경하지 않는다.

완료 조건:

- [x] `go test ./...`와 `go build ./...` 성공
- [x] `GET /api/health`가 `{"status":"ok"}`를 반환
- [x] `npm run build` 성공
- [x] 빌드된 `index.html`을 Go가 제공하고 `/status` 새로고침도 `index.html`
- [x] `GET /api/unknown`이 JSON 404
- [x] 포트 8090, DB 이름 `interface_hub`, 서비스 이름 `interface_hub`
- [x] `config.yaml`과 실제 secret이 Git에 없음
- [x] 로컬 MariaDB `interface_hub`에 `000001`을 적용하고, 체크섬이 파일과 같으며 재실행해도 `applied_at`이 바뀌지 않음
- [x] 그 DB로 서버가 8090에서 기동하고 콘솔 인터럽트로 종료됨
- [x] 브라우저에서 Health 화면이 `{"status":"ok"}`를 표시함

검증:

- 라우터 테스트, 빌드, 로컬 MariaDB, 브라우저로 Health, 정적 파일, JSON 404를 확인했다
- `anonymous_board`와 운영 서버는 변경하지 않았다

위험:

- 스키마 확인을 통과해야 서버가 포트를 연다. 적용된 migration과 파일이 다르면 서버는 SQL을 실행하지 않고 종료한다
- DDL은 실패 시 자동 롤백되지 않는다

중단: 완료 보고 후 TASK-002를 진행했다.

### TASK-002 로그인과 최소 계정

상태: `완료`

목적: 사번 로그인과 MASTER의 개별 계정 관리를 실제 DB에 연결한다.

Backend: 로그인, JWT 8시간, `GET /api/me`, MASTER 사용자 생성·조회·수정·비활성화. 고정 MASTER 자동 생성은 없다.

Database: `users`. `password_reset_tokens`는 만들지 않는다.

Frontend: 로그인, 로그인 사용자 정보, MASTER 계정 화면, 인증 상태별 접근 제어. 서비스 표시 이름은 화면 설정의 `Interface Hub`다. 일괄 등록 화면은 없다.

CLI: `cmd/create-master`. 비밀번호는 표준 입력으로만 받고 출력하지 않는다.

뒤로 옮긴 범위: 본인 비밀번호 변경, 비밀번호 초기화 링크, SMTP. 요구사항은 삭제하지 않고 TASK-018에서 구현한다.

완료 조건:

- [x] 잘못된 비밀번호와 없는 사번은 같은 401이다
- [x] 비활성 계정은 로그인되지 않는다
- [x] bcrypt 해시만 저장된다
- [x] 토큰 없이 보호 API를 호출하면 401이다
- [x] MASTER가 직원을 만들고, 그 직원은 로그인되지만 계정 관리는 403이다
- [x] 서버를 다시 시작해도 계정이 남아 있다
- [x] 브라우저에서 MASTER 로그인, 내 정보, 계정 목록, 로그아웃, 비로그인 접근 차단이 된다

검증: 서비스 테스트, 로컬 MariaDB, API, 브라우저.

미검증: SMTP, 본인 비밀번호 변경, 초기화 메일. Vite 개발 서버는 이 단계에서 다시 띄우지 않았다. 검증용 사번 `9000001`, `9000002`는 비활성화했다.

중단: 완료 보고 후 대기. TASK-003은 시작하지 않는다.

### TASK-003 프로젝트와 권한

상태: `완료`

목적: 프로젝트 생성, 목록, 상세, 멤버, 보관, 복구를 Backend와 화면에서 끝낸다.

Backend: 목록에는 제목, 상태, 생성자, 생성일, 내 권한만 준다. 상세는 READ 또는 MASTER. 멤버 변경은 MASTER와 생성자. 생성자 WRITE는 잠근다. ARCHIVED 내용 수정은 409.

Database: `projects`, `project_members`. 파일은 합의된 번호 `000004`, `000005`다. `000003` 비밀번호 토큰 파일은 아직 없다.

Frontend: 목록, 생성, 상세, 멤버. API 편집 탭은 두지 않고 미구현 안내만 보여 준다.

완료 조건:

- [x] 권한 없는 상세는 403이고 설명이 응답에 없다
- [x] 일반 WRITE 사용자는 프로젝트 정보와 멤버를 바꾸지 못한다
- [x] 생성자 권한 행이 삭제되거나 READ로 내려가지 않는다
- [x] 보관 중 수정이 거절되고 복구 후 다시 수정할 수 있다
- [x] 브라우저에서 생성, READ 상세, WRITE 승격 후 관리 버튼 숨김이 맞다

검증: MariaDB 통합 테스트와 브라우저. MASTER, 생성자, WRITE, READ, 권한 없음.

미검증: 규격 편집 화면은 TASK-005다. 비생성자 WRITE의 제목 수정은 권한 표에 따라 403이다.

중단: 완료 보고 후 대기. TASK-004는 시작하지 않는다.

### TASK-004 API 문서와 Endpoint 저장

상태: `완료`

목적: API 공식 문서와 Endpoint를 항목 단위로 저장하고 version으로 막는다. 편집기 전체 UI는 TASK-005다.

Backend: 문서 생성, 상단 수정, 항목 생성·수정·삭제, 순서 변경. `kind`는 `API`만 받는다. 다른 kind는 404다. `errorCodeIds`는 빈 배열만 허용한다. 다른 항목 행을 교체하지 않는다.

Database: `spec_documents`, `spec_items`, `spec_document_revisions`. kind 허용 값에는 네 종류를 모두 넣는다.

Frontend: 없음. 이 Task는 HTTP와 DB 검증까지다.

완료 조건:

- [x] 프로젝트당 API 문서가 두 개 생기지 않는다
- [x] version이 다르면 409이고 대상 밖 항목은 그대로다
- [x] 순서 배열의 UUID 집합이 다르면 항목 수가 줄지 않는다
- [x] 저장 성공 시에만 이력 스냅샷이 생긴다
- [x] ARCHIVED에서는 저장이 거절된다

검증: MariaDB 통합 테스트와 HTTP 호출. 브라우저 검증은 TASK-005로 넘긴다.

미검증: 편집 화면, Markdown, MQTT, WebSocket, 장비 프로토콜 API.

위험: 항목 JSON을 통째로 교체하는 구현이 들어가면 동시 수정 시 다른 Endpoint가 되돌아간다.

중단: 완료 보고 후 대기. TASK-005는 시작하지 않는다.

### TASK-005 API 편집기와 조회 화면

상태: `완료`

목적: Endpoint를 양식으로 저장하고 표와 JSON으로 읽게 한다.

Frontend: 필드 트리, object/array, Request와 여러 Response, 자동 JSON 예시, 직접 입력 시 불일치면 저장 금지. 조회 모드와 편집 모드를 나눈다. 에러 코드 선택 칸은 두지 않는다.

Backend: TASK-004 API를 그대로 사용한다. 화면 전용 가짜 저장소는 두지 않는다.

완료 조건:

- [x] 중첩 필드를 저장한 뒤 다시 열어도 값과 순서가 같다
- [x] 예시 JSON의 타입 불일치가 저장되지 않는다
- [x] 한 Endpoint만 저장했을 때 다른 Endpoint가 바뀌지 않는다
- [x] 권한 없는 사용자에게 편집 버튼이 없고 API도 거절한다
- [x] 브라우저에서 등록, 수정, 삭제, 조회가 된다

검증: 브라우저에서 위 경로를 직접 조작한다. 개발 DB의 행을 확인한다.

검증 기록:

- [x] 서버·화면 기동, 전용 테스트 계정 준비. 기존 MASTER(사번 10001)는 변경하지 않음.
- [x] 2026-11-04 로컬 Chrome에서 POST Endpoint 저장. HTTP 201. Request Body의 contentType은 application/json. Response 객체에는 contentType 없음. 400 없음. 새로고침 후 params.speed, params.meta.unit, items[].id가 남음.
- [x] Header·Path·Query 추가와 삭제, Query 순서 이동, object 중첩, array 안 object와 하위 필드, Response 필드 추가·삭제를 저장 전에 조작. AUTO 예시에 integer 10과 문자열, 배열 항목이 나옴. MANUAL은 문법 오류, 필수 누락, 타입 불일치, 정의되지 않은 필드를 저장 요청 없이 막음. 정상 MANUAL은 HTTP 200. 새로고침 후 필드와 예시가 남음.
- [x] Endpoint 추가, 설명 수정(HTTP 200, 화면 버전 증가), 정렬, 다른 Endpoint 유지, 삭제. 저장하지 않은 변경에서 프로젝트로 이동할 때 확인 문구가 뜸.
- [x] 두 탭에서 같은 Endpoint를 편집. 첫 탭 저장 후 둘째 탭 PUT은 409. 둘째 탭 Path는 유지. 내 입력과 서버 최신 Path를 나란히 표시. 확인 후에만 재저장이 한 번 나감.
- [x] MASTER는 규격 편집 가능. READ는 편집 버튼과 Endpoint 추가가 없고 직접 PUT은 403. WRITE는 규격 편집이 되고 프로젝트명·멤버 추가는 없음. 권한 없는 계정은 상세·규격 안내 문구와 GET 403. 보관 후 조회 배너만 있고 편집 버튼이 없으며 수정 API는 409.
- [x] 테스트 계정 8명과 그 계정이 만든 프로젝트 7개, 연결된 규격 행을 삭제. 사번 10001과 그 외 프로젝트 1개는 유지. `cmd/task005seed`는 삭제.

위험: 필드 편집기 상태 관리가 이 Task의 대부분이다. MQTT 화면을 같이 만들지 않는다.

중단: 완료 보고 후 대기.

### TASK-006 이력, 충돌, 버전 비교

상태: `완료`

목적: 409 이후에도 입력이 남고, 추가·삭제·수정이 구분되는 비교가 된다.

Frontend: 충돌 배너, 최신 항목과 내 입력의 나란히 보기, 명시적 재저장, 이력 목록, 두 버전 비교.

Backend: 비교 API가 UUID 기준으로 `added`, `removed`, `updated`를 준다. 응답 계약은 바꾸지 않았고, 필드·순서·개요의 세부 차이는 스냅샷으로 화면에서 나눈다.

완료 조건:

- [x] 409 응답이 폼을 지우지 않는다. TASK-005에서 확인했고 저장 경로는 유지했다
- [x] 재저장 전에는 새 version으로 요청이 나가지 않는다. TASK-005에서 확인했다
- [x] 다른 Endpoint를 먼저 저장한 뒤 재저장해도 그 Endpoint가 유지된다. TASK-005에서 확인했다
- [x] 비교 화면이 추가, 삭제, 수정, 필드 변경, 순서, 문서 개요를 구분한다

검증: 2026-11-04 로컬 Chrome. 문서 생성, Endpoint 추가·수정·순서 변경·삭제, 이력 목록, Version 3과 4 비교, 새로고침, READ 조회, 보관 후 조회를 확인했다. 캡처는 `docs/ui-screenshots/ui006-history.png`, `ui006-compare.png`. 검증 계정과 프로젝트는 삭제했다.

위험: 재저장이 문서 전체를 보내면 TASK-004의 잠금이 무력해진다. 재저장 요청은 기존처럼 항목 하나만 보낸다.

중단: 완료 보고 후 대기.

### TASK-007 Markdown 복사와 다운로드

상태: `완료`

목적: 화면에 보이는 최신 API 규격과 같은 Markdown을 복사하고 파일로 저장한다.

Backend: `GET /api/projects/:id/specs/API/markdown`.

Frontend: 조회 화면의 복사와 다운로드. 항목 하나 복사는 만들지 않는다.

완료 조건:

- [x] Method, 경로, 필드 표, 중첩 경로, JSON 예시, version, 수정자가 들어 있다
- [x] READ는 받을 수 있고 권한 없음은 403이다
- [x] 저장 전 편집 내용이 아니라 마지막 저장본이 나온다

검증: 2026-11-04 로컬 Chrome. 복사 내용과 다운로드 파일이 같고 `device.serial`, `tags[]`, 문서 버전 6이 들어 있다. 삭제한 Endpoint는 없다. 조회와 Markdown은 version을 올리지 않는다. 보관 후에도 받을 수 있다. 캡처는 `docs/ui-screenshots/ui006-markdown.png`, `ui006-reader.png`, `ui006-archived.png`.

위험: 클라이언트가 표를 조립하면 서버 출력과 달라진다. 미리보기, 복사, 다운로드는 서버 본문만 사용한다.

중단: 완료 보고 후 대기.

### TASK-008 통합 검증과 운영 빌드

상태: `완료`

목적: P0 전체를 개발 DB와 브라우저로 한 번 더 확인하고, Go가 `web/dist`를 제공하는 빌드를 만든다.

범위: 새 기능 추가가 아니다. 로그인부터 Markdown까지 한 경로를 검증하고 실패한 항목만 고친다. Windows Service 등록과 운영 서버 배포는 별도 승인 전이다.

완료 조건:

- [x] `go test ./...`, `npm run build` 성공
- [x] 개발 DB에 P0 Migration이 적용된 상태에서 시나리오가 통과한다
- [x] 운영 빌드에서 `npm run dev` 없이 로그인, API 편집, 조회, Markdown이 된다
- [x] `/api/unknown`이 JSON이다
- [x] 익명 게시판 DB 이름과 포트, 서비스 이름을 사용하지 않는다

검증: 2026-11-04. `go test ./...`와 `npm run build`가 통과했다. 로컬 DB `interface_hub`(127.0.0.1:3306)의 Migration 7개 체크섬이 파일과 일치하고, 콘솔의 Go 서버가 포트 8090에서 `web/dist`를 제공했다. Vite 개발 서버는 사용하지 않았다. 로컬 Chrome에서 MASTER 로그인, 프로젝트 생성·목록·상세, 직원 계정 생성, READ/WRITE 부여, 권한 밖 403, 보관과 복구, Endpoint 추가·수정·삭제·정렬, Header/Path/Query, 중첩 Object, Array 안 Object, AUTO JSON, MANUAL JSON 거부와 초안 유지, Version 증가, 새로고침, 409 초안 유지와 명시적 재저장, 변경 이력, 필드 타입 비교, Markdown 미리보기·복사·다운로드를 확인했다. 조회와 내보내기는 Version을 올리지 않았고, 복사 내용과 다운로드 파일이 같았다. 서버를 재시작한 뒤에도 같은 Version과 필드가 남았다. `/api/unknown`은 JSON `NOT_FOUND`다. 기능 오류는 없어 코드를 고치지 않았다. 검증 계정과 프로젝트는 삭제했다. 기존 프로젝트 id 10, 24와 기존 계정은 변경하지 않았다. Windows Service와 운영 배포는 하지 않았다.

위험: 이 Task에서 P1 화면을 끼워 넣으면 검증 범위가 커진다.

중단: P0 보고 후 P1은 새 승인을 기다린다.

### TASK-018 비밀번호 변경과 초기화 메일

상태: `대기`

목적: TASK-002에서 뒤로 옮긴 본인 비밀번호 변경과 MASTER 비밀번호 초기화를 구현한다. 요구사항과 API 초안은 유지한다.

Backend: `PUT /api/me/password`, 초기화 링크 발급과 확인. 메일은 DB 트랜잭션 밖에서 보내고, 실패하면 토큰만 취소한다. 비밀번호는 유지한다.

Database: `password_reset_tokens`.

Frontend: 내 비밀번호 변경, MASTER의 초기화 요청, 설정 화면.

완료 조건:

- [ ] 초기화 메일 실패 시 토큰이 취소되고 비밀번호는 유지된다
- [ ] 현재 비밀번호가 다르면 본인 비밀번호가 바뀌지 않는다
- [ ] 만료, 사용됨, 취소 토큰은 같은 401이다

검증: 서비스 테스트. SMTP가 없으면 가짜 Sender로 실패 경로를 확인하고, 실제 메일 도착은 미검증으로 남긴다.

위험: 메일 주소를 응답이나 로그에 남기면 초기화 대상이 노출된다.

중단: 완료 보고 후 대기.

---

## 3. P1

P0 완료와 승인 후에만 시작한다. 공통 필드 편집기와 항목 API를 재사용한다. `spec_documents`를 다시 설계하지 않는다.

### TASK-009 MQTT

상태: `완료`

목적: Topic 편집과 조회. REST 문서와 같은 `spec_documents` 행을 쓰되 kind는 MQTT이고 Version은 독립이다. 새 테이블은 없다.

완료 조건:

- [x] QoS, Retain, 방향, Payload, 대응 Topic이 저장 후 조회와 Markdown에 남는다
- [x] API 문서 테스트가 계속 통과하고, MQTT 저장은 API Version을 바꾸지 않는다
- [x] kind 분기가 API payload 검증을 느슨하게 만들지 않는다

검증: 2026-11-04. 로컬 DB `interface_hub`와 포트 8090 운영 빌드. `go test ./...`, `npm run build` 통과. MariaDB 통합 테스트에서 MQTT 문서 생성, Topic 3개, QoS·Retain, 중첩 Payload, 수정·삭제·정렬, Version 증가, API Version 유지, 409, 참조 중 삭제 거부, Markdown, READ 403 아님·외부 403, 보관 중 `PROJECT_ARCHIVED`를 확인했다. 로컬 Chrome에서 프로젝트 상세의 MQTT 카드, 빈 문서·빈 Topic, Topic 추가·조회, 와일드카드 안내, 수동 JSON 거부, 변경 이력과 Version 1 대비 비교, Markdown 복사와 다운로드 일치, 두 탭 409 초안 유지, READ 조회 전용, 보관 후 편집 차단과 복구를 확인했다. 서버 재시작 후 MQTT Version 11과 API Version 2가 그대로였다. WebSocket과 장비 프로토콜 카드는 열리지 않는다. 검증 계정과 프로젝트는 삭제했다. 기존 프로젝트 id 10, 24와 기존 계정은 변경하지 않았다. 캡처는 `docs/ui-screenshots/ui009-editor.png`, `ui009-mqtt.png`, `ui009-compare.png`, `ui009-markdown.png`.

위험: kind 분기가 API payload 검증을 느슨하게 만들 수 있다. MQTT는 별도 정규화를 쓰고, API payload에 `topic`이 있으면 거부한다.

### TASK-010 WebSocket

상태: `완료`

목적: 연결 정보와 메시지 편집, 조회. REST·MQTT와 같은 문서 구조를 쓰고, 메시지 payload는 WebSocket 계약 그대로다.

완료 조건:

- [x] 연결 URL, 인증, 방향, 종류, Payload가 다시 열어도 같다
- [x] 문서 상단 저장과 메시지 저장은 요청을 나누고, 각 저장이 WebSocket Version만 올린다
- [x] API·MQTT 테스트와 Version은 유지된다

검증: 2026-11-04. 로컬 DB `interface_hub`와 포트 8090 운영 빌드. `go test ./...`, `npm run build` 통과. MariaDB 통합 테스트에서 WebSocket 문서, 연결 URL·종료 코드, 메시지 3개, 방향·종류, 중첩 Payload, 수정·삭제·정렬, Version 증가, API·MQTT Version 유지, 409, 참조 중 삭제 거부, Markdown, 외부 403, 보관 중 `PROJECT_ARCHIVED`를 확인했다. 로컬 Chrome에서 프로젝트 카드, 빈 문서·빈 메시지, 메시지 추가·조회, AUTO JSON, MANUAL 거부, 변경 이력과 Version 비교, Markdown 복사·다운로드 일치, 두 탭 409 초안 유지, READ 조회 전용, 권한 없음, 보관 후 편집 차단과 복구를 확인했다. 서버 재시작 후 WebSocket Version 11, API·MQTT Version 2가 그대로였다. 장비 프로토콜 카드는 열리지 않는다. 검증 계정과 프로젝트는 삭제했다. 기존 프로젝트 id 10, 24와 기존 계정은 변경하지 않았다. 캡처는 `docs/ui-screenshots/ui010-websocket.png`, `ui010-compare.png`, `ui010-markdown.png`.

위험: 문서 상단과 항목 저장을 한 요청으로 합치면 항목 잠금과 섞인다. 상단과 메시지는 기존과 같이 따로 저장한다.

### TASK-011 일반 문서

상태: `완료`

목적: 부서별 산출물을 Markdown으로 여러 개 저장하고 조회한다.

Database: `general_documents`, `general_document_revisions`. 둘 다 `000009_create_general_documents.up.sql`에 둔다. `000010`은 에러 코드용으로 남겨 둔다.

완료 조건:

- [x] 프로젝트마다 일반 문서를 여러 개 만들 수 있고, 개수 제한이 없다
- [x] 제목, 부서 태그, Markdown 본문, 작성자, 수정자, 생성일, 수정일, Version, 변경 이력을 저장한다
- [x] 부서 태그는 SW, APP, FW, GW, HW를 제안하고 자유 입력도 받는다. 권한으로 쓰지 않는다
- [x] 저장 성공 시 그 문서의 Version만 증가하고 이력을 남긴다. 다른 문서와 규격 Version은 바뀌지 않는다
- [x] 같은 Version으로 동시에 저장하면 409 `GENERAL_DOC_VERSION_CONFLICT`다. 초안은 유지하고, 확인 후에만 다시 저장한다
- [x] 소프트 삭제 후 목록과 본문 조회에서 빠지고, 이력 스냅샷은 남는다. 복원 화면은 없다
- [x] 프로젝트 개요에서 부서 문자열이 같은 문서끼리 개수가 보인다
- [x] READ는 조회만 한다. 권한 없음은 차단한다. 보관 프로젝트는 조회만 된다

검증: 2026-11-04. 로컬 DB `interface_hub`와 포트 8090 운영 빌드. `go test ./...`, `npm run build` 통과. MariaDB 통합 테스트에서 SW·APP·자유 입력 부서, 제목 중복 허용, 문서별 Version, 409, 삭제 후 목록 제외와 이력 보존, Markdown, 외부 403, 보관 중 `PROJECT_ARCHIVED`, API·MQTT·WebSocket Version 유지를 확인했다. 로컬 Chrome에서 프로젝트 진입, 세 문서 작성, 실시간 미리보기, Version 증가, 변경 이력과 비교, 두 탭 409 초안 유지, Markdown 복사·다운로드 일치, 소프트 삭제, READ 조회 전용, 권한 없음, 보관 후 편집 차단을 확인했다. 서버 재시작 후 일반 문서 Version 4와 삭제 이력, API·MQTT·WebSocket Version 2가 그대로였다. 장비 프로토콜은 열리지 않는다. 검증 계정과 프로젝트는 삭제했다. 기존 프로젝트 id 10, 24와 기존 계정은 변경하지 않았다. 캡처는 `docs/ui-screenshots/ui011-editor.png`, `ui011-project.png`, `ui011-history.png`, `ui011-markdown.png`.

위험: 규격 항목 저장 API를 재사용하면 본문 모델이 어긋난다. 일반 문서는 별도 테이블과 별도 API를 쓴다. 미리보기는 제목, 목록, 코드 블록, 굵게, 인라인 코드, 링크만 렌더링한다.

### TASK-012 장비 프로토콜

상태: `완료`

목적: 바이너리 레이아웃과 HEX를 편집하고 조회한다.

완료 조건: Offset, Length, Endian, Encoding, HEX가 왕복된다. 겹치는 FIXED 구간은 저장되지 않는다. JSON만 있는 폼으로 대체하지 않는다.

구현: 기존 `spec_documents` / `spec_items`의 `DEVICE_PROTOCOL`을 연다. 명령 항목은 `commandId`, 방향 `REQUEST|RESPONSE|EVENT`, 필드 `byteOffset` / `byteLength` / `endian` / `encoding` / `lengthMode`, 수동 `exampleHex`를 저장한다. 문서 Version은 API, MQTT, WebSocket, 일반 문서와 독립이다. FIXED 구간이 겹치거나 Length가 1 미만이면 저장하지 않는다. HEX 길이와 고정 필드 합이 달라도 저장하고 화면에서만 경고한다. Offset과 HEX는 자동 계산하지 않는다.

검증: 로컬 `interface_hub`와 포트 8090 운영 빌드에서 명령 3개, 겹침·잘못된 Length 거절, Endian/Encoding/HEX 재조회, 수정·삭제·정렬, 409 초안 보존, 이력 비교, Markdown 복사·다운로드, READ·외부 사용자·보관 조회, 서버 재시작 후 유지를 확인했다. 검증 프로젝트는 정리했다.

위험: HEX와 바이트 합의 불일치를 오류로 올리면 초안 저장이 막힌다. 현재 설계는 경고다. 같은 바이트를 비트 단위로 나누는 두 BITFIELD는 바이트 구간 규칙에 따라 겹침으로 거절된다.

### TASK-013 에러 코드

상태: `완료`

목적: 프로젝트 공통 에러 코드와 API, MQTT, WebSocket, 장비 프로토콜 항목 연결.

Database: `migrations/000010_create_error_codes.up.sql`. `error_codes`, `error_code_revisions`, `spec_item_error_codes`. 삭제는 `deleted_at`이며 이력 행은 지우지 않는다. 활성 코드 유일성은 `active_code` 생성 컬럼이다.

완료 조건: 코드 설명 변경은 규격 version을 올리지 않는다. 연결 변경은 규격 version을 올린다. 참조 중 삭제는 409다. 삭제 후에도 코드 이력을 조회할 수 있다. 별도 오류명 컬럼은 두지 않는다.

검증: 로컬 `interface_hub`와 포트 8090 운영 빌드에서 생성, 같은 프로젝트 중복 거절, 다른 프로젝트 동일 코드, 검색·분류 필터, 수정, 네 규격 연결, 없는 코드와 다른 프로젝트 코드 거절, 참조 중 삭제 거절, 저장 재조회, Markdown, 설명 수정과 과거 스냅샷 분리, READ·외부 사용자·보관 조회, 서버 재시작 후 유지를 확인했다. 검증 프로젝트는 정리했다.

위험: 현재 Markdown은 최신 오류 코드 설명을 읽고, 규격 Revision 비교는 규격 저장 당시 복사본을 읽는다. 활성 코드 UNIQUE를 일반 UNIQUE `(project_id, code)`로 바꾸면 소프트 삭제와 충돌한다.

---

## 4. P2

세미나 이후에만 연다. 각 Task는 시작 전에 범위를 다시 승인한다.

### TASK-014 계정 일괄 처리

상태: `대기`

목적: 사용자 일괄 등록과 일괄 초기화.

완료 조건: 개별 계정 API의 비밀번호 규칙과 메일 실패 처리가 그대로다.

### TASK-015 파일 첨부

상태: `대기`

목적: 일반 문서 첨부.

완료 조건: 익명 게시판 업로드 경로와 디렉터리를 공유하지 않는다.

### TASK-016 실시간 공동 편집

상태: `대기`

목적: 편집자 표시 또는 공동 편집.

완료 조건: Optimistic Locking과 명시적 재저장을 제거하지 않는다.

### TASK-017 고급 검색

상태: `대기`

목적: 프로젝트와 규격 항목 검색.

완료 조건: 권한 없는 문서 본문이 검색 결과에 나오지 않는다.

### TASK-UI-001 전체 UI/UX

상태: `완료`

목적: 기능 테스트용 화면을 연구소 직원이 쓰는 업무 시스템 화면으로 정리한다. TASK 번호는 바꾸지 않는다.

범위: 공통 Shell, 로그인, 프로젝트 목록·상세, API 규격 편집기와 조회. Backend 계약, Migration, TASK-006, TASK-007은 포함하지 않는다.

완료 조건:

- [x] 로그인 이후 화면이 좌측 사이드바와 상단 헤더를 쓴다
- [x] 프로젝트 상세는 개요를 먼저 보여주고 기본 정보·멤버 관리는 탭으로 연다
- [x] API 편집기는 Endpoint 목록, 편집 영역, JSON 예시를 나눈다
- [x] 로그인, 프로젝트 생성, Endpoint 저장·재조회, 409 초안 유지, READ/WRITE/권한 없음/보관이 유지된다

검증: 2026-11-04 로컬 Chrome, `http://127.0.0.1:8090`. 화면 캡처는 `docs/ui-screenshots`. 테스트 계정과 그 계정이 만든 프로젝트는 검증 후 삭제했다. 사번 10001과 기존 프로젝트는 유지했다.

### TASK-UI-002 핵심 작업 동선

상태: `완료`

목적: 프로젝트에 들어온 직원이 설명 없이 REST API 규격을 시작하고 Endpoint를 작성할 수 있게 한다. TASK-006과 TASK-007은 포함하지 않는다.

범위: 프로젝트 상세의 규격 진입, API 문서·Endpoint 빈 상태, Endpoint 작성 순서와 화면 계층. Backend 계약, DB, Migration, 문서 1개 정책, Endpoint 저장, Version, 409, 권한, AUTO/MANUAL 검증은 유지한다.

완료 조건:

- [x] 프로젝트 상세는 REST API, MQTT, WebSocket, 장비 프로토콜을 구분하고 미구현 프로토콜은 동작하지 않는다
- [x] REST API 버튼은 문서 없음, Endpoint 없음, Endpoint 있음에 따라 문구가 달라지고 같은 공식 문서로 연결된다
- [x] 문서가 없을 때와 Endpoint가 없을 때 다음 행동이 화면에 나온다
- [x] Method와 Path를 먼저 작성하고, Request와 Response를 구분해 저장한 뒤 다시 조회할 수 있다
- [x] READ는 조회만 한다. 보관 프로젝트와 권한 없음은 기존 분기를 유지하며 이번 브라우저 검증에서는 다시 실행하지 않았다

검증: 2026-11-04 로컬 Chrome, `http://127.0.0.1:8090`. 캡처는 `docs/ui-screenshots/ui002-*.png`. 검증용 계정과 프로젝트는 삭제했다. 사번 10001과 기존 프로젝트는 변경하지 않았다.

---

## 5. 현재 위치

TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-UI-001, TASK-UI-002는 완료다. P0는 로컬 MariaDB와 Go가 제공하는 운영 빌드에서 로그인부터 Markdown까지 확인했다. MQTT는 TASK-009, WebSocket은 TASK-010, 일반 문서는 TASK-011, 장비 프로토콜은 TASK-012, 공통 오류 코드는 TASK-013에서 확인했다. 비밀번호 변경과 SMTP는 TASK-018이다. 다음 구현은 개발자 확인 후다.
