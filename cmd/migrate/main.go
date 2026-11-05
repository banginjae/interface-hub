package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"interface-hub/internal/config"
	"interface-hub/internal/repository"
	"interface-hub/internal/schema"
)

func main() {
	path := flag.String("config", config.DefaultPath, "config file path")
	flag.Parse()

	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "설정 파일을 확인하세요. 예시는 config/config.example.yaml 입니다.")
		os.Exit(1)
	}
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := schema.ApplyDB(ctx, sqlDB); err != nil {
		fmt.Fprintln(os.Stderr, "migration 적용에 실패했습니다. 자동으로 되돌리지 않습니다.")
		os.Exit(1)
	}
	fmt.Fprintln(os.Stdout, "migration 적용이 끝났습니다.")
}
