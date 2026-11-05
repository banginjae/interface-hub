import { flattenFields, type ApiField, type ApiPayload, type FlatField, type SpecOverview } from "./specModel";

export type SnapshotErrorCode = {
  code?: string;
  description?: string;
  conditionText?: string;
  handling?: string;
};

export type SnapshotItem = {
  itemUid: string;
  name: string;
  summary?: string;
  status?: string;
  sortOrder?: number;
  payload: ApiPayload;
  errorCodes?: SnapshotErrorCode[];
};

export type SnapshotDocument = {
  title?: string;
  overview?: SpecOverview;
  items?: SnapshotItem[];
};

export type ChangeLine = {
  kind: "added" | "removed" | "changed";
  area: string;
  field: string;
  before: string;
  after: string;
};

export type EndpointDiff = {
  itemUid: string;
  title: string;
  tags: string[];
  lines: ChangeLine[];
  examples: Array<{ label: string; before: string; after: string }>;
};

export type CompareReport = {
  overview: ChangeLine[];
  added: EndpointDiff[];
  removed: EndpointDiff[];
  changed: EndpointDiff[];
  orderBefore: string[];
  orderAfter: string[];
  orderChanged: boolean;
};

export function buildCompareReport(before: SnapshotDocument, after: SnapshotDocument): CompareReport {
  const previous = new Map((before.items ?? []).map((item) => [item.itemUid, item]));
  const next = new Map((after.items ?? []).map((item) => [item.itemUid, item]));
  const added: EndpointDiff[] = [];
  const removed: EndpointDiff[] = [];
  const changed: EndpointDiff[] = [];
  for (const item of after.items ?? []) {
    const old = previous.get(item.itemUid);
    if (!old) {
      added.push(endpointSnapshot(item, "added"));
      continue;
    }
    const diff = endpointDiff(old, item);
    if (diff.tags.length > 0 || diff.lines.length > 0 || diff.examples.length > 0) {
      changed.push(diff);
    }
  }
  for (const item of before.items ?? []) {
    if (!next.has(item.itemUid)) {
      removed.push(endpointSnapshot(item, "removed"));
    }
  }
  const orderBefore = (before.items ?? []).map(orderLabel);
  const orderAfter = (after.items ?? []).map(orderLabel);
  return {
    overview: overviewDiff(before, after),
    added,
    removed,
    changed,
    orderBefore,
    orderAfter,
    orderChanged: orderBefore.join("\n") !== orderAfter.join("\n"),
  };
}

function endpointSnapshot(item: SnapshotItem, kind: "added" | "removed"): EndpointDiff {
  if (isDevice(item.payload)) {
    return deviceSnapshot(item, kind);
  }
  if (isSocket(item.payload)) {
    return socketSnapshot(item, kind);
  }
  if (isMqtt(item.payload)) {
    return mqttSnapshot(item, kind);
  }
  const empty: ApiField[] = [];
  const fields = item.payload.requestBody?.fields ?? [];
  const lines: ChangeLine[] = [
    sideLine(kind, "Endpoint", "이름", item.name),
    sideLine(kind, "Endpoint", "Method", item.payload.method ?? ""),
    sideLine(kind, "Endpoint", "Path", item.payload.path ?? ""),
    sideLine(kind, "Endpoint", "설명", item.payload.description ?? ""),
  ];
  lines.push(...fieldDiff("Request Body", kind === "removed" ? fields : empty, kind === "added" ? fields : empty));
  for (const response of item.payload.responses ?? []) {
    const area = `Response ${response.status ?? ""}`;
    lines.push(...fieldDiff(area, kind === "removed" ? response.fields ?? [] : empty, kind === "added" ? response.fields ?? [] : empty));
  }
  return { itemUid: item.itemUid, title: orderLabel(item), tags: [], lines, examples: [] };
}

function sideLine(kind: "added" | "removed", area: string, field: string, value: string): ChangeLine {
  const text = value || "—";
  return kind === "added"
    ? { kind, area, field, before: "—", after: text }
    : { kind, area, field, before: text, after: "—" };
}

