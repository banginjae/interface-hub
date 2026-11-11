import { useState, type ReactNode } from "react";
import type { Issue } from "./restValidation";

export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={error ? "rest-field has-error" : "rest-field"}>
      <span className="rest-label">{label}{required ? <b className="req-mark" aria-label="필수">*</b> : null}</span>
      {children}
      {error ? <span className="field-error">오류: {error}</span> : hint ? <span className="rest-hint">{hint}</span> : null}
    </label>
  );
}

export function IssueSummary<T extends string>({ issues, onPick }: { issues: Issue<T>[]; onPick: (issue: Issue<T>) => void }) {
  if (issues.length === 0) {
    return null;
  }
  const shown = issues.slice(0, 5);
  return (
    <div className="issue-summary" role="alert">
      <strong>저장하지 못했습니다 · 오류 {issues.length}건</strong>
      <ul>
        {shown.map((issue) => (
          <li key={issue.target + issue.message}>
            <button type="button" onClick={() => onPick(issue)}>{issue.where}: {issue.message}</button>
          </li>
        ))}
      </ul>
      {issues.length > shown.length ? <p>외 {issues.length - shown.length}건은 화면에 표시된 '오류' 위치를 확인하세요.</p> : null}
    </div>
  );
}

export function TagInput({
  values,
  onChange,
  text,
  onTextChange,
  placeholder,
  target,
  invalid,
  disabled,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  text: string;
  onTextChange: (text: string) => void;
  placeholder: string;
  target: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [duplicate, setDuplicate] = useState("");

  function add() {
    const next = text.trim();
    if (!next) {
      return;
    }
    if (values.includes(next)) {
      setDuplicate(next);
      onTextChange("");
      return;
    }
    setDuplicate("");
    onChange([...values, next]);
    onTextChange("");
  }

  return (
    <div className="tag-input">
      <div className="tag-input-row">
        <input
          data-issue={target}
          aria-invalid={invalid}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => { setDuplicate(""); onTextChange(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn" disabled={disabled || !text.trim()} onClick={add}>추가</button>
      </div>
      {duplicate ? <p className="tag-notice" role="status">이미 등록된 주체입니다. ('{duplicate}')</p> : null}
      {values.length > 0 ? (
        <ul className="tag-chips">
          {values.map((value) => (
            <li key={value}>
              <span>{value}</span>
              {disabled ? null : <button type="button" aria-label={`${value} 삭제`} onClick={() => onChange(values.filter((item) => item !== value))}>×</button>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
