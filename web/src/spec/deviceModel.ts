import { blankField, buildExample, errorCodeIdsOf, fieldFromApi, type FieldNode, type SpecDocument, type SpecItem } from "./specModel";

export const transports = ["TCP", "UDP", "UART", "RS485", "OTHER"];
export const deviceDirections = [
  { value: "REQUEST", label: "요청" },
  { value: "RESPONSE", label: "응답" },
  { value: "EVENT", label: "이벤트" },
];

export type DeviceOverviewDraft = {
  title: string;
  transport: string;
  defaultEndian: string;
  framing: string;
  changeReason: string;
};

export type DeviceDraft = {
  name: string;
  summary: string;
  status: "ACTIVE" | "DEPRECATED";
  commandId: string;
  direction: string;
  description: string;
  fields: FieldNode[];
  exampleHex: string;
  exampleMode: "AUTO" | "MANUAL";
  manualText: string;
  relatedItemUid: string;
  errorCodeIds: number[];
  changeReason: string;
};

export function blankDevice(): DeviceDraft {
  return {
    name: "새 명령", summary: "", status: "ACTIVE", commandId: "", direction: "REQUEST",
    description: "", fields: [], exampleHex: "", exampleMode: "AUTO", manualText: "",
    relatedItemUid: "", errorCodeIds: [], changeReason: "",
  };
}

export function directionText(direction: string) {
  return deviceDirections.find((item) => item.value === direction)?.label ?? direction;
}

export function deviceFromApi(item: SpecItem): DeviceDraft {
  const payload = item.payload;
  return {
    name: item.name,
    summary: item.summary,
    status: item.status,
    commandId: payload.commandId ?? "",
    direction: payload.direction || "REQUEST",
    description: payload.description ?? "",
    fields: (payload.fields ?? []).map((field) => fieldFromApi(field)),
    exampleHex: payload.exampleHex ?? "",
    exampleMode: payload.exampleMode === "MANUAL" ? "MANUAL" : "AUTO",
    manualText: payload.exampleJson ? JSON.stringify(payload.exampleJson, null, 2) : "",
    relatedItemUid: payload.relatedItemUid ?? "",
    errorCodeIds: errorCodeIdsOf(item),
    changeReason: "",
  };
}

export function overviewFromDevice(document: SpecDocument): DeviceOverviewDraft {
  return {
    title: document.title,
    transport: document.overview.transport || "TCP",
    defaultEndian: document.overview.defaultEndian || "BIG",
    framing: document.overview.framing ?? "",
    changeReason: "",
  };
}

export function deviceToPayload(draft: DeviceDraft) {
  let example: unknown = null;
  if (draft.exampleMode === "MANUAL") {
    example = JSON.parse(draft.manualText);
  }
  return {
    commandId: draft.commandId.trim(),
    direction: draft.direction,
    description: draft.description.trim(),
    fields: draft.fields.map(fieldToDevice),
    exampleHex: draft.exampleHex.trim(),
    exampleMode: draft.exampleMode,
    exampleJson: example,
    relatedItemUid: draft.relatedItemUid || null,
  };
}

export function deviceError(draft: DeviceDraft) {
  if (!draft.name.trim() || !draft.commandId.trim() || !draft.changeReason.trim()) {
    return "명령 이름, Command ID, 변경 사유를 입력하세요.";
  }
  const overlap = overlappingFields(draft.fields);
  if (overlap.length > 0) {
    return `FIXED 구간이 겹칩니다: ${overlap.join(", ")}`;
  }
  if (draft.exampleMode === "AUTO") {
    try {
      buildExample(draft.fields);
    } catch (error) {
      return error instanceof Error ? error.message : "예시를 해석할 수 없습니다.";
    }
  } else {
    try {
      const parsed = JSON.parse(draft.manualText);
      if (typeof parsed === "string" || parsed === null || Array.isArray(parsed)) {
        return "해석 JSON은 객체여야 합니다.";
      }
    } catch {
      return "해석 JSON 형식이 올바르지 않습니다.";
    }
  }
  try {
    deviceToPayload(draft);
  } catch (error) {
    return error instanceof Error ? error.message : "명령을 해석할 수 없습니다.";
  }
  return "";
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error("Offset과 Length는 정수여야 합니다.");
  }
  return Number(trimmed);
}

