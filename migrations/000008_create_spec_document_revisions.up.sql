CREATE TABLE spec_document_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL COMMENT '저장 후 version',
  change_reason VARCHAR(500) NOT NULL,
  actor_id BIGINT UNSIGNED NOT NULL,
  summary_json LONGTEXT NOT NULL,
  snapshot_json LONGTEXT NOT NULL COMMENT '저장 후 제목, overview, items',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spec_revisions_version (document_id, version),
  CONSTRAINT fk_spec_revisions_document FOREIGN KEY (document_id) REFERENCES spec_documents (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_spec_revisions_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='규격 문서 저장 이력';
