import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fieldTarget } from "./restValidation";
import { blankField, type FieldNode } from "./specModel";

const types = ["string", "number", "integer", "boolean", "object", "array", "enum", "bytes"];

const examplePlaceholder: Record<string, string> = {
  string: "예: user01",
  bytes: "예: AQID",
  integer: "예: 10",
  number: "예: 3.14",
  enum: "Enum 값 중 하나",
};

type Shared = {
  readOnly: boolean;
  issues: Map<string, string>;
  focusKey: string | null;
  onFocused: () => void;
  open: Set<string>;
  toggle: (key: string, force?: boolean) => void;
  namePlaceholder: string;
  focusNew: (key: string) => void;
};

export function SchemaTable({
  fields,
  onChange,
  readOnly = false,
  issues,
  addLabel = "필드 추가",
  emptyText = "아직 필드가 없습니다.",
  namePlaceholder = "예: loginId",
}: {
  fields: FieldNode[];
  onChange?: (fields: FieldNode[]) => void;
  readOnly?: boolean;
  issues?: Map<string, string>;
  addLabel?: string;
  emptyText?: string;
  namePlaceholder?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const editable = !readOnly && Boolean(onChange);

  function toggle(key: string, force?: boolean) {
    setOpen((current) => {
      const next = new Set(current);
      const want = force ?? !next.has(key);
      if (want) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function addField() {
    const field = blankField("");
    onChange?.([...fields, field]);
    setFocusKey(field.clientKey);
  }

  const shared: Shared = {
    readOnly: !editable,
    issues: issues ?? new Map(),
    focusKey,
    onFocused: () => setFocusKey(null),
    open,
    toggle,
    namePlaceholder,
    focusNew: setFocusKey,
  };

  return (
    <div className={editable ? "schema is-edit" : "schema is-read"}>
      {fields.length > 0 ? (
        <div className="schema-head" aria-hidden="true">
          <span>필드명{editable ? <b className="req-mark">*</b> : null}</span>
          <span>타입</span>
          <span>필수</span>
          <span>설명</span>
          <span>예시</span>
          {editable ? <span /> : null}
        </div>
      ) : null}
      {fields.length === 0 ? <p className="schema-empty">{emptyText}</p> : null}
      <SchemaList fields={fields} depth={1} shared={shared} onChange={editable ? onChange : undefined} />
      {editable ? <button type="button" className="schema-add" onClick={addField}>+ {addLabel}</button> : null}
    </div>
  );
}

function SchemaList({
  fields,
  depth,
  shared,
  onChange,
}: {
  fields: FieldNode[];
  depth: number;
  shared: Shared;
  onChange?: (fields: FieldNode[]) => void;
}) {
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (!onChange || target < 0 || target >= fields.length) {
      return;
    }
    const next = fields.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  function remove(index: number) {
    const field = fields[index];
    const nested = countNested(field);
    if (nested > 0 && !window.confirm(`'${field.name || "이름 없는 필드"}'의 하위 필드 ${nested}개도 함께 삭제됩니다.`)) {
      return;
    }
    onChange?.(fields.filter((_, fieldIndex) => fieldIndex !== index));
  }

  return (
    <>
      {fields.map((field, index) => (
        <SchemaField
          key={field.clientKey}
          field={field}
          depth={depth}
          shared={shared}
          canUp={index > 0}
          canDown={index < fields.length - 1}
          onChange={onChange ? (next) => onChange(fields.map((item, itemIndex) => (itemIndex === index ? next : item))) : undefined}
          onRemove={onChange ? () => remove(index) : undefined}
          onMove={onChange ? (direction) => move(index, direction) : undefined}
        />
      ))}
    </>
  );
}

function countNested(field: FieldNode): number {
  const children = field.children.reduce((sum, child) => sum + 1 + countNested(child), 0);
  return children + (field.arrayItem && field.arrayItem.type === "object" ? countNested(field.arrayItem) : 0);
}

function SchemaField({
  field,
  depth,
  shared,
  canUp,
  canDown,
  onChange,
  onRemove,
  onMove,
  arrayItem = false,
}: {
  field: FieldNode;
  depth: number;
  shared: Shared;
  canUp: boolean;
  canDown: boolean;
  onChange?: (field: FieldNode) => void;
  onRemove?: () => void;
  onMove?: (direction: -1 | 1) => void;
  arrayItem?: boolean;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const editable = !shared.readOnly && Boolean(onChange);
  const key = field.clientKey;
  const error = (input: Parameters<typeof fieldTarget>[1]) => shared.issues.get(fieldTarget(field, input));
  const detailIssue = Boolean(error("enum") || error("format"));
  const detailOpen = editable && (shared.open.has(key) || detailIssue);
  const detailSet = field.nullable || field.format.trim() !== "" || (field.type === "enum" && field.enumText.trim() !== "");
  const messages = (["name", "type", "description", "example", "enum", "format"] as const)
    .map((input) => error(input))
    .filter((message): message is string => Boolean(message));
  const hasError = messages.length > 0;
  const blank = editable && !arrayItem && field.name.trim() === "";

  useEffect(() => {
    if (shared.focusKey === key && nameRef.current) {
      nameRef.current.focus();
      shared.onFocused();
    }
  }, [shared, key]);

  function changeType(type: string) {
    if (!onChange) {
      return;
    }
    const hasNested = field.children.length > 0 || (field.arrayItem !== null && countNested(field.arrayItem) > 0);
    if (type !== field.type && hasNested && !window.confirm("타입을 바꾸면 기존 하위 필드가 삭제됩니다.")) {
      return;
    }
    onChange({
      ...field,
      type,
      example: type === "object" || type === "array" || type === "boolean" ? "" : field.example,
      children: type === "object" ? field.children : [],
      arrayItem: type === "array" ? field.arrayItem ?? blankField("item") : null,
    });
    if (type === "enum") {
      shared.toggle(key, true);
    }
  }

  function addChild() {
    if (!onChange) {
      return;
    }
    const child = blankField("");
    onChange({ ...field, children: [...field.children, child] });
    shared.focusNew(child.clientKey);
  }

  const rowClass = ["schema-row", hasError ? "has-error" : "", blank && !hasError ? "is-draft" : ""].filter(Boolean).join(" ");
  const label = field.name.trim() || "이 필드";

  return (
    <div className="schema-field" style={{ "--depth": depth - 1 } as CSSProperties}>
      <div className={rowClass}>
        <div className="cell name">
          {depth > 1 ? <span className="elbow" aria-hidden="true" /> : null}
          {arrayItem && !error("name") ? (
            <span className="array-tag">배열 요소</span>
          ) : editable ? (
            <input
              ref={nameRef}
              aria-label="필드명"
              data-issue={fieldTarget(field, "name")}
              aria-invalid={Boolean(error("name"))}
              placeholder={depth > 1 ? "하위 필드명" : shared.namePlaceholder}
              value={field.name}
              onChange={(event) => onChange?.({ ...field, name: event.target.value })}
            />
          ) : (
            <span className="read">{field.name}</span>
          )}
          {blank && !hasError ? <span className="draft-tag">작성 중</span> : null}
        </div>
        <div className="cell">
          {editable ? (
            <select aria-label={arrayItem ? "배열 요소 타입" : "타입"} value={field.type} onChange={(event) => changeType(event.target.value)}>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          ) : (
            <span className="read type">{field.type}</span>
          )}
        </div>
        <div className="cell req">
          {editable ? (
            <label className="req-check">
              <input type="checkbox" aria-label="필수" checked={field.required} onChange={(event) => onChange?.({ ...field, required: event.target.checked })} />
              <span>{field.required ? "필수" : "선택"}</span>
            </label>
          ) : (
            <span className="read">{field.required ? "필수" : "선택"}</span>
          )}
        </div>
        <div className="cell">
          {editable ? (
            <input
              aria-label="설명"
              data-issue={fieldTarget(field, "description")}
              aria-invalid={Boolean(error("description"))}
              placeholder="설명"
              value={field.description}
              onChange={(event) => onChange?.({ ...field, description: event.target.value })}
            />
          ) : (
            <span className="read">{field.description}{readMeta(field)}</span>
          )}
        </div>
        <div className="cell mono">
          {editable ? <ExampleInput field={field} invalid={Boolean(error("example"))} onChange={(example) => onChange?.({ ...field, example })} /> : <span className="read">{field.example}</span>}
        </div>
        {editable ? (
          <div className="cell actions">
            <button type="button" className={detailSet ? "row-detail is-set" : "row-detail"} aria-expanded={detailOpen} onClick={() => shared.toggle(key)}>
              상세{detailSet ? " •" : ""} {detailOpen ? "▴" : "▾"}
            </button>
            {arrayItem ? null : <button type="button" className="row-remove" aria-label={`${label} 삭제`} onClick={onRemove}>삭제</button>}
          </div>
        ) : null}
      </div>
      {hasError ? (
        <div className="field-errors">
          {messages.map((message) => <p key={message} className="field-error">오류: {message}</p>)}
        </div>
      ) : null}
      {detailOpen ? (
        <div className="schema-extra">
          <label className="check">
            <input type="checkbox" checked={field.nullable} onChange={(event) => onChange?.({ ...field, nullable: event.target.checked })} />
            Nullable <small>null 값을 허용합니다</small>
          </label>
          <label>
            Format
            <input
              data-issue={fieldTarget(field, "format")}
              aria-invalid={Boolean(error("format"))}
              value={field.format}
              placeholder="예: date-time, email, uuid"
              onChange={(event) => onChange?.({ ...field, format: event.target.value })}
            />
          </label>
          {field.type === "enum" ? (
            <label>
              Enum 값 <b className="req-mark">*</b>
              <input
                data-issue={fieldTarget(field, "enum")}
                aria-invalid={Boolean(error("enum"))}
                value={field.enumText}
                placeholder="예: ACTIVE, INACTIVE"
                onChange={(event) => onChange?.({ ...field, enumText: event.target.value })}
              />
            </label>
          ) : (
            <p className="extra-note">Enum 값은 타입을 enum으로 바꾸면 입력할 수 있습니다.</p>
          )}
          {arrayItem ? null : (
            <div className="extra-order">
              <span>순서</span>
              <button type="button" onClick={() => onMove?.(-1)} disabled={!canUp || !onMove}>위로</button>
              <button type="button" onClick={() => onMove?.(1)} disabled={!canDown || !onMove}>아래로</button>
            </div>
          )}
        </div>
      ) : null}
      {field.type === "object" ? (
        <>
          <SchemaList fields={field.children} depth={depth + 1} shared={shared} onChange={onChange ? (children) => onChange({ ...field, children }) : undefined} />
          {editable && depth < 8 ? (
            <div className="nested-add" style={{ "--depth": depth } as CSSProperties}>
              <button type="button" onClick={addChild}>+ {field.name.trim() || "object"} 하위 필드 추가</button>
              {field.children.length === 0 ? <span>object 타입은 하위 필드로 구조를 정의합니다.</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {field.type === "array" && field.arrayItem ? (
        <>
          {editable ? (
            <p className="nested-note" style={{ "--depth": depth } as CSSProperties}>
              배열 요소의 타입을 고르세요. object를 고르면 요소의 하위 필드를 추가할 수 있습니다.
            </p>
          ) : null}
          <SchemaField
            field={field.arrayItem}
            depth={depth + 1}
            shared={shared}
            canUp={false}
            canDown={false}
            arrayItem
            onChange={onChange ? (item) => onChange({ ...field, arrayItem: item }) : undefined}
          />
        </>
      ) : null}
    </div>
  );
}

function ExampleInput({ field, invalid, onChange }: { field: FieldNode; invalid: boolean; onChange: (value: string) => void }) {
  const target = fieldTarget(field, "example");
  if (field.type === "object" || field.type === "array") {
    return <span className="example-auto">{field.type === "object" ? "하위 필드로 생성" : "배열 요소로 생성"}</span>;
  }
  if (field.type === "boolean") {
    return (
      <select aria-label="예시" data-issue={target} aria-invalid={invalid} value={field.example} onChange={(event) => onChange(event.target.value)}>
        <option value="">선택</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      aria-label="예시"
      data-issue={target}
      aria-invalid={invalid}
      placeholder={examplePlaceholder[field.type] ?? "예시"}
      value={field.example}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function readMeta(field: FieldNode) {
  const parts = [
    field.nullable ? "nullable" : "",
    field.format.trim() ? `format: ${field.format.trim()}` : "",
    field.type === "enum" && field.enumText.trim() ? `enum: ${field.enumText.trim()}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? <small className="read-meta">{parts.join(" · ")}</small> : null;
}