function fieldToDevice(field: FieldNode): Record<string, unknown> {
  const mode = field.lengthMode.trim();
  return {
    name: field.name.trim(),
    type: field.type,
    required: field.required,
    nullable: field.nullable,
    description: field.description.trim(),
    example: field.example,
    format: field.format.trim(),
    enum: field.type === "enum" ? field.enumText.split(",").map((value) => value.trim()).filter(Boolean) : [],
    children: field.type === "object" ? field.children.map(fieldToDevice) : [],
    arrayItem: field.type === "array" && field.arrayItem ? fieldToDevice(field.arrayItem) : null,
    byteOffset: mode ? optionalNumber(field.byteOffset) : null,
    byteLength: mode === "FIXED" ? optionalNumber(field.byteLength) : null,
    endian: mode && field.endian ? field.endian : null,
    encoding: mode && field.encoding ? field.encoding : null,
    lengthMode: mode || null,
    bitOffset: mode && field.encoding === "BITFIELD" ? optionalNumber(field.bitOffset) : null,
    bitLength: mode && field.encoding === "BITFIELD" ? optionalNumber(field.bitLength) : null,
  };
}

export function overlappingFields(fields: FieldNode[]) {
  const ranges: Array<{ name: string; start: number; end: number }> = [];
  const walk = (nodes: FieldNode[], prefix: string) => {
    for (const field of nodes) {
      const path = prefix ? `${prefix}.${field.name.trim()}` : field.name.trim();
      if (field.lengthMode === "FIXED" && field.byteOffset.trim() && field.byteLength.trim()) {
        const start = Number(field.byteOffset);
        const length = Number(field.byteLength);
        if (Number.isInteger(start) && Number.isInteger(length) && length > 0 && start >= 0) {
          ranges.push({ name: path || "필드", start, end: start + length });
        }
      }
      if (field.type === "object") walk(field.children, path);
      if (field.type === "array" && field.arrayItem) walk([field.arrayItem], `${path}[]`);
    }
  };
  walk(fields, "");
  const names = new Set<string>();
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (ranges[left].start < ranges[right].end && ranges[right].start < ranges[left].end) {
        names.add(ranges[left].name);
        names.add(ranges[right].name);
      }
    }
  }
  return [...names];
}

export function fixedByteSum(fields: FieldNode[]) {
  let sum = 0;
  const walk = (nodes: FieldNode[]) => {
    for (const field of nodes) {
      if (field.lengthMode === "FIXED" && field.byteLength.trim() && Number(field.byteLength) > 0) {
        sum += Number(field.byteLength);
      }
      if (field.type === "object") walk(field.children);
      if (field.type === "array" && field.arrayItem) walk([field.arrayItem]);
    }
  };
  walk(fields);
  return sum;
}

export function hexByteCount(hex: string) {
  const compact = hex.replace(/\s+/g, "");
  if (!compact) return 0;
  return compact.length / 2;
}

export function layoutRows(fields: FieldNode[]) {
  const rows: Array<{ path: string; offset: string; length: string; type: string; endian: string; encoding: string; range: string }> = [];
  const walk = (nodes: FieldNode[], prefix: string) => {
    for (const field of nodes) {
      const path = prefix ? `${prefix}.${field.name.trim()}` : field.name.trim();
      const encoding = field.encoding === "BITFIELD" && field.bitOffset && field.bitLength
        ? `BITFIELD bit ${field.bitOffset} len ${field.bitLength}`
        : field.encoding || "—";
      const offset = field.byteOffset.trim();
      const length = field.byteLength.trim();
      let range = "위치 없음";
      if (offset && length && Number(length) > 0) {
        const start = Number(offset);
        range = `${start}–${start + Number(length) - 1}`;
      } else if (field.lengthMode === "VARIABLE") {
        range = offset ? `${offset}부터 가변` : "가변";
      }
      if (field.lengthMode || offset || length) {
        rows.push({
          path: path || "필드",
          offset: offset || "—",
          length: field.lengthMode === "VARIABLE" ? "가변" : length || "—",
          type: field.type,
          endian: field.endian || "기본값",
          encoding,
          range,
        });
      }
      if (field.type === "object") walk(field.children, path);
      if (field.type === "array" && field.arrayItem) walk([field.arrayItem], `${path}[]`);
    }
  };
  walk(fields, "");
  return rows.sort((left, right) => {
    const leftOffset = Number(left.offset);
    const rightOffset = Number(right.offset);
    if (Number.isNaN(leftOffset)) return 1;
    if (Number.isNaN(rightOffset)) return -1;
    return leftOffset - rightOffset;
  });
}

export { blankField };
