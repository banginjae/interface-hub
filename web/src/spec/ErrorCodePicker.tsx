import { useEffect, useState } from "react";
import { apiRequest } from "../api";
import type { LinkedErrorCode } from "./specModel";

type CatalogCode = LinkedErrorCode & { category: string; description: string };

export function ErrorCodePicker({
  projectId,
  token,
  selected,
  onChange,
}: {
  projectId: string;
  token: string;
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [codes, setCodes] = useState<CatalogCode[]>([]);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancel = false;
    apiRequest<{ errorCodes: CatalogCode[] }>(`/api/projects/${projectId}/error-codes`, { token })
      .then((result) => {
        if (!cancel) setCodes(result.errorCodes ?? []);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => {
      cancel = true;
    };
  }, [projectId, token]);

  const needle = query.trim().toLowerCase();
  const visible = codes.filter((code) => {
    if (!needle) return true;
    return [code.code, code.category, code.description, code.conditionText, code.handling].join(" ").toLowerCase().includes(needle);
  });
  const missing = selected.filter((id) => !codes.some((code) => code.id === id));

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }

  return (
    <section className="work-section">
      <h3>관련 에러 코드</h3>
      <label>
        검색
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="코드, 분류, 설명" />
      </label>
      {failed ? <p className="section-empty">오류 코드 목록을 불러오지 못했습니다.</p> : null}
      {!failed && visible.length === 0 && missing.length === 0 ? <p className="section-empty">선택할 오류 코드가 없습니다.</p> : null}
      <div className="tag-list">
        {visible.map((code) => (
          <label className="check" key={code.id}>
            <input type="checkbox" checked={selected.includes(code.id)} onChange={() => toggle(code.id)} />
            <code>{code.code}</code> {code.category} · {code.description}
          </label>
        ))}
        {missing.map((id) => (
          <label className="check" key={id}>
            <input type="checkbox" checked onChange={() => toggle(id)} />
            저장된 코드 #{id}
          </label>
        ))}
      </div>
    </section>
  );
}

export function LinkedErrorCodes({ codes }: { codes: LinkedErrorCode[] | undefined }) {
  const rows = codes ?? [];
  return (
    <section>
      <h3>에러 코드</h3>
      {rows.length === 0 ? <p>없습니다.</p> : (
        <table>
          <thead>
            <tr><th>코드</th><th>설명</th><th>발생 조건</th><th>처리</th></tr>
          </thead>
          <tbody>
            {rows.map((code) => (
              <tr key={code.id}>
                <td><code>{code.code}</code></td>
                <td>{code.description || ""}</td>
                <td>{code.conditionText || ""}</td>
                <td>{code.handling || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
