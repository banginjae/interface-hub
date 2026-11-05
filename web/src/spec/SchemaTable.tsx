import { useState, type CSSProperties, type MouseEvent } from "react";
import { blankField, type FieldNode } from "./specModel";

const types = ["string", "number", "integer", "boolean", "object", "array", "enum", "bytes"];

export function SchemaTable({
  fields,
  onChange,
  readOnly = false,
}: {
  fields: FieldNode[];
  onChange?: (fields: FieldNode[]) => void;
  readOnly?: boolean;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  function change(next: FieldNode[]) {
    onChange?.(next);
  }

  function addField() {
    const field = blankField("");
    change([...fields, field]);
    setActiveKey(field.clientKey);
  }

  return (
    <div className="schema">
      <div className="schema-head">
        <span>필드</span>
        <span>타입</span>
        <span>필수</span>
        <span>설명</span>
        <span>예시</span>
      </div>
      {fields.length === 0 ? <p className="schema-empty">아직 필드가 없습니다.</p> : null}
      <SchemaList
        fields={fields}
        depth={1}
        readOnly={readOnly}
        activeKey={activeKey}
        onSelect={readOnly ? undefined : setActiveKey}
        onChange={readOnly ? undefined : change}
      />
      {readOnly ? null : <button type="button" className="btn" onClick={addField}>+ 필드</button>}
      {readOnly ? null : <p className="schema-hint">행을 선택하면 Nullable, Format, Enum, 하위 필드, 순서를 편집합니다.</p>}
    </div>
  );
}

function SchemaList({
  fields,
  depth,
  readOnly,
  activeKey,
  onSelect,
  onChange,
}: {
  fields: FieldNode[];
  depth: number;
  readOnly: boolean;
  activeKey: string | null;
  onSelect?: (key: string) => void;
  onChange?: (fields: FieldNode[]) => void;
}) {
  function update(index: number, next: FieldNode) {
    onChange?.(fields.map((field, fieldIndex) => (fieldIndex === index ? next : field)));
  }

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

  return (
    <>
      {fields.map((field, index) => (
        <SchemaField
          key={field.clientKey}
          field={field}
          depth={depth}
          readOnly={readOnly}
          active={field.clientKey === activeKey}
          activeKey={activeKey}
          canUp={index > 0}
          canDown={index < fields.length - 1}
          onSelect={onSelect}
          onChange={onChange ? (next) => update(index, next) : undefined}
          onRemove={onChange ? () => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index)) : undefined}
          onMove={onChange ? (direction) => move(index, direction) : undefined}
        />
      ))}
    </>
  );
}

function SchemaField({
  field,
  depth,
  readOnly,
  active,
  activeKey,
  canUp,
  canDown,
  onSelect,
  onChange,
  onRemove,
  onMove,
}: {
  field: FieldNode;
  depth: number;
  readOnly: boolean;
  active: boolean;
  activeKey: string | null;
  canUp: boolean;
  canDown: boolean;
  onSelect?: (key: string) => void;
  onChange?: (field: FieldNode) => void;
  onRemove?: () => void;
  onMove?: (direction: -1 | 1) => void;
}) {
  const nested = depth > 1;

  function changeType(type: string) {
    if (!onChange) {
      return;
    }
    const hasNested = field.children.length > 0 || field.arrayItem !== null;
    if (type !== field.type && hasNested && !window.confirm("타입을 바꾸면 맞지 않는 하위 필드를 지웁니다.")) {
      return;
    }
    onChange({
      ...field,
      type,
      children: type === "object" ? field.children : [],
      arrayItem: type === "array" ? field.arrayItem ?? blankField("item") : null,
    });
  }

  function select(event: MouseEvent) {
    if (readOnly || !onSelect) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, select, button, textarea, label")) {
      onSelect(field.clientKey);
      return;
    }
    onSelect(field.clientKey);
  }

  function addChild() {
    if (!onChange || !onSelect) {
      return;
    }
    const child = blankField("");
    onChange({ ...field, children: [...field.children, child] });
    onSelect(child.clientKey);
  }

  return (
    <div className={active ? "schema-field is-active" : "schema-field"} style={{ "--depth": depth - 1 } as CSSProperties}>
      <div className={readOnly ? "schema-row" : "schema-row is-selectable"} onClick={select}>
        <div className="cell name">
          {nested ? <span className="spine" /> : null}
          {nested ? <span className="elbow" /> : null}
          {active ? (
            <input aria-label="필드명" value={field.name} onChange={(event) => onChange?.({ ...field, name: event.target.value })} />
          ) : (
            <span className="read">{field.name || "이름 없음"}</span>
          )}
        </div>
        <div className="cell">
          {active ? (
            <select aria-label="타입" value={field.type} onChange={(event) => changeType(event.target.value)}>
              {types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          ) : (
            <span className="read">{field.type}</span>
          )}
        </div>
        <div className="cell">
          {active ? (
            <input aria-label="필수" type="checkbox" checked={field.required} onChange={(event) => onChange?.({ ...field, required: event.target.checked })} />
          ) : (
            <span className="read">{field.required ? "예" : ""}</span>
          )}
        </div>
        <div className="cell">
          {active ? (
            <input aria-label="설명" value={field.description} onChange={(event) => onChange?.({ ...field, description: event.target.value })} />
          ) : (
            <span className="read">{field.description}</span>
          )}
        </div>
        <div className="cell mono">
          {active ? (
            <input aria-label="예시" value={field.example} onChange={(event) => onChange?.({ ...field, example: event.target.value })} />
          ) : (
            <span className="read">{field.example}</span>
          )}
        </div>
      </div>
      {active ? (
        <div className="schema-extra">
          <label className="check">
            <input type="checkbox" checked={field.nullable} onChange={(event) => onChange?.({ ...field, nullable: event.target.checked })} />
            Nullable
          </label>
          <label>Format<input value={field.format} onChange={(event) => onChange?.({ ...field, format: event.target.value })} /></label>
          <label>Enum<input value={field.enumText} placeholder="A, B" onChange={(event) => onChange?.({ ...field, enumText: event.target.value })} /></label>
          <div className="row-actions">
            {field.type === "object" && depth < 8 ? <button type="button" onClick={addChild}>하위 필드</button> : null}
            <button type="button" onClick={() => onMove?.(-1)} disabled={!canUp || !onMove}>위</button>
            <button type="button" onClick={() => onMove?.(1)} disabled={!canDown || !onMove}>아래</button>
            <button type="button" onClick={onRemove}>삭제</button>
          </div>
        </div>
      ) : null}
      {field.type === "object" && field.children.length > 0 ? (
        <SchemaList
          fields={field.children}
          depth={depth + 1}
          readOnly={readOnly}
          activeKey={activeKey}
          onSelect={onSelect}
          onChange={onChange ? (children) => onChange({ ...field, children }) : undefined}
        />
      ) : null}
      {field.type === "array" && field.arrayItem ? <p className="array-note">배열 요소</p> : null}
      {field.type === "array" && field.arrayItem ? (
        <SchemaField
          field={field.arrayItem}
          depth={depth + 1}
          readOnly={readOnly}
          active={field.arrayItem.clientKey === activeKey}
          activeKey={activeKey}
          canUp={false}
          canDown={false}
          onSelect={onSelect}
          onChange={onChange ? (arrayItem) => onChange({ ...field, arrayItem }) : undefined}
          onRemove={onChange ? () => onChange({ ...field, arrayItem: blankField("item") }) : undefined}
        />
      ) : null}
    </div>
  );
}
