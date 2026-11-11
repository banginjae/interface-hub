import { mqttDirections, type MqttDraft, type MqttOverviewDraft } from "./mqttModel";
import { checkExample, pushIssue, type Issue, type IssueScope } from "./restValidation";

export type MqttSection = "basic" | "payload" | "extra";
export type MqttIssue = Issue<MqttSection>;

const basic: IssueScope<MqttSection> = { tab: "basic", trail: "기본 정보" };
const extra: IssueScope<MqttSection> = { tab: "extra", trail: "추가 설정" };
const uidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function topicProblem(value: string) {
  const topic = value.trim();
  if (!topic) {
    return "Topic 경로를 입력해 주세요. 예: devices/{deviceId}/status";
  }
  if (/\s/.test(topic)) {
    return "Topic 경로에는 공백을 넣을 수 없습니다.";
  }
  if (topic.length > 300) {
    return "Topic 경로는 300자 이하로 입력해 주세요.";
  }
  const parts = topic.split("/");
  if (parts.some((part) => part === "")) {
    return "Topic 경로에 빈 단계가 있습니다. 맨 앞·맨 뒤의 / 또는 // 를 확인해 주세요.";
  }
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.includes("#") && (part !== "#" || index !== parts.length - 1)) {
      return "# 와일드카드는 마지막 단계에 단독으로만 쓸 수 있습니다. 예: devices/#";
    }
    if (part.includes("+") && part !== "+") {
      return "+ 와일드카드는 한 단계 전체에 단독으로만 쓸 수 있습니다. 예: devices/+/status";
    }
  }
  return null;
}

function actorProblem(values: string[], label: string) {
  if (values.length > 30) {
    return `${label}는 30개까지 등록할 수 있습니다.`;
  }
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (!text) {
      return `${label}에 빈 항목이 있습니다.`;
    }
    if (text.length > 100) {
      return `${label} '${text.slice(0, 20)}…'는 100자 이하로 입력해 주세요.`;
    }
    if (/[\r\n\t]/.test(text)) {
      return `${label}에는 줄바꿈이나 탭을 넣을 수 없습니다.`;
    }
    if (seen.has(text)) {
      return `${label} '${text}'가 중복되었습니다.`;
    }
    seen.add(text);
  }
  return null;
}

export function validateTopic(draft: MqttDraft): MqttIssue[] {
  const out: MqttIssue[] = [];
  const topic = topicProblem(draft.topic);
  if (topic) {
    pushIssue(out, basic, "mqtt:topic", "기본 정보 > Topic 경로", topic);
  }
  const name = draft.name.trim();
  if (!name) {
    pushIssue(out, basic, "mqtt:name", "기본 정보 > Topic 이름", "Topic 이름을 입력해 주세요.");
  } else if (name.length > 300) {
    pushIssue(out, basic, "mqtt:name", "기본 정보 > Topic 이름", "Topic 이름은 300자 이하로 입력해 주세요.");
  }
  if (!mqttDirections.some((item) => item.value === draft.direction)) {
    pushIssue(out, basic, "mqtt:direction", "기본 정보 > 메시지 방향", "메시지 방향을 선택해 주세요.");
  }
  if (![0, 1, 2].includes(draft.qos)) {
    pushIssue(out, basic, "mqtt:qos", "기본 정보 > QoS", "QoS는 0, 1, 2 중 하나를 선택해 주세요.");
  }
  if (draft.summary.trim().length > 500) {
    pushIssue(out, basic, "mqtt:summary", "기본 정보 > 요약", "요약은 500자 이하로 입력해 주세요.");
  }
  if (draft.purpose.length > 2000) {
    pushIssue(out, basic, "mqtt:purpose", "기본 정보 > 용도/설명", "용도/설명은 2000자 이하로 입력해 주세요.");
  }

  checkExample(draft.payload, { tab: "payload", trail: "Payload" }, "mqtt:manual", out);

  const publishers = actorProblem(draft.publishers, "발행 주체");
  if (publishers) {
    pushIssue(out, extra, "mqtt:publishers", "추가 설정 > 발행 주체", publishers);
  }
  const subscribers = actorProblem(draft.subscribers, "수신 주체");
  if (subscribers) {
    pushIssue(out, extra, "mqtt:subscribers", "추가 설정 > 수신 주체", subscribers);
  }
  if (draft.relatedItemUid && !uidPattern.test(draft.relatedItemUid.trim())) {
    pushIssue(out, extra, "mqtt:related", "추가 설정 > 대응 Topic", "대응 Topic을 목록에서 다시 선택해 주세요.");
  }
  return out;
}

export function pendingActorIssues(pending: { publishers: string; subscribers: string }): MqttIssue[] {
  const out: MqttIssue[] = [];
  const publisher = pending.publishers.trim();
  if (publisher) {
    pushIssue(out, extra, "mqtt:publishers", "추가 설정 > 발행 주체", `입력창에 추가하지 않은 값 '${publisher}'이(가) 남아 있습니다. '추가'를 누르거나 입력을 비워 주세요.`);
  }
  const subscriber = pending.subscribers.trim();
  if (subscriber) {
    pushIssue(out, extra, "mqtt:subscribers", "추가 설정 > 수신 주체", `입력창에 추가하지 않은 값 '${subscriber}'이(가) 남아 있습니다. '추가'를 누르거나 입력을 비워 주세요.`);
  }
  return out;
}

export function duplicateTopics<T extends { itemUid: string; payload: { topic?: string } }>(items: T[], topic: string, self: string | null) {
  const path = topic.trim();
  if (!path) {
    return [];
  }
  return items.filter((item) => item.itemUid !== self && (item.payload.topic ?? "").trim() === path);
}

export function validateMqttOverview(overview: MqttOverviewDraft): MqttIssue[] {
  const out: MqttIssue[] = [];
  const scope: IssueScope<MqttSection> = { tab: null, trail: "문서 설정" };
  const title = overview.title.trim();
  if (!title) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목을 입력해 주세요.");
  } else if (title.length > 200) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목은 200자 이하로 입력해 주세요.");
  }
  if (overview.brokerUrl.length > 500) {
    pushIssue(out, scope, "doc:brokerUrl", "문서 설정 > 브로커 주소", "브로커 주소는 500자 이하로 입력해 주세요.");
  }
  if (overview.protocolVersion.length > 50) {
    pushIssue(out, scope, "doc:protocolVersion", "문서 설정 > 프로토콜 버전", "프로토콜 버전은 50자 이하로 입력해 주세요.");
  }
  if (overview.authDescription.length > 500) {
    pushIssue(out, scope, "doc:authDescription", "문서 설정 > 인증 설명", "인증 설명은 500자 이하로 입력해 주세요.");
  }
  return out;
}
