import { errorCodeIdsOf, fieldFromApi, fieldToApi, previewText, type ExampleDraft, type SpecItem } from "./specModel";

export const wsDirections = [
  { value: "CLIENT_TO_SERVER", label: "클라이언트 → 서버", short: "클라이언트→서버", hint: "클라이언트(앱·웹)가 보내고 서버가 받습니다." },
  { value: "SERVER_TO_CLIENT", label: "서버 → 클라이언트", short: "서버→클라이언트", hint: "서버가 보내고 클라이언트가 받습니다." },
  { value: "BIDIRECTIONAL", label: "양방향", short: "양방향", hint: "클라이언트와 서버 모두 같은 형식으로 보냅니다." },
];

export const wsKinds = [
  { value: "REQUEST", label: "Request", hint: "특정 동작이나 데이터 처리를 요청하는 메시지입니다." },
  { value: "RESPONSE", label: "Response", hint: "요청에 대한 처리 결과를 전달하는 메시지입니다." },
  { value: "EVENT", label: "Event", hint: "특정 상황이나 상태 변화를 알리는 메시지입니다." },
];

export const wsTerms = [
  { term: "WebSocket", text: "연결을 유지하면서 클라이언트와 서버가 양방향으로 메시지를 주고받는 통신 방식입니다." },
  { term: "메시지 식별자", text: "애플리케이션에서 메시지 종류를 구분하기 위해 정의한 값입니다." },
  { term: "방향", text: "메시지를 보내는 쪽과 받는 쪽입니다." },
  { term: "Request", text: "특정 동작이나 데이터 처리를 요청하는 메시지입니다." },
  { term: "Response", text: "요청에 대한 처리 결과를 전달하는 메시지입니다." },
  { term: "Event", text: "특정 상황이나 상태 변화를 알리는 메시지입니다." },
  { term: "Payload", text: "메시지에 포함되는 실제 데이터입니다." },
  { term: "requestId", text: "요청과 응답을 연결하기 위해 애플리케이션에서 사용하는 식별자입니다." },
];

export const eventNameExamples = ["session.ready", "doorlock.open", "doorlock.open.result", "gateway.status.changed"];

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
    name: "",
    summary: "",
    status: "ACTIVE",
    eventName: "",
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

export function messageName(draft: WsDraft) {
  return draft.name.trim() || draft.eventName.trim();
}

export function directionText(direction: string) {
  return wsDirections.find((item) => item.value === direction)?.label ?? direction;
}

export function directionShort(direction: string) {
  return wsDirections.find((item) => item.value === direction)?.short ?? direction;
}

export function kindText(kind: string) {
  return wsKinds.find((item) => item.value === kind)?.label ?? kind;
}
