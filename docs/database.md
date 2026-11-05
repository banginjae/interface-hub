# Interface Hub - Database Design

## 1. 문서 상태

2차 설계다. SQL 파일은 아직 만들지 않고 실행하지도 않는다.

MariaDB 10.2.1 이상을 기준으로 한다. 구조화 본문은 `LONGTEXT`의 JSON 문자열이다. JSON 컬럼 타입에 의존하지 않는다.

문자 집합은 `utf8mb4`, collation은 `utf8mb4_unicode_ci`다. 시각은 UTC `DATETIME`이다.

database 이름은 `interface_hub`다. `anonymous_board`와 테이블을 공유하지 않는다.

payload의 필드 하나하나는 편집기 컨트롤과 대응한다. 화면에서 입력한 값은 이 문서의 JSON에 모두 들어가고, 다시 읽으면 같은 값으로 돌아온다.

---

## 2. 설계 원칙

- 비밀번호 원문과 재설정 토큰 원문을 저장하지 않는다.
- 공식 규격 종류는 UNIQUE로 1개를 강제한다.
- 공식 규격 문서 행은 애플리케이션이 삭제하지 않는다. 이력 이전용 테이블은 두지 않는다.
- 항목 본문은 JSON 문자열이다. 중첩 필드를 테이블로 분해하지 않는다.
- 낙관적 잠금 컬럼은 정수 `version`이다. 최초 값은 1이다.
- 이력은 성공한 저장마다 1행이며, 서버가 DB를 읽어 만든 전체 스냅샷이다.
- 일반 저장 경로는 대상 항목만 `UPDATE` 또는 `DELETE`한다.
- GORM AutoMigrate를 쓰지 않는다.
- DDL을 하나의 트랜잭션으로 롤백할 수 있다고 가정하지 않는다.

---

## 3. 테이블 목록

| 테이블 | 목적 |
|---|---|
| schema_migrations | 적용된 SQL 파일명과 체크섬 |
| users | 직원 계정 |
| password_reset_tokens | 일회용 비밀번호 설정 토큰 해시 |
| projects | 프로젝트 |
| project_members | 프로젝트 READ/WRITE |
| spec_documents | 공식 규격 문서. 종류당 1개. 삭제하지 않음 |
| spec_items | 규격 항목 |
| spec_document_revisions | 규격 문서의 성공 저장 이력 |
| general_documents | 일반 산출물 문서 |
| general_document_revisions | 일반 문서 이력 |
| error_codes | 프로젝트 에러 코드 |
| error_code_revisions | 에러 코드 이력 |
| spec_item_error_codes | 규격 항목과 에러 코드의 N:M |

`archived_spec_revisions`는 만들지 않는다.

---

## 4. 관계

```text
users 1 ── N projects.created_by
users N ── M projects   through project_members

projects 1 ── N spec_documents
spec_documents 1 ── N spec_items
spec_documents 1 ── N spec_document_revisions

projects 1 ── N general_documents
general_documents 1 ── N general_document_revisions

projects 1 ── N error_codes
error_codes N ── M spec_items   through spec_item_error_codes
```

애플리케이션은 `projects`와 `spec_documents`를 물리 삭제하지 않는다. FK는 `ON DELETE RESTRICT`로 두어, 수동 SQL이 이력과 항목을 연쇄로 지우지 않게 한다.

예외는 항목 편집이다. `spec_items` 한 행을 지우면 그 항목의 `spec_item_error_codes`만 `ON DELETE CASCADE`로 지운다. 문서와 이력 행은 남는다.

---

## 5. schema_migrations

| 컬럼 | 타입 | 설명 |
|---|---|---|
| filename | VARCHAR(255) PK | `000001_create_users.up.sql` |
| checksum | CHAR(64) NOT NULL | 파일 바이트의 SHA-256 hex |
| applied_at | DATETIME NOT NULL | 적용 완료 시각 UTC |

