-- 프로젝트 공통 에러 코드, 이력, 규격 항목 연결.
CREATE TABLE error_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL COMMENT '예: AUTH_INVALID',
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  condition_text TEXT NULL COMMENT '발생 조건',
  handling TEXT NULL COMMENT '처리 방법',
  version INT UNSIGNED NOT NULL COMMENT '행 단위 잠금. 시작값 1',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL COMMENT 'NULL이면 목록에 표시',
  active_code VARCHAR(64) AS (CASE WHEN deleted_at IS NULL THEN code ELSE NULL END) PERSISTENT,
  PRIMARY KEY (id),
  UNIQUE KEY uq_error_codes_active (project_id, active_code),
  KEY idx_error_codes_project_deleted (project_id, deleted_at),
  CONSTRAINT fk_error_codes_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_error_codes_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_error_codes_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='프로젝트 공통 에러 코드';

CREATE TABLE error_code_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  error_code_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL COMMENT '저장 후 version',
  change_reason VARCHAR(500) NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  summary_json LONGTEXT NOT NULL,
  snapshot_json LONGTEXT NOT NULL COMMENT '저장 후 코드, 분류, 설명, 조건, 처리',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_error_code_revisions_version (error_code_id, version),
  CONSTRAINT fk_error_code_revisions_code FOREIGN KEY (error_code_id) REFERENCES error_codes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_error_code_revisions_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='에러 코드 저장 이력';

CREATE TABLE spec_item_error_codes (
  spec_item_id BIGINT UNSIGNED NOT NULL,
  error_code_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (spec_item_id, error_code_id),
  KEY idx_spec_item_error_codes_code (error_code_id),
  CONSTRAINT fk_spec_item_error_item FOREIGN KEY (spec_item_id) REFERENCES spec_items (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_spec_item_error_code FOREIGN KEY (error_code_id) REFERENCES error_codes (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='규격 항목과 에러 코드 연결';
