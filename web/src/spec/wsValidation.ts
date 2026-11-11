import { checkExample, pushIssue, type Issue, type IssueScope } from "./restValidation";
import { wsDirections, wsKinds, type WsDraft, type WsOverviewDraft } from "./wsModel";

export type WsSection = "basic" | "payload" | "extra";
export type WsIssue = Issue<WsSection>;

const basic: IssueScope<WsSection> = { tab: "basic", trail: "기본 정보" };
const extra: IssueScope<WsSection> = { tab: "extra", trail: "추가 설정" };
const uidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function eventNameProblem(value: string) {
  const name = value.trim();
  if (!name) {
    return "메시지 식별자를 입력해 주세요. 예: doorlock.open";
  }
  if (/\s/.test(name)) {
    return "메시지 식별자에는 공백을 넣을 수 없습니다.";
  }
  if (name.length > 200) {
    return "메시지 식별자는 200자 이하로 입력해 주세요.";
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return "메시지 식별자는 영문, 숫자, 점(.), 밑줄(_), 하이픈(-)만 쓸 수 있습니다.";
  }
  if (name.startsWith(".") || name.endsWith(".") || name.includes("..")) {
    return "점(.)은 맨 앞·맨 뒤에 둘 수 없고 연속으로 쓸 수 없습니다. 예: doorlock.open.result";
  }
  return null;
}

export function validateMessage(draft: WsDraft, itemUid: string | null): WsIssue[] {
  const out: WsIssue[] = [];
  const eventName = eventNameProblem(draft.eventName);
  if (eventName) {
    pushIssue(out, basic, "ws:eventName", "기본 정보 > 메시지 식별자", eventName);
  }
  if (draft.name.trim().length > 300) {
    pushIssue(out, basic, "ws:name", "기본 정보 > 메시지 이름", "메시지 이름은 300자 이하로 입력해 주세요.");
  }
  if (!wsDirections.some((item) => item.value === draft.direction)) {
    pushIssue(out, basic, "ws:direction", "기본 정보 > 방향", "방향을 선택해 주세요.");
  }
  if (!wsKinds.some((item) => item.value === draft.messageKind)) {
    pushIssue(out, basic, "ws:kind", "기본 정보 > 메시지 종류", "메시지 종류를 선택해 주세요.");
  }
  if (draft.summary.trim().length > 500) {
    pushIssue(out, basic, "ws:summary", "기본 정보 > 요약", "요약은 500자 이하로 입력해 주세요.");
  }
  if (draft.description.length > 2000) {
    pushIssue(out, basic, "ws:description", "기본 정보 > 상세 설명", "상세 설명은 2000자 이하로 입력해 주세요.");
  }

  checkExample(draft.payload, { tab: "payload", trail: "Payload" }, "ws:manual", out);

  const related = draft.relatedItemUid.trim();
  if (related && (!uidPattern.test(related) || related === itemUid)) {
    pushIssue(out, extra, "ws:related", "추가 설정 > 대응 메시지", related === itemUid ? "자기 자신은 대응 메시지로 연결할 수 없습니다." : "대응 메시지를 목록에서 다시 선택해 주세요.");
  }
  return out;
}

export function duplicateEventNames<T extends { itemUid: string; payload: { eventName?: string } }>(items: T[], eventName: string, self: string | null) {
  const name = eventName.trim();
  if (!name) {
    return [];
  }
  return items.filter((item) => item.itemUid !== self && (item.payload.eventName ?? "").trim() === name);
}

export function validateWsOverview(overview: WsOverviewDraft): WsIssue[] {
  const out: WsIssue[] = [];
  const scope: IssueScope<WsSection> = { tab: null, trail: "문서 설정" };
  const title = overview.title.trim();
  if (!title) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목을 입력해 주세요.");
  } else if (title.length > 200) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목은 200자 이하로 입력해 주세요.");
  }
  if (overview.url.length > 500) {
    pushIssue(out, scope, "doc:url", "문서 설정 > 연결 URL", "연결 URL은 500자 이하로 입력해 주세요.");
  } else if (/\s/.test(overview.url.trim())) {
    pushIssue(out, scope, "doc:url", "문서 설정 > 연결 URL", "연결 URL에는 공백을 넣을 수 없습니다.");
  }
  if (overview.heartbeat.length > 2000) {
    pushIssue(out, scope, "doc:heartbeat", "문서 설정 > 하트비트·공통 규칙", "2000자 이하로 입력해 주세요.");
  }
  if (overview.authDescription.length > 500) {
    pushIssue(out, scope, "doc:authDescription", "문서 설정 > 인증 설명", "인증 설명은 500자 이하로 입력해 주세요.");
  }
  if (overview.closeCodes.length > 40) {
    pushIssue(out, scope, "doc:closeCodes", "문서 설정 > 종료 코드", "종료 코드는 40개까지 등록할 수 있습니다.");
  }
  const seen = new Set<number>();
  overview.closeCodes.forEach((code, index) => {
    const where = `문서 설정 > 종료 코드 ${index + 1}번째`;
    const text = code.code.trim();
    if (!/^\d+$/.test(text) || Number(text) > 4999) {
      pushIssue(out, scope, `doc:closeCode:${index}`, where, "종료 코드는 0부터 4999까지의 정수로 입력해 주세요. 예: 1000, 4001");
    } else if (seen.has(Number(text))) {
      pushIssue(out, scope, `doc:closeCode:${index}`, where, `종료 코드 ${Number(text)}가 이미 있습니다.`);
    } else {
      seen.add(Number(text));
    }
    if (code.description.trim().length > 200) {
      pushIssue(out, scope, `doc:closeCodeText:${index}`, where, "종료 코드 설명은 200자 이하로 입력해 주세요.");
    }
  });
  return out;
}