실행 주체는 `cmd/migrate`다. 절차와 실패 복구는 `docs/architecture.md` 7장과 같다. 이 테이블에 행이 생겼다는 것은 그 파일의 statement가 모두 끝났다는 뜻이다. 중간에 실패한 파일은 행이 없다.

DDL 암묵적 COMMIT 때문에, 이 행 INSERT를 파일의 DDL과 하나의 롤백 단위로 묶지 않는다. DDL이 모두 끝난 뒤 이 행만 따로 INSERT한다. INSERT 전에 프로세스가 죽으면 객체는 있고 행은 없다. 그때는 자동으로 다시 실행하지 않고 architecture.md의 복구 절차를 따른다.

체크섬이 다른 같은 파일명이 있으면 실행을 거부한다.

---

## 6. users

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| employee_no | VARCHAR(32) | NO | UNIQUE | 로그인 사번 |
| name | VARCHAR(100) | NO | | 성명 |
| email | VARCHAR(255) | NO | | 초기화 메일 주소 |
| password_hash | VARCHAR(255) | NO | | bcrypt. API에 노출하지 않음 |
| role | VARCHAR(20) | NO | | `MASTER`, `MEMBER` |
| active | BOOLEAN | NO | | 비활성은 로그인 불가 |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |

CHECK `role IN ('MASTER','MEMBER')`.

이메일은 필수다. 비밀번호 최소 길이는 8자이며 애플리케이션이 검사한다.

계정 물리 삭제는 하지 않는다. 비활성만 한다. 다른 테이블의 사용자 FK도 `ON DELETE RESTRICT`다.

---

## 7. password_reset_tokens

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| user_id | BIGINT UNSIGNED | NO | FK | users.id |
| token_hash | CHAR(64) | NO | UNIQUE | 원문 토큰의 SHA-256 hex |
| expires_at | DATETIME | NO | | 생성 시각부터 30분 |
| sent_at | DATETIME | YES | | 메일 발송 성공 시각 |
| used_at | DATETIME | YES | | 비밀번호 변경 완료 |
| revoked_at | DATETIME | YES | | 취소 |
| created_at | DATETIME | NO | | |

토큰을 쓸 수 있는 조건은 `used_at`, `revoked_at`이 NULL이고 `expires_at`이 지나지 않은 것이다. `sent_at`이 NULL이어도 해시가 맞으면 사용할 수 있다. 메일이 실제로 도착한 뒤 `sent_at` 갱신만 실패한 경우를 막지 않기 위해서다.

새 발급의 첫 트랜잭션은 기존에 쓸 수 있는 행의 `revoked_at`을 채우고 새 행을 INSERT한 뒤 커밋한다. 메일 전송은 이 트랜잭션에 포함하지 않는다. 발송 실패 후의 `revoked_at` 기록은 다음 트랜잭션이다.

인덱스: `(user_id, revoked_at, used_at)`.

---

## 8. projects

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| title | VARCHAR(200) | NO | | 목록에 보이는 제목 |
| description | TEXT | YES | | READ 또는 MASTER의 상세에서만 |
| status | VARCHAR(20) | NO | | `ACTIVE`, `ARCHIVED` |
| created_by | BIGINT UNSIGNED | NO | FK | 생성 후 변경하지 않음 |
| updated_by | BIGINT UNSIGNED | NO | FK | |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |
| version | INT UNSIGNED | NO | | 제목, 설명, 상태 변경용. 시작값 1 |

CHECK `status IN ('ACTIVE','ARCHIVED')`.

인덱스: `status`, `created_at`.

프로젝트 메타데이터에는 별도 이력 테이블을 두지 않는다. 문서 이력과 잠금을 섞지 않는다.

1차 API는 이 행을 DELETE하지 않는다.

---

## 9. project_members

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| project_id | BIGINT UNSIGNED | NO | PK, FK | |
| user_id | BIGINT UNSIGNED | NO | PK, FK | |
| permission | VARCHAR(10) | NO | | `READ` 또는 `WRITE` |
| granted_by | BIGINT UNSIGNED | NO | FK | users.id |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |

