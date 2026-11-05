export type FieldNode = {
  clientKey: string;
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  description: string;
  example: string;
  format: string;
  enumText: string;
  children: FieldNode[];
  arrayItem: FieldNode | null;
  byteOffset: string;
  byteLength: string;
  endian: string;
  encoding: string;
  lengthMode: string;
  bitOffset: string;
  bitLength: string;
};

export type ExampleDraft = {
  fields: FieldNode[];
  exampleMode: "AUTO" | "MANUAL";
  manualText: string;
};

export type ResponseDraft = ExampleDraft & {
  clientKey: string;
  name: string;
  status: string;
  description: string;
};

export type ItemDraft = {
  name: string;
  summary: string;
  status: "ACTIVE" | "DEPRECATED";
  method: string;
  path: string;
  description: string;
  authType: string;
  authDescription: string;
  useDocumentAuth: boolean;
  headers: FieldNode[];
  pathParams: FieldNode[];
  queryParams: FieldNode[];
  requestBody: ExampleDraft;
  responses: ResponseDraft[];
  errorCodeIds: number[];
  changeReason: string;
};

export type ApiField = {
  name?: string;
  type?: string;
  required?: boolean;
  nullable?: boolean;
  description?: string;
  example?: string;
  format?: string;
  enum?: string[];
  children?: ApiField[];
  arrayItem?: ApiField | null;
  byteOffset?: number | null;
  byteLength?: number | null;
  endian?: string | null;
  encoding?: string | null;
  lengthMode?: string | null;
  bitOffset?: number | null;
  bitLength?: number | null;
};

export type ApiExample = {
  contentType?: string;
  fields?: ApiField[];
  exampleMode?: string;
  example?: unknown;
};

export type ApiPayload = {
  method?: string;
  path?: string;
  description?: string;
  auth?: { type?: string; description?: string; useDocumentAuth?: boolean };
  headers?: ApiField[];
  pathParams?: ApiField[];
  queryParams?: ApiField[];
  requestBody?: ApiExample;
  responses?: Array<ApiExample & { name?: string; status?: number; description?: string }>;
  topic?: string;
  qos?: number;
  retain?: boolean;
  direction?: string;
  publishers?: string[];
  subscribers?: string[];
  purpose?: string;
  payloadFields?: ApiField[];
  eventName?: string;
  messageKind?: string;
  fields?: ApiField[];
  exampleMode?: string;
  example?: unknown;
  commandId?: string;
  exampleHex?: string;
  exampleJson?: unknown;
  relatedItemUid?: string | null;
};

export type SpecItem = {
  itemUid: string;
  sortOrder: number;
  name: string;
  summary: string;
  status: "ACTIVE" | "DEPRECATED";
  payload: ApiPayload;
  errorCodes: LinkedErrorCode[];
};

export type LinkedErrorCode = {
  id: number;
  code: string;
  category?: string;
  description?: string;
  conditionText?: string;
  handling?: string;
};

export type SpecOverview = {
  baseUrl?: string;
  brokerUrl?: string;
  protocolVersion?: string;
  url?: string;
  heartbeat?: string;
  closeCodes?: Array<{ code?: number; description?: string }>;
  auth?: { type?: string; description?: string };
  commonHeaders?: ApiField[];
  transport?: string;
  defaultEndian?: string;
  framing?: string;
};

export type SpecDocument = {
  id: number;
  kind: string;
  title: string;
  overview: SpecOverview;
  version: number;
  updatedBy: { id: number; name: string };
  updatedAt: string;
  items: SpecItem[];
};

const fieldTypes = ["string", "number", "integer", "boolean", "object", "array", "enum", "bytes"];

let keySeq = 0;

export function newKey() {
  keySeq += 1;
  return `k${Date.now().toString(36)}${keySeq}`;
}

