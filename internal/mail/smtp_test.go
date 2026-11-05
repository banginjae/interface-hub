package mail

import (
	"context"
	"testing"

	"interface-hub/internal/config"
)

func TestDisabledSMTPDoesNotConnect(t *testing.T) {
	sender := New(config.SMTPConfig{Enabled: false, Host: "127.0.0.1", Port: 1, FromAddress: "hub@example.com"})
	if sender.Enabled() {
		t.Fatal("disabled smtp reported enabled")
	}
	if err := sender.Send(context.Background(), "person@example.com", "제목", "본문"); err != ErrDisabled {
		t.Fatal("disabled smtp attempted a connection")
	}
}