function endpointDiff(before: SnapshotItem, after: SnapshotItem): EndpointDiff {
  if (isDevice(before.payload) || isDevice(after.payload)) {
    return deviceDiff(before, after);
  }
  if (isSocket(before.payload) || isSocket(after.payload)) {
    return socketDiff(before, after);
  }
  if (isMqtt(before.payload) || isMqtt(after.payload)) {
    return mqttDiff(before, after);
  }
  const lines: ChangeLine[] = [];
  const tags: string[] = [];
  pushText(lines, tags, "이름", "Endpoint 이름", before.name, after.name, "이름 변경");
  pushText(lines, tags, "Method", "Method", before.payload.method ?? "", after.payload.method ?? "", "Method/Path 변경");
  pushText(lines, tags, "Path", "Path", before.payload.path ?? "", after.payload.path ?? "", "Method/Path 변경");
  pushText(lines, tags, "설명", "설명", before.payload.description ?? "", after.payload.description ?? "", "설명 변경");
  pushText(lines, tags, "요약", "요약", before.summary ?? "", after.summary ?? "", "설명 변경");
  pushText(lines, tags, "상태", "상태", before.status ?? "", after.status ?? "", "상태 변경");
  const areas: Array<[string, ApiField[] | undefined, ApiField[] | undefined]> = [
    ["Headers", before.payload.headers, after.payload.headers],
    ["Path Parameters", before.payload.pathParams, after.payload.pathParams],
    ["Query Parameters", before.payload.queryParams, after.payload.queryParams],
    ["Request Body", before.payload.requestBody?.fields, after.payload.requestBody?.fields],
  ];
  for (const [area, left, right] of areas) {
    lines.push(...fieldDiff(area, left ?? [], right ?? []));
  }
  lines.push(...responseDiff(before, after));
  if (lines.some((line) => !["이름", "Method", "Path", "설명", "요약", "상태"].includes(line.area))) {
    tags.push("필드 변경");
  }
  if (lines.some((line) => line.field.endsWith(" 타입") || line.field.endsWith(" 필수"))) {
    tags.push("타입·필수 변경");
  }
  const examples = exampleChanges(before.payload, after.payload);
  if (examples.length > 0) {
    tags.push("JSON 예시 변경");
  }
  appendErrorChange(lines, tags, before, after);
  return {
    itemUid: after.itemUid,
    title: orderLabel(before) === orderLabel(after) ? orderLabel(after) : `${orderLabel(before)} → ${orderLabel(after)}`,
    tags: unique(tags),
    lines,
    examples,
  };
}

function overviewDiff(before: SnapshotDocument, after: SnapshotDocument): ChangeLine[] {
  if (isDeviceOverview(before.overview) || isDeviceOverview(after.overview)) {
    const lines: ChangeLine[] = [];
    const tags: string[] = [];
    pushText(lines, tags, "문서", "제목", before.title ?? "", after.title ?? "", "");
    pushText(lines, tags, "개요", "전송", before.overview?.transport ?? "", after.overview?.transport ?? "", "");
    pushText(lines, tags, "개요", "기본 엔디언", before.overview?.defaultEndian ?? "", after.overview?.defaultEndian ?? "", "");
    pushText(lines, tags, "개요", "프레이밍", before.overview?.framing ?? "", after.overview?.framing ?? "", "");
    return lines;
  }
  if (isSocketOverview(before.overview) || isSocketOverview(after.overview)) {
    const lines: ChangeLine[] = [];
    const tags: string[] = [];
    pushText(lines, tags, "문서", "제목", before.title ?? "", after.title ?? "", "");
    pushText(lines, tags, "개요", "연결 URL", before.overview?.url ?? "", after.overview?.url ?? "", "");
    pushText(lines, tags, "개요", "공통 인증", before.overview?.auth?.type ?? "", after.overview?.auth?.type ?? "", "");
    pushText(lines, tags, "개요", "인증 설명", before.overview?.auth?.description ?? "", after.overview?.auth?.description ?? "", "");
    pushText(lines, tags, "개요", "하트비트", before.overview?.heartbeat ?? "", after.overview?.heartbeat ?? "", "");
    pushText(lines, tags, "개요", "종료 코드", closeCodeText(before.overview?.closeCodes), closeCodeText(after.overview?.closeCodes), "");
    return lines;
  }
  if (isMqttOverview(before.overview) || isMqttOverview(after.overview)) {
    const lines: ChangeLine[] = [];
    const tags: string[] = [];
    pushText(lines, tags, "문서", "제목", before.title ?? "", after.title ?? "", "");
    pushText(lines, tags, "개요", "브로커", before.overview?.brokerUrl ?? "", after.overview?.brokerUrl ?? "", "");
    pushText(lines, tags, "개요", "프로토콜", before.overview?.protocolVersion ?? "", after.overview?.protocolVersion ?? "", "");
    pushText(lines, tags, "개요", "공통 인증", before.overview?.auth?.type ?? "", after.overview?.auth?.type ?? "", "");
    pushText(lines, tags, "개요", "인증 설명", before.overview?.auth?.description ?? "", after.overview?.auth?.description ?? "", "");
    return lines;
  }
  const lines: ChangeLine[] = [];
  const tags: string[] = [];
  pushText(lines, tags, "문서", "제목", before.title ?? "", after.title ?? "", "");
  pushText(lines, tags, "개요", "Base URL", before.overview?.baseUrl ?? "", after.overview?.baseUrl ?? "", "");
  pushText(lines, tags, "개요", "공통 인증", before.overview?.auth?.type ?? "", after.overview?.auth?.type ?? "", "");
  pushText(lines, tags, "개요", "인증 설명", before.overview?.auth?.description ?? "", after.overview?.auth?.description ?? "", "");
  lines.push(...fieldDiff("공통 헤더", before.overview?.commonHeaders ?? [], after.overview?.commonHeaders ?? []));
  return lines;
}

