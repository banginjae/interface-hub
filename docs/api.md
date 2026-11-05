# Interface Hub - API

## 1. 문서 상태

API 초안이다. 정책은 유지하고, 구현 시점만 P0와 P1로 나눈다.

P0에서 서버에 등록하는 경로는 다음과 같다.

- `GET /api/health`
- 로그인, 본인 비밀번호, MASTER의 개별 사용자 API
- 프로젝트, 멤버
- `kind=API`인 규격 문서, 항목, 이력, 비교, Markdown

P0의 항목 저장에서 `errorCodeIds`는 빈 배열만 받는다. 원소가 있으면 400 `INVALID_REQUEST`다. P1에서 에러 코드 테이블을 만든 뒤 같은 필드로 연결한다.

P1 전에는 아래 경로를 등록하지 않는다. 없는 경로는 JSON 404다. 빈 성공이나 가짜 목록을 반환하지 않는다.

- MQTT, WebSocket, `DEVICE_PROTOCOL` 문서의 생성과 조회
- 일반 문서
- 에러 코드

P2 API는 이 초안에 없다.

정책은 `docs/requirements.md`, 저장 형태는 `docs/database.md`, 잠금 절차는 `docs/architecture.md`, 화면은 `docs/ui-design.md`를 따른다.

payload 내부 필드는 database.md 13장을 반복하지 않는다. 이 문서는 HTTP 겉모양만 정한다.

---

## 2. 공통

Base path는 `/api`다.

인증이 필요한 요청은 `Authorization: Bearer <token>`을 쓴다. `GET /api/health`만 예외다.

성공 시각은 RFC3339 UTC다.

오류:

```json
{
  "code": "INVALID_REQUEST",
  "message": "요청 정보가 올바르지 않습니다."
}
```

version 충돌만 `currentVersion`을 더한다.

```json
{
  "code": "DOCUMENT_VERSION_CONFLICT",
  "message": "다른 사용자가 먼저 저장했습니다.",
  "currentVersion": 6
}
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 형식, 길이, 타입, HEX |
| 400 | `EXAMPLE_SCHEMA_MISMATCH` | 직접 입력 예시가 필드 트리와 불일치 |
| 401 | `UNAUTHORIZED` | 토큰 없음, 만료, 로그인 실패, 재설정 토큰 불가 |
| 403 | `FORBIDDEN` | 로그인됐으나 프로젝트 권한 또는 관리 권한 없음 |
| 404 | `NOT_FOUND` | 프로젝트, 문서, 항목, 일반 문서, 에러 코드, 사용자 없음 |
| 409 | `DOCUMENT_VERSION_CONFLICT` | 문서 version 불일치 |
| 409 | `ITEM_SET_CHANGED` | 순서 저장의 UUID 집합이 현재 항목과 다름 |
| 409 | `PROJECT_VERSION_CONFLICT` | 프로젝트 제목·상태 version 불일치 |
| 409 | `PROJECT_ARCHIVED` | 보관 중 내용 또는 멤버 변경 |
| 409 | `SPEC_KIND_ALREADY_EXISTS` | 같은 종류 문서가 이미 있음 |
| 409 | `CREATOR_PERMISSION_LOCKED` | 생성자 WRITE 제거 또는 강등 |
| 409 | `EMPLOYEE_NO_TAKEN` | 사번 중복 |
| 409 | `ERROR_CODE_TAKEN` | 프로젝트 안 코드 중복 |
| 409 | `ERROR_CODE_IN_USE` | 참조 중인 코드 삭제 |
| 409 | `ERROR_CODE_VERSION_CONFLICT` | 에러 코드 version 불일치 |
| 409 | `GENERAL_DOC_VERSION_CONFLICT` | 일반 문서 version 불일치 |
| 500 | `INTERNAL_ERROR` | 내부 오류 |

보관 중 수정은 권한이 있어도 403이 아니라 409 `PROJECT_ARCHIVED`다. 권한 없음과 구분하기 위해서다.

항목 저장 요청에는 다른 항목의 payload를 넣지 않는다. 서버는 요청에 없는 항목을 갱신하거나 삭제하지 않는다.

1차에 없는 API:

- 공식 규격 문서 DELETE
- 공식 규격 문서 초기화
- 항목 배열 전체를 교체하는 PUT
- 계정 일괄 등록, 일괄 초기화
- 프로젝트 DELETE

---

## 3. 인증과 계정

### POST /api/auth/login

```json
{ "employeeNo": "2026001", "password": "********" }
```

200:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 28800,
  "user": { "id": 1, "employeeNo": "2026001", "name": "홍길동", "role": "MASTER" }
}
```

