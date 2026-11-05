import { blankField, type FieldNode } from "./specModel";

const types = ["string", "number", "integer", "boolean", "object", "array", "enum", "bytes"];

const encodings = ["", "UINT8", "UINT16", "UINT32", "INT8", "INT16", "INT32", "BYTES", "ASCII", "UTF8", "BCD", "BITFIELD"];

export function FieldTreeEditor({
  fields,
  onChange,
  depth = 1,
  layout = false,
}: {
  fields: FieldNode[];
  onChange: (fields: FieldNode[]) => void;
  depth?: number;
  layout?: boolean;
}) {
  function update(index: number, next: FieldNode) {
    onChange(fields.map((field, fieldIndex) => (fieldIndex === index ? next : field)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) {
      return;
    }
    const next = fields.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  return (
    <div className="field-tree">
      {fields.length === 0 ? <p className="field-empty">아직 필드가 없습니다. 아래 버튼으로 추가합니다.</p> : null}
      {fields.map((field, index) => (
        <FieldCard
          key={field.clientKey}
          field={field}
          depth={depth}
          layout={layout}
          onChange={(next) => update(index, next)}
          onRemove={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}
          onMove={(direction) => move(index, direction)}
          canUp={index > 0}
          canDown={index < fields.length - 1}
        />
      ))}
      <button type="button" onClick={() => onChange([...fields, blankField("")])}>{depth > 1 ? "+ 하위 필드 추가" : "+ 필드 추가"}</button>
    </div>
  );
}

function FieldCard({
  field,
  depth,
  layout,
  onChange,
  onRemove,
  onMove,
  canUp,
  canDown,
}: {
  field: FieldNode;
  depth: number;
  layout: boolean;
  onChange: (field: FieldNode) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
}) {
  function changeType(type: string) {
    const hasNested = field.children.length > 0 || field.arrayItem !== null;
    if (type !== field.type && hasNested && !window.confirm("타입을 바꾸면 맞지 않는 하위 필드를 지웁니다.")) {
      return;
    }
    const next = { ...field, type, children: type === "object" ? field.children : [], arrayItem: type === "array" ? field.arrayItem ?? blankField("item") : null };
    if (type !== "object") {
      next.children = [];
    }
    if (type !== "array") {
      next.arrayItem = null;
    }
    onChange(next);
  }

  return (
    <article className={`field-card is-${field.type}`} style={{ marginLeft: `${(depth - 1) * 0.8}rem` }}>
      <div className="field-toolbar">
        <strong>{field.name || "새 필드"}</strong>
        <span className={`type-badge type-${field.type}`}>{field.type}</span>
        <button type="button" onClick={() => onMove(-1)} disabled={!canUp}>위로</button>
        <button type="button" onClick={() => onMove(1)} disabled={!canDown}>아래로</button>
        <button type="button" className="danger" onClick={onRemove}>필드 삭제</button>
      </div>
      <div className="field-grid">
        <label>필드명<input value={field.name} onChange={(event) => onChange({ ...field, name: event.target.value })} /></label>
        <label>타입
          <select value={field.type} onChange={(event) => changeType(event.target.value)}>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={field.required} onChange={(event) => onChange({ ...field, required: event.target.checked })} />필수</label>
        <label className="check"><input type="checkbox" checked={field.nullable} onChange={(event) => onChange({ ...field, nullable: event.target.checked })} />Nullable</label>
      </div>
      <div className="field-grid">
        <label>설명<input value={field.description} onChange={(event) => onChange({ ...field, description: event.target.value })} /></label>
        <label>예시<input value={field.example} onChange={(event) => onChange({ ...field, example: event.target.value })} /></label>
        <label>Format<input value={field.format} onChange={(event) => onChange({ ...field, format: event.target.value })} /></label>
        {field.type === "enum" ? (
          <label>Enum 값<input value={field.enumText} placeholder="A, B" onChange={(event) => onChange({ ...field, enumText: event.target.value })} /></label>
        ) : null}
      </div>
      {layout ? (
        <div className="byte-grid">
          <label>길이 방식
            <select value={field.lengthMode} onChange={(event) => onChange({ ...field, lengthMode: event.target.value, byteLength: event.target.value === "VARIABLE" ? "" : field.byteLength })}>
              <option value="">없음</option>
              <option value="FIXED">FIXED</option>
              <option value="VARIABLE">VARIABLE</option>
            </select>
          </label>
          <label>Offset<input value={field.byteOffset} onChange={(event) => onChange({ ...field, byteOffset: event.target.value, lengthMode: field.lengthMode || "FIXED" })} /></label>
          <label>Length<input value={field.byteLength} disabled={field.lengthMode === "VARIABLE"} onChange={(event) => onChange({ ...field, byteLength: event.target.value, lengthMode: field.lengthMode || "FIXED" })} /></label>
          <label>Endian
            <select value={field.endian} onChange={(event) => onChange({ ...field, endian: event.target.value, lengthMode: field.lengthMode || (event.target.value ? "FIXED" : field.lengthMode) })}>
              <option value="">문서 기본값</option>
              <option value="BIG">BIG</option>
              <option value="LITTLE">LITTLE</option>
            </select>
          </label>
          <label>Encoding
            <select value={field.encoding} onChange={(event) => onChange({ ...field, encoding: event.target.value, lengthMode: field.lengthMode || (event.target.value ? "FIXED" : ""), bitOffset: event.target.value === "BITFIELD" ? field.bitOffset : "", bitLength: event.target.value === "BITFIELD" ? field.bitLength : "" })}>
              {encodings.map((encoding) => <option key={encoding || "none"} value={encoding}>{encoding || "없음"}</option>)}
            </select>
          </label>
          {field.encoding === "BITFIELD" ? (
            <>
              <label>비트 위치<input value={field.bitOffset} onChange={(event) => onChange({ ...field, bitOffset: event.target.value })} /></label>
              <label>비트 길이<input value={field.bitLength} onChange={(event) => onChange({ ...field, bitLength: event.target.value })} /></label>
            </>
          ) : null}
        </div>
      ) : null}
      {field.type === "object" && depth < 8 ? (
        <details className="nested" open={depth < 3}>
          <summary>하위 필드</summary>
          <FieldTreeEditor fields={field.children} depth={depth + 1} layout={layout} onChange={(children) => onChange({ ...field, children })} />
        </details>
      ) : null}
      {field.type === "array" && field.arrayItem && depth < 8 ? (
        <div className="array-item">
          <p>배열 요소</p>
          <FieldCard
            field={field.arrayItem}
            depth={depth + 1}
            layout={layout}
            onChange={(arrayItem) => onChange({ ...field, arrayItem })}
            onRemove={() => onChange({ ...field, arrayItem: blankField("item") })}
            onMove={() => undefined}
            canUp={false}
            canDown={false}
          />
        </div>
      ) : null}
    </article>
  );
}