export function blankField(name = ""): FieldNode {
  return {
    clientKey: newKey(),
    name,
    type: "string",
    required: true,
    nullable: false,
    description: "",
    example: "",
    format: "",
    enumText: "",
    children: [],
    arrayItem: null,
    byteOffset: "",
    byteLength: "",
    endian: "",
    encoding: "",
    lengthMode: "",
    bitOffset: "",
    bitLength: "",
  };
}

export function blankExample(): ExampleDraft {
  return { fields: [], exampleMode: "AUTO", manualText: "" };
}

export function blankResponse(status = "200"): ResponseDraft {
  return { ...blankExample(), clientKey: newKey(), name: "성공", status, description: "" };
}

export function blankItem(): ItemDraft {
  return {
    name: "새 Endpoint",
    summary: "",
    status: "ACTIVE",
    method: "POST",
    path: "/resources",
    description: "",
    authType: "NONE",
    authDescription: "",
    useDocumentAuth: false,
    headers: [],
    pathParams: [],
    queryParams: [],
    requestBody: blankExample(),
    responses: [blankResponse()],
    errorCodeIds: [],
    changeReason: "",
  };
}

export function fieldFromApi(raw: ApiField | null | undefined): FieldNode {
  const field = blankField(raw?.name ?? "");
  field.type = fieldTypes.includes(raw?.type ?? "") ? (raw?.type as string) : "string";
  field.required = Boolean(raw?.required);
  field.nullable = Boolean(raw?.nullable);
  field.description = raw?.description ?? "";
  field.example = raw?.example ?? "";
  field.format = raw?.format ?? "";
  field.enumText = Array.isArray(raw?.enum) ? raw.enum.join(", ") : "";
  field.byteOffset = raw?.byteOffset == null ? "" : String(raw.byteOffset);
  field.byteLength = raw?.byteLength == null ? "" : String(raw.byteLength);
  field.endian = raw?.endian ?? "";
  field.encoding = raw?.encoding ?? "";
  field.lengthMode = raw?.lengthMode ?? "";
  field.bitOffset = raw?.bitOffset == null ? "" : String(raw.bitOffset);
  field.bitLength = raw?.bitLength == null ? "" : String(raw.bitLength);
  field.children = (raw?.children ?? []).map((child) => fieldFromApi(child));
  field.arrayItem = raw?.arrayItem ? fieldFromApi(raw.arrayItem) : null;
  if (field.type === "array" && !field.arrayItem) {
    field.arrayItem = blankField("item");
  }
  if (field.type !== "array") {
    field.arrayItem = null;
  }
  if (field.type !== "object") {
    field.children = [];
  }
  return field;
}

function exampleFromApi(raw: ApiExample | undefined): ExampleDraft {
  const mode = raw?.exampleMode === "MANUAL" ? "MANUAL" : "AUTO";
  return {
    fields: (raw?.fields ?? []).map((field) => fieldFromApi(field)),
    exampleMode: mode,
    manualText: mode === "MANUAL" && raw?.example !== undefined ? JSON.stringify(raw.example, null, 2) : "",
  };
}

export function itemFromApi(item: SpecItem): ItemDraft {
  const payload = item.payload ?? {};
  return {
    name: item.name,
    summary: item.summary ?? "",
    status: item.status === "DEPRECATED" ? "DEPRECATED" : "ACTIVE",
    method: payload.method ?? "GET",
    path: payload.path ?? "/",
    description: payload.description ?? "",
    authType: payload.auth?.type ?? "NONE",
    authDescription: payload.auth?.description ?? "",
    useDocumentAuth: Boolean(payload.auth?.useDocumentAuth),
    headers: (payload.headers ?? []).map((field) => fieldFromApi(field)),
    pathParams: (payload.pathParams ?? []).map((field) => fieldFromApi(field)),
    queryParams: (payload.queryParams ?? []).map((field) => fieldFromApi(field)),
    requestBody: exampleFromApi(payload.requestBody),
    responses: (payload.responses ?? []).map((response) => ({
      ...exampleFromApi(response),
      clientKey: newKey(),
      name: response.name ?? "",
      status: String(response.status ?? ""),
      description: response.description ?? "",
    })),
    errorCodeIds: errorCodeIdsOf(item),
    changeReason: "",
  };
}

