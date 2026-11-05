package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExampleFileHasNoSecret(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "config", "config.example.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !containsAll(text, "port: 8090", "name: interface_hub", "secret: \"\"", "password: \"\"") {
		t.Fatalf("example config drifted:\n%s", text)
	}
	cfg := Config{
		Server:   ServerConfig{Port: 8090},
		Database: DatabaseConfig{Host: "localhost", Port: 3306, Name: "interface_hub", User: "interface_hub"},
		JWT:      JWTConfig{ExpireHours: 8},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("empty jwt secret must fail validation")
	}
}

func TestRejectAnonymousBoardDatabase(t *testing.T) {
	cfg := validConfig()
	cfg.Database.Name = "anonymous_board"
	if err := cfg.Validate(); err == nil {
		t.Fatal("anonymous_board must be rejected")
	}
}

func TestValidConfig(t *testing.T) {
	if err := validConfig().Validate(); err != nil {
		t.Fatal(err)
	}
}

func validConfig() Config {
	return Config{
		Server:   ServerConfig{Port: 8090},
		Database: DatabaseConfig{Host: "localhost", Port: 3306, Name: "interface_hub", User: "interface_hub", Password: "local-only"},
		JWT:      JWTConfig{Secret: "test-only-jwt-secret", ExpireHours: 8},
	}
}

func containsAll(text string, parts ...string) bool {
	for _, part := range parts {
		if !contains(text, part) {
			return false
		}
	}
	return true
}

func contains(text, part string) bool {
	return len(text) >= len(part) && (text == part || len(part) == 0 || (len(text) > 0 && stringIndex(text, part) >= 0))
}

func stringIndex(text, part string) int {
	for i := 0; i+len(part) <= len(text); i++ {
		if text[i:i+len(part)] == part {
			return i
		}
	}
	return -1
}