function fieldDiff(area: string, before: ApiField[], after: ApiField[]): ChangeLine[] {
  const left = new Map(flattenFields(before).map((field) => [field.path, field]));
  const right = new Map(flattenFields(after).map((field) => [field.path, field]));
  const lines: ChangeLine[] = [];
  for (const [path, field] of right) {
    const old = left.get(path);
    if (!old) {
      lines.push({ kind: "added", area, field: path, before: "—", after: fieldText(field) });
      continue;
    }
    if (old.type !== field.type) {
      lines.push({ kind: "changed", area, field: `${path} 타입`, before: old.type, after: field.type });
    }
    if (old.required !== field.required) {
      lines.push({ kind: "changed", area, field: `${path} 필수`, before: old.required ? "예" : "아니오", after: field.required ? "예" : "아니오" });
    }
    if (old.description !== field.description) {
      lines.push({ kind: "changed", area, field: `${path} 설명`, before: old.description || "—", after: field.description || "—" });
    }
    if (old.example !== field.example) {
      lines.push({ kind: "changed", area, field: `${path} 예시`, before: old.example || "—", after: field.example || "—" });
    }
    pushLayout(lines, area, path, "Offset", old.byteOffset, field.byteOffset);
    pushLayout(lines, area, path, "Length", old.byteLength, field.byteLength);
    pushLayout(lines, area, path, "Endian", old.endian, field.endian);
    pushLayout(lines, area, path, "Encoding", old.encoding, field.encoding);
    pushLayout(lines, area, path, "길이 방식", old.lengthMode, field.lengthMode);
    pushLayout(lines, area, path, "비트 위치", old.bitOffset, field.bitOffset);
    pushLayout(lines, area, path, "비트 길이", old.bitLength, field.bitLength);
  }
  for (const [path, field] of left) {
    if (!right.has(path)) {
      lines.push({ kind: "removed", area, field: path, before: fieldText(field), after: "—" });
    }
  }
  return lines;
}

function responseDiff(before: SnapshotItem, after: SnapshotItem): ChangeLine[] {
  const left = new Map((before.payload.responses ?? []).map((response) => [String(response.status ?? ""), response]));
  const right = new Map((after.payload.responses ?? []).map((response) => [String(response.status ?? ""), response]));
  const lines: ChangeLine[] = [];
  for (const [status, response] of right) {
    const old = left.get(status);
    const area = `Response ${status}`;
    if (!old) {
      lines.push({ kind: "added", area, field: response.name || status, before: "—", after: "추가" });
      lines.push(...fieldDiff(area, [], response.fields ?? []).map((line) => ({ ...line, kind: "added" as const })));
      continue;
    }
    if ((old.name ?? "") !== (response.name ?? "")) {
      lines.push({ kind: "changed", area, field: "이름", before: old.name || "—", after: response.name || "—" });
    }
    if ((old.description ?? "") !== (response.description ?? "")) {
      lines.push({ kind: "changed", area, field: "설명", before: old.description || "—", after: response.description || "—" });
    }
    lines.push(...fieldDiff(area, old.fields ?? [], response.fields ?? []));
  }
  for (const [status, response] of left) {
    if (!right.has(status)) {
      lines.push({ kind: "removed", area: `Response ${status}`, field: response.name || status, before: "삭제", after: "—" });
    }
  }
  return lines;
}

