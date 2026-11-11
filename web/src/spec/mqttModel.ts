import {
  errorCodeIdsOf,
  fieldFromApi,
  fieldToApi,
  previewText,
  type ExampleDraft,
  type SpecItem,
} from "./specModel";

export const mqttDirections = [
  {
    value: "DEVICE_TO_SERVER", label: "장비 → 서버 (Publish)", short: "장비→서버",
    hint: "장비가 발행(Publish)하고 서버가 구독(Subscribe)합니다.",
    publisherExample: "예: Gateway GW001", subscriberExample: "예: Backend Server",
  },
  {
    value: "SERVER_TO_DEVICE", label: "서버 → 장비 (Publish)", short: "서버→장비",
    hint: "서버가 발행(Publish)하고 장비가 구독(Subscribe)합니다.",
    publisherExample: "예: Backend Server", subscriberExample: "예: Gateway GW001",
  },
  {
    value: "BIDIRECTIONAL", label: "양방향", short: "양방향",
    hint: "장비와 서버가 같은 Topic으로 서로 발행하고 구독합니다.",
    publisherExample: "예: Gateway GW001, Backend Server", subscriberExample: "예: Backend Server, Gateway GW001",
  },
];

export const qosOptions = [
  { value: 0, label: "0 · 최대 한 번", hint: "수신 확인 없이 최대 한 번 전달합니다. 유실될 수 있지만 가장 가볍습니다." },
  { value: 1, label: "1 · 최소 한 번", hint: "최소 한 번 전달합니다. 같은 메시지를 중복 수신할 수 있습니다." },
  { value: 2, label: "2 · 정확히 한 번", hint: "정확히 한 번 전달되도록 처리합니다. 가장 무겁습니다." },
];

export const mqttTerms = [
  { term: "Topic", text: "메시지를 발행하거나 구독하는 경로입니다. 단계를 / 로 구분합니다." },
  { term: "Publish", text: "Topic으로 메시지를 보내는(발행하는) 동작입니다." },
  { term: "Subscribe", text: "Topic의 메시지를 받기 위해 구독하는 동작입니다." },
  { term: "QoS 0", text: "수신 확인 없이 최대 한 번 전달합니다." },
  { term: "QoS 1", text: "최소 한 번 전달합니다. 중복 수신이 생길 수 있습니다." },
  { term: "QoS 2", text: "정확히 한 번 전달되도록 처리합니다." },
  { term: "Retain", text: "Broker가 그 Topic의 마지막 Retained 메시지를 보관했다가 새 구독자에게 바로 전달합니다." },
];

export const topicExamples = [
  "gateway/GW001/heartbeat",
  "gateway/GW001/doorlock/DL001/event",
  "gateway/{gatewayId}/doorlock/{doorlockId}/command",
];

export function topicHasWildcard(topic: string) {
  return topic.split("/").some((part) => part === "+" || part === "#");
}

export function directionGuide(direction: string) {
  return mqttDirections.find((item) => item.value === direction) ?? mqttDirections[0];
}

export function directionShort(direction: string) {
  return mqttDirections.find((item) => item.value === direction)?.short ?? direction;
}

export type MqttDraft = {
  name: string;
  summary: string;
  status: "ACTIVE" | "DEPRECATED";
  topic: string;
  qos: number;
  retain: boolean;
  direction: string;
  publishers: string[];
  subscribers: string[];
  purpose: string;
  payload: ExampleDraft;
  relatedItemUid: string;
  errorCodeIds: number[];
  changeReason: string;
};

export type MqttOverviewDraft = {
  title: string;
  brokerUrl: string;
  protocolVersion: string;
  authType: string;
  authDescription: string;
  changeReason: string;
};

export function blankMqtt(): MqttDraft {
  return {
    name: "",
    summary: "",
    status: "ACTIVE",
    topic: "",
    qos: 0,
    retain: false,
    direction: "DEVICE_TO_SERVER",
    publishers: [],
    subscribers: [],
    purpose: "",
    payload: { fields: [], exampleMode: "AUTO", manualText: "" },
    relatedItemUid: "",
    errorCodeIds: [],
    changeReason: "",
  };
}

export function mqttFromApi(item: SpecItem): MqttDraft {
  const payload = item.payload ?? {};
  const mode = payload.exampleMode === "MANUAL" ? "MANUAL" : "AUTO";
  return {
    name: item.name,
    summary: item.summary ?? "",
    status: item.status === "DEPRECATED" ? "DEPRECATED" : "ACTIVE",
    topic: payload.topic ?? "",
    qos: payload.qos === 1 || payload.qos === 2 ? payload.qos : 0,
    retain: Boolean(payload.retain),
    direction: payload.direction || "DEVICE_TO_SERVER",
    publishers: payload.publishers ?? [],
    subscribers: payload.subscribers ?? [],
    purpose: payload.purpose ?? "",
    payload: {
      fields: (payload.payloadFields ?? []).map((field) => fieldFromApi(field)),
      exampleMode: mode,
      manualText: mode === "MANUAL" && payload.example !== undefined ? JSON.stringify(payload.example, null, 2) : "",
    },
    relatedItemUid: payload.relatedItemUid ?? "",
    errorCodeIds: errorCodeIdsOf(item),
    changeReason: "",
  };
}

export function mqttToPayload(draft: MqttDraft) {
  const preview = previewText(draft.payload);
  let example: unknown = null;
  if (draft.payload.exampleMode === "MANUAL" && preview.text.trim()) {
    example = JSON.parse(preview.text);
  }
  return {
    topic: draft.topic.trim(),
    qos: draft.qos,
    retain: draft.retain,
    direction: draft.direction,
    publishers: draft.publishers,
    subscribers: draft.subscribers,
    purpose: draft.purpose.trim(),
    payloadFields: draft.payload.fields.map((field) => fieldToApi(field)),
    exampleMode: draft.payload.exampleMode,
    example,
    relatedItemUid: draft.relatedItemUid || null,
  };
}

export function topicNotes(topic: string) {
  const notes: Array<{ tone: "info" | "warning"; text: string }> = [];
  const variables = topic.match(/\{[^}]+\}/g) ?? [];
  if (variables.length > 0) {
    notes.push({ tone: "info", text: `${variables.join(", ")}는 문서용 변수 표기입니다. 실제 메시지에서는 GW001처럼 실제 값으로 바뀝니다.` });
  }
  if (topicHasWildcard(topic)) {
    notes.push({
      tone: "warning",
      text: "+ 또는 # 가 있어 Subscribe 필터 형태입니다. 실제로 발행(Publish)하는 Topic 이름에는 와일드카드를 쓸 수 없으니, 발행 Topic을 정의한다면 {gatewayId}처럼 변수 표기를 쓰세요. (저장은 가능합니다)",
    });
  }
  return notes;
}

export function directionText(direction: string) {
  return mqttDirections.find((item) => item.value === direction)?.label ?? direction;
}

export function addTag(values: string[], text: string) {
  const next = text.trim();
  if (!next || values.includes(next)) {
    return values;
  }
  return [...values, next];
}