실패는 401 `UNAUTHORIZED`다. 없는 사번, 잘못된 비밀번호, 비활성 계정은 같은 응답이다.

### GET /api/me

인증 사용자. 200은 현재 계정이다. `password_hash`는 없다.

```json
{
  "id": 1,
  "employeeNo": "2026001",
  "name": "홍길동",
  "email": "hong@example.com",
  "role": "MASTER",
  "active": true,
  "createdAt": "2026-11-03T00:00:00Z",
  "updatedAt": "2026-11-03T00:00:00Z"
}
```

### PUT /api/me/password

구현 시점은 TASK-018이다. 그 전에는 이 경로를 등록하지 않는다.

```json
{ "currentPassword": "********", "newPassword": "********" }
```

204. 현재 비밀번호가 다르면 400 `INVALID_REQUEST`다.

### GET /api/master/users

MASTER만. 200은 사용자 배열이다. `password_hash`는 없다.

### POST /api/master/users

```json
{
  "employeeNo": "2026002",
  "name": "김개발",
  "email": "kim@example.com",
  "password": "********",
  "role": "MEMBER"
}
```

201. 생성된 사용자. 비밀번호는 응답에 넣지 않는다.

### PUT /api/master/users/:id

이름, 이메일, 역할, 활성을 바꾼다. 사번은 바꾸지 않는다. 비밀번호는 이 API로 바꾸지 않는다.

### POST /api/master/users/:id/password-reset

구현 시점은 TASK-018이다. 그 전에는 이 경로를 등록하지 않는다.

본문 없음. MASTER만.

동작은 architecture.md 6.1이다.

200: `{ "status": "SENT" }`

메일 실패: 502 대신 400 `INVALID_REQUEST`와 메시지 "메일을 보내지 못했습니다."를 쓴다. 별도 메일 오류 코드를 사용자에게 세분하지 않는다. SMTP 설정이 없으면 같은 400이다.

### POST /api/auth/password-reset/confirm

구현 시점은 TASK-018이다. 그 전에는 이 경로를 등록하지 않는다.

비인증.

```json
{ "token": "<one-time>", "newPassword": "********" }
```

204. 토큰이 유효하지 않으면 401이다.

---

## 4. 프로젝트

### GET /api/projects

인증 사용자. 설명은 포함하지 않는다.

```json
{
  "projects": [
    {
      "id": 10,
      "title": "포장 라인",
      "status": "ACTIVE",
      "createdBy": { "id": 2, "name": "김개발" },
      "createdAt": "2026-11-03T00:00:00Z",
      "myPermission": "WRITE"
    }
  ]
}
```

`myPermission`은 `NONE`, `READ`, `WRITE`다. MASTER는 멤버 행이 없어도 관리 권한이 있으므로 `WRITE`로 내려 준다. 생성자 여부는 `createdBy.id`와 로그인 사용자를 비교한다.

### POST /api/projects

```json
{ "title": "포장 라인", "description": "" }
```

201. 생성자에게 WRITE를 넣는다. 응답에는 상세 객체를 준다.

### GET /api/projects/:id

READ 또는 MASTER.

```json
{
  "id": 10,
  "title": "포장 라인",
  "description": "",
  "status": "ACTIVE",
  "version": 1,
  "createdBy": { "id": 2, "name": "김개발" },
  "createdAt": "2026-11-03T00:00:00Z",
  "myPermission": "WRITE",
  "specSummaries": [
    { "kind": "API", "exists": true, "version": 12, "updatedAt": "2026-11-03T06:20:00Z", "updatedByName": "홍길동" }
  ],
  "generalDocumentCount": 3,
  "errorCodeCount": 8
}
```

`specSummaries`는 네 종류를 항상 포함한다. `exists: false`이면 행이 없다.

### PUT /api/projects/:id

생성자 또는 MASTER. ACTIVE에서 제목과 설명. 보관과 복구도 이 API다.

```json
{
  "version": 1,
  "title": "포장 라인",
  "description": "",
  "status": "ARCHIVED"
}
```

200은 갱신된 프로젝트다. version이 다르면 409 `PROJECT_VERSION_CONFLICT`다.

ARCHIVED에서 허용되는 status 변경은 `ACTIVE`뿐이다. 제목이나 설명이 함께 바뀌면 409 `PROJECT_ARCHIVED`다. 복구 요청은 status만 ACTIVE로 보낸다.

---

## 5. 멤버

### GET /api/projects/:id/members

READ 또는 MASTER.

