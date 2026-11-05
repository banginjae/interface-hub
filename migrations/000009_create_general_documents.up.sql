-- 일반 문서와 이력. 에러 코드는 다음 번호로 남긴다.
CREATE TABLE general_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  department VARCHAR(100) NULL COMMENT '자유 입력. SW, APP, FW, GW, HW 등',
  content MEDIUMTEXT NOT NULL COMMENT 'Markdown',
  version INT UNSIGNED NOT NULL COMMENT '저장마다 증가. 시작값 1',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL COMMENT 'NULL이면 목록에 표시',
  PRIMARY KEY (id),
  KEY idx_general_documents_project_deleted (project_id, deleted_at),
  CONSTRAINT fk_general_documents_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_general_documents_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_general_documents_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='일반 산출물 문서';

CREATE TABLE general_document_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL COMMENT '저장 후 version',
  change_reason VARCHAR(500) NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  summary_json LONGTEXT NOT NULL,
  snapshot_json LONGTEXT NOT NULL COMMENT '저장 후 제목, 부서, 본문',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_general_revisions_version (document_id, version),
  CONSTRAINT fk_general_revisions_document FOREIGN KEY (document_id) REFERENCES general_documents (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_general_revisions_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='일반 문서 저장 이력';
