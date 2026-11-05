package router

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"interface-hub/internal/dto"
	"interface-hub/internal/handler"

	"github.com/gin-gonic/gin"
)

func TestHealthUnknownAPIAndSPA(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	index := "<!doctype html><html><body>interface-hub-index</body></html>"
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	engine := New(Params{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Health: handler.NewHealthHandler()})
	MountStatic(engine, root)
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)

	health := get(t, server.URL+"/api/health")
	if health.StatusCode != http.StatusOK {
		t.Fatalf("health status %d", health.StatusCode)
	}
	var body dto.HealthResponse
	decode(t, health, &body)
	if body.Status != "ok" {
		t.Fatalf("health body %+v", body)
	}

	unknown := get(t, server.URL+"/api/unknown")
	if unknown.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown status %d", unknown.StatusCode)
	}
	raw, err := io.ReadAll(unknown.Body)
	if err != nil {
		t.Fatal(err)
	}
	var problem dto.ErrorResponse
	if err := json.Unmarshal(raw, &problem); err != nil {
		t.Fatal(err)
	}
	if problem.Code != "NOT_FOUND" || jsonLooksLikeHTML(raw) {
		t.Fatalf("unknown body %s", raw)
	}

	page := get(t, server.URL+"/status")
	if page.StatusCode != http.StatusOK {
		t.Fatalf("spa status %d", page.StatusCode)
	}
	html, _ := io.ReadAll(page.Body)
	if string(html) != index {
		t.Fatalf("spa body %s", html)
	}
}

func TestBuiltDistIsServed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := filepath.Join("..", "..", "web", "dist")
	indexPath := filepath.Join(root, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		t.Skip("web/dist is not built")
	}
	engine := New(Params{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Health: handler.NewHealthHandler()})
	MountStatic(engine, root)
	server := httptest.NewServer(engine)
	t.Cleanup(server.Close)

	page := get(t, server.URL+"/status")
	html, err := io.ReadAll(page.Body)
	if err != nil {
		t.Fatal(err)
	}
	if page.StatusCode != http.StatusOK || !contains(string(html), `id="root"`) {
		t.Fatalf("dist spa status %d body %s", page.StatusCode, html)
	}
	unknown := get(t, server.URL+"/api/unknown")
	raw, err := io.ReadAll(unknown.Body)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.StatusCode != http.StatusNotFound || jsonLooksLikeHTML(raw) {
		t.Fatalf("dist api 404 %d %s", unknown.StatusCode, raw)
	}
}

func contains(text, part string) bool {
	return len(text) >= len(part) && (text == part || len(part) == 0 || indexOf(text, part) >= 0)
}

func indexOf(text, part string) int {
	for i := 0; i+len(part) <= len(text); i++ {
		if text[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}

func get(t *testing.T, url string) *http.Response {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func decode(t *testing.T, res *http.Response, dest any) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(dest); err != nil {
		t.Fatal(err)
	}
}

func jsonLooksLikeHTML(body []byte) bool {
	text := string(body)
	return len(text) > 0 && (text[0] == '<' || containsHTML(text))
}

func containsHTML(text string) bool {
	return len(text) >= 5 && (text[:5] == "<!doc" || text[:5] == "<html")
}