```json
{
  "members": [
    {
      "userId": 2,
      "employeeNo": "2026002",
      "name": "김개발",
      "permission": "WRITE",
      "creator": true
    }
  ]
}
```

### POST /api/projects/:id/members

생성자 또는 MASTER. 프로젝트는 ACTIVE.

```json
{ "employeeNo": "2026003", "permission": "READ" }
```

201. 이미 등록된 멤버이면 409 `MEMBER_ALREADY_EXISTS`다.

### PUT /api/projects/:id/members/:userId

```json
{ "permission": "WRITE" }
```

200.

### DELETE /api/projects/:id/members/:userId

204.

대상이 생성자이면 409 `CREATOR_PERMISSION_LOCKED`다. PUT으로 READ를 주는 것도 같은 코드다.

---

## 6. 공식 규격 문서

### POST /api/projects/:id/specs

WRITE 또는 MASTER. ACTIVE.

```json
{ "kind": "API", "title": "API 규격" }
```

201. version 1. items는 빈 배열. overview는 종류별 빈 구조다.

### GET /api/projects/:id/specs/:kind

`:kind`는 `API`, `MQTT`, `WEBSOCKET`, `DEVICE_PROTOCOL`이다.

```json
{
  "id": 3,
  "kind": "API",
  "title": "API 규격",
  "overview": {},
  "version": 5,
  "updatedBy": { "id": 4, "name": "홍길동" },
  "updatedAt": "2026-11-03T06:20:00Z",
  "items": [
    {
      "itemUid": "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10",
      "sortOrder": 1,
      "name": "POST /login",
      "summary": "",
      "status": "ACTIVE",
      "payload": {},
      "errorCodes": [
        {
          "id": 9,
          "code": "AUTH_INVALID",
          "category": "인증",
          "description": "자격 증명이 올바르지 않다",
          "conditionText": "",
          "handling": ""
        }
      ]
    }
  ]
}
```

`errorCodes`는 연결 당시가 아니라 에러 코드 행의 최신 설명이다.

### PATCH /api/projects/:id/specs/:kind

문서 상단만 저장한다. items를 받지 않는다.

```json
{
  "version": 5,
  "changeReason": "Base URL 변경",
  "title": "API 규격",
  "overview": {}
}
```

200:

```json
{ "version": 6 }
```

### PUT /api/projects/:id/specs/:kind/items/order

```json
{
  "version": 6,
  "changeReason": "로그인 API를 위로",
  "itemUids": [
    "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10"
  ]
}
```

배열 집합이 현재 항목과 같아야 한다. 200은 `{ "version": 7 }`이다.

다르면 409 `ITEM_SET_CHANGED`이며 `currentVersion`을 포함한다. 어떤 항목도 삭제하지 않는다.

---

## 7. 규격 항목

### POST /api/projects/:id/specs/:kind/items

```json
{
  "version": 6,
  "changeReason": "로그인 Endpoint 추가",
  "name": "POST /login",
  "summary": "",
  "status": "ACTIVE",
  "payload": {},
  "errorCodeIds": [9]
}
```

201:

```json
{
  "version": 7,
  "itemUid": "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10"
}
```

서버가 UUID와 `sort_order`를 만든다. 순서를 나중에 바꾸려면 order API를 쓴다.

### PUT /api/projects/:id/specs/:kind/items/:itemUid

본문은 POST와 같다. `name`, `summary`, `status`, `payload`, `errorCodeIds`만 그 행에 반영한다.

200: `{ "version": 8 }`

항목이 없으면 404다. 이 경우 다른 항목은 그대로다.

### DELETE /api/projects/:id/specs/:kind/items/:itemUid

```json
{ "version": 8, "changeReason": "미사용 Endpoint 제거" }
```

200: `{ "version": 9 }`

충돌이면 409 본문이 있다. 이 요청은 항목 한 행만 지운다. 문서 행과 다른 항목, 이력은 지우지 않는다.

---

## 8. 이력

### GET /api/projects/:id/specs/:kind/revisions

```json
{
  "revisions": [
    {
      "version": 8,
      "changeReason": "미사용 Endpoint 제거",
      "actor": { "id": 4, "name": "홍길동" },
      "createdAt": "2026-11-03T07:00:00Z",
      "summary": {
        "op": "DELETE_ITEM",
        "itemUid": "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10",
        "name": "POST /login"
      }
    }
  ]
}
```

### GET /api/projects/:id/specs/:kind/revisions/compare?from=5&to=8

