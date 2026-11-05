ALTER TABLE users
  ADD COLUMN password_must_change BOOLEAN NOT NULL DEFAULT 0 COMMENT '다음 로그인에서 비밀번호 변경 안내';