CHECK `permission IN ('READ','WRITE')`.

한 사용자·한 프로젝트에 행은 하나다. WRITE는 READ를 포함하므로 행을 두 개 만들지 않는다.

보조 인덱스: `user_id`.

생성 트랜잭션:

```text
INSERT projects
INSERT project_members (created_by, WRITE, granted_by = created_by)
```

애플리케이션 규칙:

- `user_id = projects.created_by`인 행은 DELETE하지 않는다.
- 그 행의 permission을 READ로 바꾸지 않는다.
- 이 규칙은 MASTER 요청에도 적용한다.

DB CHECK로는 생성자 보호를 표현하기 어렵다. Service가 거절한다.

---

## 10. spec_documents

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | 생성된 뒤 유지 |
| project_id | BIGINT UNSIGNED | NO | FK | RESTRICT |
| kind | VARCHAR(32) | NO | | `API`, `MQTT`, `WEBSOCKET`, `DEVICE_PROTOCOL` |
| title | VARCHAR(200) | NO | | |
| overview | LONGTEXT | NO | | JSON. 문서 상단 |
| version | INT UNSIGNED | NO | | 항목 저장마다 증가. 시작값 1 |
| created_by | BIGINT UNSIGNED | NO | FK | |
| updated_by | BIGINT UNSIGNED | NO | FK | |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |

UNIQUE `(project_id, kind)`.

CHECK `kind IN ('API','MQTT','WEBSOCKET','DEVICE_PROTOCOL')`.

행이 없으면 아직 생성하지 않은 상태다. 1차에는 이 행을 지우는 API가 없다. 항목을 비워 초기화하는 API도 없다.

생성 직후 `overview`는 종류별 빈 객체이고 version 1 이력을 남긴다. 사유는 `최초 작성`을 허용한다.

`overview`의 키는 13.2에 있다. 편집기가 다루지 않는 키는 저장하지 않는다. 다시 열 때 키를 빠뜨리지 않는다.

---

## 11. spec_items

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| document_id | BIGINT UNSIGNED | NO | FK | RESTRICT |
| item_uid | CHAR(36) | NO | | 서버 생성 UUID |
| sort_order | INT | NO | | 조회 순서 |
| name | VARCHAR(300) | NO | | 목록 이름 |
| summary | VARCHAR(500) | YES | | |
| status | VARCHAR(20) | NO | | `ACTIVE`, `DEPRECATED` |
| payload | LONGTEXT | NO | | 종류별 JSON |
| created_by | BIGINT UNSIGNED | NO | FK | |
| updated_by | BIGINT UNSIGNED | NO | FK | |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |

UNIQUE `(document_id, item_uid)`.

CHECK `status IN ('ACTIVE','DEPRECATED')`.

항목 행에는 version을 두지 않는다. 잠금은 부모 `spec_documents.version`이다.

항목 수정 UPDATE의 WHERE는 `document_id`와 `item_uid`다. 같은 문서의 다른 `item_uid`는 SET 대상이 아니다.

인덱스: `(document_id, sort_order)`.

---

## 12. spec_document_revisions

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| document_id | BIGINT UNSIGNED | NO | FK | RESTRICT |
| version | INT UNSIGNED | NO | | 저장 후 version |
| change_reason | VARCHAR(500) | NO | | 공백만 있으면 거절 |
| actor_id | BIGINT UNSIGNED | NO | FK | 실제 로그인 계정 |
| summary_json | LONGTEXT | NO | | 아래 형태 |
| snapshot_json | LONGTEXT | NO | | 저장 후 제목, overview, items, 에러 코드 연결 |
| created_at | DATETIME | NO | | |

UNIQUE `(document_id, version)`.

`summary_json`:

```json
{
  "op": "UPDATE_ITEM",
  "itemUid": "0f4c0b2e-7c2a-4e1b-9d5a-6b8e1c2a9f10",
  "name": "POST /login"
}
```

