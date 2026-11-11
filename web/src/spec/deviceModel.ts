import { blankField, errorCodeIdsOf, fieldFromApi, type ExampleDraft, type FieldNode, type SpecDocument, type SpecItem } from "./specModel";

export const transports = ["TCP", "UDP", "UART", "RS485", "OTHER"];
export const deviceDirections = [
  { value: "REQUEST", label: "요청", hint: "상대 장비에 동작이나 데이터를 요청하는 패킷입니다." },
  { value: "RESPONSE", label: "응답", hint: "요청을 처리한 결과로 돌려주는 패킷입니다. 같은 Command ID의 요청과 대응 명령으로 연결할 수 있습니다." },
  { value: "EVENT", label: "이벤트", hint: "요청 없이 장비가 상태 변화를 알리는 패킷입니다." },
];

export const encodings = ["UINT8", "UINT16", "UINT32", "INT8", "INT16", "INT32", "BYTES", "ASCII", "UTF8", "BCD", "BITFIELD"];

export const commandIdExamples = ["0x01", "0x03", "0x0B", "0x10"];

export const deviceTerms = [
  { term: "Command ID", text: "패킷이 어떤 명령인지 구분하는 값입니다. 0x03처럼 16진수로 적는 경우가 많습니다." },
  { term: "Packet", text: "한 번에 주고받는 바이트 묶음입니다. 헤더, 데이터, 체크섬 등으로 구성됩니다." },
  { term: "Byte", text: "8비트(0x00~0xFF) 단위입니다. 필드 길이는 보통 바이트 수로 적습니다." },
  { term: "Offset", text: "패킷 시작에서 몇 번째 바이트부터 이 필드가 시작하는지입니다. 0부터 셉니다." },
  { term: "Length", text: "필드가 차지하는 바이트 수입니다." },
  { term: "Endian", text: "2바이트 이상 숫자를 어떤 순서로 적는지입니다." },
  { term: "Little / Big Endian", text: "Little은 낮은 자리 바이트를 먼저(0x1234 → 34 12), Big은 높은 자리 바이트를 먼저(12 34) 적습니다." },
  { term: "HEX", text: "바이트를 16진수 두 자리씩 적은 표기입니다. 예: 02 03 00 10" },
  { term: "Checksum", text: "전송 오류를 찾으려고 다른 바이트로 계산해 붙이는 값입니다. 계산 방식은 장비마다 다릅니다." },
  { term: "Fixed / Variable", text: "Fixed는 길이가 항상 같은 필드, Variable은 다른 값(예: 데이터 길이 필드)에 따라 길이가 바뀌는 필드입니다." },
  { term: "Request / Response", text: "요청 패킷과 그에 대한 응답 패킷입니다. 이 문서에서는 각각 별도 명령으로 등록하고 연결합니다." },
  { term: "Payload / ExtraData", text: "헤더 뒤에 붙는 실제 데이터 부분입니다. 길이가 바뀌면 가변(Variable)으로 적습니다." },
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
    name: "", summary: "", status: "ACTIVE", commandId: "", direction: "REQUEST",
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

export function blankByteField() {
  return { ...blankField(""), type: "bytes" };
}

export function exampleDraftOf(draft: DeviceDraft): ExampleDraft {
  return { fields: draft.fields, exampleMode: draft.exampleMode, manualText: draft.manualText };
}

export type LayoutSummary = { fixedSum: number; variable: string[]; unknown: number; complete: boolean };

export function layoutSummary(fields: FieldNode[]): LayoutSummary {
  let fixedSum = 0;
  const variable: string[] = [];
  let unknown = 0;
  for (const field of fields) {
    const mode = field.lengthMode.trim().toUpperCase();
    const length = Number(field.byteLength.trim());
    if (mode === "FIXED" && field.byteLength.trim() && Number.isInteger(length) && length > 0) {
      fixedSum += length;
    } else if (mode === "VARIABLE") {
      variable.push(field.name.trim() || "이름 없는 필드");
    } else {
      unknown += 1;
    }
  }
  return { fixedSum, variable, unknown, complete: unknown === 0 && variable.length === 0 };
}

export function fillOffsets(fields: FieldNode[]) {
  let cursor = 0;
  let filled = 0;
  const next = fields.slice();
  for (let index = 0; index < next.length; index += 1) {
    const field = next[index];
    const mode = field.lengthMode.trim().toUpperCase();
    const length = Number(field.byteLength.trim());
    if (mode === "FIXED" && field.byteLength.trim() && Number.isInteger(length) && length > 0) {
      const offset = field.byteOffset.trim();
      if (!offset) {
        next[index] = { ...field, byteOffset: String(cursor) };
        filled += 1;
        cursor += length;
      } else if (/^\d+$/.test(offset)) {
        cursor = Number(offset) + length;
      } else {
        break;
      }
      continue;
    }
    if (mode === "VARIABLE" && !field.byteOffset.trim()) {
      next[index] = { ...field, byteOffset: String(cursor) };
      filled += 1;
    }
    break;
  }
  return { fields: next, filled };
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

export function hexByteCount(hex: string) {
  const compact = hex.replace(/\s+/g, "");
  if (!compact) return 0;
  return compact.length / 2;
}

export { blankField };
