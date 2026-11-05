import {
  blankField,
  errorCodeIdsOf,
  fieldFromApi,
  fieldToApi,
  newKey,
  previewText,
  type ApiField,
  type ExampleDraft,
  type FieldNode,
  type SpecItem,
} from "./specModel";

export const mqttDirections = [
  { value: "DEVICE_TO_SERVER", label: "장비 → 서버 (Publish)" },
  { value: "SERVER_TO_DEVICE", label: "서버 → 장비 (Publish)" },
  { value: "BIDIRECTIONAL", label: "양방향" },
];

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
    name: "새 Topic",
    summary: "",
    status: "ACTIVE",
    topic: "lab/status",
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

export function mqttError(draft: MqttDraft) {
  if (!draft.name.trim() || !draft.changeReason.trim()) {
    return "Topic 이름과 변경 사유를 입력하세요.";
  }
  if (!validTopic(draft.topic.trim())) {
    return "Topic은 공백 없이 쓰고, # 는 마지막 단계에만 둘 수 있습니다.";
  }
  if (![0, 1, 2].includes(draft.qos)) {
    return "QoS는 0, 1, 2 중 하나입니다.";
  }
  if (!mqttDirections.some((item) => item.value === draft.direction)) {
    return "방향을 선택하세요.";
  }
  const preview = previewText(draft.payload);
  if (preview.problem) {
    return preview.problem;
  }
  return null;
}

export function topicNotes(topic: string) {
  const notes: string[] = [];
  if (topic.includes("+")) {
    notes.push("+ 는 그 한 단계를 아무 값이나 받는 와일드카드입니다.");
  }
  if (topic.includes("#")) {
    notes.push("# 는 남은 단계를 모두 받는 와일드카드이며 마지막에만 둡니다.");
  }
  const variables = topic.match(/\{[^}]+\}/g) ?? [];
  if (variables.length > 0) {
    notes.push(`Topic 변수: ${variables.join(", ")}`);
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

export function payloadFields(fields: ApiField[] | FieldNode[]) {
  return fields;
}

export function newPayloadField() {
  return blankField("");
}

export function payloadKey() {
  return newKey();
}

function validTopic(topic: string) {
  if (!topic || topic.length > 300 || /\s/.test(topic)) {
    return false;
  }
  const parts = topic.split("/");
  let seenHash = false;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || seenHash) {
      return false;
    }
    if (part === "#") {
      if (index !== parts.length - 1) {
        return false;
      }
      seenHash = true;
      continue;
    }
    if (part.includes("#") || (part.includes("+") && part !== "+")) {
      return false;
    }
  }
  return true;
}
