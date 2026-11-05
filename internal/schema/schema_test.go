package schema

import (
	"errors"
	"strings"
	"testing"

	"interface-hub/migrations"
)

func TestComparePendingAndChecksum(t *testing.T) {
	files := []migrations.File{{Name: "000001_create_schema_migrations.up.sql", Body: []byte("CREATE TABLE schema_migrations (id INT)")}}
	if err := Compare(map[string]string{}, files); !errors.Is(err, ErrPending) {
		t.Fatalf("pending: %v", err)
	}
	if err := Compare(map[string]string{files[0].Name: "wrong"}, files); !errors.Is(err, ErrChecksum) {
		t.Fatalf("checksum: %v", err)
	}
	applied := map[string]string{files[0].Name: Sum(files[0].Body), "extra.sql": Sum(files[0].Body)}
	if err := Compare(applied, files); !errors.Is(err, ErrUnknown) {
		t.Fatalf("unknown: %v", err)
	}
	if err := Compare(map[string]string{files[0].Name: Sum(files[0].Body)}, files); err != nil {
		t.Fatal(err)
	}
}

func TestRejectDestructiveIgnoresComment(t *testing.T) {
	if err := RejectDestructive("CREATE TABLE schema_migrations (filename VARCHAR(255));\n-- do not DROP TABLE later"); err != nil {
		t.Fatal(err)
	}
	if err := RejectDestructive("DROP TABLE schema_migrations"); !errors.Is(err, ErrDestructive) {
		t.Fatal(err)
	}
}

func TestApplyStopsBeforeRecordWhenStatementFails(t *testing.T) {
	files := []migrations.File{{
		Name: "000001_create_schema_migrations.up.sql",
		Body: []byte("CREATE TABLE schema_migrations (filename VARCHAR(255)); INSERT INTO other_table VALUES (1)"),
	}}
	var queries []string
	err := Apply(func(query string, args ...any) error {
		queries = append(queries, query)
		if strings.HasPrefix(query, "INSERT INTO other_table") {
			return errors.New("stopped")
		}
		return nil
	}, map[string]string{}, files)
	if err == nil {
		t.Fatal("expected statement error")
	}
	for _, query := range queries {
		if strings.HasPrefix(query, "INSERT INTO schema_migrations") {
			t.Fatalf("recorded migration after failed statement: %v", queries)
		}
	}
}

func TestApplySkipsMatchingFile(t *testing.T) {
	body := []byte("CREATE TABLE schema_migrations (filename VARCHAR(255))")
	file := migrations.File{Name: "000001_create_schema_migrations.up.sql", Body: body}
	called := false
	err := Apply(func(string, ...any) error {
		called = true
		return nil
	}, map[string]string{file.Name: Sum(body)}, []migrations.File{file})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("matching migration was executed again")
	}
}

func TestEmbeddedMigrationIsNotDestructive(t *testing.T) {
	files, err := migrations.Files()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"000001_create_schema_migrations.up.sql",
		"000002_create_users.up.sql",
		"000004_create_projects.up.sql",
		"000005_create_project_members.up.sql",
		"000006_create_spec_documents.up.sql",
		"000007_create_spec_items.up.sql",
		"000008_create_spec_document_revisions.up.sql",
		"000009_create_general_documents.up.sql",
		"000010_create_error_codes.up.sql",
		"000011_add_users_password_must_change.up.sql",
	}
	if len(files) != len(want) {
		t.Fatalf("migration count %d", len(files))
	}
	for i, file := range files {
		if file.Name != want[i] {
			t.Fatalf("migration name %s", file.Name)
		}
		if err := RejectDestructive(string(file.Body)); err != nil {
			t.Fatal(err)
		}
		statements := Split(string(file.Body))
		limit := 1
		// 일반 문서와 이력은 000009 하나에 둔다. 000010은 에러 코드용이다.
		if file.Name == "000009_create_general_documents.up.sql" {
			limit = 2
		}
		if file.Name == "000010_create_error_codes.up.sql" {
			limit = 3
		}
		if len(statements) != limit {
			t.Fatalf("statements in %s: %d", file.Name, len(statements))
		}
	}
}