function exampleChanges(before: ApiPayload, after: ApiPayload): Array<{ label: string; before: string; after: string }> {
  const rows: Array<{ label: string; before: string; after: string }> = [];
  const requestBefore = jsonText(before.requestBody?.example);
  const requestAfter = jsonText(after.requestBody?.example);
  if (requestBefore !== requestAfter) {
    rows.push({ label: "Request JSON", before: requestBefore, after: requestAfter });
  }
  const statuses = new Set([
    ...(before.responses ?? []).map((response) => String(response.status ?? "")),
    ...(after.responses ?? []).map((response) => String(response.status ?? "")),
  ]);
  for (const status of statuses) {
    const left = (before.responses ?? []).find((response) => String(response.status ?? "") === status);
    const right = (after.responses ?? []).find((response) => String(response.status ?? "") === status);
    const leftText = jsonText(left?.example);
    const rightText = jsonText(right?.example);
    if (leftText !== rightText) {
      rows.push({ label: `Response ${status} JSON`, before: leftText, after: rightText });
    }
  }
  return rows;
}

function pushText(lines: ChangeLine[], tags: string[], area: string, field: string, before: string, after: string, tag: string) {
  if (before === after) {
    return;
  }
  lines.push({ kind: "changed", area, field, before: before || "—", after: after || "—" });
  if (tag) {
    tags.push(tag);
  }
}

function fieldText(field: FlatField) {
  return `${field.type}, ${field.required ? "필수" : "선택"}`;
}

function orderLabel(item: SnapshotItem) {
  if (isDevice(item.payload)) {
    return item.payload.commandId || item.name;
  }
  if (isSocket(item.payload)) {
    return item.payload.eventName || item.name;
  }
  if (isMqtt(item.payload)) {
    return item.payload.topic || item.name;
  }
  return `${item.payload.method ?? ""} ${item.payload.path ?? ""}`.trim() || item.name;
}

function pushLayout(lines: ChangeLine[], area: string, path: string, label: string, before: string, after: string) {
  if ((before || "") === (after || "")) return;
  lines.push({ kind: "changed", area, field: `${path} ${label}`, before: before || "—", after: after || "—" });
}

function isDevice(payload: ApiPayload) {
  return payload.commandId !== undefined || payload.exampleHex !== undefined;
}

function isDeviceOverview(overview: SpecOverview | undefined) {
  return Boolean(overview && ("transport" in overview || "defaultEndian" in overview));
}

function deviceDirection(direction: string | undefined) {
  if (direction === "REQUEST") return "요청";
  if (direction === "RESPONSE") return "응답";
  if (direction === "EVENT") return "이벤트";
  return direction ?? "";
}

function deviceSnapshot(item: SnapshotItem, kind: "added" | "removed"): EndpointDiff {
  const lines: ChangeLine[] = [
    sideLine(kind, "명령", "이름", item.name),
    sideLine(kind, "명령", "Command ID", item.payload.commandId ?? ""),
    sideLine(kind, "명령", "방향", deviceDirection(item.payload.direction)),
    sideLine(kind, "명령", "설명", item.payload.description ?? ""),
    sideLine(kind, "명령", "HEX", item.payload.exampleHex ?? ""),
  ];
  lines.push(...fieldDiff("필드", kind === "removed" ? item.payload.fields ?? [] : [], kind === "added" ? item.payload.fields ?? [] : []));
  return { itemUid: item.itemUid, title: orderLabel(item), tags: [], lines, examples: [] };
}

function deviceDiff(before: SnapshotItem, after: SnapshotItem): EndpointDiff {
  const lines: ChangeLine[] = [];
  const tags: string[] = [];
  pushText(lines, tags, "명령", "이름", before.name, after.name, "이름 변경");
  pushText(lines, tags, "명령", "Command ID", before.payload.commandId ?? "", after.payload.commandId ?? "", "Command ID 변경");
  pushText(lines, tags, "명령", "방향", deviceDirection(before.payload.direction), deviceDirection(after.payload.direction), "방향 변경");
  pushText(lines, tags, "명령", "설명", before.payload.description ?? "", after.payload.description ?? "", "설명 변경");
  pushText(lines, tags, "명령", "HEX", before.payload.exampleHex ?? "", after.payload.exampleHex ?? "", "HEX 예시 변경");
  lines.push(...fieldDiff("필드", before.payload.fields ?? [], after.payload.fields ?? []));
  if (lines.some((line) => line.field.endsWith(" Offset"))) tags.push("Offset 변경");
  if (lines.some((line) => line.field.endsWith(" Length"))) tags.push("Length 변경");
  if (lines.some((line) => line.field.endsWith(" Endian"))) tags.push("Endian 변경");
  if (lines.some((line) => line.field.endsWith(" Encoding"))) tags.push("Encoding 변경");
  if (lines.some((line) => line.field.endsWith(" 타입"))) tags.push("타입 변경");
  const beforeJson = jsonText(before.payload.exampleJson);
  const afterJson = jsonText(after.payload.exampleJson);
  const examples = beforeJson === afterJson ? [] : [{ label: "해석 JSON", before: beforeJson, after: afterJson }];
  appendErrorChange(lines, tags, before, after);
  return {
    itemUid: after.itemUid,
    title: orderLabel(before) === orderLabel(after) ? orderLabel(after) : `${orderLabel(before)} → ${orderLabel(after)}`,
    tags: unique(tags),
    lines,
    examples,
  };
}