export function errorCodeIdsOf(item: { errorCodes?: LinkedErrorCode[] | unknown[] }) {
  const rows = Array.isArray(item.errorCodes) ? item.errorCodes : [];
  return rows.flatMap((row) => {
    if (row && typeof row === "object" && "id" in row && typeof (row as LinkedErrorCode).id === "number") {
      return [(row as LinkedErrorCode).id];
    }
    return [];
  });
}

function enumValues(text: string) {
  return text.split(",").map((value) => value.trim()).filter(Boolean);
}

export function fieldToApi(field: FieldNode): Record<string, unknown> {
  return {
    name: field.name.trim(),
    type: field.type,
    required: field.required,
    nullable: field.nullable,
    description: field.description.trim(),
    example: field.example,
    format: field.format.trim(),
    enum: field.type === "enum" ? enumValues(field.enumText) : [],
    children: field.type === "object" ? field.children.map(fieldToApi) : [],
    arrayItem: field.type === "array" && field.arrayItem ? fieldToApi(field.arrayItem) : null,
    byteOffset: null,
    byteLength: null,
    endian: null,
    encoding: null,
    lengthMode: null,
    bitOffset: null,
    bitLength: null,
  };
}

export function buildExample(fields: FieldNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.name.trim()] = buildValue(field);
  }
  return result;
}

function buildValue(field: FieldNode): unknown {
  if (field.type === "object") {
    return buildExample(field.children);
  }
  if (field.type === "array") {
    if (!field.arrayItem) {
      throw new Error("배열 요소가 없습니다.");
    }
    return [buildValue(field.arrayItem)];
  }
  if (field.type === "integer") {
    if (!/^-?\d+$/.test(field.example.trim())) {
      throw new Error(`${fieldLabel(field)} 예시를 정수로 해석할 수 없습니다.`);
    }
    return Number(field.example);
  }
  if (field.type === "number") {
    if (field.example.trim() === "" || Number.isNaN(Number(field.example))) {
      throw new Error(`${fieldLabel(field)} 예시를 숫자로 해석할 수 없습니다.`);
    }
    return Number(field.example);
  }
  if (field.type === "boolean") {
    if (field.example !== "true" && field.example !== "false") {
      throw new Error(`${fieldLabel(field)} 예시는 true 또는 false여야 합니다.`);
    }
    return field.example === "true";
  }
  if (field.type === "enum") {
    const values = enumValues(field.enumText);
    if (!values.includes(field.example)) {
      throw new Error(`${fieldLabel(field)} 예시가 enum 값에 없습니다.`);
    }
    return field.example;
  }
  return field.example;
}

function fieldLabel(field: FieldNode) {
  return field.name.trim() || "이름 없는 필드";
}

export function manualError(fields: FieldNode[], text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "예시 JSON 문법이 올바르지 않습니다.";
  }
  if (typeof parsed === "string" || parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    return "예시는 JSON 객체여야 합니다.";
  }
  return matchObject(fields, parsed as Record<string, unknown>);
}

function matchObject(fields: FieldNode[], value: Record<string, unknown>): string | null {
  const known = new Map(fields.map((field) => [field.name.trim(), field]));
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      return `정의되지 않은 필드 ${key}가 있습니다.`;
    }
  }
  for (const field of fields) {
    const name = field.name.trim();
    if (!(name in value)) {
      if (field.required) {
        return `필수 필드 ${name}가 없습니다.`;
      }
      continue;
    }
    const found = matchValue(field, value[name]);
    if (found) {
      return found;
    }
  }
  return null;
}

