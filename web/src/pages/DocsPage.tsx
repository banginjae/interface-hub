import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { renderMarkdown } from "../docs/markdownPreview";
import type { ProjectDetail } from "../projectTypes";
import { usePageChrome } from "../Shell";

const departmentSuggestions = ["SW", "APP", "FW", "GW", "HW"];

type Person = { id: number; name: string };

type DocSummary = {
  id: number;
  title: string;
  department: string;
  version: number;
  updatedBy: Person;
  updatedAt: string;
};

type DocDetail = DocSummary & {
  content: string;
  createdBy: Person;
  createdAt: string;
};

type Draft = {
  title: string;
  department: string;
  content: string;
  changeReason: string;
};

type Revision = {
  version: number;
  changeReason: string;
  actor: Person;
  createdAt: string;
  summary: { op?: string; title?: string };
};

type CompareResult = {
  fromVersion: number;
  toVersion: number;
  before: { title: string; department: string; content: string };
  after: { title: string; department: string; content: string };
};

type Conflict = { current: number; latest: DocDetail | null };

const emptyDraft: Draft = { title: "", department: "", content: "", changeReason: "" };

function draftKey(id: number, version: number) {
  return `draft:general:${id}:${version}`;
}

function localDate(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function operationLabel(op?: string) {
  if (op === "CREATE_DOCUMENT") return "문서 생성";
  if (op === "UPDATE_DOCUMENT") return "문서 수정";
  if (op === "DELETE_DOCUMENT") return "문서 삭제";
  return op || "변경";
}

export function DocsPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [documents, setDocuments] = useState<DocSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState<DocDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "danger" | "">("");
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"edit" | "history" | "markdown">("edit");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [editorFilter, setEditorFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [markdownText, setMarkdownText] = useState("");
  const [filename, setFilename] = useState("");
  usePageChrome(project ? `${project.title} 일반 문서` : "일반 문서", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : "/projects" },
    { label: "일반 문서" },
  ]);

  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));

  async function loadList(token: string) {
    const result = await apiRequest<{ documents: DocSummary[] }>(`/api/projects/${projectId}/general-docs`, { token });
    setDocuments(result.documents ?? []);
    return result.documents ?? [];
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
        if (error instanceof ApiError && error.status === 403) {
          setDenied(true);
          return;
        }
        setNotice(authErrorMessage(error));
        setNoticeTone("danger");
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const filtered = useMemo(() => documents.filter((doc) => {
    if (query && !doc.title.includes(query.trim())) return false;
    if (departmentFilter && doc.department !== departmentFilter) return false;
    if (editorFilter && !doc.updatedBy.name.includes(editorFilter.trim())) return false;
    if (dateFilter && localDate(doc.updatedAt) !== dateFilter) return false;
    return true;
  }), [documents, query, departmentFilter, editorFilter, dateFilter]);

  const departments = useMemo(() => {
    const extra = documents.map((doc) => doc.department).filter((value) => value && !departmentSuggestions.includes(value));
    return [...departmentSuggestions, ...Array.from(new Set(extra))];
  }, [documents]);

  function rememberDraft(next: Draft, id: number | null, version: number) {
    setDraft(next);
    setDirty(true);
    if (id) sessionStorage.setItem(draftKey(id, version), JSON.stringify(next));
  }

  function applyDocument(doc: DocDetail) {
    const stored = sessionStorage.getItem(draftKey(doc.id, doc.version));
    let next: Draft = { title: doc.title, department: doc.department, content: doc.content, changeReason: "" };
    let restored = false;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Draft;
        next = { ...next, ...parsed };
        restored = true;
      } catch {
        restored = false;
      }
    }
    setSaved(doc);
    setDraft(next);
    setDirty(restored);
    setSelectedId(doc.id);
    setCreating(false);
    setConflict(null);
    setTab("edit");
    setNotice(restored ? "이 버전에 저장하지 않은 초안이 있습니다." : "");
    setNoticeTone("");
  }

  async function openDocument(id: number) {
    if (!auth.token) return;
    if (dirty && !window.confirm("저장하지 않은 내용이 있습니다. 다른 문서로 이동할까요?")) return;
    const doc = await apiRequest<DocDetail>(`/api/projects/${projectId}/general-docs/${id}`, { token: auth.token });
    applyDocument(doc);
  }

  function startNew() {
    if (dirty && !window.confirm("저장하지 않은 내용이 있습니다. 새 문서로 이동할까요?")) return;
    setSelectedId(null);
    setSaved(null);
    setCreating(true);
    setDraft(emptyDraft);
    setDirty(false);
    setConflict(null);
    setTab("edit");
    setNotice("");
    setNoticeTone("");
  }

  async function save(version: number) {
    if (!auth.token || !canEdit) return;
    if (!draft.title.trim() || !draft.changeReason.trim()) {
      setNotice("문서 제목과 변경 사유를 입력하세요.");
      setNoticeTone("danger");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const body = {
        title: draft.title.trim(),
        department: draft.department.trim(),
        content: draft.content,
        changeReason: draft.changeReason.trim(),
        version,
      };
      if (selectedId) {
        const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/general-docs/${selectedId}`, {
          method: "PUT", token: auth.token, body,
        });
        sessionStorage.removeItem(draftKey(selectedId, version));
        const doc = await apiRequest<DocDetail>(`/api/projects/${projectId}/general-docs/${selectedId}`, { token: auth.token });
        setSaved(doc);
        setDraft({ title: doc.title, department: doc.department, content: doc.content, changeReason: "" });
        setDirty(false);
        setConflict(null);
        setNotice(`문서를 저장했습니다. Version ${result.version}`);
        setNoticeTone("success");
      } else {
        const result = await apiRequest<{ id: number; version: number }>(`/api/projects/${projectId}/general-docs`, {
          method: "POST", token: auth.token, body,
        });
        const doc = await apiRequest<DocDetail>(`/api/projects/${projectId}/general-docs/${result.id}`, { token: auth.token });
        setSaved(doc);
        setSelectedId(doc.id);
        setCreating(false);
        setDraft({ title: doc.title, department: doc.department, content: doc.content, changeReason: "" });
        setDirty(false);
        setConflict(null);
        setNotice(`문서를 만들었습니다. Version ${result.version}`);
        setNoticeTone("success");
      }
      await loadList(auth.token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "GENERAL_DOC_VERSION_CONFLICT" && selectedId) {
        const current = error.currentVersion ?? version;
        let latest: DocDetail | null = null;
        try {
          latest = await apiRequest<DocDetail>(`/api/projects/${projectId}/general-docs/${selectedId}`, { token: auth.token });
        } catch {
          latest = null;
        }
        setConflict({ current, latest });
        setNotice("다른 사용자가 먼저 저장했습니다. 이 문서의 입력은 남아 있습니다.");
        setNoticeTone("danger");
        return;
      }
      setNotice(authErrorMessage(error));
      setNoticeTone("danger");
    } finally {
      setSaving(false);
    }
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    if (conflict) {
      setNotice("충돌이 남아 있습니다. 최신 버전 기준으로 다시 저장을 눌러 확인하세요.");
      setNoticeTone("danger");
      return;
    }
    void save(saved?.version ?? 0);
  }

  function resave() {
    if (!conflict) return;
    if (!window.confirm("다시 저장하면 이 문서 전체가 내 내용으로 바뀝니다.")) return;
    void save(conflict.current);
  }

  async function removeDocument() {
    if (!auth.token || !saved || !canEdit) return;
    if (!draft.changeReason.trim()) {
      setNotice("삭제하려면 변경 사유를 입력하세요.");
      setNoticeTone("danger");
      return;
    }
    if (!window.confirm("이 문서를 목록에서 숨깁니다. 변경 이력은 남습니다.")) return;
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/general-docs/${saved.id}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: saved.version, changeReason: draft.changeReason.trim() },
      });
      sessionStorage.removeItem(draftKey(saved.id, saved.version));
      setSelectedId(null);
      setSaved(null);
      setCreating(false);
      setDraft(emptyDraft);
      setDirty(false);
      setConflict(null);
      setNotice("문서를 삭제했습니다.");
      setNoticeTone("success");
      await loadList(auth.token);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "GENERAL_DOC_VERSION_CONFLICT") {
        setNotice("다른 사용자가 먼저 저장했습니다. 이 문서의 입력은 남아 있습니다.");
        setNoticeTone("danger");
        return;
      }
      setNotice(authErrorMessage(error));
      setNoticeTone("danger");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (tab !== "history" || !auth.token || !selectedId) return;
    let cancel = false;
    apiRequest<{ revisions: Revision[] }>(`/api/projects/${projectId}/general-docs/${selectedId}/revisions`, { token: auth.token })
      .then((result) => {
        if (cancel) return;
        const rows = result.revisions ?? [];
        setRevisions(rows);
        setCompare(null);
        if (rows.length >= 2) {
          setFromVersion(String(rows[1].version));
          setToVersion(String(rows[0].version));
        } else if (rows.length === 1) {
          setFromVersion(String(rows[0].version));
          setToVersion(String(rows[0].version));
        }
      })
      .catch((error: unknown) => {
        if (!cancel) {
          setNotice(authErrorMessage(error));
          setNoticeTone("danger");
        }
      });
    return () => {
      cancel = true;
    };
  }, [tab, auth.token, projectId, selectedId, saved?.version]);

  useEffect(() => {
    if (tab !== "markdown" || !auth.token || !selectedId) return;
    let cancel = false;
    fetch(`/api/projects/${projectId}/general-docs/${selectedId}/markdown`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    }).then(async (response) => {
      const body = await response.text();
      if (!response.ok) throw new ApiError(response.status, "Markdown을 받지 못했습니다.");
      if (cancel) return;
      setMarkdownText(body);
      const encoded = response.headers.get("X-Markdown-Filename") || "";
      try {
        setFilename(encoded ? decodeURIComponent(encoded) : `general-v${saved?.version ?? 1}.md`);
      } catch {
        setFilename(encoded);
      }
    }).catch((error: unknown) => {
      if (!cancel) {
        setNotice(authErrorMessage(error));
        setNoticeTone("danger");
      }
    });
    return () => {
      cancel = true;
    };
  }, [tab, auth.token, projectId, selectedId, saved?.version]);

  async function copyMarkdown() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(markdownText);
      else copyWithSelection(markdownText);
      setNotice("Markdown을 복사했습니다.");
      setNoticeTone("success");
    } catch {
      try {
        copyWithSelection(markdownText);
        setNotice("Markdown을 복사했습니다.");
        setNoticeTone("success");
      } catch {
        setNotice("복사하지 못했습니다. 미리보기에서 직접 선택할 수 있습니다.");
        setNoticeTone("danger");
      }
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || `general-v${saved?.version ?? 1}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Markdown 파일을 저장했습니다.");
    setNoticeTone("success");
  }

  async function runCompare() {
    if (!auth.token || !selectedId || !fromVersion || !toVersion) return;
    try {
      const result = await apiRequest<CompareResult>(
        `/api/projects/${projectId}/general-docs/${selectedId}/revisions/compare?from=${fromVersion}&to=${toVersion}`,
        { token: auth.token },
      );
      setCompare(result);
    } catch (error: unknown) {
      setNotice(authErrorMessage(error));
      setNoticeTone("danger");
    }
  }

  if (!auth.ready) return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) {
    return (
      <main className="page">
        <h1>일반 문서</h1>
        <p className="banner warning">이 프로젝트의 일반 문서를 볼 권한이 없습니다.</p>
        <Link to="/projects">목록으로</Link>
      </main>
    );
  }
  if (!project) return <main className="page"><p className="state-panel">불러오는 중입니다.</p></main>;

  const showEditor = creating || selectedId !== null;
  const previewHtml = renderMarkdown(draft.content);

  return (
    <main className="page spec-screen">
      <div className="spec-toolbar">
        <h1>일반 문서</h1>
        <p className="lede">{project.title}의 부서별 산출물입니다. Markdown 원문이 저장됩니다.</p>
      </div>
      {project.status !== "ACTIVE" ? <p className="banner">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
      {!canEdit && project.status === "ACTIVE" ? <p className="banner">조회 권한입니다. 문서를 수정할 수 없습니다.</p> : null}
      {notice ? <p className={noticeTone === "danger" ? "banner danger" : noticeTone === "success" ? "banner success" : "banner"}>{notice}</p> : null}
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")}>편집</button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")} disabled={!selectedId}>변경 이력</button>
        <button type="button" role="tab" aria-selected={tab === "markdown"} onClick={() => setTab("markdown")} disabled={!selectedId}>Markdown</button>
      </div>
      {tab === "edit" ? (
        <div className="spec-layout">
          <aside className="endpoint-pane">
            <div className="inline-actions">
              {canEdit ? <button type="button" className="btn primary" onClick={startNew}>새 문서</button> : null}
            </div>
            <label>제목 검색<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label>
              부서
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="">전체</option>
                {departments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>수정자<input value={editorFilter} onChange={(event) => setEditorFilter(event.target.value)} /></label>
            <label>수정일<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
            {filtered.length === 0 ? <p className="section-empty">표시할 문서가 없습니다.</p> : null}
            <div className="doc-list">
              {filtered.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className={doc.id === selectedId ? "doc-list-button is-selected" : "doc-list-button"}
                  data-doc-id={doc.id}
                  onClick={() => void openDocument(doc.id)}
                >
                  <strong>{doc.title}</strong>
                  <span>{doc.department || "부서 없음"} · Version {doc.version}</span>
                  <span>{doc.updatedBy.name} · {localDate(doc.updatedAt)}</span>
                </button>
              ))}
            </div>
          </aside>
          {showEditor ? (
            <form className="editor-pane" onSubmit={onSave}>
              <div className="inline-actions">
                <span className="version-pill">{saved ? `Version ${saved.version}` : "새 문서"}</span>
                {saved ? <span className="section-empty">작성 {saved.createdBy.name} · 수정 {saved.updatedBy.name}</span> : null}
              </div>
              <label>
                제목
                <input value={draft.title} disabled={!canEdit} onChange={(event) => rememberDraft({ ...draft, title: event.target.value }, selectedId, saved?.version ?? 0)} />
              </label>
              <label>
                담당 부서
                <input
                  list="general-doc-departments"
                  value={draft.department}
                  disabled={!canEdit}
                  onChange={(event) => rememberDraft({ ...draft, department: event.target.value }, selectedId, saved?.version ?? 0)}
                />
              </label>
              <datalist id="general-doc-departments">
                {departments.map((item) => <option key={item} value={item} />)}
              </datalist>
              <label>
                본문
                <textarea
                  className="doc-body"
                  value={draft.content}
                  disabled={!canEdit}
                  onChange={(event) => rememberDraft({ ...draft, content: event.target.value }, selectedId, saved?.version ?? 0)}
                />
              </label>
              {canEdit ? (
                <label>
                  변경 사유
                  <input value={draft.changeReason} onChange={(event) => rememberDraft({ ...draft, changeReason: event.target.value }, selectedId, saved?.version ?? 0)} />
                </label>
              ) : null}
              {conflict ? (
                <div className="conflict-box" role="alert">
                  <p>서버의 최신 문서 버전은 {conflict.current}입니다. 내 초안은 그대로입니다.</p>
                  <div className="compare-pair">
                    <section>
                      <h3>내 초안</h3>
                      <p>{draft.title} · {draft.department || "부서 없음"}</p>
                      <pre className="markdown-preview">{draft.content}</pre>
                    </section>
                    <section>
                      <h3>최신본</h3>
                      <p>{conflict.latest ? `${conflict.latest.title} · ${conflict.latest.department || "부서 없음"}` : "최신본을 불러오지 못했습니다."}</p>
                      <pre className="markdown-preview">{conflict.latest?.content ?? ""}</pre>
                    </section>
                  </div>
                  {canEdit ? <button type="button" className="btn primary" onClick={resave}>최신 버전 기준으로 다시 저장</button> : null}
                </div>
              ) : null}
              {canEdit ? (
                <div className="form-actions">
                  <button type="submit" disabled={saving}>{selectedId ? "저장" : "문서 만들기"}</button>
                  {selectedId && !conflict ? <button type="button" className="danger" disabled={saving} onClick={() => void removeDocument()}>삭제</button> : null}
                </div>
              ) : null}
            </form>
          ) : (
            <section className="editor-pane">
              <h2>문서를 선택하세요</h2>
              <p className="section-empty">{canEdit ? "새 문서로 제목, 부서, Markdown을 작성할 수 있습니다." : "조회 권한으로는 문서를 만들 수 없습니다."}</p>
            </section>
          )}
          <aside className="preview-pane" aria-label="실시간 미리보기">
            <h2>실시간 미리보기</h2>
            <p className="section-empty">편집 중인 Markdown입니다. 복사와 다운로드는 마지막 저장본입니다.</p>
            {draft.content.trim() ? <div className="preview-html" dangerouslySetInnerHTML={{ __html: previewHtml }} /> : <p className="section-empty">미리볼 내용이 없습니다.</p>}
          </aside>
        </div>
      ) : null}
      {tab === "history" && selectedId ? (
        <section className="history-screen">
          <h2>변경 이력</h2>
          {revisions.length === 0 ? <p className="state-panel">이력이 없습니다.</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Version</th><th>작업</th><th>수정자</th><th>사유</th><th>시각</th></tr>
                </thead>
                <tbody>
                  {revisions.map((row) => (
                    <tr key={row.version}>
                      <td>{row.version}</td>
                      <td>{operationLabel(row.summary?.op)}</td>
                      <td>{row.actor.name}</td>
                      <td>{row.changeReason}</td>
                      <td>{localDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {revisions.length >= 2 ? (
            <div className="compare-panel">
              <h2>Version 비교</h2>
              <div className="inline-actions">
                <label>이전
                  <select value={fromVersion} onChange={(event) => setFromVersion(event.target.value)}>
                    {revisions.map((row) => <option key={`from-${row.version}`} value={row.version}>{row.version}</option>)}
                  </select>
                </label>
                <label>이후
                  <select value={toVersion} onChange={(event) => setToVersion(event.target.value)}>
                    {revisions.map((row) => <option key={`to-${row.version}`} value={row.version}>{row.version}</option>)}
                  </select>
                </label>
                <button type="button" className="btn primary" onClick={() => void runCompare()}>비교</button>
              </div>
              {compare ? (
                <div className="compare-pair">
                  <article className="diff-before">
                    <h3>Version {compare.fromVersion}</h3>
                    <p>{compare.before.title} · {compare.before.department || "부서 없음"}</p>
                    <div className="preview-html" dangerouslySetInnerHTML={{ __html: renderMarkdown(compare.before.content) }} />
                  </article>
                  <article className="diff-after">
                    <h3>Version {compare.toVersion}</h3>
                    <p>{compare.after.title} · {compare.after.department || "부서 없음"}</p>
                    <div className="preview-html" dangerouslySetInnerHTML={{ __html: renderMarkdown(compare.after.content) }} />
                  </article>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {tab === "markdown" && selectedId ? (
        <section className="markdown-screen">
          <div className="inline-actions">
            <button type="button" className="btn primary" onClick={() => void copyMarkdown()} disabled={!markdownText}>Markdown 복사</button>
            <button type="button" onClick={downloadMarkdown} disabled={!markdownText}>파일 다운로드</button>
            <span className="section-empty">{filename} · 문서 버전 {saved?.version}</span>
          </div>
          <h2>미리보기</h2>
          <p className="section-empty">마지막 저장본입니다. 편집 중인 내용은 포함하지 않습니다.</p>
          <pre className="markdown-preview">{markdownText}</pre>
        </section>
      ) : null}
    </main>
  );
}

function copyWithSelection(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("copy failed");
}
