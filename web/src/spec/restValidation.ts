import { manualError, type ExampleDraft, type FieldNode, type ItemDraft } from "./specModel";

export type EditorTab = "request" | "response" | "header" | "path" | "query" | "errors";

export type Issue<T extends string = EditorTab> = {
  target: string;
  tab: T | null;
  responseIndex?: number;
  detail?: boolean;
  where: string;
  message: string;
};

export type OverviewInput = {
  title: string;
  baseUrl: string;
  authDescription: string;
  headers: FieldNode[];
};

export type IssueScope<T extends string = EditorTab> = {
  tab: T | null;
  responseIndex?: number;
  trail: string;
};
type Scope = IssueScope;

const MAX_DEPTH = 8;
const badName = /[\s.{}[\]]/;

export function fieldTarget(field: FieldNode, input: "name" | "type" | "description" | "example" | "format" | "enum") {
  return `field:${field.clientKey}:${input}`;
}

export function enumValues(text: string) {
  return text.split(",").map((value) => value.trim()).filter(Boolean);
}

export function pushIssue<T extends string>(out: Issue<T>[], scope: IssueScope<T>, target: string, where: string, message: string, detail = false) {
  out.push({ target, tab: scope.tab, responseIndex: scope.responseIndex, detail, where, message });
}

const push = pushIssue;

export function checkFields<T extends string>(fields: FieldNode[], scope: IssueScope<T>, depth: number, out: Issue<T>[], childLabel = "필드") {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const name = field.name.trim();
    const where = `${scope.trail} > ${index + 1}번째 ${childLabel}${name ? `(${name})` : ""}`;
    checkField(field, scope, depth, where, out, seen);
  });
}

function checkField<T extends string>(field: FieldNode, scope: IssueScope<T>, depth: number, where: string, out: Issue<T>[], seen: Set<string> | null) {
  const name = field.name.trim();
  const nameTarget = fieldTarget(field, "name");
  if (!name) {
    push(out, scope, nameTarget, where, "필드명을 입력해 주세요. 쓰지 않는 행이면 삭제하세요.");
  } else if (badName.test(name)) {
    push(out, scope, nameTarget, where, "필드명에는 공백, 점(.), 괄호({ } [ ])를 쓸 수 없습니다.");
  } else if (name.length > 100) {
    push(out, scope, nameTarget, where, "필드명은 100자 이하로 입력해 주세요.");
  } else if (seen?.has(name)) {
    push(out, scope, nameTarget, where, `같은 단계에 '${name}' 필드가 이미 있습니다.`);
  }
  if (name) {
    seen?.add(name);
  }
  if (depth > MAX_DEPTH) {
    push(out, scope, nameTarget, where, `필드는 ${MAX_DEPTH}단계까지만 중첩할 수 있습니다.`);
  }
  if (field.description.length > 500) {
    push(out, scope, fieldTarget(field, "description"), where, "설명은 500자 이하로 입력해 주세요.");
  }
  if (field.format.trim().length > 50) {
    push(out, scope, fieldTarget(field, "format"), where, "Format은 50자 이하로 입력해 주세요.", true);
  }
  if (field.example.length > 4000) {
    push(out, scope, fieldTarget(field, "example"), where, "예시는 4000자 이하로 입력해 주세요.");
  }
  if (field.type === "enum") {
    const values = enumValues(field.enumText);
    if (values.length === 0) {
      push(out, scope, fieldTarget(field, "enum"), where, "Enum 값을 쉼표로 구분해 입력해 주세요. 예: ACTIVE, INACTIVE", true);
    } else if (new Set(values).size !== values.length) {
      push(out, scope, fieldTarget(field, "enum"), where, "Enum 값이 중복되었습니다.", true);
    }
  }
  const example = exampleProblem(field);
  if (example) {
    push(out, scope, fieldTarget(field, "example"), where, example);
  }
  if (field.type === "object") {
    checkFields(field.children, { ...scope, trail: where }, depth + 1, out, "하위 필드");
  }
  if (field.type === "array" && field.arrayItem) {
    checkField(field.arrayItem, { ...scope, trail: where }, depth + 1, `${where} > 배열 요소`, out, null);
  }
}

function exampleProblem(field: FieldNode) {
  const value = field.example;
  switch (field.type) {
    case "integer":
      return /^-?\d+$/.test(value) ? null : "integer 타입은 정수 예시가 필요합니다. 예: 10";
    case "number":
      return value.trim() !== "" && Number.isFinite(Number(value)) ? null : "number 타입은 숫자 예시가 필요합니다. 예: 3.14";
    case "boolean":
      return value === "true" || value === "false" ? null : "boolean 타입은 예시로 true 또는 false를 선택해 주세요.";
    case "enum": {
      const values = enumValues(field.enumText);
      if (values.length === 0) {
        return null;
      }
      return values.includes(value) ? null : `예시는 Enum 값 중 하나여야 합니다. (${values.join(", ")})`;
    }
    default:
      return null;
  }
}

export function checkExample<T extends string>(example: ExampleDraft, scope: IssueScope<T>, target: string, out: Issue<T>[]) {
  const before = out.length;
  checkFields(example.fields, scope, 1, out);
  if (example.exampleMode !== "MANUAL" || out.length > before) {
    return;
  }
  const problem = manualError(example.fields, example.manualText);
  if (problem) {
    push(out, scope, target, `${scope.trail} > 예시 JSON`, problem);
  }
}

