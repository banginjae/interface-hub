package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

const DefaultPath = "config/config.yaml"

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	JWT      JWTConfig      `yaml:"jwt"`
	SMTP     SMTPConfig     `yaml:"smtp"`
}

type ServerConfig struct {
	Port      int    `yaml:"port"`
	PublicURL string `yaml:"public_url"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Name     string `yaml:"name"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
}

type JWTConfig struct {
	Secret      string `yaml:"secret"`
	ExpireHours int    `yaml:"expire_hours"`
}

type SMTPConfig struct {
	Enabled     bool   `yaml:"enabled"`
	Host        string `yaml:"host"`
	Port        int    `yaml:"port"`
	Username    string `yaml:"username"`
	Password    string `yaml:"password"`
	FromAddress string `yaml:"from_address"`
}

func Load(path string) (Config, error) {
	if strings.TrimSpace(path) == "" {
		path = DefaultPath
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("config file unreadable")
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("config yaml invalid")
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if err := requirePort("server.port", c.Server.Port); err != nil {
		return err
	}
	if err := requirePort("database.port", c.Database.Port); err != nil {
		return err
	}
	if strings.TrimSpace(c.Database.Host) == "" {
		return fmt.Errorf("database.host is required")
	}
	if strings.TrimSpace(c.Database.User) == "" {
		return fmt.Errorf("database.user is required")
	}
	if err := validateDatabaseName(c.Database.Name); err != nil {
		return err
	}
	if strings.TrimSpace(c.JWT.Secret) == "" {
		return fmt.Errorf("jwt.secret is required")
	}
	if c.JWT.ExpireHours <= 0 {
		return fmt.Errorf("jwt.expire_hours must be positive")
	}
	if c.SMTP.Enabled {
		if strings.TrimSpace(c.SMTP.Host) == "" || strings.TrimSpace(c.SMTP.FromAddress) == "" {
			return fmt.Errorf("smtp host and from_address are required when enabled")
		}
		if err := requirePort("smtp.port", c.SMTP.Port); err != nil {
			return err
		}
	}
	return nil
}

func requirePort(name string, port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("%s must be between 1 and 65535", name)
	}
	return nil
}

func validateDatabaseName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("database.name is required")
	}
	switch strings.ToLower(name) {
	case "anonymous_board", "anonymous_board_test":
		return fmt.Errorf("database.name is reserved by another service")
	}
	for _, r := range name {
		if r > 127 || !isNameChar(r) {
			return fmt.Errorf("database.name has invalid characters")
		}
	}
	return nil
}

func isNameChar(r rune) bool {
	return r == '_' || (r >= '0' && r <= '9') || (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
}

func (c DatabaseConfig) Addr() string {
	return c.Host + ":" + strconv.Itoa(c.Port)
}
