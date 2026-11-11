import { pushIssue, type Issue, type IssueScope } from "./restValidation";

export type ErrorCodeDraft = {
  code: string;
  category: string;
  description: string;
  conditionText: string;
  handling: string;
  changeReason: string;
};

export type ErrorCodeIssue = Issue<"basic" | "detail">;

const basic: IssueScope<"basic" | "detail"> = { tab: "basic", trail: "기본 정보" };
const detail: IssueScope<"basic" | "detail"> = { tab: "detail", trail: "상세 정보" };
const textLimit = 4000;

function length(value: string) {
  return Array.from(value).length;
}

export function sameCode<T extends { id: number; code: string }>(rows: T[], code: string, self: number | null) {
  const value = code.trim().toLocaleLowerCase();
  if (!value) return [];
  return rows.filter((row) => row.id !== self && row.code.trim().toLocaleLowerCase() === value);
}

export function validateErrorCode<T extends { id: number; code: string }>(draft: ErrorCodeDraft, rows: T[], self: number | null): ErrorCodeIssue[] {
  const out: ErrorCodeIssue[] = [];
  const code = draft.code.trim();
  if (!code) {
    pushIssue(out, basic, "code:code", "기본 정보 > 코드", "코드를 입력해 주세요. 예: E_TIMEOUT");
  } else if (length(code) > 64) {
    pushIssue(out, basic, "code:code", "기본 정보 > 코드", "코드는 64자 이하로 입력해 주세요.");
  } else if (/[\s\p{Cc}]/u.test(code)) {
    pushIssue(out, basic, "code:code", "기본 정보 > 코드", "코드에는 공백이나 줄바꿈을 넣을 수 없습니다.");
  } else if (sameCode(rows, code, self).length > 0) {
    pushIssue(out, basic, "code:code", "기본 정보 > 코드", `같은 코드 '${sameCode(rows, code, self)[0].code}'가 이미 있습니다. 대소문자는 구분하지 않고 비교합니다.`);
  }
  const category = draft.category.trim();
  if (!category) {
    pushIssue(out, basic, "code:category", "기본 정보 > 분류", "분류를 입력해 주세요. 예: 인증, 통신, 장비");
  } else if (length(category) > 100) {
    pushIssue(out, basic, "code:category", "기본 정보 > 분류", "분류는 100자 이하로 입력해 주세요.");
  }
  const description = draft.description.trim();
  if (!description) {
    pushIssue(out, basic, "code:description", "기본 정보 > 설명", "설명을 입력해 주세요. 한 줄이면 충분합니다.");
  } else if (length(description) > textLimit) {
    pushIssue(out, basic, "code:description", "기본 정보 > 설명", "설명은 4000자 이하로 입력해 주세요.");
  }
  if (length(draft.conditionText.trim()) > textLimit) {
    pushIssue(out, detail, "code:condition", "상세 정보 > 발생 조건", "발생 조건은 4000자 이하로 입력해 주세요.");
  }
  if (length(draft.handling.trim()) > textLimit) {
    pushIssue(out, detail, "code:handling", "상세 정보 > 처리 방법", "처리 방법은 4000자 이하로 입력해 주세요.");
  }
  return out;
}