export function validateItem(draft: ItemDraft): Issue[] {
  const out: Issue[] = [];
  const basic: Scope = { tab: null, trail: "기본 정보" };
  const path = draft.path.trim();
  if (!path) {
    push(out, basic, "item:path", "기본 정보 > URL 경로", "URL 경로를 입력해 주세요. 예: /api/v1/auth/login");
  } else if (!path.startsWith("/")) {
    push(out, basic, "item:path", "기본 정보 > URL 경로", "URL 경로는 /로 시작해야 합니다.");
  } else if (/\s/.test(path)) {
    push(out, basic, "item:path", "기본 정보 > URL 경로", "URL 경로에는 공백을 넣을 수 없습니다.");
  } else if (path.length > 300) {
    push(out, basic, "item:path", "기본 정보 > URL 경로", "URL 경로는 300자 이하로 입력해 주세요.");
  }
  const name = draft.name.trim();
  if (!name) {
    push(out, basic, "item:name", "기본 정보 > Endpoint 이름", "Endpoint 이름을 입력해 주세요.");
  } else if (name.length > 300) {
    push(out, basic, "item:name", "기본 정보 > Endpoint 이름", "Endpoint 이름은 300자 이하로 입력해 주세요.");
  }
  if (draft.summary.trim().length > 500) {
    push(out, basic, "item:summary", "기본 정보 > 요약", "요약은 500자 이하로 입력해 주세요.");
  }
  if (draft.description.trim().length > 2000) {
    push(out, basic, "item:description", "기본 정보 > 설명", "설명은 2000자 이하로 입력해 주세요.");
  }

  checkExample(draft.requestBody, { tab: "request", trail: "요청 Body" }, "manual:request", out);

  const statuses = new Set<string>();
  draft.responses.forEach((response, index) => {
    const label = response.status.trim() ? `응답 ${response.status.trim()}` : `${index + 1}번째 응답`;
    const scope: Scope = { tab: "response", responseIndex: index, trail: label };
    const status = response.status.trim();
    if (!/^\d{3}$/.test(status) || Number(status) < 100 || Number(status) > 599) {
      push(out, scope, `response:${response.clientKey}:status`, `${label} > 상태 코드`, "상태 코드는 100~599 사이의 세 자리 숫자로 입력해 주세요.");
    } else if (statuses.has(status)) {
      push(out, scope, `response:${response.clientKey}:status`, `${index + 1}번째 응답 > 상태 코드`, `상태 코드 ${status} 응답이 이미 있습니다.`);
    }
    statuses.add(status);
    const responseName = response.name.trim();
    if (!responseName) {
      push(out, scope, `response:${response.clientKey}:name`, `${label} > 응답 이름`, "응답 이름을 입력해 주세요. 예: 성공");
    } else if (responseName.length > 100) {
      push(out, scope, `response:${response.clientKey}:name`, `${label} > 응답 이름`, "응답 이름은 100자 이하로 입력해 주세요.");
    }
    if (response.description.trim().length > 2000) {
      push(out, scope, `response:${response.clientKey}:description`, `${label} > 설명`, "응답 설명은 2000자 이하로 입력해 주세요.");
    }
    checkExample(response, scope, `manual:${response.clientKey}`, out);
  });

  if (draft.authDescription.trim().length > 500) {
    push(out, { tab: "header", trail: "Header" }, "item:authDescription", "Header > 인증 설명", "인증 설명은 500자 이하로 입력해 주세요.");
  }
  checkFields(draft.headers, { tab: "header", trail: "Header" }, 1, out, "헤더");
  checkFields(draft.pathParams, { tab: "path", trail: "Path 변수" }, 1, out, "변수");
  checkFields(draft.queryParams, { tab: "query", trail: "Query 파라미터" }, 1, out, "파라미터");
  return out;
}

export function validateOverview(overview: OverviewInput): Issue[] {
  const out: Issue[] = [];
  const scope: Scope = { tab: null, trail: "문서 설정" };
  const title = overview.title.trim();
  if (!title) {
    push(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목을 입력해 주세요.");
  } else if (title.length > 200) {
    push(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목은 200자 이하로 입력해 주세요.");
  }
  if (overview.baseUrl.trim().length > 500) {
    push(out, scope, "doc:baseUrl", "문서 설정 > Base URL", "Base URL은 500자 이하로 입력해 주세요.");
  }
  if (overview.authDescription.trim().length > 500) {
    push(out, scope, "doc:authDescription", "문서 설정 > 인증 설명", "인증 설명은 500자 이하로 입력해 주세요.");
  }
  checkFields(overview.headers, { tab: null, trail: "문서 설정 > 공통 헤더" }, 1, out, "헤더");
  return out;
}

export function reasonProblem(reason: string) {
  const value = reason.trim();
  if (!value) {
    return "변경 사유를 입력해 주세요.";
  }
  if (value.length > 500) {
    return "변경 사유는 500자 이하로 입력해 주세요.";
  }
  return null;
}

export function issueMap<T extends string>(issues: Issue<T>[]) {
  const map = new Map<string, string>();
  for (const issue of issues) {
    if (!map.has(issue.target)) {
      map.set(issue.target, issue.message);
    }
  }
  return map;
}

export function fullUrl(baseUrl: string | undefined, method: string, path: string) {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  const tail = path.trim();
  if (!base || !tail) {
    return null;
  }
  return `${method} ${base}${tail.startsWith("/") ? tail : `/${tail}`}`;
}