function isSocket(payload: ApiPayload) {
  return payload.eventName !== undefined;
}

function isSocketOverview(overview: SpecOverview | undefined) {
  return Boolean(overview && ("heartbeat" in overview || "closeCodes" in overview));
}

function isMqtt(payload: ApiPayload) {
  return payload.topic !== undefined;
}

function isMqttOverview(overview: SpecOverview | undefined) {
  return Boolean(overview && ("brokerUrl" in overview || "protocolVersion" in overview));
}

function mqttSnapshot(item: SnapshotItem, kind: "added" | "removed"): EndpointDiff {
  const lines: ChangeLine[] = [
    sideLine(kind, "Topic", "이름", item.name),
    sideLine(kind, "Topic", "Topic", item.payload.topic ?? ""),
    sideLine(kind, "Topic", "방향", directionLabel(item.payload.direction)),
    sideLine(kind, "Topic", "QoS", String(item.payload.qos ?? "")),
    sideLine(kind, "Topic", "Retain", item.payload.retain ? "예" : "아니오"),
    sideLine(kind, "Topic", "용도", item.payload.purpose ?? ""),
  ];
  lines.push(...fieldDiff("Payload", kind === "removed" ? item.payload.payloadFields ?? [] : [], kind === "added" ? item.payload.payloadFields ?? [] : []));
  return { itemUid: item.itemUid, title: orderLabel(item), tags: [], lines, examples: [] };
}

function mqttDiff(before: SnapshotItem, after: SnapshotItem): EndpointDiff {
  const lines: ChangeLine[] = [];
  const tags: string[] = [];
  pushText(lines, tags, "Topic", "이름", before.name, after.name, "이름 변경");
  pushText(lines, tags, "Topic", "Topic", before.payload.topic ?? "", after.payload.topic ?? "", "Topic 변경");
  pushText(lines, tags, "Topic", "방향", directionLabel(before.payload.direction), directionLabel(after.payload.direction), "방향 변경");
  pushText(lines, tags, "Topic", "QoS", String(before.payload.qos ?? ""), String(after.payload.qos ?? ""), "QoS 변경");
  pushText(lines, tags, "Topic", "Retain", before.payload.retain ? "예" : "아니오", after.payload.retain ? "예" : "아니오", "Retain 변경");
  pushText(lines, tags, "Topic", "Publisher", (before.payload.publishers ?? []).join(", "), (after.payload.publishers ?? []).join(", "), "주체 변경");
  pushText(lines, tags, "Topic", "Subscriber", (before.payload.subscribers ?? []).join(", "), (after.payload.subscribers ?? []).join(", "), "주체 변경");
  pushText(lines, tags, "Topic", "용도", before.payload.purpose ?? "", after.payload.purpose ?? "", "설명 변경");
  pushText(lines, tags, "Topic", "요약", before.summary ?? "", after.summary ?? "", "설명 변경");
  lines.push(...fieldDiff("Payload", before.payload.payloadFields ?? [], after.payload.payloadFields ?? []));
  if (lines.some((line) => line.area === "Payload")) {
    tags.push("필드 변경");
  }
  if (lines.some((line) => line.field.endsWith(" 타입") || line.field.endsWith(" 필수"))) {
    tags.push("타입·필수 변경");
  }
  const beforeExample = jsonText(before.payload.example);
  const afterExample = jsonText(after.payload.example);
  const examples = beforeExample === afterExample ? [] : [{ label: "Payload JSON", before: beforeExample, after: afterExample }];
  if (examples.length > 0) {
    tags.push("JSON 예시 변경");
  }
  appendErrorChange(lines, tags, before, after);
  return {
    itemUid: after.itemUid,
    title: orderLabel(before) === orderLabel(after) ? orderLabel(after) : `${orderLabel(before)} → ${orderLabel(after)}`,
    tags: unique(tags),
    lines,
    examples,
  };
}

