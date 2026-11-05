CREATE TABLE users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_no VARCHAR(32) NOT NULL COMMENT '로그인 사번',
  name VARCHAR(100) NOT NULL COMMENT '성명',
  email VARCHAR(255) NOT NULL COMMENT '메일 주소',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt 해시',
  role VARCHAR(20) NOT NULL COMMENT 'MASTER 또는 MEMBER',
  active BOOLEAN NOT NULL COMMENT '비활성은 로그인 불가',
  created_at DATETIME NOT NULL COMMENT '생성 시각 UTC',
  updated_at DATETIME NOT NULL COMMENT '수정 시각 UTC',
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_employee_no (employee_no),
  CONSTRAINT chk_users_role CHECK (role IN ('MASTER', 'MEMBER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='직원 계정';