function matchValue(field: FieldNode, value: unknown): string | null {
  if (value === null) {
    return field.nullable ? null : `${fieldLabel(field)}는 null일 수 없습니다.`;
  }
  if (field.type === "string" || field.type === "bytes" || field.type === "enum") {
    if (typeof value !== "string") {
      return `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
    }
    if (field.type === "enum" && !enumValues(field.enumText).includes(value)) {
      return `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
    }
    return null;
  }
  if (field.type === "integer") {
    return typeof value === "number" && Number.isInteger(value) ? null : `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? null : `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
  }
  if (field.type === "boolean") {
    return typeof value === "boolean" ? null : `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
  }
  if (field.type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      return `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
    }
    return matchObject(field.children, value as Record<string, unknown>);
  }
  if (field.type === "array") {
    if (!Array.isArray(value) || !field.arrayItem) {
      return `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
    }
    for (const item of value) {
      const found = matchValue(field.arrayItem, item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return `${fieldLabel(field)}의 타입이 맞지 않습니다.`;
}

function fieldError(field: FieldNode, depth: number, siblings: Set<string>): string | null {
  const name = field.name.trim();
  if (!name || name.includes(".") || /\s/.test(name)) {
    return "필드 이름은 비울 수 없고 공백이나 점을 넣을 수 없습니다.";
  }
  if (siblings.has(name)) {
    return `같은 단계에 ${name} 필드가 중복되었습니다.`;
  }
  siblings.add(name);
  if (depth > 8) {
    return "필드 중첩은 8단까지입니다.";
  }
  if (!fieldTypes.includes(field.type)) {
    return "지원하지 않는 필드 타입입니다.";
  }
  if (field.type === "object" && field.arrayItem) {
    return "object 필드에는 배열 요소를 둘 수 없습니다.";
  }
  if (field.type === "array" && field.children.length > 0) {
    return "array 필드에는 하위 필드 목록 대신 배열 요소를 사용합니다.";
  }
  if (field.type === "enum" && enumValues(field.enumText).length === 0) {
    return `${name}의 enum 값을 입력하세요.`;
  }
  if (field.type === "object") {
    return fieldsError(field.children, depth + 1);
  }
  if (field.type === "array") {
    return field.arrayItem ? fieldError(field.arrayItem, depth + 1, new Set()) : "배열 요소가 없습니다.";
  }
  return null;
}

function fieldsError(fields: FieldNode[], depth: number) {
  const names = new Set<string>();
  for (const field of fields) {
    const found = fieldError(field, depth, names);
    if (found) {
      return found;
    }
  }
  return null;
}

function exampleError(example: ExampleDraft, label: string) {
  const structure = fieldsError(example.fields, 1);
  if (structure) {
    return structure;
  }
  if (example.exampleMode === "AUTO") {
    try {
      buildExample(example.fields);
    } catch (error) {
      return error instanceof Error ? error.message : `${label} 예시를 만들지 못했습니다.`;
    }
    return null;
  }
  const manual = manualError(example.fields, example.manualText);
  return manual ? `${label}: ${manual}` : null;
}

export function itemError(draft: ItemDraft) {
  if (!draft.name.trim() || !draft.changeReason.trim()) {
    return "Endpoint 이름과 변경 사유를 입력하세요.";
  }
  if (!draft.path.startsWith("/") || /\s/.test(draft.path)) {
    return "경로는 /로 시작하고 공백이 없어야 합니다.";
  }
  const lists = [
    fieldsError(draft.headers, 1),
    fieldsError(draft.pathParams, 1),
    fieldsError(draft.queryParams, 1),
    exampleError(draft.requestBody, "Request"),
  ];
  for (const found of lists) {
    if (found) {
      return found;
    }
  }
  const statuses = new Set<string>();
  for (const response of draft.responses) {
    if (!response.name.trim() || !/^\d{3}$/.test(response.status)) {
      return "Response 이름과 상태 코드를 확인하세요.";
    }
    if (statuses.has(response.status)) {
      return "같은 상태 코드가 두 번 있습니다.";
    }
    statuses.add(response.status);
    const found = exampleError(response, `Response ${response.status}`);
    if (found) {
      return found;
    }
  }
  return null;
}

function exampleFields(example: ExampleDraft) {
  return {
    fields: example.fields.map(fieldToApi),
    exampleMode: example.exampleMode,
    example: example.exampleMode === "MANUAL" ? JSON.parse(example.manualText) : null,
  };
}

function exampleToApi(example: ExampleDraft) {
  return {
    contentType: "application/json",
    ...exampleFields(example),
  };
}

export function itemToPayload(draft: ItemDraft) {
  return {
    method: draft.method,
    path: draft.path.trim(),
    description: draft.description.trim(),
    auth: {
      type: draft.authType,
      description: draft.authDescription.trim(),
      useDocumentAuth: draft.useDocumentAuth,
    },
    headers: draft.headers.map(fieldToApi),
    pathParams: draft.pathParams.map(fieldToApi),
    queryParams: draft.queryParams.map(fieldToApi),
    requestBody: exampleToApi(draft.requestBody),
    responses: draft.responses.map((response) => ({
      name: response.name.trim(),
      status: Number(response.status),
      description: response.description.trim(),
      ...exampleFields(response),
    })),
  };
}

export function pathWarning(path: string, params: FieldNode[]) {
  const names = Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
  const known = new Set(params.map((field) => field.name.trim()));
  return names.filter((name) => !known.has(name));
}

export function previewText(example: ExampleDraft) {
  if (example.exampleMode === "MANUAL") {
    const problem = manualError(example.fields, example.manualText);
    return { text: example.manualText || "{}", problem };
  }
  try {
    return { text: JSON.stringify(buildExample(example.fields), null, 2), problem: null };
  } catch (error) {
    return { text: "", problem: error instanceof Error ? error.message : "예시를 만들지 못했습니다." };
  }
}

function layoutValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

export function draftKey(documentId: number, itemUid: string, version: number) {
  return `draft:${documentId}:${itemUid}:${version}`;
}

export type FlatField = {
  path: string;
  type: string;
  required: boolean;
  description: string;
  example: string;
  byteOffset: string;
  byteLength: string;
  endian: string;
  encoding: string;
  lengthMode: string;
  bitOffset: string;
  bitLength: string;
};

export function flattenFields(fields: ApiField[] | FieldNode[], prefix = ""): FlatField[] {
  const rows: FlatField[] = [];
  for (const field of fields) {
    const name = (field.name ?? "").trim();
    const path = prefix ? `${prefix}.${name}` : name;
    rows.push({
      path,
      type: field.type ?? "string",
      required: Boolean(field.required),
      description: field.description ?? "",
      example: field.example ?? "",
      byteOffset: layoutValue(field.byteOffset),
      byteLength: layoutValue(field.byteLength),
      endian: field.endian ?? "",
      encoding: field.encoding ?? "",
      lengthMode: field.lengthMode ?? "",
      bitOffset: layoutValue(field.bitOffset),
      bitLength: layoutValue(field.bitLength),
    });
    if (field.type === "object") {
      rows.push(...flattenFields(field.children ?? [], path));
    }
    if (field.type === "array" && field.arrayItem) {
      const item = field.arrayItem;
      if (item.type === "object") {
        rows.push(...flattenFields(item.children ?? [], `${path}[]`));
      } else {
        rows.push({
          path: `${path}[]`,
          type: item.type ?? "string",
          required: Boolean(item.required),
          description: item.description ?? "",
          example: item.example ?? "",
          byteOffset: layoutValue(item.byteOffset),
          byteLength: layoutValue(item.byteLength),
          endian: item.endian ?? "",
          encoding: item.encoding ?? "",
          lengthMode: item.lengthMode ?? "",
          bitOffset: layoutValue(item.bitOffset),
          bitLength: layoutValue(item.bitLength),
        });
      }
    }
  }
  return rows;
}
