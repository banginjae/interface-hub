import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome, useSidebarSlot } from "../Shell";
import { ErrorCodePicker } from "../spec/ErrorCodePicker";
import { JsonBlock } from "../spec/jsonView";
import { SchemaTable } from "../spec/SchemaTable";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import {
  blankItem,
  blankResponse,
  draftKey,
  fieldFromApi,
  fieldToApi,
  itemError,
  itemFromApi,
  itemToPayload,
  pathWarning,
  previewText,
  type ExampleDraft,
  type FieldNode,
  type ItemDraft,
  type SpecDocument,
  type SpecItem,
} from "../spec/specModel";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const authTypes = ["NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM"];

type OverviewDraft = {
  title: string;
  baseUrl: string;
  authType: string;
  authDescription: string;
  headers: FieldNode[];
  changeReason: string;
};

type ConflictView = {
  currentVersion: number;
  latest: SpecItem | null;
  notes: string[];
};

export function SpecPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [spec, setSpec] = useState<SpecDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<OverviewDraft | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overviewLock, setOverviewLock] = useState<number | null>(null);
  const [panel, setPanel] = useState<"spec" | "history" | "markdown">("spec");
  const [tab, setTab] = useState<"request" | "response" | "params" | "errors">("request");
  const [responseIndex, setResponseIndex] = useState(0);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const sidebar = useSidebarSlot();
  const openItemRef = useRef<(uid: string) => void>(() => undefined);
  const appliedItem = useRef<string | null>(null);
  usePageChrome(project?.title ?? "API 규격", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "API 규격" },
  ]);
  useNavGuard(() => guardDirty(), dirty);

  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));

  async function loadSpec(token: string) {
    const detail = await apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token });
    setProject(detail);
    try {
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/API`, { token });
      setSpec(document);
      setMissing(false);
      setOverview((current) => (current && current.changeReason.trim() ? current : overviewFrom(document)));
      setBaseVersion((current) => (dirty ? current : document.version));
      return document;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setSpec(null);
        setMissing(true);
        return null;
      }
      throw error;
    }
  }

  useEffect(() => {
    if (!auth.token || !projectId) {
      return;
    }
    let cancel = false;
    setLoading(true);
    loadSpec(auth.token)
      .catch((error: unknown) => {
        if (cancel) {
          return;
        }
        if (error instanceof ApiError && error.status === 403) {
          setDenied(true);
          return;
        }
        setNotice(error instanceof ApiError && error.status === 401 ? "로그인이 만료되었습니다." : authErrorMessage(error));
      })
      .finally(() => {
        if (!cancel) {
          setLoading(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!spec || !draft || !selectedUid || !dirty) {
      return;
    }
    sessionStorage.setItem(draftKey(spec.id, selectedUid, baseVersion), JSON.stringify({ official: false, draft }));
  }, [spec, draft, selectedUid, dirty, baseVersion]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  useEffect(() => {
    sidebar?.setOverride(true);
    return () => sidebar?.setOverride(false);
  }, [sidebar]);

  useEffect(() => {
    const view = searchParams.get("view");
    if (view === "history" || view === "markdown") {
      setPanel(view);
    }
    const item = searchParams.get("item");
    if (!item || !spec || appliedItem.current === item) {
      return;
    }
    appliedItem.current = item;
    openItemRef.current(item);
  }, [searchParams, spec]);

  if (!auth.ready) {
    return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  if (denied) {
    return <main className="spec-screen"><h1>API 규격</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
  }
  if (loading) {
    return <main className="spec-screen"><p className="state-panel">불러오는 중입니다.</p></main>;
  }
  if (!project) {
    return <main className="spec-screen"><p>{notice || "프로젝트를 찾지 못했습니다."}</p></main>;
  }

  function guardDirty() {
    return !dirty || window.confirm("저장하지 않은 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 남습니다.");
  }

  function openItem(uid: string, document = spec, edit = editing) {
    if (!document) {
      return;
    }
    setSelectedUid(uid);
    setConflict(null);
    setConfirmDelete(false);
    setRestored(false);
    if (!edit) {
      setDraft(null);
      setDirty(false);
      return;
    }
    const found = document.items.find((item) => item.itemUid === uid);
    const official = found ? itemFromApi(found) : blankItem();
    const saved = sessionStorage.getItem(draftKey(document.id, uid, document.version));
    if (saved) {
      const parsed = JSON.parse(saved) as { draft?: ItemDraft };
      if (parsed.draft) {
        setDraft(parsed.draft);
        setDirty(true);
        setRestored(true);
        setBaseVersion(document.version);
        return;
      }
    }
    setDraft(official);
    setDirty(uid === "new");
    setBaseVersion(document.version);
  }

  function choose(uid: string) {
    if (!guardDirty()) {
      return;
    }
    openItem(uid);
  }

  function beginEndpoint() {
    if (!spec || !guardDirty()) {
      return;
    }
    setEditing(true);
    setSelectedUid("new");
    setDraft(blankItem());
    setDirty(true);
    setConflict(null);
    setBaseVersion(spec.version);
    setRestored(false);
  }

  function updateDraft(next: ItemDraft) {
    setDraft(next);
    setDirty(true);
  }

  async function createDocument() {
    if (!auth.token || !canEdit) {
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "API", title: "API 규격" } });
      await loadSpec(auth.token);
      setNotice("API 규격 문서를 만들었습니다.");
    } catch (error) {
      setNotice(authErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) {
      return;
    }
    if (!overview.changeReason.trim() || !overview.title.trim()) {
      setNotice("문서 제목과 변경 사유를 입력하세요.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/API`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: overviewLock ?? spec.version,
          changeReason: overview.changeReason.trim(),
          title: overview.title.trim(),
          overview: {
            baseUrl: overview.baseUrl.trim(),
            auth: { type: overview.authType, description: overview.authDescription.trim() },
            commonHeaders: overview.headers.map((field) => fieldToApi(field)),
          },
        },
      });
      void result;
      setOverviewLock(null);
      const document = await loadSpec(auth.token);
      if (document) {
        setOverview({ ...overviewFrom(document), changeReason: "" });
      }
      if (document && !dirty) {
        setBaseVersion(document.version);
      } else if (document && dirty) {
        setBaseVersion(document.version);
        setNotice("문서 상단을 저장했습니다. 편집중인 Endpoint 초안은 유지됩니다.");
        return;
      }
      setNotice("문서 상단을 저장했습니다.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setOverviewLock(error.currentVersion ?? null);
        setNotice("다른 사용자가 문서를 먼저 저장했습니다. 문서 상단 입력은 유지됩니다. 아래 버튼을 눌러야 최신 버전으로 다시 저장합니다.");
      } else {
        setNotice(authErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(version = baseVersion, create = selectedUid === "new") {
    if (!auth.token || !spec || !draft || saving) {
      return;
    }
    const problem = itemError(draft);
    if (problem) {
      setNotice(problem);
      return;
    }
    setSaving(true);
    setNotice("");
    const body = {
      version,
      changeReason: draft.changeReason.trim(),
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      status: draft.status,
      payload: itemToPayload(draft),
      errorCodeIds: draft.errorCodeIds ?? [],
    };
    try {
      const path = create
        ? `/api/projects/${projectId}/specs/API/items`
        : `/api/projects/${projectId}/specs/API/items/${selectedUid}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, {
        method: create ? "POST" : "PUT",
        token: auth.token,
        body,
      });
      sessionStorage.removeItem(draftKey(spec.id, selectedUid ?? "new", baseVersion));
      const document = await loadSpec(auth.token);
      const uid = result.itemUid ?? selectedUid;
      setDirty(false);
      setConflict(null);
      setRestored(false);
      setEditing(true);
      if (document && uid) {
        const saved = document.items.find((item) => item.itemUid === uid);
        setSelectedUid(uid);
        setDraft(saved ? itemFromApi(saved) : draft);
        setBaseVersion(document.version);
      }
      setNotice(`저장했습니다. 문서 버전 ${result.version}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && selectedUid !== "new") {
        setNotice("이 Endpoint는 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.");
        const latest = await loadSpec(auth.token);
        if (latest) {
          setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 Endpoint가 삭제되었습니다."] });
        }
      } else {
        setNotice(error instanceof ApiError && error.code === "EXAMPLE_SCHEMA_MISMATCH"
          ? "예시가 필드 구조와 맞지 않아 저장하지 않았습니다. 입력은 그대로입니다."
          : authErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function showConflict(currentVersion?: number) {
    if (!auth.token || !spec) {
      return;
    }
    const latest = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/API`, { token: auth.token });
    const previous = spec.items.map((item) => `${item.itemUid}:${item.name}`);
    const notes = latest.items
      .filter((item) => item.itemUid !== selectedUid && !previous.includes(`${item.itemUid}:${item.name}`))
      .map((item) => `${item.payload.method ?? ""} ${item.payload.path ?? item.name}`.trim());
    const removed = spec.items
      .filter((item) => item.itemUid !== selectedUid && !latest.items.some((next) => next.itemUid === item.itemUid))
      .map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setOverview((current) => (current && current.changeReason.trim() ? current : overviewFrom(latest)));
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === selectedUid) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    setNotice("다른 사용자가 먼저 저장했습니다. 이 항목의 입력은 남아 있습니다. 다른 항목은 이 저장에 포함되지 않습니다.");
  }

  async function saveWithLatest() {
    if (!conflict) {
      return;
    }
    if (conflict.latest && !window.confirm("다시 저장하면 이 항목만 내 내용으로 바뀝니다.")) {
      return;
    }
    await saveItem(conflict.currentVersion, !conflict.latest);
  }

  async function removeItem() {
    if (!auth.token || !spec || !selectedUid || selectedUid === "new" || !deleteReason.trim()) {
      setNotice("삭제 사유를 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/API/items/${selectedUid}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, selectedUid, baseVersion));
      setDraft(null);
      setSelectedUid(null);
      setDirty(false);
      setConfirmDelete(false);
      setDeleteReason("");
      await loadSpec(auth.token);
      setNotice(`Endpoint를 삭제했습니다. 문서 버전 ${result.version}`);
    } catch (error) {
      setNotice(error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT"
        ? "다른 저장이 먼저 반영되어 삭제하지 않았습니다."
        : authErrorMessage(error));
      if (auth.token) {
        await loadSpec(auth.token);
      }
    } finally {
      setSaving(false);
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    if (!auth.token || !spec || query.trim()) {
      return;
    }
    if (dirty && !window.confirm("저장하지 않은 Endpoint 수정은 순서 변경에 포함되지 않습니다.")) {
      return;
    }
    const target = index + direction;
    const uids = spec.items.map((item) => item.itemUid);
    if (target < 0 || target >= uids.length) {
      return;
    }
    const [moved] = uids.splice(index, 1);
    uids.splice(target, 0, moved);
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/specs/API/items/order`, {
        method: "PUT",
        token: auth.token,
        body: { version: spec.version, changeReason: "Endpoint 순서 변경", itemUids: uids },
      });
      const document = await loadSpec(auth.token);
      if (document && !dirty) {
        setBaseVersion(document.version);
      }
      setNotice("순서를 저장했습니다.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "ITEM_SET_CHANGED") {
        setNotice("항목 목록이 변경되어 순서를 바꾸지 않았습니다.");
        if (auth.token) {
          await loadSpec(auth.token);
        }
      } else {
        setNotice(authErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  const selected = spec?.items.find((item) => item.itemUid === selectedUid) ?? null;
  const visible = (spec?.items ?? []).filter((item) => {
    const text = `${item.name} ${item.summary} ${item.payload.method ?? ""} ${item.payload.path ?? ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const writer = Boolean(canEdit && editing && draft);
  const responseCursor = draft ? Math.min(responseIndex, Math.max(draft.responses.length - 1, 0)) : 0;
  const activeExample: ExampleDraft | null = draft
    ? (tab === "response" ? draft.responses[responseCursor] ?? null : draft.requestBody)
    : null;
  const preview = activeExample ? previewText(activeExample) : null;
  const storedPreview = !draft && selected
    ? (tab === "response"
      ? JSON.stringify(selected.payload.responses?.[responseCursor]?.example ?? {}, null, 2)
      : JSON.stringify(selected.payload.requestBody?.example ?? {}, null, 2))
    : "";
  const jsonText = preview?.text || storedPreview;
  const jsonTitle = tab === "response"
    ? `Response ${draft?.responses[responseCursor]?.status ?? selected?.payload.responses?.[responseCursor]?.status ?? ""} JSON`
    : "Request JSON";
  const missingPath = draft ? pathWarning(draft.path, draft.pathParams) : [];
  const tone = saveTone(notice, dirty, saving, Boolean(conflict));
  openItemRef.current = (uid: string) => {
    if (!spec || uid === selectedUid || !spec.items.some((item) => item.itemUid === uid)) {
      return;
    }
    if (!guardDirty()) {
      return;
    }
    openItem(uid, spec, canEdit);
  };

  const side = sidebar?.slot && spec ? createPortal(
    <div className="side-scroll">
      <Link className="nav-item" to={`/projects/${project.id}`} onClick={(event) => { if (!guardDirty()) event.preventDefault(); }}>← {project.title}</Link>
      <button type="button" className="nav-item" onClick={() => setDocOpen((open) => !open)}>문서 정보 <small>Base URL</small></button>
      <input className="search" aria-label="Endpoint 검색" placeholder="Endpoint 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
      <p className="side-label">ENDPOINT</p>
      {visible.map((item) => {
        const index = spec.items.findIndex((candidate) => candidate.itemUid === item.itemUid);
        return (
          <div key={item.itemUid}>
            <button type="button" className="endpoint" aria-current={item.itemUid === selectedUid} onClick={() => choose(item.itemUid)}>
              <span className={`method method-${(item.payload.method ?? "get").toLowerCase()}`}>{item.payload.method}</span>
              <span className="path"><code>{item.payload.path}</code><em>{item.name}</em></span>
            </button>
            {canEdit && editing && !query.trim() ? (
              <span className="order-actions">
                <button type="button" onClick={() => reorder(index, -1)} disabled={saving || index === 0}>위</button>
                <button type="button" onClick={() => reorder(index, 1)} disabled={saving || index === spec.items.length - 1}>아래</button>
              </span>
            ) : null}
          </div>
        );
      })}
      {spec.items.length === 0 ? <p className="side-label">아직 Endpoint가 없습니다.</p> : null}
      {canEdit ? <button type="button" className="add-endpoint" onClick={beginEndpoint}>+ Endpoint 추가</button> : null}
      {query.trim() ? <p className="side-label">검색 중에는 순서를 바꾸지 않습니다.</p> : null}
      <p className="side-label">이 문서</p>
      <button type="button" className="nav-item" onClick={() => { if (guardDirty()) setPanel("history"); }}>변경 이력 <small>v{spec.version}</small></button>
      <button type="button" className="nav-item" onClick={() => { if (guardDirty()) setPanel("markdown"); }}>Markdown</button>
      {canEdit ? (
        <button type="button" className="nav-item" onClick={() => {
          if (editing) {
            if (guardDirty()) {
              setEditing(false);
              setDirty(false);
              setDraft(null);
            }
            return;
          }
          setEditing(true);
          if (selectedUid && spec) {
            openItem(selectedUid, spec, true);
          }
        }}>{editing ? "조회로 전환" : "편집"}</button>
      ) : null}
    </div>,
    sidebar.slot,
  ) : null;

  function setMode(example: ExampleDraft, exampleMode: "AUTO" | "MANUAL", apply: (next: ExampleDraft) => void) {
    if (exampleMode === "MANUAL" && !example.manualText) {
      const generated = previewText({ ...example, exampleMode: "AUTO" });
      apply({ ...example, exampleMode, manualText: generated.text || "{}" });
      setJsonOpen(true);
      return;
    }
    apply({ ...example, exampleMode });
    if (exampleMode === "MANUAL") {
      setJsonOpen(true);
    }
  }

  function applyExample(next: ExampleDraft) {
    if (!draft) {
      return;
    }
    if (tab === "response") {
      updateResponse(responseCursor, { ...draft.responses[responseCursor], ...next });
      return;
    }
    updateDraft({ ...draft, requestBody: next });
  }

  return (
    <main className="studio">
      {side}
      <div className="studio-main">
        {project.status !== "ACTIVE" ? <p className="banner warning">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
        {!canEdit && project.status === "ACTIVE" ? <p className="banner">조회 권한입니다. 규격을 수정할 수 없습니다.</p> : null}
        {notice ? <p className={noticeClass(notice)}>{notice}</p> : null}
        {panel === "history" ? (spec && auth.token ? <div className="studio-doc"><SpecHistory projectId={projectId} token={auth.token} /></div> : <div className="studio-doc"><h2>아직 API 규격 문서가 없습니다.</h2></div>) : null}
        {panel === "markdown" ? (spec && auth.token ? <div className="studio-doc"><SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} /></div> : <div className="studio-doc"><h2>아직 API 규격 문서가 없습니다.</h2></div>) : null}
        {panel === "spec" && missing ? (
          <section className="studio-doc">
            <h2>아직 API 규격 문서가 없습니다.</h2>
            <p>이 프로젝트의 REST API 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 Endpoint를 추가합니다.</p>
            {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>API 규격 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
          </section>
        ) : null}
        {panel === "spec" && spec && overview && docOpen ? (
          <section className="doc-box">
            <h2>문서 정보</h2>
            <p>Endpoint 저장과 별도로 문서 상단만 저장합니다.</p>
            <div className="field-grid">
              <label>제목<input value={overview.title} disabled={!canEdit} onChange={(event) => setOverview({ ...overview, title: event.target.value })} /></label>
              <label>Base URL<input value={overview.baseUrl} disabled={!canEdit} onChange={(event) => setOverview({ ...overview, baseUrl: event.target.value })} /></label>
              <label>공통 인증
                <select value={overview.authType} disabled={!canEdit} onChange={(event) => setOverview({ ...overview, authType: event.target.value })}>
                  {authTypes.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label>인증 설명<input value={overview.authDescription} disabled={!canEdit} onChange={(event) => setOverview({ ...overview, authDescription: event.target.value })} /></label>
            </div>
            <h3>공통 헤더</h3>
            <SchemaTable fields={overview.headers} readOnly={!canEdit} onChange={canEdit ? (headers) => setOverview({ ...overview, headers }) : undefined} />
            {canEdit ? (
              <>
                <label>변경 사유<input value={overview.changeReason} onChange={(event) => setOverview({ ...overview, changeReason: event.target.value })} /></label>
                <button type="button" className="btn primary" disabled={saving} onClick={saveOverview}>{overviewLock ? "문서 상단을 최신 버전 기준으로 저장" : "문서 상단 저장"}</button>
              </>
            ) : null}
          </section>
        ) : null}
        {panel === "spec" && spec && !draft && !selected ? (
          <section className="studio-doc">
            <h2>{spec.items.length === 0 ? "아직 등록된 Endpoint가 없습니다." : "Endpoint를 선택하세요."}</h2>
            <p>왼쪽 목록에서 Method와 Path를 고치거나 새 Endpoint를 추가합니다.</p>
            {canEdit && spec.items.length === 0 ? <button type="button" className="btn primary" onClick={beginEndpoint}>+ 첫 Endpoint 추가</button> : null}
          </section>
        ) : null}
        {panel === "spec" && spec && (draft || selected) ? (
          <form onSubmit={(event) => event.preventDefault()}>
            <div className="editor-top">
              <div className="identity">
                <div className="path-input">
                  <select aria-label="Method" value={draft?.method ?? selected?.payload.method ?? "GET"} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, method: event.target.value })}>
                    {methods.map((method) => <option key={method}>{method}</option>)}
                  </select>
                  <input aria-label="Path" value={draft?.path ?? selected?.payload.path ?? ""} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, path: event.target.value })} />
                </div>
                <div className="names">
                  <label>이름<input value={draft?.name ?? selected?.name ?? ""} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, name: event.target.value })} /></label>
                  <label>요약<input value={draft?.summary ?? selected?.summary ?? ""} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, summary: event.target.value })} /></label>
                  <label>설명<input value={draft?.description ?? selected?.payload.description ?? ""} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, description: event.target.value })} /></label>
                </div>
              </div>
              <div className="toolbar">
                <span className={`save-state is-${tone}`}>{saveLabel(tone, notice, spec.version, conflict?.currentVersion)}</span>
                <button type="button" className="btn" onClick={() => setJsonOpen((open) => !open)}>{jsonOpen ? "예시 닫기" : "예시"}</button>
                {writer ? <button type="button" className="btn primary" disabled={saving || Boolean(conflict)} onClick={() => setSaveOpen((open) => !open)}>{saving ? "저장 중" : "저장"}</button> : null}
                {writer && selectedUid !== "new" ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                {writer && saveOpen ? (
                  <div className="save-pop">
                    <label>변경 사유<input value={draft?.changeReason ?? ""} onChange={(event) => draft && updateDraft({ ...draft, changeReason: event.target.value })} /></label>
                    <button type="button" className="btn primary" disabled={saving || Boolean(conflict)} onClick={() => { if (!conflict) void saveItem(); }}>{saving ? "저장 중" : "이 버전으로 저장"}</button>
                  </div>
                ) : null}
              </div>
            </div>
            {missingPath.length > 0 ? <p className="banner warning">경로의 {missingPath.map((name) => `{${name}}`).join(", ")}가 Path Parameter에 없습니다. 저장은 가능합니다.</p> : null}
            {restored && writer ? (
              <p className="banner">임시 초안을 복구했습니다. 아직 공식 규격이 아닙니다.
                <button type="button" onClick={() => { if (selected && spec) { setDraft(itemFromApi(selected)); setDirty(false); setRestored(false); sessionStorage.removeItem(draftKey(spec.id, selected.itemUid, baseVersion)); } }}>공식 규격으로 되돌리기</button>
              </p>
            ) : null}
            <div className={jsonOpen ? "studio-work is-json" : "studio-work"}>
              <div className="studio-doc">
                <div className="tabs" role="tablist">
                  <button type="button" aria-selected={tab === "request"} onClick={() => setTab("request")}>요청</button>
                  {(draft ? draft.responses : selected?.payload.responses ?? []).map((response, index) => (
                    <button type="button" key={`${"status" in response ? response.status : index}-${index}`} aria-selected={tab === "response" && responseCursor === index} onClick={() => { setTab("response"); setResponseIndex(index); }}>
                      응답 {"status" in response ? response.status : ""}
                    </button>
                  ))}
                  {writer ? <button type="button" onClick={() => { const next = blankResponse(String(200 + (draft?.responses.length ?? 0))); updateDraft({ ...draft!, responses: [...draft!.responses, next] }); setTab("response"); setResponseIndex(draft!.responses.length); }}>+ 응답</button> : null}
                  <button type="button" aria-selected={tab === "params"} onClick={() => setTab("params")}>Header · Path · Query</button>
                  <button type="button" aria-selected={tab === "errors"} onClick={() => setTab("errors")}>오류 코드</button>
                </div>
                {tab === "request" ? (
                  <SchemaTable
                    fields={draft ? draft.requestBody.fields : (selected?.payload.requestBody?.fields ?? []).map((field) => fieldFromApi(field))}
                    readOnly={!writer}
                    onChange={writer ? (fields) => updateDraft({ ...draft!, requestBody: { ...draft!.requestBody, fields } }) : undefined}
                  />
                ) : null}
                {tab === "response" && draft?.responses[responseCursor] ? (
                  <div>
                    <div className="names">
                      <label>이름<input value={draft.responses[responseCursor].name} disabled={!writer} onChange={(event) => updateResponse(responseCursor, { ...draft.responses[responseCursor], name: event.target.value })} /></label>
                      <label>상태 코드<input value={draft.responses[responseCursor].status} disabled={!writer} onChange={(event) => updateResponse(responseCursor, { ...draft.responses[responseCursor], status: event.target.value })} /></label>
                      <label>설명<input value={draft.responses[responseCursor].description} disabled={!writer} onChange={(event) => updateResponse(responseCursor, { ...draft.responses[responseCursor], description: event.target.value })} /></label>
                    </div>
                    <SchemaTable
                      fields={draft.responses[responseCursor].fields}
                      readOnly={!writer}
                      onChange={writer ? (fields) => updateResponse(responseCursor, { ...draft.responses[responseCursor], fields }) : undefined}
                    />
                    {writer && draft.responses.length > 1 ? <button type="button" className="btn danger" onClick={() => { updateDraft({ ...draft, responses: draft.responses.filter((_, index) => index !== responseCursor) }); setResponseIndex(0); }}>이 응답 삭제</button> : null}
                  </div>
                ) : null}
                {tab === "response" && !draft && selected?.payload.responses?.[responseCursor] ? (
                  <div>
                    <p>{selected.payload.responses[responseCursor].name} · {selected.payload.responses[responseCursor].description}</p>
                    <SchemaTable fields={(selected.payload.responses[responseCursor].fields ?? []).map((field) => fieldFromApi(field))} readOnly />
                  </div>
                ) : null}
                {tab === "params" ? (
                  <div>
                    <section className="param-block">
                      <h3>Header</h3>
                      <SchemaTable fields={draft ? draft.headers : (selected?.payload.headers ?? []).map((field) => fieldFromApi(field))} readOnly={!writer} onChange={writer ? (headers) => updateDraft({ ...draft!, headers }) : undefined} />
                    </section>
                    <section className="param-block">
                      <h3>Path</h3>
                      <SchemaTable fields={draft ? draft.pathParams : (selected?.payload.pathParams ?? []).map((field) => fieldFromApi(field))} readOnly={!writer} onChange={writer ? (pathParams) => updateDraft({ ...draft!, pathParams }) : undefined} />
                    </section>
                    <section className="param-block">
                      <h3>Query</h3>
                      <SchemaTable fields={draft ? draft.queryParams : (selected?.payload.queryParams ?? []).map((field) => fieldFromApi(field))} readOnly={!writer} onChange={writer ? (queryParams) => updateDraft({ ...draft!, queryParams }) : undefined} />
                    </section>
                    <section className="param-block auth-grid">
                      <label>인증
                        <select value={draft?.authType ?? selected?.payload.auth?.type ?? "NONE"} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, authType: event.target.value })}>
                          {authTypes.map((type) => <option key={type}>{type}</option>)}
                        </select>
                      </label>
                      <label>인증 설명<input value={draft?.authDescription ?? selected?.payload.auth?.description ?? ""} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, authDescription: event.target.value })} /></label>
                      <label className="check"><input type="checkbox" checked={draft?.useDocumentAuth ?? Boolean(selected?.payload.auth?.useDocumentAuth)} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, useDocumentAuth: event.target.checked })} />문서 공통 인증 사용</label>
                      <label>상태
                        <select value={draft?.status ?? selected?.status ?? "ACTIVE"} disabled={!writer} onChange={(event) => draft && updateDraft({ ...draft, status: event.target.value as ItemDraft["status"] })}>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="DEPRECATED">DEPRECATED</option>
                        </select>
                      </label>
                    </section>
                  </div>
                ) : null}
                {tab === "errors" && auth.token && draft ? (
                  <ErrorCodePicker projectId={projectId} token={auth.token} selected={draft.errorCodeIds ?? []} onChange={(errorCodeIds) => updateDraft({ ...draft, errorCodeIds })} />
                ) : null}
                {tab === "errors" && !draft ? (
                  <div>
                    {(selected?.errorCodes ?? []).length === 0 ? <p>연결된 오류 코드가 없습니다.</p> : (selected?.errorCodes ?? []).map((code) => (
                      <p key={code.id}><code>{code.code}</code> {code.category} · {code.description}</p>
                    ))}
                  </div>
                ) : null}
                {writer && activeExample && activeExample.exampleMode === "MANUAL" && !jsonOpen ? (
                  <label className="manual-box">직접 입력 JSON
                    <textarea value={activeExample.manualText} onChange={(event) => applyExample({ ...activeExample, manualText: event.target.value })} />
                  </label>
                ) : null}
              </div>
              {jsonOpen ? (
                <aside className="json-panel">
                  <header>
                    <h2>{jsonTitle}</h2>
                    <div className="seg">
                      {writer && activeExample ? (
                        <>
                          <button type="button" aria-pressed={activeExample.exampleMode === "AUTO"} onClick={() => setMode(activeExample, "AUTO", applyExample)}>자동</button>
                          <button type="button" aria-pressed={activeExample.exampleMode === "MANUAL"} onClick={() => setMode(activeExample, "MANUAL", applyExample)}>직접</button>
                        </>
                      ) : null}
                      <button type="button" className="copy" onClick={() => { void navigator.clipboard.writeText(jsonText || "{}"); setNotice("JSON을 복사했습니다."); }}>복사</button>
                    </div>
                  </header>
                  {preview?.problem ? <p>{preview.problem}</p> : null}
                  {writer && activeExample?.exampleMode === "MANUAL" ? (
                    <textarea aria-label="직접 입력 JSON" value={activeExample.manualText} onChange={(event) => applyExample({ ...activeExample, manualText: event.target.value })} />
                  ) : (
                    <JsonBlock text={jsonText || "{}"} />
                  )}
                </aside>
              ) : null}
            </div>
            {confirmDelete ? (
              <div className="modal-backdrop">
                <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                  <h2>Endpoint 삭제</h2>
                  <p>이 Endpoint만 삭제합니다. 문서와 다른 Endpoint는 남습니다.</p>
                  <label>변경 사유<input value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} /></label>
                  <div className="form-actions">
                    <button type="submit" className="danger" disabled={saving}>삭제 확인</button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>취소</button>
                  </div>
                </form>
              </div>
            ) : null}
            {conflict ? (
              <section className="conflict-box">
                <h3>버전 충돌</h3>
                <p>서버의 최신 문서 버전은 {conflict.currentVersion}입니다. 입력은 남아 있고, 확인 없이 덮어쓰지 않습니다.</p>
                {conflict.notes.length > 0 ? <ul>{conflict.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>다른 Endpoint 이름 변경은 없습니다.</p>}
                <div className="compare-grid">
                  <div>
                    <h4>내 입력</h4>
                    <pre>{draft ? `${draft.method} ${draft.path}\n${previewText(draft.requestBody).text}` : ""}</pre>
                  </div>
                  <div>
                    <h4>서버 최신</h4>
                    <pre>{conflict.latest ? `${conflict.latest.payload.method} ${conflict.latest.payload.path}\n${JSON.stringify(conflict.latest.payload.requestBody?.example ?? {}, null, 2)}` : "서버에 이 Endpoint가 없습니다."}</pre>
                  </div>
                </div>
                <button type="button" className="btn primary" disabled={saving} onClick={() => void saveWithLatest()}>{conflict.latest ? "이 항목을 최신 버전 기준으로 저장" : "새 항목으로 저장"}</button>
              </section>
            ) : null}
          </form>
        ) : null}
      </div>
    </main>
  );

  function updateResponse(index: number, next: ItemDraft["responses"][number]) {
    if (!draft) {
      return;
    }
    updateDraft({ ...draft, responses: draft.responses.map((response, responseIndex) => (responseIndex === index ? next : response)) });
  }
}

function saveTone(notice: string, dirty: boolean, saving: boolean, conflict: boolean) {
  if (conflict) return "conflict";
  if (saving) return "saving";
  if (notice && noticeClass(notice) === "banner danger") return "error";
  if (dirty) return "dirty";
  if (notice && (noticeClass(notice) === "banner success" || notice.includes("복사"))) return "saved";
  return "clean";
}

function saveLabel(tone: string, notice: string, version: number, conflictVersion?: number) {
  if (tone === "conflict") return `버전 충돌 · 서버 v${conflictVersion ?? ""}`;
  if (tone === "saving") return "저장 중";
  if (tone === "error") return "유효성 검사 오류";
  if (tone === "dirty") return "저장되지 않은 변경";
  if (tone === "saved") return notice || `저장됨 · v${version}`;
  return `저장됨 · v${version}`;
}

function noticeClass(notice: string) {
  if (notice.includes("저장했습니다") || notice.includes("삭제했습니다") || notice.includes("만들었습니다") || notice.includes("순서를 저장") || notice.includes("복사했습니다")) {
    return "banner success";
  }
  if (notice.includes("먼저 저장") || notice.includes("충돌") || notice.includes("유지")) {
    return "banner warning";
  }
  return "banner danger";
}

function overviewFrom(document: SpecDocument): OverviewDraft {
  return {
    title: document.title,
    baseUrl: document.overview.baseUrl ?? "",
    authType: document.overview.auth?.type ?? "NONE",
    authDescription: document.overview.auth?.description ?? "",
    headers: (document.overview.commonHeaders ?? []).map((field) => fieldFromApi(field)),
    changeReason: "",
  };
}
