import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import type { ProjectDetail } from "../projectTypes";
import { usePageChrome } from "../Shell";

type Person = { id: number; name: string };

type Usage = { kind: string; title: string; itemUid: string; itemName: string };

type ErrorCodeRow = {
  id: number;
  code: string;
  category: string;
  description: string;
  conditionText: string;
  handling: string;
  version: number;
  referenceCount: number;
  usages: Usage[];
  createdBy: Person;
  updatedBy: Person;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  code: string;
  category: string;
  description: string;
  conditionText: string;
  handling: string;
  changeReason: string;
};

type Revision = {
  version: number;
  changeReason: string;
  actor: Person;
  createdAt: string;
  summary: { op?: string; code?: string };
};

type CodeBody = {
  code: string;
  category: string;
  description: string;
  conditionText: string;
  handling: string;
};

type CompareResult = {
  fromVersion: number;
  toVersion: number;
  before: CodeBody;
  after: CodeBody;
};

const emptyDraft: Draft = { code: "", category: "", description: "", conditionText: "", handling: "", changeReason: "" };

const kindLabel: Record<string, string> = {
  API: "REST API",
  MQTT: "MQTT",
  WEBSOCKET: "WebSocket",
  DEVICE_PROTOCOL: "장비 프로토콜",
};

function specPath(projectId: string, kind: string) {
  if (kind === "API") return `/projects/${projectId}/specs/api`;
  if (kind === "MQTT") return `/projects/${projectId}/specs/mqtt`;
  if (kind === "WEBSOCKET") return `/projects/${projectId}/specs/websocket`;
  if (kind === "DEVICE_PROTOCOL") return `/projects/${projectId}/specs/device`;
  return `/projects/${projectId}`;
}

function operationLabel(op?: string) {
  if (op === "CREATE") return "생성";
  if (op === "UPDATE") return "수정";
  if (op === "DELETE") return "삭제";
  return op || "변경";
}

function draftFrom(row: ErrorCodeRow): Draft {
  return {
    code: row.code,
    category: row.category,
    description: row.description,
    conditionText: row.conditionText ?? "",
    handling: row.handling ?? "",
    changeReason: "",
  };
}

