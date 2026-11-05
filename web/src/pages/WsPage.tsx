import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { ErrorCodePicker, LinkedErrorCodes } from "../spec/ErrorCodePicker";
import { FieldTreeEditor } from "../spec/FieldTreeEditor";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import { draftKey, previewText, type SpecDocument, type SpecItem } from "../spec/specModel";
import {
  blankWs,
  closeCodeError,
  directionBadge,
  directionText,
  kindText,
  wsDirections,
  wsError,
  wsFromApi,
  wsKinds,
  wsToPayload,
  type CloseCodeDraft,
  type WsDraft,
  type WsOverviewDraft,
} from "../spec/wsModel";

const authTypes = ["NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM"];

type ConflictView = { currentVersion: number; latest: SpecItem | null; notes: string[] };

export function WsPage() {
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
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<WsDraft | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<WsOverviewDraft | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overviewLock, setOverviewLock] = useState<number | null>(null);
  const [panel, setPanel] = useState<"spec" | "history" | "markdown">("spec");
  usePageChrome(project?.title ?? "WebSocket 규격", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "WebSocket 규격" },
  ]);
  useNavGuard(() => guardDirty(), dirty);
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));

  async function loadSpec(token: string) {
    const detail = await apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token });
    setProject(detail);
    try {
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/WEBSOCKET`, { token });
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
    if (!auth.token || !projectId) return;
    let cancel = false;
    setLoading(true);
    loadSpec(auth.token)
      .catch((error: unknown) => {
        if (cancel) return;
        if (error instanceof ApiError && error.status === 403) {
          setDenied(true);
          return;
        }
        setNotice(authErrorMessage(error));
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!spec || !draft || !selectedUid || !dirty) return;
    sessionStorage.setItem(draftKey(spec.id, selectedUid, baseVersion), JSON.stringify({ official: false, draft }));
  }, [spec, draft, selectedUid, dirty, baseVersion]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  if (!auth.ready) return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) return <main className="spec-screen"><h1>WebSocket 규격</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
  if (loading) return <main className="spec-screen"><p className="state-panel">불러오는 중입니다.</p></main>;
  if (!project) return <main className="spec-screen"><p>{notice || "프로젝트를 찾지 못했습니다."}</p></main>;

  function guardDirty() {
    return !dirty || window.confirm("저장하지 않은 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 남습니다.");
  }

  function openItem(uid: string, document = spec, edit = editing) {
    if (!document) return;
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
    const official = found ? wsFromApi(found) : blankWs();
    const saved = sessionStorage.getItem(draftKey(document.id, uid, document.version));
    if (saved) {
      const parsed = JSON.parse(saved) as { draft?: WsDraft };
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

  function updateDraft(next: WsDraft) {
    setDraft(next);
    setDirty(true);
  }

  async function createDocument() {
    if (!auth.token || !canEdit) return;
    setSaving(true);
    setNotice("");
    try {
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "WEBSOCKET", title: "WebSocket 규격" } });
      await loadSpec(auth.token);
      setNotice("WebSocket 규격 문서를 만들었습니다.");
    } catch (error) {
      setNotice(authErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) return;
    if (!overview.changeReason.trim() || !overview.title.trim()) {
      setNotice("문서 제목과 변경 사유를 입력하세요.");
      return;
    }
    const codeProblem = closeCodeError(overview.closeCodes);
    if (codeProblem) {
      setNotice(codeProblem);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await apiRequest(`/api/projects/${projectId}/specs/WEBSOCKET`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: overviewLock ?? spec.version,
          changeReason: overview.changeReason.trim(),
          title: overview.title.trim(),
          overview: {
            url: overview.url.trim(),
            heartbeat: overview.heartbeat.trim(),
            auth: { type: overview.authType, description: overview.authDescription.trim() },
            closeCodes: overview.closeCodes.map((code) => ({ code: Number(code.code), description: code.description.trim() })),
          },
        },
      });
      setOverviewLock(null);
      const document = await loadSpec(auth.token);
      if (document) setOverview({ ...overviewFrom(document), changeReason: "" });
      setNotice(dirty ? "문서 상단을 저장했습니다. 편집중인 메시지 초안은 유지됩니다." : "문서 상단을 저장했습니다.");
      if (document) setBaseVersion(document.version);
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
    if (!auth.token || !spec || !draft || saving) return;
    const problem = wsError(draft);
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
      payload: wsToPayload(draft),
      errorCodeIds: draft.errorCodeIds ?? [],
    };
    try {
      const path = create ? `/api/projects/${projectId}/specs/WEBSOCKET/items` : `/api/projects/${projectId}/specs/WEBSOCKET/items/${selectedUid}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, { method: create ? "POST" : "PUT", token: auth.token, body });
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
        setDraft(saved ? wsFromApi(saved) : draft);
        setBaseVersion(document.version);
      }
      setNotice(`저장했습니다. 문서 버전 ${result.version}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && selectedUid !== "new") {
        setNotice("이 메시지는 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.");
        const latest = await loadSpec(auth.token);
        if (latest) setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 메시지가 삭제되었습니다."] });
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
    if (!auth.token || !spec) return;
    const latest = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/WEBSOCKET`, { token: auth.token });
    const previous = spec.items.map((item) => `${item.itemUid}:${item.name}`);
    const notes = latest.items.filter((item) => item.itemUid !== selectedUid && !previous.includes(`${item.itemUid}:${item.name}`)).map((item) => item.payload.eventName || item.name);
    const removed = spec.items.filter((item) => item.itemUid !== selectedUid && !latest.items.some((next) => next.itemUid === item.itemUid)).map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === selectedUid) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    setNotice("다른 사용자가 먼저 저장했습니다. 이 항목의 입력은 남아 있습니다. 다른 항목은 이 저장에 포함되지 않습니다.");
  }

  async function saveWithLatest() {
    if (!conflict) return;
    if (conflict.latest && !window.confirm("다시 저장하면 이 항목만 내 내용으로 바뀝니다.")) return;
    await saveItem(conflict.currentVersion, !conflict.latest);
  }

  async function removeItem() {
    if (!auth.token || !spec || !selectedUid || selectedUid === "new" || !deleteReason.trim()) {
      setNotice("삭제 사유를 입력하세요.");
      return;
    }
    if (spec.items.some((item) => item.itemUid !== selectedUid && item.payload.relatedItemUid === selectedUid)) {
      setNotice("다른 메시지가 이 메시지를 대응 메시지로 가리키고 있습니다. 연결을 해제한 뒤 삭제하세요.");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/WEBSOCKET/items/${selectedUid}`, {
        method: "DELETE", token: auth.token, body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, selectedUid, baseVersion));
      setDraft(null);
      setSelectedUid(null);
      setDirty(false);
      setConfirmDelete(false);
      setDeleteReason("");
      await loadSpec(auth.token);
      setNotice(`메시지를 삭제했습니다. 문서 버전 ${result.version}`);
    } catch (error) {
      setNotice(error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT" ? "다른 저장이 먼저 반영되어 삭제하지 않았습니다." : authErrorMessage(error));
      if (auth.token) await loadSpec(auth.token);
    } finally {
      setSaving(false);
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    if (!auth.token || !spec || query.trim()) return;
    if (dirty && !window.confirm("저장하지 않은 메시지 수정은 순서 변경에 포함되지 않습니다.")) return;
    const target = index + direction;
    const uids = spec.items.map((item) => item.itemUid);
    if (target < 0 || target >= uids.length) return;
    const [moved] = uids.splice(index, 1);
    uids.splice(target, 0, moved);
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/specs/WEBSOCKET/items/order`, {
        method: "PUT", token: auth.token, body: { version: spec.version, changeReason: "메시지 순서 변경", itemUids: uids },
      });
      const document = await loadSpec(auth.token);
      if (document && !dirty) setBaseVersion(document.version);
      setNotice("순서를 저장했습니다.");
    } catch (error) {
      setNotice(error instanceof ApiError && error.code === "ITEM_SET_CHANGED" ? "항목 목록이 변경되어 순서를 바꾸지 않았습니다." : authErrorMessage(error));
      if (auth.token) await loadSpec(auth.token);
    } finally {
      setSaving(false);
    }
  }

  const selected = spec?.items.find((item) => item.itemUid === selectedUid) ?? null;
  const visible = (spec?.items ?? []).filter((item) => `${item.name} ${item.summary} ${item.payload.eventName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const preview = draft ? previewText(draft.payload) : null;

  return (
    <main className="spec-screen">
      <div className="heading-row">
        <div>
          <p><Link to={`/projects/${project.id}`} onClick={(event) => { if (!guardDirty()) event.preventDefault(); }}>{project.title}</Link></p>
          <h1>WebSocket 규격</h1>
        </div>
        <div className="inline-actions">
          {spec ? <span className="version-pill">문서 버전 {spec.version}</span> : null}
          {panel === "spec" && spec && canEdit && !editing ? <button type="button" onClick={() => { setEditing(true); if (selectedUid) openItem(selectedUid, spec, true); }}>편집</button> : null}
          {panel === "spec" && spec && canEdit && editing ? <button type="button" onClick={() => { if (guardDirty()) { setEditing(false); setDirty(false); setDraft(null); } }}>조회로 전환</button> : null}
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={panel === "spec"} onClick={() => { if (guardDirty()) setPanel("spec"); }}>규격</button>
        <button type="button" role="tab" aria-selected={panel === "history"} onClick={() => { if (guardDirty()) setPanel("history"); }}>변경 이력</button>
        <button type="button" role="tab" aria-selected={panel === "markdown"} onClick={() => { if (guardDirty()) setPanel("markdown"); }}>Markdown</button>
      </div>
      {project.status !== "ACTIVE" ? <p className="banner">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
      {!canEdit && project.status === "ACTIVE" ? <p className="banner">조회 권한입니다. 규격을 수정할 수 없습니다.</p> : null}
      {notice ? <p className={noticeClass(notice)}>{notice}</p> : null}
      {panel === "history" ? (spec && auth.token ? <SpecHistory projectId={projectId} token={auth.token} kind="WEBSOCKET" /> : <div className="empty-work"><h2>아직 WebSocket 규격 문서가 없습니다.</h2></div>) : null}
      {panel === "markdown" ? (spec && auth.token ? <SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} kind="WEBSOCKET" /> : <div className="empty-work"><h2>아직 WebSocket 규격 문서가 없습니다.</h2></div>) : null}
      {panel === "spec" && missing ? (
        <section className="empty-work">
          <h2>아직 WebSocket 규격 문서가 없습니다.</h2>
          <p>이 프로젝트의 WebSocket 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 메시지를 추가합니다.</p>
          {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>WebSocket 규격 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
        </section>
      ) : null}
      {panel === "spec" && spec && overview && editing ? (
        <details className="overview-box">
          <summary>문서 상단</summary>
          <div className="field-grid">
            <label>제목<input value={overview.title} onChange={(event) => setOverview({ ...overview, title: event.target.value })} /></label>
            <label>연결 URL<input value={overview.url} onChange={(event) => setOverview({ ...overview, url: event.target.value })} placeholder="wss://lab.example/ws" /></label>
            <label>공통 인증
              <select value={overview.authType} onChange={(event) => setOverview({ ...overview, authType: event.target.value })}>
                {authTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>인증 설명<input value={overview.authDescription} onChange={(event) => setOverview({ ...overview, authDescription: event.target.value })} /></label>
          </div>
          <label>하트비트<textarea rows={3} value={overview.heartbeat} onChange={(event) => setOverview({ ...overview, heartbeat: event.target.value })} placeholder="연결 유지, 세션, 공통 메시지 규칙" /></label>
          <CloseCodes
            codes={overview.closeCodes}
            onPatch={(index, patch) => setOverview((current) => current ? { ...current, closeCodes: current.closeCodes.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : current)}
            onAdd={() => setOverview((current) => current ? { ...current, closeCodes: [...current.closeCodes, { code: "", description: "" }] } : current)}
            onRemove={(index) => setOverview((current) => current ? { ...current, closeCodes: current.closeCodes.filter((_, itemIndex) => itemIndex !== index) } : current)}
          />
          <label>변경 사유<input value={overview.changeReason} onChange={(event) => setOverview({ ...overview, changeReason: event.target.value })} /></label>
          <button type="button" disabled={saving} onClick={saveOverview}>{overviewLock ? "문서 상단을 최신 버전 기준으로 저장" : "문서 상단 저장"}</button>
        </details>
      ) : null}
      {panel === "spec" && spec ? (
        <div className="spec-layout">
          <aside className="endpoint-pane">
            {canEdit ? <button type="button" className="btn primary add-endpoint" onClick={() => { if (!spec || !guardDirty()) return; setEditing(true); setSelectedUid("new"); setDraft(blankWs()); setDirty(true); setConflict(null); setBaseVersion(spec.version); setRestored(false); }}>{spec.items.length === 0 ? "+ 첫 메시지 추가" : "+ 메시지 추가"}</button> : null}
            <label>메시지 검색<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            {spec.items.length === 0 ? <p className="section-empty">아직 등록된 메시지가 없습니다.</p> : null}
            <ul className="endpoint-list">
              {visible.map((item) => {
                const index = spec.items.findIndex((candidate) => candidate.itemUid === item.itemUid);
                const direction = item.payload.direction ?? "";
                return (
                  <li key={item.itemUid} className={item.itemUid === selectedUid ? "selected" : ""}>
                    <button type="button" className="endpoint-select" onClick={() => { if (guardDirty()) openItem(item.itemUid); }}>
                      <span className={`method method-${direction === "SERVER_TO_CLIENT" ? "post" : direction === "BIDIRECTIONAL" ? "patch" : "get"}`}>{directionBadge(direction)}</span>
                      <span>{item.payload.eventName}</span>
                      <small>{item.name}</small>
                    </button>
                    {editing && !query.trim() ? (
                      <span className="inline-actions">
                        <button type="button" onClick={() => reorder(index, -1)} disabled={saving || index === 0}>위로</button>
                        <button type="button" onClick={() => reorder(index, 1)} disabled={saving || index === spec.items.length - 1}>아래로</button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </aside>
          <section className="editor-pane">
            {!editing && spec.items.length === 0 ? (
              <div className="empty-work">
                <h2>아직 등록된 메시지가 없습니다.</h2>
                <p>첫 메시지에서 식별자와 방향을 정하고 Payload를 작성합니다.</p>
                {canEdit ? <button type="button" className="btn primary" onClick={() => { setEditing(true); setSelectedUid("new"); setDraft(blankWs()); setDirty(true); setBaseVersion(spec.version); }}>+ 첫 메시지 추가</button> : <p>조회 권한으로는 메시지를 추가할 수 없습니다.</p>}
              </div>
            ) : null}
            {!editing && selected ? <WsReader item={selected} items={spec.items} /> : null}
            {editing && restored ? <p className="banner">임시 초안을 복구했습니다. 아직 공식 규격이 아닙니다.</p> : null}
            {editing && draft ? (
              <form onSubmit={(event) => { event.preventDefault(); if (!conflict) void saveItem(); }}>
                <div className="identity-row topic-row">
                  <label>메시지 식별자<input value={draft.eventName} onChange={(event) => updateDraft({ ...draft, eventName: event.target.value, name: draft.name === "새 메시지" ? event.target.value || "새 메시지" : draft.name })} /></label>
                  <label>방향
                    <select value={draft.direction} onChange={(event) => updateDraft({ ...draft, direction: event.target.value })}>
                      {wsDirections.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="field-grid">
                  <label>이름<input value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} /></label>
                  <label>종류
                    <select value={draft.messageKind} onChange={(event) => updateDraft({ ...draft, messageKind: event.target.value })}>
                      {wsKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>요약<input value={draft.summary} onChange={(event) => updateDraft({ ...draft, summary: event.target.value })} /></label>
                </div>
                <label>설명<textarea rows={3} value={draft.description} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} placeholder="발생 조건과 처리 시 주의사항" /></label>
                <section className="work-section">
                  <h3>Payload</h3>
                  <p className="section-empty">이 메시지 하나의 JSON입니다. 응답은 별도 메시지로 만들고 대응 메시지로 연결합니다.</p>
                  <label>예시
                    <select value={draft.payload.exampleMode} onChange={(event) => {
                      const exampleMode = event.target.value as "AUTO" | "MANUAL";
                      const manualText = exampleMode === "MANUAL" && !draft.payload.manualText ? previewText({ ...draft.payload, exampleMode: "AUTO" }).text || "{}" : draft.payload.manualText;
                      updateDraft({ ...draft, payload: { ...draft.payload, exampleMode, manualText } });
                    }}>
                      <option value="AUTO">자동 생성</option>
                      <option value="MANUAL">직접 수정</option>
                    </select>
                  </label>
                  <FieldTreeEditor fields={draft.payload.fields} onChange={(fields) => updateDraft({ ...draft, payload: { ...draft.payload, fields } })} />
                  {draft.payload.exampleMode === "MANUAL" ? <label>예시 JSON<textarea rows={8} value={draft.payload.manualText} onChange={(event) => updateDraft({ ...draft, payload: { ...draft.payload, manualText: event.target.value } })} /></label> : null}
                </section>
                <details className="fold">
                  <summary>대응 메시지와 상태</summary>
                  <div className="field-grid">
                    <label>대응 메시지
                      <select value={draft.relatedItemUid} onChange={(event) => updateDraft({ ...draft, relatedItemUid: event.target.value })}>
                        <option value="">없음</option>
                        {spec.items.filter((item) => item.itemUid !== selectedUid).map((item) => <option key={item.itemUid} value={item.itemUid}>{item.payload.eventName || item.name}</option>)}
                      </select>
                    </label>
                    <label>상태
                      <select value={draft.status} onChange={(event) => updateDraft({ ...draft, status: event.target.value as WsDraft["status"] })}>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="DEPRECATED">DEPRECATED</option>
                      </select>
                    </label>
                  </div>
                </details>
                {auth.token ? (
                  <ErrorCodePicker
                    projectId={projectId}
                    token={auth.token}
                    selected={draft.errorCodeIds ?? []}
                    onChange={(errorCodeIds) => updateDraft({ ...draft, errorCodeIds })}
                  />
                ) : null}
                <div className="save-bar">
                  <label>변경 사유<input value={draft.changeReason} onChange={(event) => updateDraft({ ...draft, changeReason: event.target.value })} /></label>
                  <div className="inline-actions">
                    <span className="version-pill">문서 버전 {spec.version}{dirty ? " · 저장되지 않은 변경" : ""}</span>
                    <button type="submit" disabled={saving || Boolean(conflict)}>{saving ? "저장 중" : "메시지 저장"}</button>
                    {selectedUid !== "new" ? <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>메시지 삭제</button> : null}
                  </div>
                </div>
              </form>
            ) : null}
            {confirmDelete ? (
              <div className="modal-backdrop">
                <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                  <h2>메시지 삭제</h2>
                  <p>이 메시지만 삭제합니다. 문서와 다른 메시지는 남습니다.</p>
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
                <p>서버의 최신 문서 버전은 {conflict.currentVersion}입니다. 자동으로 다시 저장하지 않습니다.</p>
                {conflict.notes.length > 0 ? <ul>{conflict.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>다른 메시지 이름 변경은 없습니다.</p>}
                <div className="compare-grid">
                  <div><h4>내 입력</h4><pre>{draft ? `${draft.direction} ${draft.eventName}\n${previewText(draft.payload).text}` : ""}</pre></div>
                  <div><h4>서버 최신</h4><pre>{conflict.latest ? `${conflict.latest.payload.direction ?? ""} ${conflict.latest.payload.eventName ?? ""}\n${JSON.stringify(conflict.latest.payload.example ?? {}, null, 2)}` : "서버에 이 메시지가 없습니다."}</pre></div>
                </div>
                <button type="button" disabled={saving} onClick={() => void saveWithLatest()}>{conflict.latest ? "이 항목을 최신 버전 기준으로 저장" : "새 항목으로 저장"}</button>
              </section>
            ) : null}
          </section>
          <aside className="json-panel">
            <h2>JSON 예시</h2>
            <p className="mode-note">{dirty ? "저장되지 않은 변경" : "저장됨"} · 기준 버전 {baseVersion || spec.version}</p>
            {preview ? <pre>{preview.problem || preview.text}</pre> : selected ? <pre>{JSON.stringify(selected.payload.example ?? {}, null, 2)}</pre> : <p>메시지를 선택하면 예시를 보여 줍니다.</p>}
          </aside>
        </div>
      ) : null}
    </main>
  );
}

function CloseCodes({ codes, onPatch, onAdd, onRemove }: { codes: CloseCodeDraft[]; onPatch: (index: number, patch: Partial<CloseCodeDraft>) => void; onAdd: () => void; onRemove: (index: number) => void }) {
  return (
    <section className="work-section">
      <h3>종료 코드</h3>
      {codes.map((code, index) => (
        <div className="field-grid" key={index}>
          <label>코드<input value={code.code} onChange={(event) => onPatch(index, { code: event.target.value })} /></label>
          <label>설명<input value={code.description} onChange={(event) => onPatch(index, { description: event.target.value })} /></label>
          <button type="button" className="danger" onClick={() => onRemove(index)}>행 삭제</button>
        </div>
      ))}
      <button type="button" onClick={onAdd}>+ 종료 코드 추가</button>
    </section>
  );
}

function WsReader({ item, items }: { item: SpecItem; items: SpecItem[] }) {
  const related = items.find((candidate) => candidate.itemUid === item.payload.relatedItemUid);
  return (
    <article className="reader">
      <h2>{item.payload.eventName}</h2>
      <p>{item.name}{item.summary ? ` · ${item.summary}` : ""}</p>
      <p>방향 {directionText(item.payload.direction ?? "")} · 종류 {kindText(item.payload.messageKind ?? "")}</p>
      {item.payload.description ? <p>{item.payload.description}</p> : null}
      {related ? <p>대응 메시지 {related.payload.eventName || related.name}</p> : null}
      <LinkedErrorCodes codes={item.errorCodes} />
      <pre>{JSON.stringify(item.payload.example ?? {}, null, 2)}</pre>
    </article>
  );
}

function overviewFrom(document: SpecDocument): WsOverviewDraft {
  return {
    title: document.title,
    url: document.overview.url ?? "",
    heartbeat: document.overview.heartbeat ?? "",
    authType: document.overview.auth?.type ?? "NONE",
    authDescription: document.overview.auth?.description ?? "",
    closeCodes: (document.overview.closeCodes ?? []).map((code) => ({ code: String(code.code ?? ""), description: code.description ?? "" })),
    changeReason: "",
  };
}

function noticeClass(notice: string) {
  if (notice.includes("저장했습니다") || notice.includes("삭제했습니다") || notice.includes("만들었습니다") || notice.includes("순서를 저장")) return "banner success";
  if (notice.includes("먼저 저장") || notice.includes("충돌") || notice.includes("유지")) return "banner warning";
  return "banner danger";
}
