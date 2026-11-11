import { useEffect, useRef, useState, type CSSProperties } from "react";
import { blankByteField, encodings } from "./deviceModel";
import { layoutTarget, type LayoutInput } from "./deviceValidation";
import { fieldTarget } from "./restValidation";
import { blankField, type FieldNode } from "./specModel";

const types = ["bytes", "integer", "number", "string", "boolean", "enum", "object", "array"];
const examplePlaceholder: Record<string, string> = {
  bytes: "예: AQID",
  string: "예: OPEN",
  integer: "예: 3",
  number: "예: 23.5",
  enum: "Enum 값 중 하나",
};
const detailInputs: Array<LayoutInput | "example" | "format" | "enum"> = ["offset", "lengthMode", "encoding", "bitOffset", "bitLength", "example", "format", "enum"];

type Shared = {
  issues: Map<string, string>;
  open: Set<string>;
  toggle: (key: string, force?: boolean) => void;
  focusKey: string | null;
  onFocused: () => void;
  focusNew: (key: string) => void;
  defaultEndian: string;
};

export function ByteFieldTable({
  fields,
  onChange,
  issues,
  defaultEndian,
}: {
  fields: FieldNode[];
  onChange: (fields: FieldNode[]) => void;
  issues: Map<string, string>;
  defaultEndian: string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  function toggle(key: string, force?: boolean) {
    setOpen((current) => {
      const next = new Set(current);
      if (force ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function addField() {
    const field = blankByteField();
    onChange([...fields, field]);
    setFocusKey(field.clientKey);
  }

  const shared: Shared = { issues, open, toggle, focusKey, onFocused: () => setFocusKey(null), focusNew: setFocusKey, defaultEndian };

  return (
    <div className="schema is-edit byte-table" data-issue="device:fields" tabIndex={-1}>
      {fields.length > 0 ? (
        <div className="schema-head byte-head" aria-hidden="true">
          <span>필드명<b className="req-mark">*</b></span>
          <span>타입</span>
          <span>길이(Byte)</span>
          <span>설명</span>
          <span />
        </div>
      ) : null}
      {fields.length === 0 ? <p className="schema-empty">바이너리 필드가 없습니다. 명령 이름과 Command ID만으로도 저장할 수 있습니다. 바이트 구조를 적으려면 '필드 추가'를 누르세요.</p> : null}
      <ByteList fields={fields} depth={1} shared={shared} onChange={onChange} />
      <button type="button" className="schema-add" onClick={addField}>+ 필드 추가</button>
    </div>
  );
}

function ByteList({ fields, depth, shared, onChange }: { fields: FieldNode[]; depth: number; shared: Shared; onChange: (fields: FieldNode[]) => void }) {
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = fields.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  function remove(index: number) {
    const field = fields[index];
    const nested = field.children.length + (field.arrayItem ? 1 : 0);
    if (nested > 0 && !window.confirm(`'${field.name || "이름 없는 필드"}'의 하위 필드도 함께 삭제됩니다.`)) return;
    onChange(fields.filter((_, fieldIndex) => fieldIndex !== index));
  }

  return (
    <>
      {fields.map((field, index) => (
        <ByteRow
          key={field.clientKey}
          field={field}
          depth={depth}
          shared={shared}
          canUp={index > 0}
          canDown={index < fields.length - 1}
          onChange={(next) => onChange(fields.map((item, itemIndex) => (itemIndex === index ? next : item)))}
          onRemove={() => remove(index)}
          onMove={(direction) => move(index, direction)}
        />
      ))}
    </>
  );
}

function withLayout(field: FieldNode, patch: Partial<FieldNode>): FieldNode {
  const next = { ...field, ...patch };
  const hasLayout = Boolean(next.byteOffset.trim() || next.byteLength.trim() || next.endian.trim() || next.encoding.trim());
  if (hasLayout && !next.lengthMode.trim()) {
    next.lengthMode = "FIXED";
  }
  return next;
}

function ByteRow({
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
  onChange: (field: FieldNode) => void;
  onRemove?: () => void;
  onMove?: (direction: -1 | 1) => void;
  arrayItem?: boolean;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const key = field.clientKey;
  const mode = field.lengthMode.trim().toUpperCase();
  const variable = mode === "VARIABLE";
  const bitfield = field.encoding.trim().toUpperCase() === "BITFIELD";
  const error = (input: string) => shared.issues.get(input === "name" || input === "description" || input === "example" || input === "format" || input === "enum" || input === "type"
    ? fieldTarget(field, input as "name")
    : layoutTarget(field, input as LayoutInput));
  const messages = ["name", "length", ...detailInputs, "description"].map((input) => error(input)).filter((message): message is string => Boolean(message));
  const detailIssue = detailInputs.some((input) => Boolean(error(input)));
  const detailOpen = shared.open.has(key) || detailIssue;
  const detailSet = Boolean(field.byteOffset.trim() || field.endian.trim() || field.encoding.trim() || field.nullable || field.format.trim() || field.example.trim() || !field.required);

  useEffect(() => {
    if (shared.focusKey === key && nameRef.current) {
      nameRef.current.focus();
      shared.onFocused();
    }
  }, [shared, key]);

  function changeType(type: string) {
    const nested = field.children.length > 0 || (field.arrayItem !== null && field.arrayItem.children.length > 0);
    if (type !== field.type && nested && !window.confirm("타입을 바꾸면 기존 하위 필드가 삭제됩니다.")) return;
    onChange({
      ...field,
      type,
      example: type === "object" || type === "array" || type === "boolean" ? "" : field.example,
      children: type === "object" ? field.children : [],
      arrayItem: type === "array" ? field.arrayItem ?? { ...blankField("item"), type: "bytes" } : null,
    });
    if (type === "enum") shared.toggle(key, true);
  }

  function toggleVariable() {
    if (variable) {
      onChange(withLayout({ ...field, lengthMode: "" }, {}));
      return;
    }
    onChange({ ...field, lengthMode: "VARIABLE", byteLength: "", encoding: bitfield ? "" : field.encoding, bitOffset: "", bitLength: "" });
  }

  function changeMode(value: string) {
    if (!value) {
      const has = field.byteOffset.trim() || field.byteLength.trim() || field.endian.trim() || field.encoding.trim();
      if (has && !window.confirm("길이 방식을 비우면 Offset·길이·Endian·Encoding 값을 지웁니다.")) return;
      onChange({ ...field, lengthMode: "", byteOffset: "", byteLength: "", endian: "", encoding: "", bitOffset: "", bitLength: "" });
      return;
    }
    if (value === "VARIABLE") {
      toggleVariable();
      return;
    }
    onChange({ ...field, lengthMode: "FIXED" });
  }

  const rowClass = ["schema-row", messages.length ? "has-error" : "", !arrayItem && !field.name.trim() && !messages.length ? "is-draft" : ""].filter(Boolean).join(" ");

  return (
    <div className="schema-field" style={{ "--depth": depth - 1 } as CSSProperties}>
      <div className={rowClass}>
        <div className="cell name">
          {depth > 1 ? <span className="elbow" aria-hidden="true" /> : null}
          {arrayItem && !error("name") ? <span className="array-tag">배열 요소</span> : (
            <input ref={nameRef} aria-label="필드명" data-issue={fieldTarget(field, "name")} aria-invalid={Boolean(error("name"))} placeholder={depth > 1 ? "하위 필드명" : "예: Command"} value={field.name} onChange={(event) => onChange({ ...field, name: event.target.value })} />
          )}
          {!arrayItem && !field.name.trim() && !messages.length ? <span className="draft-tag">작성 중</span> : null}
        </div>
        <div className="cell">
          <select aria-label="타입" value={field.type} onChange={(event) => changeType(event.target.value)}>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <div className="cell byte-length">
          <input
            aria-label="길이(Byte)"
            inputMode="numeric"
            data-issue={layoutTarget(field, "length")}
            aria-invalid={Boolean(error("length"))}
            placeholder={variable ? "가변" : "—"}
            disabled={variable}
            value={variable ? "" : field.byteLength}
            onChange={(event) => onChange(withLayout(field, { byteLength: event.target.value }))}
          />
          <button type="button" className={variable ? "byte-variable is-on" : "byte-variable"} aria-pressed={variable} title="길이가 다른 값에 따라 바뀌는 필드" onClick={toggleVariable}>가변</button>
        </div>
        <div className="cell">
          <input aria-label="설명" data-issue={fieldTarget(field, "description")} placeholder="설명" value={field.description} onChange={(event) => onChange({ ...field, description: event.target.value })} />
        </div>
        <div className="cell actions">
          <button type="button" className={detailSet ? "row-detail is-set" : "row-detail"} aria-expanded={detailOpen} onClick={() => shared.toggle(key)}>
            상세{detailSet ? " •" : ""} {detailOpen ? "▴" : "▾"}
          </button>
          {onRemove ? <button type="button" className="row-remove" aria-label={`${field.name || "이 필드"} 삭제`} onClick={onRemove}>삭제</button> : null}
        </div>
      </div>
      {messages.length ? <div className="field-errors">{messages.map((message) => <p key={message} className="field-error">오류: {message}</p>)}</div> : null}
      {detailOpen ? (
        <div className="schema-extra byte-extra">
          <label>
            Offset
            <input inputMode="numeric" data-issue={layoutTarget(field, "offset")} aria-invalid={Boolean(error("offset"))} placeholder="예: 0" value={field.byteOffset} onChange={(event) => onChange(withLayout(field, { byteOffset: event.target.value }))} />
          </label>
          <label>
            길이 방식
            <select data-issue={layoutTarget(field, "lengthMode")} aria-invalid={Boolean(error("lengthMode"))} value={mode} onChange={(event) => changeMode(event.target.value)}>
              <option value="">없음 (위치 미정)</option>
              <option value="FIXED">FIXED · 고정 길이</option>
              <option value="VARIABLE">VARIABLE · 가변 길이</option>
            </select>
          </label>
          <label>
            Endian
            <select value={field.endian} onChange={(event) => onChange(withLayout(field, { endian: event.target.value }))}>
              <option value="">문서 기본값 ({shared.defaultEndian})</option>
              <option value="BIG">BIG</option>
              <option value="LITTLE">LITTLE</option>
            </select>
          </label>
          <label>
            Encoding
            <select data-issue={layoutTarget(field, "encoding")} aria-invalid={Boolean(error("encoding"))} value={field.encoding} onChange={(event) => onChange(withLayout(field, { encoding: event.target.value, bitOffset: event.target.value === "BITFIELD" ? field.bitOffset : "", bitLength: event.target.value === "BITFIELD" ? field.bitLength : "" }))}>
              <option value="">없음</option>
              {encodings.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {bitfield ? (
            <>
              <label>
                비트 위치
                <input inputMode="numeric" data-issue={layoutTarget(field, "bitOffset")} aria-invalid={Boolean(error("bitOffset"))} placeholder="0" value={field.bitOffset} onChange={(event) => onChange({ ...field, bitOffset: event.target.value })} />
              </label>
              <label>
                비트 길이
                <input inputMode="numeric" data-issue={layoutTarget(field, "bitLength")} aria-invalid={Boolean(error("bitLength"))} placeholder="1" value={field.bitLength} onChange={(event) => onChange({ ...field, bitLength: event.target.value })} />
              </label>
            </>
          ) : null}
          <label>
            예시값
            {field.type === "boolean" ? (
              <select data-issue={fieldTarget(field, "example")} aria-invalid={Boolean(error("example"))} value={field.example} onChange={(event) => onChange({ ...field, example: event.target.value })}>
                <option value="">선택</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : field.type === "object" || field.type === "array" ? (
              <input disabled placeholder={field.type === "object" ? "하위 필드로 생성" : "배열 요소로 생성"} />
            ) : (
              <input data-issue={fieldTarget(field, "example")} aria-invalid={Boolean(error("example"))} placeholder={examplePlaceholder[field.type] ?? "예시"} value={field.example} onChange={(event) => onChange({ ...field, example: event.target.value })} />
            )}
          </label>
          <label>
            Format
            <input data-issue={fieldTarget(field, "format")} aria-invalid={Boolean(error("format"))} placeholder="예: hex, date-time" value={field.format} onChange={(event) => onChange({ ...field, format: event.target.value })} />
          </label>
          {field.type === "enum" ? (
            <label>
              Enum 값 <b className="req-mark">*</b>
              <input data-issue={fieldTarget(field, "enum")} aria-invalid={Boolean(error("enum"))} placeholder="예: OPEN, CLOSE" value={field.enumText} onChange={(event) => onChange({ ...field, enumText: event.target.value })} />
            </label>
          ) : null}
          <div className="byte-checks">
            <label className="check"><input type="checkbox" checked={field.required} onChange={(event) => onChange({ ...field, required: event.target.checked })} />필수</label>
            <label className="check"><input type="checkbox" checked={field.nullable} onChange={(event) => onChange({ ...field, nullable: event.target.checked })} />Nullable</label>
          </div>
          {onMove ? (
            <div className="extra-order">
              <span>순서</span>
              <button type="button" onClick={() => onMove(-1)} disabled={!canUp}>위로</button>
              <button type="button" onClick={() => onMove(1)} disabled={!canDown}>아래로</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {field.type === "object" ? (
        <>
          <ByteList fields={field.children} depth={depth + 1} shared={shared} onChange={(children) => onChange({ ...field, children })} />
          {depth < 8 ? (
            <div className="nested-add" style={{ "--depth": depth } as CSSProperties}>
              <button type="button" onClick={() => { const child = blankByteField(); onChange({ ...field, children: [...field.children, child] }); shared.focusNew(child.clientKey); }}>+ {field.name.trim() || "object"} 하위 필드 추가</button>
            </div>
          ) : null}
        </>
      ) : null}
      {field.type === "array" && field.arrayItem ? (
        <ByteRow field={field.arrayItem} depth={depth + 1} shared={shared} canUp={false} canDown={false} arrayItem onChange={(item) => onChange({ ...field, arrayItem: item })} />
      ) : null}
    </div>
  );
}

export function ByteFieldView({ fields, defaultEndian }: { fields: FieldNode[]; defaultEndian: string }) {
  const rows: Array<{ key: string; depth: number; field: FieldNode; label: string }> = [];
  const walk = (nodes: FieldNode[], depth: number) => {
    for (const field of nodes) {
      rows.push({ key: field.clientKey, depth, field, label: field.name });
      if (field.type === "object") walk(field.children, depth + 1);
      if (field.type === "array" && field.arrayItem) {
        rows.push({ key: field.arrayItem.clientKey, depth: depth + 1, field: field.arrayItem, label: "배열 요소" });
        if (field.arrayItem.type === "object") walk(field.arrayItem.children, depth + 2);
      }
    }
  };
  walk(fields, 0);
  if (rows.length === 0) {
    return <p className="rest-card-note">정의된 바이너리 필드가 없습니다.</p>;
  }
  return (
    <div className="byte-view-wrap">
      <table className="byte-view">
        <thead>
          <tr><th>#</th><th>필드</th><th>타입</th><th>Offset</th><th>길이</th><th>Endian</th><th>Encoding</th><th>필수</th><th>설명</th><th>예시</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const field = row.field;
            const mode = field.lengthMode.trim().toUpperCase();
            const encoding = field.encoding === "BITFIELD" && field.bitOffset && field.bitLength ? `BITFIELD (bit ${field.bitOffset}, ${field.bitLength}비트)` : field.encoding || "—";
            return (
              <tr key={row.key}>
                <td className="num">{index + 1}</td>
                <td><span className="byte-name" style={{ paddingLeft: `${row.depth * 16}px` }}>{row.label}</span></td>
                <td><code>{field.type}</code></td>
                <td className="num">{field.byteOffset.trim() || "—"}</td>
                <td className="num">{mode === "VARIABLE" ? "가변" : field.byteLength.trim() || "—"}</td>
                <td>{mode ? field.endian || `기본(${defaultEndian})` : "—"}</td>
                <td>{encoding}</td>
                <td>{field.required ? "필수" : "선택"}</td>
                <td>{field.description || ""}</td>
                <td className="mono">{field.example}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
