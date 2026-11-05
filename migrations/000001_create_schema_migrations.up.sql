CREATE TABLE schema_migrations (
  filename VARCHAR(255) NOT NULL COMMENT '적용된 up SQL 파일명',
  checksum CHAR(64) NOT NULL COMMENT '파일 내용 SHA-256 hex',
  applied_at DATETIME NOT NULL COMMENT '적용 완료 시각 UTC',
  PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='적용된 SQL migration';