`op`는 `CREATE_DOCUMENT`, `CREATE_ITEM`, `UPDATE_ITEM`, `DELETE_ITEM`, `REORDER_ITEMS`, `UPDATE_OVERVIEW`만 쓴다.

스냅샷의 각 항목에는 `item_uid`, `name`, `summary`, `status`, `sort_order`, `payload`, `errorCodeIds`를 넣는다. 비교 API가 추가·삭제·수정을 UUID로 나누려면 payload만으로는 부족하다.

문서 행을 지우지 않으므로 이 이력은 그 문서에 계속 남는다.

---

## 13. JSON 형태

### 13.1 필드 노드

편집기의 한 행이다.

```json
{
  "name": "speed",
  "type": "integer",
  "required": true,
  "nullable": false,
  "description": "속도",
  "example": "10",
  "format": "",
  "enum": [],
  "children": [],
  "arrayItem": null,
  "byteOffset": null,
  "byteLength": null,
  "endian": null,
  "encoding": null,
  "lengthMode": null,
  "bitOffset": null,
  "bitLength": null
}
```

`type`: `string`, `number`, `integer`, `boolean`, `object`, `array`, `enum`, `bytes`.

`example`은 항상 문자열이다. `0x10`이나 앞자리 0을 그대로 다시 보여 주기 위해서다. 타입에 맞게 해석되지 않으면 저장을 거절한다.

`object`는 `children`만 채운다. `array`는 `arrayItem` 하나만 채운다. 둘을 같이 채우면 거절한다.

`byteOffset`, `byteLength`, `endian`, `encoding`, `lengthMode`, `bitOffset`, `bitLength`는 `DEVICE_PROTOCOL`에서만 값을 가진다. 다른 종류에서는 모두 null이어야 한다.

`endian`: `BIG`, `LITTLE`, null. null이면 문서 기본 엔디언을 따른다.

`encoding`: `UINT8`, `UINT16`, `UINT32`, `INT8`, `INT16`, `INT32`, `BYTES`, `ASCII`, `UTF8`, `BCD`, `BITFIELD`.

`lengthMode`: `FIXED`, `VARIABLE`.

`encoding`이 `BITFIELD`이면 `bitOffset`과 `bitLength`가 필요하다. 그 외에는 둘 다 null이다.

바이트 값을 가진 FIXED 필드끼리 Offset 구간이 겹치면 저장을 거절한다. 레이아웃을 비운 필드는 이 검사에서 뺀다. 초안 저장을 막지 않기 위해서다.

### 13.2 overview

API:

```json
{
  "baseUrl": "",
  "auth": { "type": "NONE", "description": "" },
  "commonHeaders": []
}
```

MQTT:

```json
{
  "brokerUrl": "",
  "protocolVersion": "",
  "auth": { "type": "NONE", "description": "" }
}
```

WebSocket:

```json
{
  "url": "",
  "auth": { "type": "NONE", "description": "" },
  "heartbeat": "",
  "closeCodes": []
}
```

`closeCodes`의 원소는 `{ "code": 4001, "description": "" }`다.

장비 프로토콜:

```json
{
  "transport": "TCP",
  "defaultEndian": "BIG",
  "framing": ""
}
```

`transport`: `TCP`, `UDP`, `UART`, `RS485`, `OTHER`.

`auth.type`: `NONE`, `BEARER`, `BASIC`, `API_KEY`, `CUSTOM`.

### 13.3 API 항목 payload

```json
{
  "method": "POST",
  "path": "/devices/{deviceId}/commands",
  "description": "",
  "auth": { "type": "BEARER", "description": "", "useDocumentAuth": false },
  "headers": [],
  "pathParams": [],
  "queryParams": [],
  "requestBody": {
    "contentType": "application/json",
    "fields": [],
    "exampleMode": "AUTO",
    "example": null
  },
  "responses": [
    {
      "name": "성공",
      "status": 200,
      "description": "",
      "fields": [],
      "exampleMode": "AUTO",
      "example": null
    }
  ]
}
```

