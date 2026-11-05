package schema

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"interface-hub/migrations"

	mysqldriver "github.com/go-sql-driver/mysql"
)

var (
	ErrPending     = errors.New("schema migrations are pending")
	ErrChecksum    = errors.New("applied migration checksum mismatch")
	ErrUnknown     = errors.New("database has an unknown migration")
	ErrDestructive = errors.New("destructive migration statement is rejected")
)

type ExecFunc func(query string, args ...any) error

func Sum(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func Compare(applied map[string]string, files []migrations.File) error {
	known := make(map[string]struct{}, len(files))
	for _, file := range files {
		known[file.Name] = struct{}{}
		got, ok := applied[file.Name]
		if !ok {
			return fmt.Errorf("%w: %s", ErrPending, file.Name)
		}
		if got != Sum(file.Body) {
			return fmt.Errorf("%w: %s", ErrChecksum, file.Name)
		}
	}
	for name := range applied {
		if _, ok := known[name]; !ok {
			return fmt.Errorf("%w: %s", ErrUnknown, name)
		}
	}
	return nil
}

func RejectDestructive(body string) error {
	normalized := normalizeSQL(body)
	blocked := []string{
		"DROP DATABASE",
		"DROP TABLE",
		"DROP COLUMN",
		"DROP INDEX",
		"TRUNCATE",
		"DELETE FROM",
	}
	for _, phrase := range blocked {
		if strings.Contains(normalized, phrase) {
			return fmt.Errorf("%w: %s", ErrDestructive, phrase)
		}
	}
	return nil
}

func Split(body string) []string {
	parts := strings.Split(body, ";")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		stmt := strings.TrimSpace(part)
		if stmt == "" {
			continue
		}
		out = append(out, stmt)
	}
	return out
}

func Apply(exec ExecFunc, applied map[string]string, files []migrations.File) error {
	if applied == nil {
		applied = map[string]string{}
	}
	for _, file := range files {
		sum := Sum(file.Body)
		if prev, ok := applied[file.Name]; ok {
			if prev != sum {
				return fmt.Errorf("%w: %s", ErrChecksum, file.Name)
			}
			continue
		}
		if err := RejectDestructive(string(file.Body)); err != nil {
			return fmt.Errorf("%s: %w", file.Name, err)
		}
		statements := Split(string(file.Body))
		for i, stmt := range statements {
			if err := exec(stmt); err != nil {
				return fmt.Errorf("%s statement %d: %w", file.Name, i+1, err)
			}
		}
		if err := exec(
			"INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP())",
			file.Name,
			sum,
		); err != nil {
			return fmt.Errorf("%s record: %w", file.Name, err)
		}
		applied[file.Name] = sum
	}
	return nil
}

func VerifyDB(ctx context.Context, db *sql.DB) error {
	files, err := migrations.Files()
	if err != nil {
		return err
	}
	applied, err := loadApplied(ctx, db)
	if err != nil {
		if isMissingTable(err) {
			return fmt.Errorf("%w: schema_migrations", ErrPending)
		}
		return err
	}
	return Compare(applied, files)
}

func ApplyDB(ctx context.Context, db *sql.DB) error {
	files, err := migrations.Files()
	if err != nil {
		return err
	}
	applied, err := loadApplied(ctx, db)
	if err != nil {
		if isMissingTable(err) {
			applied = map[string]string{}
		} else {
			return err
		}
	}
	return Apply(func(query string, args ...any) error {
		_, err := db.ExecContext(ctx, query, args...)
		return err
	}, applied, files)
}

func loadApplied(ctx context.Context, db *sql.DB) (map[string]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT filename, checksum FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	applied := map[string]string{}
	for rows.Next() {
		var name, checksum string
		if err := rows.Scan(&name, &checksum); err != nil {
			return nil, err
		}
		applied[name] = checksum
	}
	return applied, rows.Err()
}

func isMissingTable(err error) bool {
	var mysqlErr *mysqldriver.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1146 {
		return true
	}
	return false
}

func normalizeSQL(body string) string {
	withoutLineComments := stripLineComments(body)
	withoutBlock := stripBlockComments(withoutLineComments)
	upper := strings.ToUpper(withoutBlock)
	var b strings.Builder
	space := false
	for _, r := range upper {
		if unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

func stripLineComments(body string) string {
	lines := strings.Split(body, "\n")
	for i, line := range lines {
		if idx := strings.Index(line, "--"); idx >= 0 {
			lines[i] = line[:idx]
		}
	}
	return strings.Join(lines, "\n")
}

func stripBlockComments(body string) string {
	for {
		start := strings.Index(body, "/*")
		if start < 0 {
			return body
		}
		end := strings.Index(body[start+2:], "*/")
		if end < 0 {
			return body[:start]
		}
		body = body[:start] + " " + body[start+2+end+2:]
	}
}