export function ErrorCodesPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [rows, setRows] = useState<ErrorCodeRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  usePageChrome(project ? `${project.title} 오류 코드` : "오류 코드", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : "/projects" },
    { label: "오류 코드" },
  ]);

  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  async function loadList(token: string) {
    const result = await apiRequest<{ errorCodes: ErrorCodeRow[] }>(`/api/projects/${projectId}/error-codes`, { token });
    setRows(result.errorCodes ?? []);
    return result.errorCodes ?? [];
  }

  useEffect(() => {
    if (!auth.token || !projectId) return;
    let cancel = false;
    apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token: auth.token })
      .then((detail) => {
        if (cancel) return;
        setProject(detail);
        return loadList(auth.token as string);
      })
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof ApiError && error.status === 403) setDenied(true);
        else setNotice(authErrorMessage(error));
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!auth.token || !selectedId) {
      setRevisions([]);
      setCompare(null);
      return;
    }
    let cancel = false;
    apiRequest<{ revisions: Revision[] }>(`/api/projects/${projectId}/error-codes/${selectedId}/revisions`, { token: auth.token })
      .then((result) => {
        if (!cancel) setRevisions(result.revisions ?? []);
      })
      .catch(() => {
        if (!cancel) setRevisions([]);
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, projectId, selectedId, version]);

  const categories = useMemo(() => [...new Set(rows.map((row) => row.category).filter(Boolean))].sort(), [rows]);
  const filtered = rows.filter((row) => {
    if (category && row.category !== category) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [row.code, row.category, row.description, row.conditionText, row.handling].join(" ").toLowerCase().includes(needle);
  });

  function openRow(row: ErrorCodeRow) {
    setCreating(false);
    setSelectedId(row.id);
    setDraft(draftFrom(row));
    setVersion(row.version);
    setConflictVersion(null);
    setCompare(null);
    setFromVersion("");
    setToVersion("");
    setNotice("");
  }

  function startNew() {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft);
    setVersion(0);
    setConflictVersion(null);
    setCompare(null);
    setNotice("");
  }

  function updateDraft(next: Draft) {
    setDraft(next);
    setNotice("");
  }

  async function save(nextVersion: number) {
    if (!auth.token || !canEdit || saving) return;
    if (!draft.code.trim() || !draft.category.trim() || !draft.description.trim() || !draft.changeReason.trim()) {
      setNotice("코드, 분류, 설명, 변경 사유를 입력하세요.");
      return;
    }
    setSaving(true);
    const body = {
      code: draft.code.trim(),
      category: draft.category.trim(),
      description: draft.description.trim(),
      conditionText: draft.conditionText.trim(),
      handling: draft.handling.trim(),
      changeReason: draft.changeReason.trim(),
      version: nextVersion,
    };
    try {
      if (selectedId && !creating) {
        const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/error-codes/${selectedId}`, {
          method: "PUT", token: auth.token, body,
        });
        const list = await loadList(auth.token);
        const saved = list.find((row) => row.id === selectedId);
        if (saved) {
          setDraft(draftFrom(saved));
          setVersion(saved.version);
        } else {
          setVersion(result.version);
          setDraft({ ...draft, changeReason: "" });
        }
        setConflictVersion(null);
        setNotice(`오류 코드를 저장했습니다. Version ${result.version}`);
      } else {
        const result = await apiRequest<{ id: number; version: number }>(`/api/projects/${projectId}/error-codes`, {
          method: "POST", token: auth.token, body,
        });
        const list = await loadList(auth.token);
        const saved = list.find((row) => row.id === result.id);
        setCreating(false);
        setSelectedId(result.id);
        setVersion(result.version);
        setDraft(saved ? draftFrom(saved) : { ...draft, changeReason: "" });
        setConflictVersion(null);
        setNotice(`오류 코드를 만들었습니다. Version ${result.version}`);
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "ERROR_CODE_VERSION_CONFLICT") {
        setConflictVersion(error.currentVersion ?? nextVersion);
        setNotice("다른 사용자가 먼저 저장했습니다. 이 항목의 입력은 남아 있습니다.");
        return;
      }
      setNotice(authErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    if (conflictVersion) {
      setNotice("충돌이 남아 있습니다. 최신 버전 기준으로 다시 저장을 눌러 확인하세요.");
      return;
    }
    void save(version);
  }

  function resave() {
    if (conflictVersion == null) return;
    if (!window.confirm("다시 저장하면 이 오류 코드가 내 내용으로 바뀝니다.")) return;
    void save(conflictVersion);
  }

  async function removeCode() {
    if (!auth.token || !selected || !canEdit || selected.referenceCount > 0) return;
    if (!draft.changeReason.trim()) {
      setNotice("삭제하려면 변경 사유를 입력하세요.");
      return;
    }
    if (!window.confirm("이 오류 코드를 목록에서 숨깁니다. 변경 이력은 남습니다.")) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/error-codes/${selected.id}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: selected.version, changeReason: draft.changeReason.trim() },
      });
      setSelectedId(null);
      setCreating(false);
      setDraft(emptyDraft);
      setVersion(0);
      setConflictVersion(null);
      setNotice("오류 코드를 삭제했습니다.");
      await loadList(auth.token);
    } catch (error: unknown) {
      setNotice(authErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function runCompare(event: FormEvent) {
    event.preventDefault();
    if (!auth.token || !selectedId) return;
    setCompare(null);
    try {
      const result = await apiRequest<CompareResult>(
        `/api/projects/${projectId}/error-codes/${selectedId}/revisions/compare?from=${fromVersion}&to=${toVersion}`,
        { token: auth.token },
      );
      setCompare(result);
    } catch (error: unknown) {
      setNotice(authErrorMessage(error));
    }
  }

  if (!auth.ready) return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) {
    return (
      <main className="page">
        <p className="banner warning">이 프로젝트의 오류 코드를 볼 권한이 없습니다.</p>
        <Link to="/projects">프로젝트 목록</Link>
      </main>
    );
  }
  if (!project) return <main className="page"><p className="state-panel">불러오는 중입니다.</p></main>;

  const showForm = creating || selected;
  return (
    <main className="page spec-screen">
      <div className="spec-toolbar">
        <h1>오류 코드</h1>
        <p className="lede">{project.title}의 공통 오류 코드입니다. 통신 규격은 이 목록을 참조합니다.</p>
      </div>
      {project.status !== "ACTIVE" ? <p className="banner">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
      {!canEdit && project.status === "ACTIVE" ? <p className="banner">조회 권한입니다. 오류 코드를 수정할 수 없습니다.</p> : null}
      {notice ? <p className={noticeClass(notice)}>{notice}</p> : null}
      <div className="inline-actions">
        <label>
          검색
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="코드, 분류, 설명, 처리 방법" />
        </label>
        <label>
          분류
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">전체</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        {canEdit ? <button type="button" className="btn primary" onClick={startNew}>오류 코드 추가</button> : null}
      </div>
      <div className="table-wrap error-code-table">
        <table>
          <thead>
            <tr><th>코드</th><th>분류</th><th>설명</th><th>참조 수</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4}>표시할 오류 코드가 없습니다.</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.id} className={row.id === selectedId ? "selected-row" : undefined} onClick={() => openRow(row)}>
                <td><code>{row.code}</code></td>
                <td>{row.category}</td>
                <td>{row.description}</td>
                <td>{row.referenceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm ? (
        <form className="card" onSubmit={onSave}>
          <div className="inline-actions">
            <h2>{creating ? "새 오류 코드" : draft.code || "오류 코드"}</h2>
            <span className="version-pill">{selected ? `Version ${version}` : "새 코드"}</span>
            {selected ? <span className="section-empty">작성 {selected.createdBy.name} · 수정 {selected.updatedBy.name}</span> : null}
          </div>
          <div className="field-grid">
            <label>코드<input value={draft.code} disabled={!canEdit} onChange={(event) => updateDraft({ ...draft, code: event.target.value })} /></label>
            <label>분류<input value={draft.category} disabled={!canEdit} onChange={(event) => updateDraft({ ...draft, category: event.target.value })} /></label>
          </div>
          <label>설명<textarea rows={3} value={draft.description} disabled={!canEdit} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} /></label>
          <label>발생 조건<textarea rows={2} value={draft.conditionText} disabled={!canEdit} onChange={(event) => updateDraft({ ...draft, conditionText: event.target.value })} /></label>
          <label>처리 방법<textarea rows={2} value={draft.handling} disabled={!canEdit} onChange={(event) => updateDraft({ ...draft, handling: event.target.value })} /></label>
          {selected ? (
            <section>
              <h3>참조 위치</h3>
              {selected.usages.length === 0 ? <p className="section-empty">이 코드를 쓰는 규격이 없습니다.</p> : (
                <ul>
                  {selected.usages.map((usage) => (
                    <li key={`${usage.kind}-${usage.itemUid}`}>
                      <Link to={specPath(projectId, usage.kind)}>{kindLabel[usage.kind] ?? usage.kind}</Link>
                      {" · "}{usage.title} · {usage.itemName}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {conflictVersion ? (
            <div className="conflict-box" role="alert">
              <p>서버의 최신 버전은 {conflictVersion}입니다. 입력은 유지됩니다.</p>
              {canEdit ? <button type="button" className="btn primary" onClick={resave}>최신 버전 기준으로 다시 저장</button> : null}
            </div>
          ) : null}
          {canEdit ? (
            <div className="save-bar">
              <label>변경 사유<input value={draft.changeReason} onChange={(event) => updateDraft({ ...draft, changeReason: event.target.value })} /></label>
              <div className="inline-actions">
                <button type="submit" disabled={saving || conflictVersion != null}>{saving ? "저장 중" : "저장"}</button>
                {selected && selected.referenceCount === 0 ? <button type="button" className="danger" disabled={saving} onClick={() => void removeCode()}>삭제</button> : null}
                {selected && selected.referenceCount > 0 ? <span className="section-empty">참조 중인 오류 코드는 삭제할 수 없습니다.</span> : null}
              </div>
            </div>
          ) : null}
        </form>
      ) : <p className="state-panel">행을 선택하면 상세를 볼 수 있습니다.</p>}
      {selected ? (
        <section className="card">
          <h2>변경 이력</h2>
          {revisions.length === 0 ? <p className="section-empty">이력이 없습니다.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Version</th><th>작업</th><th>사유</th><th>작성자</th></tr></thead>
                <tbody>
                  {revisions.map((revision) => (
                    <tr key={revision.version}>
                      <td>{revision.version}</td>
                      <td>{operationLabel(revision.summary?.op)}</td>
                      <td>{revision.changeReason}</td>
                      <td>{revision.actor.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form className="inline-actions" onSubmit={runCompare}>
            <label>이전<input value={fromVersion} onChange={(event) => setFromVersion(event.target.value)} inputMode="numeric" /></label>
            <label>이후<input value={toVersion} onChange={(event) => setToVersion(event.target.value)} inputMode="numeric" /></label>
            <button type="submit">비교</button>
          </form>
          {compare ? (
            <div className="compare-grid">
              <div>
                <h3>Version {compare.fromVersion}</h3>
                <CodeBodyView body={compare.before} />
              </div>
              <div>
                <h3>Version {compare.toVersion}</h3>
                <CodeBodyView body={compare.after} />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function CodeBodyView({ body }: { body: CodeBody }) {
  return (
    <dl>
      <dt>코드</dt><dd>{body.code}</dd>
      <dt>분류</dt><dd>{body.category}</dd>
      <dt>설명</dt><dd>{body.description}</dd>
      <dt>발생 조건</dt><dd>{body.conditionText || "없음"}</dd>
      <dt>처리 방법</dt><dd>{body.handling || "없음"}</dd>
    </dl>
  );
}

function noticeClass(notice: string) {
  if (notice.includes("저장했습니다") || notice.includes("만들었습니다") || notice.includes("삭제했습니다")) return "banner success";
  if (notice.includes("먼저 저장") || notice.includes("남아")) return "banner warning";
  return "banner danger";
}