`method`: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.

`exampleMode`: `AUTO`, `MANUAL`.

`AUTO`이면 서버가 `fields`의 `example`로 `example`을 만들어 저장한다. 클라이언트가 보낸 example은 무시한다.

`MANUAL`이면 `example`은 JSON 값이어야 한다. 문자열이 아니어야 하고, 파싱에 실패하면 400이다. 다음이면 400 `EXAMPLE_SCHEMA_MISMATCH`다.

- 필수 필드가 없다.
- 타입이 다르다.
- 트리에 없는 키가 있다.
- nullable이 아닌데 null이다.

선택 필드가 예시에서 빠진 것은 허용한다. 배열 원소는 `arrayItem` 타입과 맞으면 여러 개여도 된다.

에러 코드는 payload에 넣지 않는다. `spec_item_error_codes`에 둔다.

### 13.4 MQTT 항목 payload

```json
{
  "topic": "lab/{lineId}/status",
  "qos": 1,
  "retain": false,
  "direction": "DEVICE_TO_SERVER",
  "publishers": ["device"],
  "subscribers": ["server"],
  "purpose": "",
  "payloadFields": [],
  "exampleMode": "AUTO",
  "example": null,
  "relatedItemUid": null
}
```

`qos`는 0, 1, 2다.

`direction`: `DEVICE_TO_SERVER`, `SERVER_TO_DEVICE`, `BIDIRECTIONAL`.

`relatedItemUid`는 같은 문서의 항목 UUID이거나 null이다. 저장 시 그 UUID가 같은 문서에 있어야 한다. 자기 자신은 거절한다.

예시 검증은 API request body와 같다. 대상 필드는 `payloadFields`다.

### 13.5 WebSocket 항목 payload

```json
{
  "eventName": "command.execute",
  "direction": "CLIENT_TO_SERVER",
  "messageKind": "REQUEST",
  "description": "",
  "fields": [],
  "exampleMode": "AUTO",
  "example": null,
  "relatedItemUid": null
}
```

`direction`: `CLIENT_TO_SERVER`, `SERVER_TO_CLIENT`, `BIDIRECTIONAL`.

`messageKind`: `REQUEST`, `RESPONSE`, `EVENT`.

연결 URL과 인증은 항목이 아니라 overview다.

### 13.6 장비 프로토콜 항목 payload

```json
{
  "commandId": "0x10",
  "direction": "REQUEST",
  "description": "",
  "fields": [],
  "exampleHex": "10 00 01",
  "exampleMode": "AUTO",
  "exampleJson": null,
  "relatedItemUid": null
}
```

`direction`: `REQUEST`, `RESPONSE`, `EVENT`.

`exampleHex`는 빈 문자열을 허용한다. 값이 있으면 16진 문자와 공백만 허용하고, 공백을 뺀 길이는 짝수여야 한다. 저장 시 대문자와 공백 정리 형태로 정규화해 다시 읽어도 의미가 같게 한다. 사용자가 입력한 바이트 순서는 바꾸지 않는다.

`exampleJson`은 디코딩 해석이다. 와이어 형식 자체는 `exampleHex`와 필드 레이아웃이다. `exampleMode`가 `AUTO`이면 필드 `example`로 `exampleJson`을 만든다. `MANUAL`이면 13.3의 불일치 규칙으로 거절한다.

`commandId`는 문자열이다. `0x10`과 `16`을 애플리케이션이 같은 값으로 합치지 않는다. 화면과 이력이 입력 그대로여야 하기 때문이다.

---

## 14. general_documents

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| project_id | BIGINT UNSIGNED | NO | FK | |
| title | VARCHAR(200) | NO | | |
| department | VARCHAR(100) | YES | | 자유 입력. SW, APP, FW, GW, HW 등 |
| content | MEDIUMTEXT | NO | | Markdown |
| version | INT UNSIGNED | NO | | |
| created_by | BIGINT UNSIGNED | NO | FK | |
| updated_by | BIGINT UNSIGNED | NO | FK | |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |
| deleted_at | DATETIME | YES | | NULL이면 목록에 표시 |

