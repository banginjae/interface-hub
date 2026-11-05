CREATE TABLE projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL COMMENT '목록에 보이는 제목',
  description TEXT NULL COMMENT '상세에서만 제공',
  status VARCHAR(20) NOT NULL COMMENT 'ACTIVE 또는 ARCHIVED',
  created_by BIGINT UNSIGNED NOT NULL COMMENT '생성 후 변경하지 않음',
  updated_by BIGINT UNSIGNED NOT NULL COMMENT '마지막 수정자',
  created_at DATETIME NOT NULL COMMENT '생성 시각 UTC',
  updated_at DATETIME NOT NULL COMMENT '수정 시각 UTC',
  version INT UNSIGNED NOT NULL COMMENT '제목, 설명, 상태 잠금',
  PRIMARY KEY (id),
  KEY idx_projects_status (status),
  KEY idx_projects_created_at (created_at),
  CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_projects_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='프로젝트';
