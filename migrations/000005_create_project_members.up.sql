CREATE TABLE project_members (
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  permission VARCHAR(10) NOT NULL COMMENT 'READ 또는 WRITE',
  granted_by BIGINT UNSIGNED NOT NULL COMMENT '권한을 부여한 사용자',
  created_at DATETIME NOT NULL COMMENT '부여 시각 UTC',
  updated_at DATETIME NOT NULL COMMENT '변경 시각 UTC',
  PRIMARY KEY (project_id, user_id),
  KEY idx_project_members_user_id (user_id),
  CONSTRAINT fk_project_members_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_project_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_project_members_granted_by FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_project_members_permission CHECK (permission IN ('READ', 'WRITE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='프로젝트 권한';
