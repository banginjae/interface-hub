import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { sameCode, validateErrorCode, type ErrorCodeDraft, type ErrorCodeIssue } from "../spec/errorCodeValidation";
import { issueMap, reasonProblem } from "../spec/restValidation";
import { noChangeMessage } from "../spec/saveCompare";
import { Field, IssueSummary, formatDate } from "../spec/workspaceUi";
import { useToast } from "../toast";

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

type Revision = { version: number; changeReason: string; actor: Person; createdAt: string; summary: { op?: string; code?: string } };
type CodeBody = { code: string; category: string; description: string; conditionText: string; handling: string };
type CompareResult = { fromVersion: number; toVersion: number; before: CodeBody; after: CodeBody };

const emptyDraft: ErrorCodeDraft = { code: "", category: "", description: "", conditionText: "", handling: "", changeReason: "" };
const codeExamples = ["0x3030", "E_TIMEOUT", "AUTH_FAILED"];
const kindLabel: Record<string, string> = { API: "REST API", MQTT: "MQTT", WEBSOCKET: "WebSocket", DEVICE_PROTOCOL: "장비 프로토콜" };

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

function draftFrom(row: ErrorCodeRow): ErrorCodeDraft {
  return { code: row.code, category: row.category, description: row.description, conditionText: row.conditionText ?? "", handling: row.handling ?? "", changeReason: "" };
}

function signature(draft: ErrorCodeDraft) {
  return JSON.stringify({
    code: draft.code.trim(),
    category: draft.category.trim(),
    description: draft.description.trim(),
    conditionText: draft.conditionText.trim(),
    handling: draft.handling.trim(),
  });
}

