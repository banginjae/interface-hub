package service

import (
	"strings"
	"testing"
)

// Server verdicts that web/scripts/check-errorcode-validation.mjs expects the error code form to match.
func TestCleanErrorCodeEditorCases(t *testing.T) {
	base := func(edit func(*ErrorCodeWrite)) ErrorCodeWrite {
		write := ErrorCodeWrite{Code: "E_TIMEOUT", Category: "통신", Description: "응답 시간 초과", ChangeReason: "test", Version: 1}
		if edit != nil {
			edit(&write)
		}
		return write
	}
	cases := []struct {
		name  string
		valid bool
		write ErrorCodeWrite
	}{
		{"code, category and description only", true, base(nil)},
		{"hex style code", true, base(func(w *ErrorCodeWrite) { w.Code = "0x3030" })},
		{"lowercase code is kept as typed", true, base(func(w *ErrorCodeWrite) { w.Code = "auth_failed" })},
		{"korean code", true, base(func(w *ErrorCodeWrite) { w.Code = "인증실패" })},
		{"64 character code", true, base(func(w *ErrorCodeWrite) { w.Code = strings.Repeat("A", 64) })},
		{"condition and handling filled", true, base(func(w *ErrorCodeWrite) { w.ConditionText = "3초 동안 응답 없음"; w.Handling = "재시도" })},
		{"empty code", false, base(func(w *ErrorCodeWrite) { w.Code = "" })},
		{"space in code", false, base(func(w *ErrorCodeWrite) { w.Code = "E TIMEOUT" })},
		{"tab in code", false, base(func(w *ErrorCodeWrite) { w.Code = "E\tTIMEOUT" })},
		{"65 character code", false, base(func(w *ErrorCodeWrite) { w.Code = strings.Repeat("A", 65) })},
		{"empty category", false, base(func(w *ErrorCodeWrite) { w.Category = " " })},
		{"category over 100", false, base(func(w *ErrorCodeWrite) { w.Category = strings.Repeat("가", 101) })},
		{"empty description", false, base(func(w *ErrorCodeWrite) { w.Description = "" })},
		{"description over 4000", false, base(func(w *ErrorCodeWrite) { w.Description = strings.Repeat("가", 4001) })},
		{"handling over 4000", false, base(func(w *ErrorCodeWrite) { w.Handling = strings.Repeat("가", 4001) })},
	}
	for _, tc := range cases {
		_, _, err := cleanErrorCode(tc.write, true)
		if tc.valid && err != nil {
			t.Errorf("%s: expected accepted, got %v", tc.name, err)
		}
		if !tc.valid && err == nil {
			t.Errorf("%s: expected rejected", tc.name)
		}
	}
}
