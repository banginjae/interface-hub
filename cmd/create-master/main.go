package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"interface-hub/internal/config"
	"interface-hub/internal/model"
	"interface-hub/internal/repository"
	"interface-hub/internal/schema"
	"interface-hub/internal/service"

	"golang.org/x/term"
)

func main() {
	configPath := flag.String("config", config.DefaultPath, "config file path")
	employeeNo := flag.String("employee-no", "", "employee number")
	name := flag.String("name", "", "display name")
	email := flag.String("email", "", "email")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "설정 파일을 확인하세요. 예시는 config/config.example.yaml 입니다.")
		os.Exit(1)
	}
	password, err := readPassword()
	if err != nil {
		fmt.Fprintln(os.Stderr, "계정을 만들지 못했습니다. 입력값을 확인하세요.")
		os.Exit(1)
	}
	defer clearString(&password)

	gdb, err := repository.Open(cfg.Database)
	if err != nil {
		fmt.Fprintln(os.Stderr, "데이터베이스에 연결하지 못했습니다.")
		os.Exit(1)
	}
	defer repository.Close(gdb)
	sqlDB, err := repository.SQLDB(gdb)
	if err != nil {
		fmt.Fprintln(os.Stderr, "데이터베이스에 연결하지 못했습니다.")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := schema.VerifyDB(ctx, sqlDB); err != nil {
		fmt.Fprintln(os.Stderr, "스키마가 최신이 아닙니다. cmd/migrate 를 먼저 실행하세요.")
		os.Exit(1)
	}

	accounts := service.NewAccountService(repository.NewUserRepository(gdb))
	user, err := accounts.Create(ctx, service.NewUser{
		EmployeeNo: *employeeNo,
		Name:       *name,
		Email:      *email,
		Password:   password,
		Role:       model.RoleMaster,
	})
	clearString(&password)
	if err != nil {
		if errors.Is(err, model.ErrEmployeeTaken) {
			fmt.Fprintln(os.Stderr, "이미 있는 사번입니다.")
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "계정을 만들지 못했습니다. 입력값을 확인하세요.")
		os.Exit(1)
	}
	fmt.Fprintf(os.Stdout, "MASTER 계정을 만들었습니다. 사번: %s\n", user.EmployeeNo)
}

func readPassword() (string, error) {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		return confirmPassword(func(label string) (string, error) {
			fmt.Fprint(os.Stderr, label)
			raw, err := term.ReadPassword(fd)
			fmt.Fprintln(os.Stderr)
			if err != nil {
				return "", err
			}
			return string(raw), nil
		})
	}
	reader := bufio.NewReader(os.Stdin)
	return confirmPassword(func(label string) (string, error) {
		fmt.Fprint(os.Stderr, label)
		line, err := reader.ReadString('\n')
		if err != nil && line == "" {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	})
}

func confirmPassword(read func(string) (string, error)) (string, error) {
	first, err := read("비밀번호: ")
	if err != nil {
		return "", err
	}
	second, err := read("비밀번호 확인: ")
	if err != nil {
		clearString(&first)
		return "", err
	}
	if first == "" || first != second {
		clearString(&first)
		clearString(&second)
		return "", fmt.Errorf("password mismatch")
	}
	clearString(&second)
	return first, nil
}

func clearString(value *string) {
	if value == nil || *value == "" {
		return
	}
	buf := []byte(*value)
	for i := range buf {
		buf[i] = 0
	}
	*value = ""
}