export function ErrorCodesPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [rows, setRows] = useState<ErrorCodeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [draft, setDraft] = useState<ErrorCodeDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseline, setBaseline] = useState("");
  const [baseVersion, setBaseVersion] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const [serverCodeError, setServerCodeError] = useState("");
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const toast = useToast();

  const itemParam = searchParams.get("item");
  const modeParam = searchParams.get("mode") === "edit" ? "edit" : null;
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const editTarget = canEdit && itemParam && (itemParam === "new" || modeParam === "edit") ? itemParam : null;
  const selectedId = itemParam && itemParam !== "new" ? Number(itemParam) : null;
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const dirty = Boolean(draft && signature(draft) !== baseline);

  usePageChrome(project ? `${project.title} 오류 코드` : "오류 코드", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : "/projects" },
    { label: "오류 코드" },
  ]);
  useNavGuard(() => !dirty || window.confirm("저장하지 않은 오류 코드 변경이 있습니다. 이동하면 입력한 내용이 사라집니다."), dirty);

  async function loadList(token: string) {
    const result = await apiRequest<{ errorCodes: ErrorCodeRow[] }>(`/api/projects/${projectId}/error-codes`, { token });
    const list = result.errorCodes ?? [];
    setRows(list);
    return list;
  }

  useEffect(() => {
    if (!auth.token || !projectId) return;
    let cancel = false;
    apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token: auth.token })
      .then((detail) => {
        if (cancel) return undefined;
        setProject(detail);
        return loadList(auth.token as string);
      })
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof ApiError && error.status === 403) setDenied(true);
        else setNotice(authErrorMessage(error));
      })
      .finally(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!loaded) return;
    if (!editTarget) {
      if (draftFor !== null) {
        setDraft(null);
        setDraftFor(null);
        setAttempted(false);
        setSaveOpen(false);
        setReasonError("");
        setServerCodeError("");
        setConflictVersion(null);
      }
      return;
    }
    if (draftFor === editTarget) return;
    const source = editTarget === "new" ? null : rows.find((row) => String(row.id) === editTarget) ?? null;
    if (editTarget !== "new" && !source) return;
    const next = source ? draftFrom(source) : emptyDraft;
    setDraft(next);
    setDraftFor(editTarget);
    setBaseline(signature(next));
    setBaseVersion(source?.version ?? 0);
    setAttempted(false);
    setSaveOpen(false);
    setReasonError("");
    setServerCodeError("");
    setConflictVersion(null);
    setDetailOpen(Boolean(source && (source.conditionText || source.handling)));
    setFocusTarget(editTarget === "new" ? "code:code" : null);
  }, [loaded, rows, editTarget, draftFor]);

  useEffect(() => {
    setConfirmDelete(false);
    setDeleteReason("");
    setCompare(null);
    setFromVersion("");
    setToVersion("");
  }, [itemParam]);

  useEffect(() => {
    if (!auth.token || !selectedId) {
      setRevisions([]);
      return;
    }
    let cancel = false;
    apiRequest<{ revisions: Revision[] }>(`/api/projects/${projectId}/error-codes/${selectedId}/revisions`, { token: auth.token })
      .then((result) => { if (!cancel) setRevisions(result.revisions ?? []); })
      .catch(() => { if (!cancel) setRevisions([]); });
    return () => { cancel = true; };
  }, [auth.token, projectId, selectedId, selected?.version]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  useEffect(() => {
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(focusTarget)}"]`);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        element.focus({ preventScroll: true });
      }
      setFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget, draftFor, detailOpen]);

  const categories = useMemo(() => [...new Set(rows.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko")), [rows]);

  if (!auth.ready) return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) {
    return (
      <main className="spec-screen">
        <p className="banner warning">이 프로젝트의 오류 코드를 볼 권한이 없습니다.</p>
        <Link to="/projects">프로젝트 목록</Link>
      </main>
    );
  }
  if (!project || !loaded) return <main className="spec-screen"><p className="state-panel">{notice || "불러오는 중입니다."}</p></main>;

  function go(item: string | null, mode: "edit" | null = null) {
    const search = new URLSearchParams();
    if (item) search.set("item", item);
    if (mode) search.set("mode", mode);
    setNotice("");
    setSearchParams(search);
  }

  function guard() {
    return !dirty || window.confirm("저장하지 않은 오류 코드 변경이 있습니다. 이동하면 입력한 내용이 사라집니다.");
  }

  function dropDraft() {
    setDraft(null);
    setDraftFor(null);
    setAttempted(false);
    setSaveOpen(false);
    setReasonError("");
    setServerCodeError("");
    setConflictVersion(null);
  }

  function openRow(id: number) {
    if (String(id) === draftFor) return;
    if (draftFor && !guard()) return;
    go(String(id));
  }

  function beginNew() {
    if (!canEdit) return;
    if (draftFor && draftFor !== "new" && !guard()) return;
    go("new");
  }

  function cancelEdit() {
    if (dirty && !window.confirm("저장하지 않은 변경을 버리고 돌아갈까요?")) return;
    const target = draftFor;
    dropDraft();
    go(target && target !== "new" ? target : null);
  }

  function toList() {
    if (draftFor && !guard()) return;
    go(null);
  }

  function update(next: ErrorCodeDraft) {
    setDraft(next);
    if (next.code !== draft?.code) setServerCodeError("");
  }

  function goToIssue(issue: ErrorCodeIssue) {
    if (issue.tab === "detail") setDetailOpen(true);
    setFocusTarget(issue.target);
  }

  function startSave() {
    if (!draft || (draftFor !== "new" && !dirty)) return;
    const found = validateErrorCode(draft, rows, selectedId);
    if (found.length > 0) {
      setAttempted(true);
      setSaveOpen(false);
      goToIssue(found[0]);
      toast.error(`저장하지 못했습니다. 입력 오류 ${found.length}건을 확인해 주세요.`);
      return;
    }
    setAttempted(false);
    setReasonError("");
    if (draftFor === "new" && !draft.changeReason.trim()) {
      setDraft({ ...draft, changeReason: `오류 코드 추가: ${draft.code.trim()}` });
    }
    setSaveOpen(true);
    setFocusTarget("code:reason");
  }

  async function save(version = baseVersion, retry = false) {
    if (!auth.token || !draft || !draftFor || saving || (draftFor !== "new" && !dirty && !retry)) return;
    const found = validateErrorCode(draft, rows, selectedId);
    if (found.length > 0) {
      setAttempted(true);
      setSaveOpen(false);
      goToIssue(found[0]);
      return;
    }
    const reason = reasonProblem(draft.changeReason);
    setReasonError(reason ?? "");
    if (reason) {
      setSaveOpen(true);
      setFocusTarget("code:reason");
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
      version,
    };
    try {
      let id: number;
      let next: number;
      if (draftFor === "new") {
        const result = await apiRequest<{ id: number; version: number }>(`/api/projects/${projectId}/error-codes`, { method: "POST", token: auth.token, body });
        id = result.id;
        next = result.version;
      } else {
        const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/error-codes/${draftFor}`, { method: "PUT", token: auth.token, body });
        id = Number(draftFor);
        next = result.version;
      }
      await loadList(auth.token);
      notifySpecChanged();
      dropDraft();
      go(String(id));
      if (draftFor !== "new" && next === version) toast.info(noChangeMessage);
      else toast.success(`오류 코드 ${body.code}을(를) 저장했습니다 · Version ${next}`);
    } catch (error: unknown) {
      setSaveOpen(false);
      if (error instanceof ApiError && error.code === "ERROR_CODE_VERSION_CONFLICT") {
        setConflictVersion(error.currentVersion ?? version);
        await loadList(auth.token).catch(() => undefined);
        toast.error("다른 사용자가 먼저 저장했습니다. 입력한 내용은 남아 있습니다.");
      } else if (error instanceof ApiError && error.code === "ERROR_CODE_TAKEN") {
        setServerCodeError("같은 코드가 이미 있습니다. 대소문자는 구분하지 않고 비교합니다.");
        setAttempted(true);
        setFocusTarget("code:code");
        await loadList(auth.token).catch(() => undefined);
        toast.error("같은 코드가 이미 있어 저장하지 않았습니다.");
      } else {
        const message = `저장하지 못했습니다. ${authErrorMessage(error)} 입력한 내용은 남아 있습니다.`;
        setNotice(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeCode() {
    if (!auth.token || !selected || !canEdit) return;
    const reason = reasonProblem(deleteReason);
    if (reason) {
      toast.error(`삭제하지 못했습니다. ${reason}`);
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/error-codes/${selected.id}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: selected.version, changeReason: deleteReason.trim() },
      });
      setConfirmDelete(false);
      dropDraft();
      await loadList(auth.token);
      notifySpecChanged();
      go(null);
      toast.success(`오류 코드 ${selected.code}을(를) 삭제했습니다.`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "ERROR_CODE_IN_USE") {
        toast.error("다른 규격에서 참조 중이라 삭제할 수 없습니다. 참조를 먼저 해제해 주세요.");
      } else if (error instanceof ApiError && error.code === "ERROR_CODE_VERSION_CONFLICT") {
        toast.error("다른 사용자가 먼저 수정해 삭제하지 않았습니다. 최신 내용을 확인해 주세요.");
      } else {
        toast.error(`삭제하지 못했습니다. ${authErrorMessage(error)}`);
      }
      await loadList(auth.token).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  async function runCompare() {
    if (!auth.token || !selectedId || !fromVersion || !toVersion) return;
    setCompare(null);
    try {
      const result = await apiRequest<CompareResult>(`/api/projects/${projectId}/error-codes/${selectedId}/revisions/compare?from=${fromVersion}&to=${toVersion}`, { token: auth.token });
      setCompare(result);
    } catch (error: unknown) {
      toast.error(`비교하지 못했습니다. ${authErrorMessage(error)}`);
    }
  }

  async function copyCode(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("코드를 복사했습니다.");
    } catch {
      toast.error("코드를 복사하지 못했습니다. 직접 선택해 복사해 주세요.");
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (category && row.category !== category) return false;
    if (!needle) return true;
    return [row.code, row.category, row.description, row.conditionText, row.handling].join(" ").toLowerCase().includes(needle);
  });
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const isNew = itemParam === "new";
  const issues = draft && attempted ? validateErrorCode(draft, rows, selectedId) : [];
  const errors = issueMap(issues);
  const codeError = errors.get("code:code") || serverCodeError || undefined;
  const totalRefs = rows.reduce((sum, row) => sum + row.referenceCount, 0);
  const duplicate = writer && draft ? sameCode(rows, draft.code, selectedId) : [];

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guard()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {itemParam ? <button type="button" className="crumb-link" onClick={toList}>오류 코드</button> : <strong>오류 코드</strong>}
        {itemParam ? <><span aria-hidden="true">/</span><strong className="crumb-current">{isNew ? "새 오류 코드" : selected?.code ?? ""}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>오류 코드</h1>
          <p className="rest-doc-meta">
            <span>등록 {rows.length}개</span>
            <span>규격 참조 {totalRefs}건</span>
            <span>프로젝트 공통 · REST API, MQTT, WebSocket, 장비 프로토콜에서 연결해 사용</span>
          </p>
        </div>
        {canEdit && rows.length > 0 ? (
          <div className="rest-doc-actions"><button type="button" className="btn primary" onClick={beginNew}>+ 오류 코드 추가</button></div>
        ) : null}
      </div>
    </header>
  );

  function codeRow(row: ErrorCodeRow, compact: boolean) {
    const current = String(row.id) === itemParam;
    return (
      <li key={row.id}>
        <button type="button" className={current ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} aria-current={current ? "true" : undefined} onClick={() => openRow(row.id)}>
          <span className="ep-main">
            <code>{row.code}</code>
            <span className="ep-name">{row.description || <em>설명 미입력</em>}</span>
          </span>
          {compact ? null : <span className="ec-category">{row.category}</span>}
          <span className={row.referenceCount > 0 ? "ec-refs is-used" : "ec-refs"}>{row.referenceCount > 0 ? `참조 ${row.referenceCount}` : "미사용"}</span>
          {String(row.id) === draftFor && dirty ? <span className="ep-tag is-draft">수정 중</span> : null}
        </button>
      </li>
    );
  }

  const filters = (
    <>
      <input className="ep-search" type="search" aria-label="오류 코드 검색" placeholder="코드, 분류, 설명, 처리 방법 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select className="ec-filter" aria-label="분류 필터" value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">전체 분류</option>
        {categories.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </>
  );

  let body: ReactNode;
  if (!itemParam) {
    body = (
      <section className="rest-panel">
        {notice ? <p className="banner rest-banner danger">{notice}</p> : null}
        {!canEdit ? <p className="banner rest-banner">{project.status !== "ACTIVE" ? "보관된 프로젝트는 조회만 할 수 있습니다." : "조회 권한입니다. 오류 코드를 수정할 수 없습니다."}</p> : null}
        {rows.length === 0 ? (
          <div className="rest-empty-state">
            <h2>아직 등록된 오류 코드가 없습니다.</h2>
            <p>프로젝트에서 공통으로 사용할 오류 코드를 등록하고 REST API, MQTT, WebSocket, 장비 프로토콜 규격에서 연결해 보세요.</p>
            {canEdit ? <button type="button" className="btn primary" onClick={beginNew}>+ 첫 오류 코드 추가</button> : <p>조회 권한으로는 오류 코드를 추가할 수 없습니다.</p>}
          </div>
        ) : (
          <div className="ep-board">
            <div className="ep-toolbar ec-toolbar">{filters}<span className="ec-count">{filtered.length} / {rows.length}개</span></div>
            {filtered.length === 0 ? <p className="ep-empty">조건과 일치하는 오류 코드가 없습니다.</p> : <ul className="ep-list">{filtered.map((row) => codeRow(row, false))}</ul>}
          </div>
        )}
      </section>
    );
  } else {
    const notFound = !isNew && !selected;
    body = (
      <div className="rest-split">
        <aside className="ep-pane" aria-label="오류 코드 목록">
          {filters}
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginNew}>+ 오류 코드 추가</button> : null}
          <ul className="ep-list is-compact">
            {draftFor === "new" && draft ? (
              <li><button type="button" className="ep-row mqtt-row is-current"><span className="ep-main"><code>{draft.code.trim() || "새 오류 코드"}</code><span className="ep-name">{draft.description.trim() || "작성 중"}</span></span><span className="ep-tag is-draft">작성 중</span></button></li>
            ) : null}
            {filtered.map((row) => codeRow(row, true))}
          </ul>
          {rows.length > 0 && filtered.length === 0 ? <p className="ep-empty">일치하는 오류 코드가 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">
          {notFound || (isNew && !canEdit) ? (
            <div className="rest-empty-state">
              <h2>{isNew ? "조회 권한으로는 오류 코드를 추가할 수 없습니다." : "오류 코드를 찾을 수 없습니다."}</h2>
              <p>{isNew ? "목록에서 오류 코드를 선택해 조회하세요." : "삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요."}</p>
              <button type="button" className="btn" onClick={() => go(null)}>오류 코드 목록으로</button>
            </div>
          ) : writer && draft ? (
            <form className="rest-editor" onSubmit={(event) => event.preventDefault()}>
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">{isNew ? "새 오류 코드" : "오류 코드 편집"}</p>
                  <h2><code>{draft.code.trim() || "코드 미입력"}</code></h2>
                </div>
                <div className="toolbar">
                  <span className={`save-state is-${issues.length ? "error" : dirty ? "dirty" : "clean"}`}>{issues.length ? `오류 ${issues.length}건 · 저장 안 됨` : dirty ? "저장되지 않은 변경" : isNew ? "새 항목" : `변경 없음 · v${baseVersion}`}</span>
                  {!isNew && selected ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                  <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button>
                  <button type="button" className="btn primary" disabled={saving || conflictVersion != null || (!isNew && !dirty)} title={!isNew && !dirty ? noChangeMessage : undefined} onClick={startSave}>{saving ? "저장 중" : "저장"}</button>
                  {saveOpen ? (
                    <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                      <Field label="변경 사유" required hint="이 오류 코드의 변경 이력에 기록됩니다." error={reasonError}>
                        <input
                          data-issue="code:reason"
                          aria-invalid={Boolean(reasonError)}
                          placeholder="예: 처리 방법에 재시도 안내 추가"
                          value={draft.changeReason}
                          onChange={(event) => { setReasonError(""); setDraft({ ...draft, changeReason: event.target.value }); }}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } }}
                        />
                      </Field>
                      <div className="save-pop-actions">
                        <button type="button" className="btn" onClick={() => setSaveOpen(false)}>닫기</button>
                        <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? "저장 중" : "저장"}</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </header>
              {notice ? <p className="banner rest-banner danger">{notice}</p> : null}
              <IssueSummary issues={issues} onPick={goToIssue} />
              {conflictVersion != null ? (
                <div className="banner rest-banner warning" role="alert">
                  다른 사용자가 먼저 저장해 서버의 최신 버전이 {conflictVersion}입니다. 입력한 내용은 그대로 남아 있습니다.
                  <button type="button" className="link-button" onClick={() => { if (window.confirm("다시 저장하면 이 오류 코드가 내 내용으로 바뀝니다.")) { const version = conflictVersion; setConflictVersion(null); setBaseVersion(version); void save(version, true); } }}>최신 버전 기준으로 다시 저장</button>
                </div>
              ) : null}
              {selected && selected.referenceCount > 0 ? <p className="banner rest-banner">이 코드는 규격 {selected.referenceCount}곳에서 참조 중입니다. 수정하면 연결은 유지되고, 바뀐 내용이 참조하는 곳에 그대로 표시됩니다.</p> : null}
              <section className="rest-card ec-form">
                <div className="rest-grid ec-basic-grid">
                  <Field label="코드" required error={codeError}>
                    <input className="mono" data-issue="code:code" aria-invalid={Boolean(codeError)} placeholder="예: E_TIMEOUT" value={draft.code} onChange={(event) => update({ ...draft, code: event.target.value })} />
                  </Field>
                  <Field label="분류" required hint={categories.length ? "기존 분류를 고르거나 새로 입력합니다." : "예: 인증, 통신, 장비"} error={errors.get("code:category")}>
                    <input data-issue="code:category" aria-invalid={Boolean(errors.get("code:category"))} list="error-code-categories" placeholder="예: 통신" value={draft.category} onChange={(event) => update({ ...draft, category: event.target.value })} />
                  </Field>
                </div>
                <datalist id="error-code-categories">{categories.map((item) => <option key={item} value={item} />)}</datalist>
                <div className="mqtt-examples ec-examples">
                  <span>코드 예시</span>
                  {codeExamples.map((example) => (
                    <button key={example} type="button" className="mqtt-example" onClick={() => { if (!draft.code.trim() || window.confirm(`현재 코드 '${draft.code.trim()}'를 '${example}'(으)로 바꿀까요?`)) update({ ...draft, code: example }); }}><code>{example}</code></button>
                  ))}
                  <em>형식은 자유입니다. 공백 없이 64자까지 입력한 그대로 저장됩니다.</em>
                </div>
                {duplicate.length > 0 && !codeError ? <p className="mqtt-note is-warning">주의: 같은 코드 '{duplicate[0].code}'가 이미 있어 저장할 수 없습니다.</p> : null}
                <Field label="설명" required error={errors.get("code:description")}>
                  {draft.description.includes("\n") ? (
                    <textarea data-issue="code:description" aria-invalid={Boolean(errors.get("code:description"))} rows={3} value={draft.description} onChange={(event) => update({ ...draft, description: event.target.value })} />
                  ) : (
                    <input data-issue="code:description" aria-invalid={Boolean(errors.get("code:description"))} placeholder="예: 장비 응답 시간이 초과되었습니다." value={draft.description} onChange={(event) => update({ ...draft, description: event.target.value })} />
                  )}
                </Field>
                <details className="ec-details" open={detailOpen} onToggle={(event) => setDetailOpen((event.target as HTMLDetailsElement).open)}>
                  <summary>상세 정보 (선택) · 발생 조건, 처리 방법{draft.conditionText.trim() || draft.handling.trim() ? " · 입력됨" : ""}</summary>
                  <div className="rest-grid two">
                    <Field label="발생 조건" error={errors.get("code:condition")}>
                      <textarea data-issue="code:condition" aria-invalid={Boolean(errors.get("code:condition"))} rows={3} placeholder="예: 요청 후 3초 동안 응답이 없을 때" value={draft.conditionText} onChange={(event) => update({ ...draft, conditionText: event.target.value })} />
                    </Field>
                    <Field label="처리 방법" error={errors.get("code:handling")}>
                      <textarea data-issue="code:handling" aria-invalid={Boolean(errors.get("code:handling"))} rows={3} placeholder="예: 1회 재시도 후 사용자에게 안내합니다." value={draft.handling} onChange={(event) => update({ ...draft, handling: event.target.value })} />
                    </Field>
                  </div>
                </details>
              </section>
            </form>
          ) : selected ? (
            <div className="rest-editor">
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">오류 코드 조회</p>
                  <h2><code>{selected.code}</code><button type="button" className="copy-chip" aria-label="코드 복사" onClick={() => void copyCode(selected.code)}>복사</button></h2>
                  <p className="mqtt-bar-meta">
                    <span>{selected.category}</span>
                    <span>{selected.referenceCount > 0 ? `참조 ${selected.referenceCount}건` : "참조 없음"}</span>
                    <span>Version {selected.version}</span>
                    <span>수정 {formatDate(selected.updatedAt)} · {selected.updatedBy.name}</span>
                  </p>
                </div>
                <div className="toolbar">
                  {canEdit ? <button type="button" className="btn primary" onClick={() => go(String(selected.id), "edit")}>편집</button> : null}
                </div>
              </header>
              {!canEdit ? <p className="banner rest-banner">{project.status !== "ACTIVE" ? "보관된 프로젝트는 조회만 할 수 있습니다." : "조회 권한입니다. 오류 코드를 수정할 수 없습니다."}</p> : null}
              <section className="rest-card rest-read">
                <dl className="rest-facts">
                  <div><dt>코드</dt><dd><code>{selected.code}</code></dd></div>
                  <div><dt>분류</dt><dd>{selected.category}</dd></div>
                  <div className="wide"><dt>설명</dt><dd className="rest-desc">{selected.description || <em>등록된 내용 없음</em>}</dd></div>
                  <div className="wide"><dt>발생 조건</dt><dd className="rest-desc">{selected.conditionText || <em>등록된 내용 없음</em>}</dd></div>
                  <div className="wide"><dt>처리 방법</dt><dd className="rest-desc">{selected.handling || <em>등록된 내용 없음</em>}</dd></div>
                </dl>
              </section>
              <section className="rest-card rest-read">
                <h3 className="mqtt-read-title">참조 중인 규격 <small>{selected.referenceCount}건</small></h3>
                {selected.usages.length === 0 ? <p className="rest-card-note">이 코드를 연결한 규격 항목이 없습니다. 각 규격의 편집 화면 '관련 오류 코드'에서 연결할 수 있습니다.</p> : (
                  <ul className="ec-usages">
                    {selected.usages.map((usage) => (
                      <li key={`${usage.kind}-${usage.itemUid}`}>
                        <span className="ec-kind">{kindLabel[usage.kind] ?? usage.kind}</span>
                        <Link to={`${specPath(projectId, usage.kind)}?item=${usage.itemUid}`}>{usage.itemName}</Link>
                        <small>{usage.title}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="rest-card rest-read">
                <details className="ec-history">
                  <summary>변경 이력 {revisions.length}건</summary>
                  {revisions.length === 0 ? <p className="rest-card-note">이력이 없습니다.</p> : (
                    <div className="byte-view-wrap">
                      <table className="byte-view">
                        <thead><tr><th>Version</th><th>작업</th><th>변경 사유</th><th>작성자</th><th>일시</th></tr></thead>
                        <tbody>
                          {revisions.map((revision) => (
                            <tr key={revision.version}>
                              <td className="num">{revision.version}</td>
                              <td>{operationLabel(revision.summary?.op)}</td>
                              <td className="ec-reason">{revision.changeReason}</td>
                              <td>{revision.actor.name}</td>
                              <td>{formatDate(revision.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {revisions.length >= 2 ? (
                    <div className="ec-compare">
                      <select aria-label="이전 버전" value={fromVersion} onChange={(event) => setFromVersion(event.target.value)}>
                        <option value="">이전 버전</option>
                        {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
                      </select>
                      <select aria-label="이후 버전" value={toVersion} onChange={(event) => setToVersion(event.target.value)}>
                        <option value="">이후 버전</option>
                        {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
                      </select>
                      <button type="button" className="btn" disabled={!fromVersion || !toVersion || fromVersion === toVersion} onClick={() => void runCompare()}>비교</button>
                    </div>
                  ) : null}
                  {compare ? (
                    <div className="compare-grid">
                      <div><h4>Version {compare.fromVersion}</h4><CodeBodyView body={compare.before} /></div>
                      <div><h4>Version {compare.toVersion}</h4><CodeBodyView body={compare.after} /></div>
                    </div>
                  ) : null}
                </details>
              </section>
            </div>
          ) : <p className="state-panel">오류 코드를 불러오는 중입니다.</p>}
        </section>
      </div>
    );
  }

  return (
    <main className="studio rest-studio mqtt-studio ec-studio">
      <div className="studio-main">
        {header}
        {body}
        {confirmDelete && selected ? (
          <div className="modal-backdrop">
            <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeCode(); }}>
              <h2>오류 코드 {selected.code} 삭제</h2>
              {selected.referenceCount > 0 ? (
                <>
                  <p>규격 {selected.referenceCount}곳에서 참조 중이라 삭제할 수 없습니다. 아래 항목의 '관련 오류 코드' 연결을 먼저 해제해 주세요.</p>
                  <ul className="ec-usages">
                    {selected.usages.map((usage) => <li key={`${usage.kind}-${usage.itemUid}`}><span className="ec-kind">{kindLabel[usage.kind] ?? usage.kind}</span>{usage.itemName}</li>)}
                  </ul>
                  <div className="form-actions"><button type="button" onClick={() => setConfirmDelete(false)}>닫기</button></div>
                </>
              ) : (
                <>
                  <p>목록에서 숨겨지고, 변경 이력은 남습니다. 현재 이 코드를 참조하는 규격은 없습니다.</p>
                  <label>변경 사유<input value={deleteReason} placeholder="예: 사용하지 않는 코드 정리" onChange={(event) => setDeleteReason(event.target.value)} /></label>
                  <div className="form-actions">
                    <button type="submit" className="danger" disabled={saving}>삭제 확인</button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>취소</button>
                  </div>
                </>
              )}
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function CodeBodyView({ body }: { body: CodeBody }) {
  return (
    <dl className="ec-body">
      <dt>코드</dt><dd>{body.code}</dd>
      <dt>분류</dt><dd>{body.category}</dd>
      <dt>설명</dt><dd>{body.description}</dd>
      <dt>발생 조건</dt><dd>{body.conditionText || "없음"}</dd>
      <dt>처리 방법</dt><dd>{body.handling || "없음"}</dd>
    </dl>
  );
}