개수 UNIQUE는 없다. 같은 제목도 허용한다.

본문 상한은 200,000자다.

목록 인덱스: `(project_id, deleted_at)`.

삭제는 `deleted_at`만 채운다. 행과 `general_document_revisions`는 남는다. 1차 목록 API는 `deleted_at IS NULL`만 반환한다. 삭제도 version을 올리고 이력에 마지막 본문 스냅샷을 남긴다.

이력 컬럼은 규격 이력과 같다. 스냅샷은 제목, 부서, 본문이다. 항목 UUID 개념은 없다. 잠금 단위는 이 행 전체다.

---

## 15. error_codes

| 컬럼 | 타입 | Null | 키 | 설명 |
|---|---|---:|---|---|
| id | BIGINT UNSIGNED | NO | PK | |
| project_id | BIGINT UNSIGNED | NO | FK | |
| code | VARCHAR(64) | NO | | 예: `AUTH_INVALID` |
| category | VARCHAR(100) | NO | | |
| description | TEXT | NO | | |
| condition_text | TEXT | YES | | 발생 조건 |
| handling | TEXT | YES | | 처리 방법 |
| version | INT UNSIGNED | NO | | 행 단위 잠금 |
| created_by | BIGINT UNSIGNED | NO | FK | |
| updated_by | BIGINT UNSIGNED | NO | FK | |
| created_at | DATETIME | NO | | |
| updated_at | DATETIME | NO | | |
| deleted_at | DATETIME | YES | | NULL이면 목록에 표시. 삭제는 이 값만 채운다 |

활성 코드만 중복을 막는다. MariaDB UNIQUE는 NULL을 서로 다른 값으로 보므로, 삭제된 행의 코드까지 UNIQUE에 넣으면 같은 코드를 다시 만들 수 없고, NULL을 그대로 UNIQUE에 넣으면 활성 행이 여러 개 생길 수 있다.

그래서 생성 컬럼을 둔다.

```text
active_code VARCHAR(64)
  AS (CASE WHEN deleted_at IS NULL THEN code ELSE NULL END) PERSISTENT
UNIQUE (project_id, active_code)
```

삭제되면 `active_code`가 NULL이 되어 이력 행의 `code` 문자열은 그대로다. 활성 행의 코드는 프로젝트 안에서 하나다.

이 테이블은 P1 Migration이다. P0 테이블을 나중에 고치지 않기 위해 P0의 `spec_documents.kind`에는 네 종류를 미리 허용해 둔다. P0 구현은 `API`만 연다.

코드 문자열을 바꾸는 것도 이 행의 version을 올린다. 규격 문서 version은 올리지 않는다. 조회는 항상 이 행의 최신 설명을 붙인다. 규격 스냅샷에는 `errorCodeIds`를 넣고, 과거 비교 화면에서 당시 설명을 고정해야 하면 스냅샷에 당시 `code`와 `description`을 함께 넣는다. Markdown과 현재 조회는 최신 설명을 쓴다. 과거 비교는 스냅샷에 복사된 설명을 쓴다. 이렇게 해야 코드 설명만 바꾼 변경이 규격 version을 올리지 않아도, 옛 규격 화면이 지금 설명으로 바뀌어 보이는 문제를 비교 화면에서 피할 수 있다.

현재 조회가 최신 설명을 보여주는 규칙과, 비교 화면이 당시 설명을 보여주는 규칙은 둘 다 유지한다.

### spec_item_error_codes

| 컬럼 | 타입 | 키 |
|---|---|---|
| spec_item_id | BIGINT UNSIGNED | PK, FK. 항목 삭제 시 CASCADE |
| error_code_id | BIGINT UNSIGNED | PK, FK. RESTRICT |

