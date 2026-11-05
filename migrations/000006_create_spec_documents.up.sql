CREATE TABLE spec_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL COMMENT 'API, MQTT, WEBSOCKET, DEVICE_PROTOCOL',
  title VARCHAR(200) NOT NULL,
  overview LONGTEXT NOT NULL COMMENT '문서 상단 JSON',
  version INT UNSIGNED NOT NULL COMMENT '항목 저장마다 증가. 시작값 1',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spec_documents_project_kind (project_id, kind),
  CONSTRAINT fk_spec_documents_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_spec_documents_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_spec_documents_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_spec_documents_kind CHECK (kind IN ('API', 'MQTT', 'WEBSOCKET', 'DEVICE_PROTOCOL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='공식 규격 문서';