```json
{
  "fromVersion": 5,
  "toVersion": 8,
  "overviewChanged": false,
  "added": [{ "itemUid": "...", "name": "POST /devices" }],
  "removed": [{ "itemUid": "...", "name": "POST /login" }],
  "updated": [{ "itemUid": "...", "name": "GET /health" }],
  "before": {},
  "after": {}
}
```

`before`와 `after`는 그 version의 스냅샷이다. 비교 화면의 항목 설명은 스냅샷에 복사된 에러 코드 설명을 쓴다.

from과 to가 없으면 404다.

일반 문서와 에러 코드도 같은 형태의 목록·비교를 둔다.

- `GET /api/projects/:id/general-docs/:docId/revisions`
- `GET /api/projects/:id/general-docs/:docId/revisions/compare?from=1&to=2`
- `GET /api/projects/:id/error-codes/:errorCodeId/revisions`
- `GET /api/projects/:id/error-codes/:errorCodeId/revisions/compare?from=1&to=2`

일반 문서 비교에는 항목 추가·삭제 배열이 없다. `before`와 `after`의 제목, 부서, 본문만 있다.

---

## 9. Markdown

### GET /api/projects/:id/specs/:kind/markdown

READ 또는 MASTER. `text/markdown; charset=utf-8`.

최신 문서와 최신 에러 코드 설명으로 만든다. 쿼리로 옛 version을 고르지 않는다.

`Content-Disposition`은 요청 헤더 `Accept`와 무관하게 attachment를 쓰지 않는다. 복사는 본문을 그대로 쓰고, 다운로드는 클라이언트가 파일로 저장한다.

파일명 규칙은 `{projectTitle}-{kind}-v{version}.md`다. 응답 헤더에 `X-Markdown-Filename`으로 준다. 제목의 경로 문자는 `_`로 바꾼다.

### GET /api/projects/:id/general-docs/:docId/markdown

같은 방식이다. 파일명 중간은 `general`이다.

---

## 10. 일반 문서

### GET /api/projects/:id/general-docs

`deleted_at`이 없는 문서만.

```json
{
  "documents": [
    {
      "id": 4,
      "title": "설치 가이드",
      "department": "FW",
      "version": 3,
      "updatedBy": { "id": 5, "name": "박펌웨어" },
      "updatedAt": "2026-11-03T06:20:00Z"
    }
  ]
}
```

### POST /api/projects/:id/general-docs

```json
{
  "title": "설치 가이드",
  "department": "FW",
  "content": "## 준비\n",
  "changeReason": "최초 작성"
}
```

201. `{ "id": 4, "version": 1 }`

### GET /api/projects/:id/general-docs/:docId

제목, 부서, 본문, version, 작성자, 수정자를 준다.

### PUT /api/projects/:id/general-docs/:docId

```json
{
  "version": 1,
  "title": "설치 가이드",
  "department": "FW",
  "content": "## 준비\n",
  "changeReason": "전원 순서 보완"
}
```

200. `{ "version": 2 }`

본문 전체를 이 문서의 저장 단위로 바꾼다. 다른 일반 문서는 건드리지 않는다.

### DELETE /api/projects/:id/general-docs/:docId

```json
{ "version": 2, "changeReason": "중복 문서 제거" }
```

200: `{ "version": 3 }`

`deleted_at`만 채운다. 행과 이력은 남는다.

---

## 11. 에러 코드

### GET /api/projects/:id/error-codes

코드, 분류, 설명, 조건, 처리, version, 참조 수를 준다.

### POST /api/projects/:id/error-codes

```json
{
  "code": "DEVICE_OFFLINE",
  "category": "장비",
  "description": "장비가 연결되어 있지 않다",
  "conditionText": "연결 상태 offline",
  "handling": "연결 후 재시도",
  "changeReason": "최초 작성"
}
```

201. `{ "id": 9, "version": 1 }`

### PUT /api/projects/:id/error-codes/:errorCodeId

같은 필드와 `version`, `changeReason`.

200. `{ "version": 2 }`

규격 문서 version은 바뀌지 않는다.

### DELETE /api/projects/:id/error-codes/:errorCodeId

P1이다. 참조가 있으면 409 `ERROR_CODE_IN_USE`다.

```json
{ "version": 2, "changeReason": "미사용 코드 정리" }
```

200: `{ "version": 3, "deleted": true }`

행을 지우지 않는다. `deleted_at`과 version을 갱신하고 삭제 이력을 추가한다. 이전 이력 행은 남는다. 규격 문서 version은 바꾸지 않는다. 목록 API는 `deleted_at`이 없는 코드만 반환한다.

---

## 12. 헬스

### GET /api/health

```json
{ "status": "ok" }
```

DB ping은 하지 않는다.