항목 저장은 이 항목의 연결만 지우고 다시 넣는다. 다른 항목의 연결 행은 삭제하지 않는다. 이 변경은 부모 문서 version을 올린다.

참조가 있으면 `error_codes` 삭제를 거절한다. 참조가 없으면 물리 삭제하지 않는다. 같은 DML 트랜잭션에서 삭제 이력 한 행을 추가하고 `deleted_at`과 version만 갱신한다. `error_code_revisions`는 지우지 않는다. 규격 문서 version은 바꾸지 않는다. 과거 스냅샷에 복사된 코드와 설명은 그대로 비교에 쓴다.

---

## 16. 트랜잭션

DML 저장만 트랜잭션으로 묶는다. Migration DDL과 SMTP는 넣지 않는다.

| 작업 | 내용 |
|---|---|
| 프로젝트 생성 | projects + 생성자 WRITE |
| 보관 / 복구 | projects.version 검사 후 status만 변경 |
| 규격 문서 생성 | spec_documents + revision `CREATE_DOCUMENT` |
| 항목 생성·수정·삭제 | 부모 `FOR UPDATE`, 대상 항목과 그 연결만 변경, version 증가, revision |
| 순서 변경 | UUID 집합이 같을 때만 sort_order 변경 |
| overview 수정 | 항목 행은 유지 |
| 일반 문서 저장·소프트 삭제 | 그 행과 그 이력만 |
| 에러 코드 저장·소프트 삭제 | 그 행의 version과 이력만. 이력 행은 삭제하지 않음. 규격 문서는 갱신하지 않음 |
| 토큰 발급 | 기존 토큰 취소 + INSERT 후 커밋. 메일은 커밋 이후 |
| 토큰 취소 | 발송 실패 후 `revoked_at`만 |
| 비밀번호 변경 | 토큰 검증 + password_hash + used_at |

항목 저장 트랜잭션이 롤백되면 version, 항목, 연결, 이력이 모두 이전 상태다. 이미 커밋된 다른 항목 저장은 롤백되지 않는다.

---

## 17. 동시성

```sql
UPDATE spec_documents
SET version = version + 1,
    updated_by = ?,
    updated_at = UTC_TIMESTAMP()
WHERE id = ? AND version = ?;
```

이 문만으로 항목 교체를 끝내지 않는다. 같은 트랜잭션에서 먼저 `SELECT ... FOR UPDATE`를 하고, 대상 항목만 바꾼 다음 이 UPDATE를 실행한다. affected row가 0이면 409 `DOCUMENT_VERSION_CONFLICT`다.

규격 종류 중복은 409 `SPEC_KIND_ALREADY_EXISTS`다.

---

## 18. Migration 파일 순서

P0와 P1을 파일 번호로 나눈다. Task 01은 `000001` 파일만 저장소에 둔다. 그 파일도 개발자 승인 전에는 어떤 데이터베이스에도 실행하지 않는다. 002부터는 해당 Task에서 추가한다.

P0:

```text
000001_create_schema_migrations.up.sql
000002_create_users.up.sql
000003_create_password_reset_tokens.up.sql
000004_create_projects.up.sql
000005_create_project_members.up.sql
000006_create_spec_documents.up.sql
000007_create_spec_items.up.sql
000008_create_spec_document_revisions.up.sql
```

P1:

```text
000009_create_general_documents.up.sql
000010_create_error_codes.up.sql
```

`000010`에는 `error_code_revisions`, `spec_item_error_codes`, `deleted_at`, `active_code`를 포함한다. 필요하면 011로 나눈다. P0에서 이미 만든 규격 테이블의 kind 제약은 바꾸지 않는다.

각 파일은 테이블 하나씩을 기본으로 한다. 실패했을 때 어디까지 만들어졌는지 사람이 보기 위해서다.

down 파일을 만들어 두어도 migrate가 자동으로 실행하지 않는다. 운영 DB를 DROP하거나 비우는 파일은 실행 거부 목록에 걸린다.

컬럼 COMMENT는 생성 파일에 함께 적는다.
