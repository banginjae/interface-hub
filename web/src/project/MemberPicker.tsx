import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { apiRequest } from "../api";

export type MemberCandidate = { userId: number; employeeNo: string; name: string };

export function MemberPicker({
  projectId,
  token,
  value,
  onChange,
}: {
  projectId: number;
  token: string;
  value: MemberCandidate | null;
  onChange: (candidate: MemberCandidate | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      apiRequest<{ candidates: MemberCandidate[] }>(`/api/projects/${projectId}/member-candidates?q=${encodeURIComponent(text)}`, { token })
        .then((result) => {
          if (!cancel) {
            setResults(result.candidates ?? []);
            setFailed(false);
            setCursor(0);
          }
        })
        .catch(() => {
          if (!cancel) {
            setResults([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (!cancel) setLoading(false);
        });
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [query, projectId, token]);

  function choose(candidate: MemberCandidate) {
    onChange(candidate);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[cursor]) choose(results[cursor]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="member-chosen">
        <span><strong>{value.name}</strong><small>{value.employeeNo}</small></span>
        <button type="button" onClick={() => onChange(null)}>다시 선택</button>
      </div>
    );
  }

  const text = query.trim();
  return (
    <div className="member-picker">
      <input
        type="search"
        role="combobox"
        aria-expanded={open && text !== ""}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="이름 또는 사번으로 검색"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && text ? (
        <ul className="member-results" id={listId} role="listbox">
          {loading ? <li className="member-empty">검색 중입니다.</li> : null}
          {!loading && failed ? <li className="member-empty">사용자를 검색하지 못했습니다. 잠시 후 다시 시도해 주세요.</li> : null}
          {!loading && !failed && results.length === 0 ? <li className="member-empty">'{text}'와 일치하는 사용자가 없습니다. 이미 멤버이거나 비활성 계정은 표시되지 않습니다.</li> : null}
          {!loading && results.map((candidate, index) => (
            <li key={candidate.userId} role="option" aria-selected={index === cursor}>
              <button type="button" className={index === cursor ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(candidate)}>
                <span>{candidate.name}</span>
                <small>{candidate.employeeNo}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
