import { deviceDirections, exampleDraftOf, overlappingFields, transports, type DeviceDraft, type DeviceOverviewDraft } from "./deviceModel";
import { checkExample, pushIssue, type Issue, type IssueScope } from "./restValidation";
import type { FieldNode } from "./specModel";

export type DeviceSection = "basic" | "fields" | "extra";
export type DeviceIssue = Issue<DeviceSection>;

const basic: IssueScope<DeviceSection> = { tab: "basic", trail: "기본 정보" };
const fieldsScope: IssueScope<DeviceSection> = { tab: "fields", trail: "바이너리 필드" };
const extra: IssueScope<DeviceSection> = { tab: "extra", trail: "추가 설정" };
const uidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type LayoutInput = "length" | "offset" | "lengthMode" | "bitOffset" | "bitLength" | "encoding";

export function layoutTarget(field: FieldNode, input: LayoutInput) {
  return `field:${field.clientKey}:${input}`;
}

function intOf(text: string) {
  const value = text.trim();
  if (!value) return null;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

function checkLayout(field: FieldNode, where: string, out: DeviceIssue[]) {
  const mode = field.lengthMode.trim().toUpperCase();
  const offset = intOf(field.byteOffset);
  const length = intOf(field.byteLength);
  const encoding = field.encoding.trim().toUpperCase();
  const bitOffset = intOf(field.bitOffset);
  const bitLength = intOf(field.bitLength);
  const push = (input: LayoutInput, message: string) => pushIssue(out, fieldsScope, layoutTarget(field, input), where, message, input !== "length");

  if (Number.isNaN(offset)) push("offset", "Offset은 0 이상의 정수로 입력해 주세요.");
  if (Number.isNaN(length)) push("length", "길이(Byte)는 1 이상의 정수로 입력해 주세요.");
  if (Number.isNaN(bitOffset)) push("bitOffset", "비트 위치는 0 이상의 정수로 입력해 주세요.");
  if (Number.isNaN(bitLength)) push("bitLength", "비트 길이는 1 이상의 정수로 입력해 주세요.");
  if (Number.isNaN(offset) || Number.isNaN(length)) return;

  if (!mode) {
    if (offset !== null || length !== null || field.endian.trim() || encoding) {
      push("lengthMode", "Offset·길이·Endian·Encoding을 쓰려면 길이 방식(FIXED 또는 VARIABLE)을 골라 주세요.");
    }
    return;
  }
  if (mode !== "FIXED" && mode !== "VARIABLE") {
    push("lengthMode", "길이 방식은 FIXED 또는 VARIABLE만 쓸 수 있습니다.");
    return;
  }
  if (offset !== null && offset < 0) push("offset", "Offset은 0 이상이어야 합니다.");
  if (mode === "VARIABLE") {
    if (length !== null) push("length", "가변 길이 필드에는 길이(Byte)를 적지 않습니다. 길이를 알면 '가변'을 해제해 주세요.");
    if (encoding === "BITFIELD") push("encoding", "BITFIELD는 고정 길이(FIXED) 필드에서만 쓸 수 있습니다.");
    return;
  }
  if (length !== null && length < 1) push("length", "길이(Byte)는 1 이상이어야 합니다.");
  if (length !== null && offset === null) {
    push("offset", "길이를 저장하려면 시작 위치(Offset)도 필요합니다. 'Offset 자동 계산'을 누르거나 상세에서 입력해 주세요.");
  }
  if (offset !== null && length === null) {
    push("length", "Offset을 입력했다면 길이(Byte)도 필요합니다.");
  }
  if (encoding === "BITFIELD") {
    if (offset === null || length === null) {
      push("encoding", "BITFIELD는 Offset과 길이가 모두 필요합니다.");
    }
    if (bitOffset === null) push("bitOffset", "BITFIELD에는 비트 위치가 필요합니다.");
    if (bitLength === null) push("bitLength", "BITFIELD에는 비트 길이가 필요합니다.");
    if (bitOffset !== null && !Number.isNaN(bitOffset) && bitOffset < 0) push("bitOffset", "비트 위치는 0 이상이어야 합니다.");
    if (bitLength !== null && !Number.isNaN(bitLength) && bitLength < 1) push("bitLength", "비트 길이는 1 이상이어야 합니다.");
    if (length !== null && bitOffset !== null && bitLength !== null && !Number.isNaN(bitOffset) && !Number.isNaN(bitLength) && bitOffset + bitLength > length * 8) {
      push("bitLength", `비트 위치와 길이의 합이 필드 크기(${length * 8}비트)를 넘습니다.`);
    }
  }
}

function walkLayout(fields: FieldNode[], trail: string, out: DeviceIssue[], childLabel = "필드") {
  fields.forEach((field, index) => {
    const name = field.name.trim();
    const where = `${trail} > ${index + 1}번째 ${childLabel}${name ? `(${name})` : ""}`;
    checkLayout(field, where, out);
    if (field.type === "object") walkLayout(field.children, where, out, "하위 필드");
    if (field.type === "array" && field.arrayItem) {
      checkLayout(field.arrayItem, `${where} > 배열 요소`, out);
      if (field.arrayItem.type === "object") walkLayout(field.arrayItem.children, `${where} > 배열 요소`, out, "하위 필드");
    }
  });
}

export function hexProblem(value: string) {
  const text = value.trim();
  if (!text) return null;
  if (/[\r\n]/.test(text)) return "HEX 예시는 줄바꿈 없이 공백으로 구분해 한 줄로 입력해 주세요.";
  if (!/^[0-9a-fA-F \t]+$/.test(text)) return "HEX 예시에는 0-9, A-F와 공백만 쓸 수 있습니다. 예: 02 03 00 10";
  const digits = text.replace(/[ \t]/g, "");
  if (digits.length % 2 !== 0) return "HEX는 두 자리씩 한 바이트입니다. 자리 수가 홀수입니다.";
  if (digits.length > 8000) return "HEX 예시는 4000바이트 이하로 입력해 주세요.";
  return null;
}

export function validateCommand(draft: DeviceDraft, itemUid: string | null): DeviceIssue[] {
  const out: DeviceIssue[] = [];
  const commandId = draft.commandId.trim();
  if (!commandId) {
    pushIssue(out, basic, "device:commandId", "기본 정보 > Command ID", "Command ID를 입력해 주세요. 예: 0x03");
  } else if (commandId.length > 100) {
    pushIssue(out, basic, "device:commandId", "기본 정보 > Command ID", "Command ID는 100자 이하로 입력해 주세요.");
  } else if (/[\r\n\t]/.test(commandId)) {
    pushIssue(out, basic, "device:commandId", "기본 정보 > Command ID", "Command ID에는 탭이나 줄바꿈을 넣을 수 없습니다.");
  }
  const name = draft.name.trim();
  if (!name) {
    pushIssue(out, basic, "device:name", "기본 정보 > 명령 이름", "명령 이름을 입력해 주세요. 예: 문열기");
  } else if (name.length > 300) {
    pushIssue(out, basic, "device:name", "기본 정보 > 명령 이름", "명령 이름은 300자 이하로 입력해 주세요.");
  }
  if (!deviceDirections.some((item) => item.value === draft.direction)) {
    pushIssue(out, basic, "device:direction", "기본 정보 > 방향", "방향을 선택해 주세요.");
  }
  if (draft.summary.trim().length > 500) {
    pushIssue(out, basic, "device:summary", "기본 정보 > 요약", "요약은 500자 이하로 입력해 주세요.");
  }
  if (draft.description.length > 2000) {
    pushIssue(out, basic, "device:description", "기본 정보 > 상세 설명", "상세 설명은 2000자 이하로 입력해 주세요.");
  }

  checkExample(exampleDraftOf(draft), fieldsScope, "device:manual", out);
  walkLayout(draft.fields, "바이너리 필드", out);
  const overlap = overlappingFields(draft.fields);
  if (overlap.length > 0) {
    pushIssue(out, fieldsScope, "device:fields", "바이너리 필드 > 고정 구간", `FIXED 구간이 겹칩니다: ${overlap.join(", ")}. Offset과 길이를 확인해 주세요.`);
  }

  const hex = hexProblem(draft.exampleHex);
  if (hex) {
    pushIssue(out, extra, "device:hex", "추가 설정 > HEX 예시", hex);
  }
  const related = draft.relatedItemUid.trim();
  if (related && (!uidPattern.test(related) || related === itemUid)) {
    pushIssue(out, extra, "device:related", "추가 설정 > 대응 명령", related === itemUid ? "자기 자신은 대응 명령으로 연결할 수 없습니다." : "대응 명령을 목록에서 다시 선택해 주세요.");
  }
  return out;
}

export function sameCommandIds<T extends { itemUid: string; payload: { commandId?: string; direction?: string } }>(items: T[], commandId: string, self: string | null) {
  const id = commandId.trim();
  if (!id) return [];
  return items.filter((item) => item.itemUid !== self && (item.payload.commandId ?? "").trim() === id);
}

export function validateDeviceOverview(overview: DeviceOverviewDraft): DeviceIssue[] {
  const out: DeviceIssue[] = [];
  const scope: IssueScope<DeviceSection> = { tab: null, trail: "문서 설정" };
  const title = overview.title.trim();
  if (!title) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목을 입력해 주세요.");
  } else if (title.length > 200) {
    pushIssue(out, scope, "doc:title", "문서 설정 > 문서 제목", "문서 제목은 200자 이하로 입력해 주세요.");
  }
  if (!transports.includes(overview.transport)) {
    pushIssue(out, scope, "doc:transport", "문서 설정 > 전송 방식", "전송 방식을 선택해 주세요.");
  }
  if (overview.defaultEndian !== "BIG" && overview.defaultEndian !== "LITTLE") {
    pushIssue(out, scope, "doc:defaultEndian", "문서 설정 > 기본 Endian", "기본 Endian을 선택해 주세요.");
  }
  if (overview.framing.length > 2000) {
    pushIssue(out, scope, "doc:framing", "문서 설정 > 공통 패킷 구조 설명", "2000자 이하로 입력해 주세요.");
  }
  return out;
}