function socketSnapshot(item: SnapshotItem, kind: "added" | "removed"): EndpointDiff {
  const lines: ChangeLine[] = [
    sideLine(kind, "메시지", "이름", item.name),
    sideLine(kind, "메시지", "식별자", item.payload.eventName ?? ""),
    sideLine(kind, "메시지", "방향", socketDirection(item.payload.direction)),
    sideLine(kind, "메시지", "종류", item.payload.messageKind ?? ""),
    sideLine(kind, "메시지", "설명", item.payload.description ?? ""),
  ];
  lines.push(...fieldDiff("Payload", kind === "removed" ? item.payload.fields ?? [] : [], kind === "added" ? item.payload.fields ?? [] : []));
  return { itemUid: item.itemUid, title: orderLabel(item), tags: [], lines, examples: [] };
}

function socketDiff(before: SnapshotItem, after: SnapshotItem): EndpointDiff {
  const lines: ChangeLine[] = [];
  const tags: string[] = [];
  pushText(lines, tags, "메시지", "이름", before.name, after.name, "이름 변경");
  pushText(lines, tags, "메시지", "식별자", before.payload.eventName ?? "", after.payload.eventName ?? "", "식별자 변경");
  pushText(lines, tags, "메시지", "방향", socketDirection(before.payload.direction), socketDirection(after.payload.direction), "방향 변경");
  pushText(lines, tags, "메시지", "종류", before.payload.messageKind ?? "", after.payload.messageKind ?? "", "종류 변경");
  pushText(lines, tags, "메시지", "설명", before.payload.description ?? "", after.payload.description ?? "", "설명 변경");
  pushText(lines, tags, "메시지", "요약", before.summary ?? "", after.summary ?? "", "설명 변경");
  lines.push(...fieldDiff("Payload", before.payload.fields ?? [], after.payload.fields ?? []));
  if (lines.some((line) => line.area === "Payload")) {
    tags.push("필드 변경");
  }
  if (lines.some((line) => line.field.endsWith(" 타입") || line.field.endsWith(" 필수"))) {
    tags.push("타입·필수 변경");
  }
  const beforeExample = jsonText(before.payload.example);
  const afterExample = jsonText(after.payload.example);
  const examples = beforeExample === afterExample ? [] : [{ label: "Payload JSON", before: beforeExample, after: afterExample }];
  if (examples.length > 0) {
    tags.push("JSON 예시 변경");
  }
  appendErrorChange(lines, tags, before, after);
  return {
    itemUid: after.itemUid,
    title: orderLabel(before) === orderLabel(after) ? orderLabel(after) : `${orderLabel(before)} → ${orderLabel(after)}`,
    tags: unique(tags),
    lines,
    examples,
  };
}

function socketDirection(direction: string | undefined) {
  if (direction === "CLIENT_TO_SERVER") return "클라이언트 → 서버";
  if (direction === "SERVER_TO_CLIENT") return "서버 → 클라이언트";
  if (direction === "BIDIRECTIONAL") return "양방향";
  return direction ?? "";
}

function closeCodeText(codes: Array<{ code?: number; description?: string }> | undefined) {
  return (codes ?? []).map((code) => `${code.code ?? ""} ${code.description ?? ""}`.trim()).join(", ");
}

function directionLabel(direction: string | undefined) {
  if (direction === "DEVICE_TO_SERVER") return "장비 → 서버";
  if (direction === "SERVER_TO_DEVICE") return "서버 → 장비";
  if (direction === "BIDIRECTIONAL") return "양방향";
  return direction ?? "";
}

function jsonText(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
}

function errorCodeText(codes: SnapshotErrorCode[] | undefined) {
  return (codes ?? []).map((code) => [code.code, code.description, code.conditionText, code.handling].filter(Boolean).join(" · ")).join("\n");
}

function appendErrorChange(lines: ChangeLine[], tags: string[], before: SnapshotItem, after: SnapshotItem) {
  const left = errorCodeText(before.errorCodes);
  const right = errorCodeText(after.errorCodes);
  if (left === right) return;
  lines.push({ kind: "changed", area: "에러 코드", field: "연결", before: left || "—", after: right || "—" });
  tags.push("에러 코드 변경");
}

function unique(values: string[]) {
  return [...new Set(values)];
}
