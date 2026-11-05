import { errorCodeIdsOf, fieldFromApi, fieldToApi, previewText, type ExampleDraft, type SpecItem } from "./specModel";

export const wsDirections = [
  { value: "CLIENT_TO_SERVER", label: "클라이언트 → 서버" },
  { value: "SERVER_TO_CLIENT", label: "서버 → 클라이언트" },
  { value: "BIDIRECTIONAL", label: "양방향" },
];

export const wsKinds = [
  { value: "REQUEST", label: "Request" },
  { value: "RESPONSE", label: "Response" },
  { value: "EVENT", label: "Event" },
];

export type CloseCodeDraft = { code: string; description: string };

export type WsDraft = {
  name: string;
  summary: string;
  status: "ACTIVE" | "DEPRECATED";
  eventName: string;
  direction: string;
  messageKind: string;
  description: string;
  payload: ExampleDraft;
  relatedItemUid: string;
  errorCodeIds: number[];
  changeReason: string;
};

export type WsOverviewDraft = {
  title: string;
  url: string;
  heartbeat: string;
  authType: string;
  authDescription: string;
  closeCodes: CloseCodeDraft[];
  changeReason: string;
};

export function blankWs(): WsDraft {
  return {
    name: "새 메시지",
    summary: "",
    status: "ACTIVE",
    eventName: "session.ready",
    direction: "CLIENT_TO_SERVER",
    messageKind: "EVENT",
    description: "",
    payload: { fields: [], exampleMode: "AUTO", manualText: "" },
    relatedItemUid: "",
    errorCodeIds: [],
    changeReason: "",
  };
}

export function wsFromApi(item: SpecItem): WsDraft {
  const payload = item.payload ?? {};
  const mode = payload.exampleMode === "MANUAL" ? "MANUAL" : "AUTO";
  return {
    name: item.name,
    summary: item.summary ?? "",
    status: item.status === "DEPRECATED" ? "DEPRECATED" : "ACTIVE",
    eventName: payload.eventName ?? "",
    direction: payload.direction || "CLIENT_TO_SERVER",
    messageKind: payload.messageKind || "EVENT",
    description: payload.description ?? "",
    payload: {
      fields: (payload.fields ?? []).map((field) => fieldFromApi(field)),
      exampleMode: mode,
      manualText: mode === "MANUAL" && payload.example !== undefined ? JSON.stringify(payload.example, null, 2) : "",
    },
    relatedItemUid: payload.relatedItemUid ?? "",
    errorCodeIds: errorCodeIdsOf(item),
    changeReason: "",
  };
}

export function wsToPayload(draft: WsDraft) {
  const preview = previewText(draft.payload);
  let example: unknown = null;
  if (draft.payload.exampleMode === "MANUAL" && preview.text.trim()) {
    example = JSON.parse(preview.text);
  }
  return {
    eventName: draft.eventName.trim(),
    direction: draft.direction,
    messageKind: draft.messageKind,
    description: draft.description.trim(),
    fields: draft.payload.fields.map((field) => fieldToApi(field)),
    exampleMode: draft.payload.exampleMode,
    example,
    relatedItemUid: draft.relatedItemUid || null,
  };
}

export function wsError(draft: WsDraft) {
  if (!draft.name.trim() || !draft.changeReason.trim()) {
    return "메시지 이름과 변경 사유를 입력하세요.";
  }
  if (!validEventName(draft.eventName.trim())) {
    return "메시지 식별자는 공백 없이 영문, 숫자, 점, 밑줄, 하이픈만 사용합니다.";
  }
  if (!wsDirections.some((item) => item.value === draft.direction)) {
    return "방향을 선택하세요.";
  }
  if (!wsKinds.some((item) => item.value === draft.messageKind)) {
    return "메시지 종류를 선택하세요.";
  }
  const preview = previewText(draft.payload);
  if (preview.problem) {
    return preview.problem;
  }
  return null;
}

export function closeCodeError(codes: CloseCodeDraft[]) {
  const seen = new Set<string>();
  for (const code of codes) {
    if (!/^\d+$/.test(code.code.trim())) {
      return "종료 코드는 0부터 4999까지의 정수입니다.";
    }
    const value = Number(code.code);
    if (value > 4999 || seen.has(code.code.trim())) {
      return "종료 코드는 0부터 4999까지이며 중복될 수 없습니다.";
    }
    seen.add(code.code.trim());
  }
  return null;
}

export function directionText(direction: string) {
  return wsDirections.find((item) => item.value === direction)?.label ?? direction;
}

export function kindText(kind: string) {
  return wsKinds.find((item) => item.value === kind)?.label ?? kind;
}

export function directionBadge(direction: string) {
  if (direction === "SERVER_TO_CLIENT") return "S→C";
  if (direction === "BIDIRECTIONAL") return "BOTH";
  return "C→S";
}

function validEventName(name: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.endsWith(".") && !name.includes("..") && name.length <= 200;
}
