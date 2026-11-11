import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { ErrorCodePicker } from "../spec/ErrorCodePicker";
import { JsonBlock } from "../spec/jsonView";
import { issueMap, reasonProblem } from "../spec/restValidation";
import { itemChanged, itemSaveBody, noChangeMessage, sameValue, type ItemSaveBody } from "../spec/saveCompare";
import { SchemaTable } from "../spec/SchemaTable";
import { SortableList } from "../spec/SortableList";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import { draftKey, previewText, type ExampleDraft, type SpecDocument, type SpecItem } from "../spec/specModel";
import { Field, IssueSummary, formatDate } from "../spec/workspaceUi";
import {
  blankWs,
  directionShort,
  directionText,
  eventNameExamples,
  kindText,
  messageName,
  wsDirections,
  wsFromApi,
  wsKinds,
  wsTerms,
  wsToPayload,
  type WsDraft,
  type WsOverviewDraft,
} from "../spec/wsModel";
import { duplicateEventNames, validateMessage, validateWsOverview, type WsIssue } from "../spec/wsValidation";
import { useToast } from "../toast";

const authTypes = ["NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM"];

type ConflictView = { currentVersion: number; latest: SpecItem | null; notes: string[] };
type Tone = "success" | "warning" | "danger" | "info";
type Notice = { text: string; tone: Tone } | null;
type DocView = "settings" | "history" | "markdown";
type Route = { item?: string | null; mode?: "edit" | null; view?: DocView | null };

const docViewLabel: Record<DocView, string> = { settings: "문서 설정", history: "변경 이력", markdown: "Markdown" };

export function WsPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [spec, setSpec] = useState<SpecDocument | null>(null);
  const [missing, setMissing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<WsDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [baseline, setBaseline] = useState<ItemSaveBody | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<WsOverviewDraft | null>(null);
  const [overviewLock, setOverviewLock] = useState<number | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const [settingsAttempted, setSettingsAttempted] = useState(false);
  const [settingsReasonError, setSettingsReasonError] = useState("");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string[] | null>(null);
  const overviewTouched = useRef(false);
  const toast = useToast();

  const viewParam = searchParams.get("view");
  const docView: DocView | null = viewParam === "settings" || viewParam === "history" || viewParam === "markdown" ? viewParam : null;
  const itemParam = searchParams.get("item");
  const modeParam = searchParams.get("mode") === "edit" ? "edit" : null;
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const editTarget = canEdit && itemParam && (itemParam === "new" || modeParam === "edit") ? itemParam : null;
  const selected = spec?.items.find((item) => item.itemUid === itemParam) ?? null;
  const selectedView = useMemo(() => (selected ? wsFromApi(selected) : null), [selected]);
  const overviewDirty = Boolean(spec && overview && !sameValue(overviewSignature(overview), overviewSignature(overviewFrom(spec))));
  const currentBody = useMemo(() => itemSaveBody(draft, wsToPayload, messageName), [draft]);
  const dirty = Boolean(draft && draftFor) && itemChanged(draftFor === "new", baseline, currentBody);

  usePageChrome(project?.title ?? "WebSocket", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "WebSocket" },
  ]);
  useNavGuard(() => guardLeave(), dirty || overviewDirty);

  function say(text: string, tone: Tone) {
    if (tone === "success" || tone === "info") {
      if (tone === "success") {
        toast.success(text);
      } else {
        toast.info(text);
      }
      setNotice(null);
      return;
    }
    toast.error(text);
    setNotice({ text, tone });
  }

  async function loadSpec(token: string) {
    const detail = await apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token });
    setProject(detail);
    try {
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/WEBSOCKET`, { token });
      setSpec(document);
      setMissing(false);
      setOverview((current) => (current && overviewTouched.current ? current : overviewFrom(document)));
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
        say(error instanceof ApiError && error.status === 401 ? "로그인이 만료되었습니다." : authErrorMessage(error), "danger");
      })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!spec) return;
    if (!editTarget) {
      if (draftFor !== null) {
        setDraft(null);
        setDraftFor(null);
        setBaseline(null);
        setRestored(false);
        setConflict(null);
        setAttempted(false);
        setReasonError("");
        setSaveOpen(false);
      }
      return;
    }
    if (draftFor === editTarget) return;
    const found = spec.items.find((item) => item.itemUid === editTarget);
    if (editTarget !== "new" && !found) return;
    let next = found ? wsFromApi(found) : blankWs();
    let wasRestored = false;
    const saved = sessionStorage.getItem(draftKey(spec.id, editTarget, spec.version));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { draft?: WsDraft };
        if (parsed.draft) {
          next = parsed.draft;
          wasRestored = true;
        }
      } catch {
        sessionStorage.removeItem(draftKey(spec.id, editTarget, spec.version));
      }
    }
    setDraft(next);
    setDraftFor(editTarget);
    setBaseline(found ? itemSaveBody(wsFromApi(found), wsToPayload, messageName) : null);
    setRestored(wasRestored);
    setBaseVersion(spec.version);
    setConflict(null);
    setAttempted(false);
    setReasonError("");
    setSaveOpen(false);
    if (editTarget === "new" && !wasRestored) setFocusTarget("ws:eventName");
  }, [spec, editTarget, draftFor]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [itemParam]);

  useEffect(() => {
    if (!spec || !draft || !draftFor) return;
    if (!dirty) {
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      return;
    }
    sessionStorage.setItem(draftKey(spec.id, draftFor, baseVersion), JSON.stringify({ official: false, draft }));
  }, [spec, draft, draftFor, dirty, baseVersion]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty && !overviewDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, overviewDirty]);

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
  }, [focusTarget, docView, itemParam, draftFor]);

  if (!auth.ready) return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) return <main className="spec-screen"><h1>WebSocket</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
  if (loading) return <main className="spec-screen"><p className="state-panel">불러오는 중입니다.</p></main>;
  if (!project) return <main className="spec-screen"><p>{notice?.text || "프로젝트를 찾지 못했습니다."}</p></main>;

  function go(next: Route, options: { keepNotice?: boolean } = {}) {
    const search = new URLSearchParams();
    if (next.view) search.set("view", next.view);
    if (next.item) search.set("item", next.item);
    if (next.mode) search.set("mode", next.mode);
    if (!options.keepNotice) setNotice(null);
    setSearchParams(search);
  }

  function guardMessage() {
    return !dirty || window.confirm("저장하지 않은 메시지 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 임시로 남습니다.");
  }

  function guardLeave() {
    if (!dirty && !overviewDirty) return true;
    const parts = [dirty ? "메시지" : "", overviewDirty ? "문서 설정" : ""].filter(Boolean).join("와 ");
    return window.confirm(`저장하지 않은 ${parts} 변경이 있습니다. 이 화면을 떠나면 공식 규격에 반영되지 않습니다.${dirty ? " 메시지 초안만 이 브라우저에 임시로 남습니다." : ""}`);
  }

  function resetIssues() {
    setAttempted(false);
    setReasonError("");
    setSaveOpen(false);
  }

  function dropDraft() {
    setDraft(null);
    setDraftFor(null);
    setBaseline(null);
    setRestored(false);
    setConflict(null);
    resetIssues();
  }

  function toList() {
    if (draftFor && !guardMessage()) return;
    go({});
  }

  function openMessage(uid: string) {
    if (uid === draftFor) {
      go({ item: uid, mode: uid === "new" ? null : "edit" });
      return;
    }
    if (draftFor && !guardMessage()) return;
    go({ item: uid });
  }

  function beginMessage() {
    if (!spec || !canEdit) return;
    if (draftFor && draftFor !== "new" && !guardMessage()) return;
    go({ item: "new" });
  }

  function beginEdit() {
    if (!selected || !canEdit) return;
    go({ item: selected.itemUid, mode: "edit" });
  }

  function cancelEdit() {
    if (dirty && !window.confirm("저장하지 않은 변경을 버리고 조회 화면으로 돌아갈까요?")) return;
    const target = draftFor;
    if (spec && target) sessionStorage.removeItem(draftKey(spec.id, target, baseVersion));
    dropDraft();
    go(target && target !== "new" ? { item: target } : {});
  }

  function openDocView(view: DocView) {
    go(editTarget ? { view, item: editTarget, mode: editTarget === "new" ? null : "edit" } : { view });
  }

  function closeDocView() {
    go(editTarget ? { item: editTarget, mode: editTarget === "new" ? null : "edit" } : {});
  }

  function updateDraft(next: WsDraft) {
    setDraft(next);
  }

  function editOverview(next: WsOverviewDraft) {
    overviewTouched.current = true;
    setOverview(next);
  }

  function goToIssue(issue: WsIssue) {
    if (issue.target.startsWith("doc:")) {
      if (docView !== "settings") openDocView("settings");
    } else if (docView) {
      closeDocView();
    }
    setFocusTarget(issue.target);
  }

  async function createDocument() {
    if (!auth.token || !canEdit) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "WEBSOCKET", title: "WebSocket 규격" } });
      await loadSpec(auth.token);
      notifySpecChanged();
      say("WebSocket 규격 문서를 만들었습니다.", "success");
    } catch (error) {
      say(authErrorMessage(error), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) return;
    const found = validateWsOverview(overview);
    if (found.length > 0) {
      setSettingsAttempted(true);
      goToIssue(found[0]);
      toast.error(`문서 설정을 저장하지 못했습니다. 입력 오류 ${found.length}건을 확인해 주세요.`);
      return;
    }
    const reason = reasonProblem(overview.changeReason);
    setSettingsReasonError(reason ?? "");
    if (reason) {
      setFocusTarget("doc:changeReason");
      return;
    }
    setSaving(true);
    setNotice(null);
    const sentVersion = overviewLock ?? spec.version;
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/WEBSOCKET`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: sentVersion,
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
      overviewTouched.current = false;
      setSettingsAttempted(false);
      const document = await loadSpec(auth.token);
      if (document) {
        setOverview(overviewFrom(document));
        if (draftFor) setBaseVersion(document.version);
      }
      notifySpecChanged();
      if (result.version === sentVersion) {
        say(noChangeMessage, "info");
        return;
      }
      say(dirty
        ? `문서 설정을 저장했습니다 · 문서 버전 v${result.version}. 편집 중인 메시지 초안은 그대로 유지됩니다.`
        : `문서 설정을 저장했습니다 · 문서 버전 v${result.version}`, "success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setOverviewLock(error.currentVersion ?? null);
        say("다른 사용자가 문서를 먼저 저장했습니다. 입력한 문서 설정은 유지됩니다. '최신 버전 기준으로 저장'을 눌러야 다시 저장합니다.", "warning");
      } else {
        say(`문서 설정을 저장하지 못했습니다. ${authErrorMessage(error)} 입력한 내용은 그대로 남아 있습니다.`, "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  function startSave() {
    if (!draft || !dirty) return;
    const found = validateMessage(draft, draftFor);
    if (found.length > 0) {
      setAttempted(true);
      setSaveOpen(false);
      setNotice(null);
      goToIssue(found[0]);
      toast.error(`저장하지 못했습니다. 입력 오류 ${found.length}건을 확인해 주세요.`);
      return;
    }
    setAttempted(false);
    setReasonError("");
    if (draftFor === "new" && !draft.changeReason.trim()) {
      updateDraft({ ...draft, changeReason: `메시지 추가: ${draft.eventName.trim()}` });
    }
    setSaveOpen(true);
    setFocusTarget("ws:changeReason");
  }

  async function saveItem(version = baseVersion, create = draftFor === "new") {
    if (!auth.token || !spec || !draft || !draftFor || saving || (!dirty && !conflict)) return;
    const found = validateMessage(draft, draftFor);
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
      setFocusTarget("ws:changeReason");
      return;
    }
    setSaving(true);
    setNotice(null);
    const body = {
      version,
      changeReason: draft.changeReason.trim(),
      name: messageName(draft),
      summary: draft.summary.trim(),
      status: draft.status,
      payload: wsToPayload(draft),
      errorCodeIds: draft.errorCodeIds ?? [],
    };
    try {
      const path = create ? `/api/projects/${projectId}/specs/WEBSOCKET/items` : `/api/projects/${projectId}/specs/WEBSOCKET/items/${draftFor}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, { method: create ? "POST" : "PUT", token: auth.token, body });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      const uid = result.itemUid ?? draftFor;
      await loadSpec(auth.token);
      notifySpecChanged();
      dropDraft();
      go({ item: uid }, { keepNotice: true });
      say(!create && result.version === version ? noChangeMessage : `메시지를 저장했습니다 · 문서 버전 v${result.version}`, !create && result.version === version ? "info" : "success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setSaveOpen(false);
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && draftFor !== "new") {
        say("이 메시지는 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.", "warning");
        const latest = await loadSpec(auth.token);
        if (latest) setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 메시지가 삭제되었습니다."] });
      } else if (error instanceof ApiError && error.code === "EXAMPLE_SCHEMA_MISMATCH") {
        say("예시 JSON이 Payload 필드 구조와 맞지 않아 저장하지 않았습니다. 입력은 그대로 남아 있습니다.", "danger");
      } else {
        say(`저장하지 못했습니다. ${authErrorMessage(error)} 입력은 그대로 남아 있습니다.`, "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  async function showConflict(currentVersion?: number) {
    if (!auth.token || !spec) return;
    const latest = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/WEBSOCKET`, { token: auth.token });
    const previous = spec.items.map((item) => `${item.itemUid}:${item.name}`);
    const notes = latest.items.filter((item) => item.itemUid !== draftFor && !previous.includes(`${item.itemUid}:${item.name}`)).map((item) => item.payload.eventName || item.name);
    const removed = spec.items.filter((item) => item.itemUid !== draftFor && !latest.items.some((next) => next.itemUid === item.itemUid)).map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setOverview((current) => (current && overviewTouched.current ? current : overviewFrom(latest)));
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === draftFor) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    say("다른 사용자가 먼저 저장했습니다. 이 메시지의 입력은 남아 있습니다. 다른 메시지는 이 저장에 포함되지 않습니다.", "warning");
  }

  async function saveWithLatest() {
    if (!conflict) return;
    if (conflict.latest && !window.confirm("다시 저장하면 이 메시지만 내 내용으로 바뀝니다.")) return;
    await saveItem(conflict.currentVersion, !conflict.latest);
  }

  async function removeItem() {
    if (!auth.token || !spec || !draftFor || draftFor === "new" || !deleteReason.trim()) {
      say("삭제 사유를 입력하세요.", "danger");
      return;
    }
    if (spec.items.some((item) => item.itemUid !== draftFor && item.payload.relatedItemUid === draftFor)) {
      say("다른 메시지가 이 메시지를 대응 메시지로 가리키고 있습니다. 연결을 해제한 뒤 삭제하세요.", "danger");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/WEBSOCKET/items/${draftFor}`, {
        method: "DELETE", token: auth.token, body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      setConfirmDelete(false);
      setDeleteReason("");
      dropDraft();
      await loadSpec(auth.token);
      notifySpecChanged();
      go({}, { keepNotice: true });
      say(`메시지를 삭제했습니다 · 문서 버전 v${result.version}`, "success");
    } catch (error) {
      say(error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT" ? "다른 저장이 먼저 반영되어 삭제하지 않았습니다." : authErrorMessage(error), "danger");
      if (auth.token) await loadSpec(auth.token);
    } finally {
      setSaving(false);
    }
  }

  function moveOrder(from: number, to: number) {
    setOrdering((current) => {
      if (!current || to < 0 || to >= current.length || from === to) return current;
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveOrdering() {
    if (!auth.token || !spec || !ordering) return;
    if (ordering.join(",") === spec.items.map((item) => item.itemUid).join(",")) {
      setOrdering(null);
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/WEBSOCKET/items/order`, {
        method: "PUT", token: auth.token, body: { version: spec.version, changeReason: "메시지 순서 변경", itemUids: ordering },
      });
      await loadSpec(auth.token);
      notifySpecChanged();
      setOrdering(null);
      say(`순서를 저장했습니다 · 문서 버전 v${result.version}`, "success");
    } catch (error) {
      if (error instanceof ApiError && (error.code === "ITEM_SET_CHANGED" || error.code === "DOCUMENT_VERSION_CONFLICT")) {
        await loadSpec(auth.token);
        setOrdering(null);
        say("다른 사용자가 먼저 문서를 바꿔 순서를 저장하지 않았습니다. 최신 목록을 불러왔으니 다시 변경해 주세요.", "warning");
      } else {
        say(`순서를 저장하지 못했습니다. ${authErrorMessage(error)}`, "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithSelection(text);
      }
      toast.success(`${label}을(를) 복사했습니다.`);
    } catch {
      try {
        copyWithSelection(text);
        toast.success(`${label}을(를) 복사했습니다.`);
      } catch {
        toast.error(`${label}을(를) 복사하지 못했습니다. 직접 선택해 복사해 주세요.`);
      }
    }
  }

  const items = spec?.items ?? [];
  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) => `${item.payload.eventName ?? ""} ${item.name} ${item.summary}`.toLowerCase().includes(needle));
  const orderedItems = ordering ? ordering.map((uid) => items.find((item) => item.itemUid === uid)).filter((item): item is SpecItem => Boolean(item)) : [];
  const orderChanged = Boolean(ordering) && !sameValue(ordering, items.map((item) => item.itemUid));
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const view: WsDraft | null = writer ? draft : selectedView;
  const isNew = itemParam === "new";
  const preview = view ? previewText(view.payload) : null;
  const itemIssues = draft && attempted ? validateMessage(draft, draftFor) : [];
  const sameNames = writer && draft ? duplicateEventNames(items, draft.eventName, draftFor) : [];
  const itemErrors = issueMap(itemIssues);
  const settingsIssues = overview && settingsAttempted ? validateWsOverview(overview) : [];
  const settingsErrors = issueMap(settingsIssues);
  const tone = saveTone(notice, dirty, saving, Boolean(conflict), itemIssues.length > 0);
  const pendingMessage = dirty && draft ? (draft.eventName.trim() || "새 메시지") : "";
  const crumbTail = docView ? docViewLabel[docView] : isNew ? "새 메시지" : selected ? (selected.payload.eventName ?? selected.name) : null;
  const selfUid = writer ? draftFor : itemParam;
  const related = view?.relatedItemUid ? items.find((item) => item.itemUid === view.relatedItemUid) ?? null : null;
  const linkedFrom = selfUid && selfUid !== "new" ? items.filter((item) => item.itemUid !== selfUid && item.payload.relatedItemUid === selfUid) : [];
  const kind = wsKinds.find((option) => option.value === view?.messageKind);
  const direction = wsDirections.find((option) => option.value === view?.direction);
  const relatedHint = view ? pairingHint(view.messageKind, related) : null;

  function applyExample(next: ExampleDraft) {
    if (!draft) return;
    updateDraft({ ...draft, payload: next });
  }

  function setMode(exampleMode: "AUTO" | "MANUAL") {
    if (!draft) return;
    const example = draft.payload;
    if (exampleMode === "MANUAL" && !example.manualText) {
      applyExample({ ...example, exampleMode, manualText: previewText({ ...example, exampleMode: "AUTO" }).text || "{}" });
      return;
    }
    applyExample({ ...example, exampleMode });
  }

  function applyEventExample(value: string) {
    if (!draft) return;
    const current = draft.eventName.trim();
    if (current && current !== value && !window.confirm(`현재 메시지 식별자 '${current}'를 '${value}'(으)로 바꿀까요?`)) return;
    updateDraft({ ...draft, eventName: value });
  }

  function messageLabel(item: SpecItem) {
    return `${item.payload.eventName || item.name} · ${kindText(item.payload.messageKind ?? "")} · ${directionShort(item.payload.direction ?? "")}`;
  }

  const noticeBanner = notice ? <p className={`banner rest-banner ${notice.tone === "info" ? "" : notice.tone}`}>{notice.text}</p> : null;

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guardLeave()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {crumbTail ? <button type="button" className="crumb-link" onClick={toList}>WebSocket</button> : <strong>WebSocket</strong>}
        {crumbTail ? <><span aria-hidden="true">/</span><strong className="crumb-current">{crumbTail}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>WebSocket 규격</h1>
          {spec ? (
            <p className="rest-doc-meta">
              {spec.title.trim() && spec.title.trim() !== "WebSocket 규격" ? <span>{spec.title}</span> : null}
              <span>문서 v{spec.version}</span>
              <span>메시지 {items.length}개</span>
              <span>최종 수정 {formatDate(spec.updatedAt)}{spec.updatedBy?.name ? ` · ${spec.updatedBy.name}` : ""}</span>
            </p>
          ) : null}
        </div>
        {spec ? (
          <div className="rest-doc-actions" role="group" aria-label="문서 작업">
            {(["settings", "history", "markdown"] as DocView[]).map((key) => (
              <button
                key={key}
                type="button"
                className={docView === key ? "btn is-current" : "btn"}
                aria-current={docView === key ? "page" : undefined}
                onClick={() => (docView === key ? closeDocView() : openDocView(key))}
              >
                {docViewLabel[key]}{key === "settings" && overviewDirty ? " · 저장 안 됨" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );

  const draftBanner = docView && pendingMessage ? (
    <p className="banner rest-banner">
      편집 중인 메시지 <code>{pendingMessage}</code>는 저장되지 않은 상태로 그대로 유지됩니다.
      <button type="button" className="link-button" onClick={closeDocView}>메시지 편집으로 돌아가기</button>
    </p>
  ) : null;

  function messageRow(item: SpecItem, compact: boolean) {
    const current = item.itemUid === itemParam && !docView;
    const dir = item.payload.direction ?? "";
    return (
      <li key={item.itemUid}>
        <button type="button" className={current ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} aria-current={current ? "true" : undefined} onClick={() => openMessage(item.itemUid)}>
          <span className={`mqtt-dir dir-${dir.toLowerCase()}`}>{directionShort(dir)}</span>
          <span className="ep-main">
            <code>{item.payload.eventName}</code>
            <span className="ep-name">
              {item.name}
              {!compact && item.summary ? <em> · {item.summary}</em> : null}
            </span>
          </span>
          <span className={`ws-kind kind-${(item.payload.messageKind ?? "").toLowerCase()}`}>{kindText(item.payload.messageKind ?? "")}</span>
          {item.status === "DEPRECATED" ? <span className="ep-tag">사용 중단</span> : null}
          {item.itemUid === draftFor && dirty ? <span className="ep-tag is-draft">수정 중</span> : null}
        </button>
      </li>
    );
  }

  const newRow = draftFor === "new" && draft ? (
    <li key="new">
      <button type="button" className={isNew && !docView ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} onClick={() => openMessage("new")}>
        <span className={`mqtt-dir dir-${draft.direction.toLowerCase()}`}>{directionShort(draft.direction)}</span>
        <span className="ep-main"><code>{draft.eventName.trim() || "식별자 미입력"}</code><span className="ep-name">{draft.name.trim() || "새 메시지"}</span></span>
        <span className="ep-tag is-draft">작성 중</span>
      </button>
    </li>
  ) : null;

  let body: ReactNode = null;

  if (missing) {
    body = (
      <section className="rest-panel">
        <div className="rest-empty-state">
          <h2>아직 WebSocket 규격 문서가 없습니다.</h2>
          <p>이 프로젝트의 WebSocket 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 메시지를 추가합니다.</p>
          {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>WebSocket 규격 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
        </div>
      </section>
    );
  } else if (spec && docView === "history" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>WebSocket 문서 변경 이력</h2>
          <p>이 WebSocket 문서의 버전별 변경 내역과 두 버전 비교입니다. 프로젝트 전체 활동은 좌측 메뉴의 '최근 변경'에서 봅니다.</p>
        </div>
        <SpecHistory projectId={projectId} token={auth.token} kind="WEBSOCKET" heading={null} />
      </section>
    );
  } else if (spec && docView === "markdown" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>WebSocket 문서</h2>
          <p>저장된 WebSocket 문서를 읽기 좋은 형태로 보여 줍니다. 복사와 다운로드는 Markdown 원본을 사용합니다.</p>
        </div>
        <SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} kind="WEBSOCKET" rendered />
      </section>
    );
  } else if (spec && docView === "settings" && overview) {
    body = (
      <section className="rest-panel rest-settings">
        {noticeBanner}
        {draftBanner}
        <IssueSummary issues={settingsIssues} onPick={goToIssue} />
        <div className="rest-panel-head">
          <h2>문서 설정</h2>
          <p>WebSocket 문서 전체에 적용되는 연결 주소, 인증, 하트비트·공통 규칙, 종료 코드입니다. 메시지 저장과 별도로 저장됩니다.</p>
          <span className={`save-state is-${overviewDirty ? "dirty" : "clean"}`}>{overviewDirty ? "저장되지 않은 변경" : `저장됨 · v${spec.version}`}</span>
        </div>
        <div className="rest-card">
          <div className="rest-grid two">
            <Field label="문서 제목" required error={settingsErrors.get("doc:title")}>
              <input data-issue="doc:title" aria-invalid={Boolean(settingsErrors.get("doc:title"))} value={overview.title} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, title: event.target.value })} />
            </Field>
            <Field label="연결 URL" hint="클라이언트가 접속하는 WebSocket 주소입니다." error={settingsErrors.get("doc:url")}>
              <input className="mono" data-issue="doc:url" aria-invalid={Boolean(settingsErrors.get("doc:url"))} placeholder="wss://lab.example/ws" value={overview.url} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, url: event.target.value })} />
            </Field>
            <Field label="공통 인증 방식">
              <select value={overview.authType} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authType: event.target.value })}>
                {authTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="인증 설명" error={settingsErrors.get("doc:authDescription")}>
              <input data-issue="doc:authDescription" aria-invalid={Boolean(settingsErrors.get("doc:authDescription"))} placeholder="예: 접속 시 쿼리 파라미터 token으로 인증합니다." value={overview.authDescription} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authDescription: event.target.value })} />
            </Field>
          </div>
          <Field label="하트비트·공통 메시지 규칙" hint="연결 유지 방법, 세션 규칙, 메시지 공통 구조(예: type·requestId 사용 방식)를 문장으로 적습니다." error={settingsErrors.get("doc:heartbeat")}>
            <textarea data-issue="doc:heartbeat" aria-invalid={Boolean(settingsErrors.get("doc:heartbeat"))} rows={3} placeholder="예: 30초마다 ping을 보내고 60초 동안 응답이 없으면 연결을 끊습니다." value={overview.heartbeat} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, heartbeat: event.target.value })} />
          </Field>
        </div>
        <div className="rest-card">
          <h3 className="rest-card-title">종료 코드</h3>
          <p className="rest-card-note">연결을 닫을 때 쓰는 Close 코드(0~4999)와 의미입니다. 표준 코드 예: 1000(정상 종료), 1001(이탈), 4000번대는 애플리케이션 정의 코드입니다.</p>
          {overview.closeCodes.length === 0 ? <p className="schema-empty">등록된 종료 코드가 없습니다.</p> : (
            <div className="ws-close-codes">
              {overview.closeCodes.map((code, index) => (
                <div className="ws-close-row" key={index}>
                  <Field label="코드" error={settingsErrors.get(`doc:closeCode:${index}`)}>
                    <input className="mono" inputMode="numeric" data-issue={`doc:closeCode:${index}`} aria-invalid={Boolean(settingsErrors.get(`doc:closeCode:${index}`))} placeholder="4001" value={code.code} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, closeCodes: overview.closeCodes.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item) })} />
                  </Field>
                  <Field label="설명" error={settingsErrors.get(`doc:closeCodeText:${index}`)}>
                    <input data-issue={`doc:closeCodeText:${index}`} placeholder="예: 인증 만료" value={code.description} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, closeCodes: overview.closeCodes.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })} />
                  </Field>
                  {canEdit ? <button type="button" className="row-remove" aria-label={`종료 코드 ${code.code || index + 1} 삭제`} onClick={() => editOverview({ ...overview, closeCodes: overview.closeCodes.filter((_, itemIndex) => itemIndex !== index) })}>삭제</button> : null}
                </div>
              ))}
            </div>
          )}
          {canEdit ? <button type="button" className="schema-add" onClick={() => editOverview({ ...overview, closeCodes: [...overview.closeCodes, { code: "", description: "" }] })}>+ 종료 코드 추가</button> : null}
        </div>
        {canEdit ? (
          <div className="rest-card rest-save">
            <Field label="변경 사유" required hint="변경 이력(Revision)에 함께 기록되어, 나중에 누가 왜 바꿨는지 확인할 수 있습니다." error={settingsReasonError}>
              <input data-issue="doc:changeReason" aria-invalid={Boolean(settingsReasonError)} placeholder="예: 운영 서버 연결 URL 변경" value={overview.changeReason} onChange={(event) => { setSettingsReasonError(""); editOverview({ ...overview, changeReason: event.target.value }); }} />
            </Field>
            <div className="rest-save-actions">
              <button type="button" className="btn" disabled={saving || !overviewDirty} onClick={() => { overviewTouched.current = false; setOverview(overviewFrom(spec)); setSettingsAttempted(false); setSettingsReasonError(""); }}>변경 취소</button>
              <button type="button" className="btn primary" disabled={saving || (!overviewDirty && !overviewLock)} title={overviewDirty ? undefined : noChangeMessage} onClick={() => void saveOverview()}>{saving ? "저장 중" : overviewLock ? "최신 버전 기준으로 저장" : "문서 설정 저장"}</button>
            </div>
          </div>
        ) : <p className="rest-card-note rest-readonly-note">조회 권한에서는 문서 설정을 볼 수만 있습니다.</p>}
      </section>
    );
  } else if (spec && !itemParam) {
    const list = ordering ? orderedItems : visible;
    body = (
      <section className="rest-panel">
        {noticeBanner}
        {items.length === 0 ? (
          <div className="rest-empty-state">
            <h2>아직 등록된 메시지가 없습니다.</h2>
            <p>클라이언트와 서버가 주고받는 메시지의 식별자, 방향, Payload 구조를 등록해 보세요.</p>
            {canEdit ? <button type="button" className="btn primary" onClick={beginMessage}>+ 첫 메시지 추가</button> : <p>조회 권한으로는 메시지를 추가할 수 없습니다.</p>}
          </div>
        ) : (
          <div className="ep-board">
            <div className="ep-toolbar">
              {ordering ? (
                <>
                  <p className="ep-mode-note"><strong>순서 변경 중</strong> · 항목을 끌어서 원하는 위치에 놓은 뒤 '순서 저장'을 누르면 한 번에 저장됩니다.</p>
                  <div className="ep-toolbar-actions">
                    <button type="button" className="btn" disabled={saving} onClick={() => setOrdering(null)}>취소</button>
                    <button type="button" className="btn primary" disabled={saving || !orderChanged} title={orderChanged ? undefined : noChangeMessage} onClick={() => void saveOrdering()}>{saving ? "저장 중" : "순서 저장"}</button>
                  </div>
                </>
              ) : (
                <>
                  <input className="ep-search" type="search" aria-label="메시지 검색" placeholder="메시지 식별자 또는 이름으로 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
                  <div className="ep-toolbar-actions">
                    {canEdit && items.length > 1 ? <button type="button" className="btn" onClick={() => { setQuery(""); setNotice(null); setOrdering(items.map((item) => item.itemUid)); }}>순서 변경</button> : null}
                    {canEdit ? <button type="button" className="btn primary" onClick={beginMessage}>+ 메시지 추가</button> : null}
                  </div>
                </>
              )}
            </div>
            {list.length === 0 ? <p className="ep-empty">'{query.trim()}'와 일치하는 메시지가 없습니다.</p> : null}
            {ordering ? (
              <SortableList items={list} itemKey={(item) => item.itemUid} itemLabel={(item) => item.payload.eventName ?? item.name} disabled={saving} onMove={moveOrder}>
                {(item) => (
                  <>
                    <span className={`mqtt-dir dir-${(item.payload.direction ?? "").toLowerCase()}`}>{directionShort(item.payload.direction ?? "")}</span>
                    <span className="ep-main"><code>{item.payload.eventName}</code><span className="ep-name">{item.name}</span></span>
                  </>
                )}
              </SortableList>
            ) : (
              <ul className="ep-list">
                {newRow}
                {list.map((item) => messageRow(item, false))}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  } else if (spec && itemParam) {
    const notFound = !isNew && !selected;
    const readOnlyNew = isNew && !canEdit;
    body = (
      <div className="rest-split">
        <aside className="ep-pane" aria-label="메시지 목록">
          <input className="ep-search" type="search" aria-label="메시지 검색" placeholder="메시지 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginMessage}>+ 메시지 추가</button> : null}
          <ul className="ep-list is-compact">
            {newRow}
            {visible.map((item) => messageRow(item, true))}
          </ul>
          {items.length > 0 && visible.length === 0 ? <p className="ep-empty">일치하는 메시지가 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">
          {notFound || readOnlyNew ? (
            <div className="rest-empty-state">
              <h2>{readOnlyNew ? "조회 권한으로는 메시지를 추가할 수 없습니다." : "메시지를 찾을 수 없습니다."}</h2>
              <p>{readOnlyNew ? "목록에서 메시지를 선택해 조회하세요." : "삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요."}</p>
              <button type="button" className="btn" onClick={() => go({})}>메시지 목록으로</button>
            </div>
          ) : view ? (
            <form className="rest-editor" onSubmit={(event) => event.preventDefault()}>
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">{isNew ? "새 메시지 작성" : writer ? "메시지 편집" : "메시지 조회"}</p>
                  <h2>
                    <code>{view.eventName.trim() || "새 메시지"}</code>
                    {view.eventName.trim() ? <button type="button" className="copy-chip" aria-label="메시지 식별자 복사" onClick={() => void copyText(view.eventName.trim(), "메시지 식별자")}>복사</button> : null}
                  </h2>
                  {!writer ? (
                    <p className="mqtt-bar-meta">
                      <span>{view.name}</span>
                      <span>{directionText(view.direction)}</span>
                      <span>{kindText(view.messageKind)}</span>
                      <span>{view.status === "DEPRECATED" ? "사용 중단" : "사용 중"}</span>
                      <span>문서 v{spec.version}</span>
                    </p>
                  ) : null}
                </div>
                <div className="toolbar">
                  {writer ? <span className={`save-state is-${tone}`}>{saveLabel(tone, spec.version, conflict?.currentVersion, itemIssues.length)}</span> : null}
                  <button type="button" className="btn" aria-pressed={writer ? jsonOpen : undefined} onClick={() => (writer ? setJsonOpen((open) => !open) : document.getElementById("ws-json")?.scrollIntoView({ behavior: "smooth", block: "start" }))}>{writer && jsonOpen ? "JSON 예시 닫기" : "JSON 예시"}</button>
                  {!writer && canEdit && selected ? <button type="button" className="btn primary" onClick={beginEdit}>편집</button> : null}
                  {writer && !isNew ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                  {writer ? <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button> : null}
                  {writer ? <button type="button" className="btn primary" disabled={saving || Boolean(conflict) || !dirty} title={dirty ? undefined : noChangeMessage} onClick={startSave}>{saving ? "저장 중" : "메시지 저장"}</button> : null}
                  {writer && saveOpen && draft ? (
                    <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                      <Field label="변경 사유" required hint="변경 이력(Revision)에 기록되어, 누가 왜 바꿨는지 나중에 확인할 수 있습니다." error={reasonError}>
                        <input
                          data-issue="ws:changeReason"
                          aria-invalid={Boolean(reasonError)}
                          placeholder="예: 도어락 열기 응답에 결과 코드 필드 추가"
                          value={draft.changeReason}
                          onChange={(event) => { setReasonError(""); updateDraft({ ...draft, changeReason: event.target.value }); }}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!conflict) void saveItem(); } }}
                        />
                      </Field>
                      <div className="save-pop-actions">
                        <button type="button" className="btn" onClick={() => setSaveOpen(false)}>닫기</button>
                        <button type="button" className="btn primary" disabled={saving || Boolean(conflict)} onClick={() => { if (!conflict) void saveItem(); }}>{saving ? "저장 중" : "저장"}</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </header>
              {noticeBanner}
              {!canEdit && project.status === "ACTIVE" ? <p className="banner rest-banner">조회 권한입니다. 메시지를 수정할 수 없습니다.</p> : null}
              {project.status !== "ACTIVE" ? <p className="banner rest-banner warning">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
              {writer ? <IssueSummary issues={itemIssues} onPick={goToIssue} /> : null}
              {writer && attempted && itemIssues.length === 0 ? <p className="banner rest-banner success">오류를 모두 고쳤습니다. 다시 '메시지 저장'을 눌러 주세요.</p> : null}
              {restored && writer ? (
                <p className="banner rest-banner">이 브라우저에 남아 있던 임시 초안을 불러왔습니다. 아직 공식 규격이 아닙니다.
                  <button type="button" className="link-button" onClick={() => {
                    if (!spec || !draftFor) return;
                    sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
                    setDraft(selected ? wsFromApi(selected) : blankWs());
                    setRestored(false);
                    resetIssues();
                  }}>{selected ? "공식 규격으로 되돌리기" : "빈 양식으로 다시 시작"}</button>
                </p>
              ) : null}

              <div className={writer && jsonOpen ? "studio-work is-json" : "studio-work"}>
                <div className="rest-column">
                  {writer && draft ? (
                    <>
                      <section className="rest-card mqtt-step">
                        <div className="mqtt-step-head">
                          <h3 className="mqtt-step-title"><span>1</span>기본 정보</h3>
                          <details className="mqtt-terms">
                            <summary>WebSocket 용어 안내</summary>
                            <dl>
                              {wsTerms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.text}</dd></div>)}
                              <div className="ws-terms-note">Request/Response/Event와 requestId는 WebSocket 프로토콜 자체의 필수 규격이 아니라, 애플리케이션이 정하는 메시지 규약입니다.</div>
                            </dl>
                          </details>
                        </div>
                        <div className="rest-grid mqtt-topic-grid">
                          <Field label="메시지 식별자" required error={itemErrors.get("ws:eventName")}>
                            <input className="mono" data-issue="ws:eventName" aria-invalid={Boolean(itemErrors.get("ws:eventName"))} placeholder="doorlock.open" value={draft.eventName} onChange={(event) => updateDraft({ ...draft, eventName: event.target.value })} />
                          </Field>
                          <Field label="메시지 이름" hint={draft.name.trim() ? undefined : `비워 두면 메시지 식별자${draft.eventName.trim() ? `(${draft.eventName.trim()})` : ""}로 저장됩니다.`} error={itemErrors.get("ws:name")}>
                            <input data-issue="ws:name" aria-invalid={Boolean(itemErrors.get("ws:name"))} placeholder="예: 도어락 열기 요청 (선택)" value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
                          </Field>
                        </div>
                        <div className="mqtt-topic-guide">
                          <p>메시지 식별자는 이 프로젝트의 프로토콜에서 메시지를 구분하려고 정한 값입니다. 특정 라이브러리가 자동으로 해석하는 표준 필드가 아닙니다. 영문, 숫자, 점(.), 밑줄(_), 하이픈(-)을 쓸 수 있습니다.</p>
                          <div className="mqtt-examples">
                            {eventNameExamples.map((example) => (
                              <button key={example} type="button" className="mqtt-example" onClick={() => applyEventExample(example)}><code>{example}</code></button>
                            ))}
                          </div>
                          {sameNames.length > 0 ? (
                            <p className="mqtt-note is-warning" role="status">
                              주의: 같은 식별자의 메시지가 이미 등록되어 있습니다. 용도와 방향·종류를 확인해 주세요. (저장은 가능합니다)
                              {sameNames.map((item) => <span key={item.itemUid} className="mqtt-dup">{item.name} · {directionShort(item.payload.direction ?? "")} · {kindText(item.payload.messageKind ?? "")}</span>)}
                            </p>
                          ) : null}
                        </div>
                        <div className="rest-grid ws-kind-grid">
                          <Field label="방향" required hint={direction?.hint} error={itemErrors.get("ws:direction")}>
                            <select data-issue="ws:direction" value={draft.direction} onChange={(event) => updateDraft({ ...draft, direction: event.target.value })}>
                              {wsDirections.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                          </Field>
                          <Field label="메시지 종류" required hint={kind?.hint} error={itemErrors.get("ws:kind")}>
                            <select data-issue="ws:kind" value={draft.messageKind} onChange={(event) => updateDraft({ ...draft, messageKind: event.target.value })}>
                              {wsKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        <Field label="요약" error={itemErrors.get("ws:summary")}>
                          <input data-issue="ws:summary" aria-invalid={Boolean(itemErrors.get("ws:summary"))} placeholder="예: 앱에서 서버로 도어락 열기 명령을 요청합니다." value={draft.summary} onChange={(event) => updateDraft({ ...draft, summary: event.target.value })} />
                        </Field>
                        <Field label="상세 설명" error={itemErrors.get("ws:description")}>
                          <textarea data-issue="ws:description" aria-invalid={Boolean(itemErrors.get("ws:description"))} rows={3} placeholder="발생 조건, 처리 결과, 주의 사항 등을 적습니다." value={draft.description} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} />
                        </Field>
                      </section>

                      <section className="rest-card mqtt-step">
                        <h3 className="mqtt-step-title"><span>2</span>Payload 구조</h3>
                        <p className="rest-card-note">이 메시지 하나에 담기는 데이터(JSON 객체)의 필드입니다. 응답은 별도 메시지로 만들고 ③에서 대응 메시지로 연결합니다. Payload가 없으면 비워 둔 채 저장해도 됩니다.</p>
                        <details className="mqtt-type-guide">
                          <summary>타입을 고르면 예시 칸에 그 타입의 예시가 표시됩니다 · 타입별 예시 보기</summary>
                          <dl>
                            <dt><code>string</code></dt><dd>OPEN</dd>
                            <dt><code>integer</code></dt><dd>10</dd>
                            <dt><code>number</code></dt><dd>23.5</dd>
                            <dt><code>boolean</code></dt><dd>true 또는 false</dd>
                            <dt><code>enum</code></dt><dd>'상세'에 적은 Enum 값 중 하나</dd>
                            <dt><code>bytes</code></dt><dd>Base64 문자열 (예: AQID)</dd>
                            <dt><code>object · array</code></dt><dd>하위 필드·배열 요소의 예시로 자동 생성</dd>
                          </dl>
                        </details>
                        <SchemaTable
                          fields={draft.payload.fields}
                          issues={itemErrors}
                          emptyText="Payload 필드가 없습니다. 아래 '필드 추가'로 시작하세요."
                          namePlaceholder="예: doorlockId"
                          onChange={(fields) => updateDraft({ ...draft, payload: { ...draft.payload, fields } })}
                        />
                        <p className={preview?.problem ? "mqtt-json-status is-problem" : "mqtt-json-status"}>
                          {preview?.problem
                            ? `JSON 예시 확인 필요: ${preview.problem}`
                            : draft.payload.fields.length === 0
                              ? "JSON 예시: 필드가 없어 빈 객체({})로 저장됩니다."
                              : draft.payload.exampleMode === "MANUAL"
                                ? "JSON 예시: 직접 입력한 예시가 필드 정의와 일치합니다."
                                : "JSON 예시: 필드 예시 값으로 자동 생성되며 필드 정의와 일치합니다."}
                          <button type="button" className="link-button" onClick={() => setJsonOpen((open) => !open)}>{jsonOpen ? "JSON 예시 닫기" : "JSON 예시 보기"}</button>
                        </p>
                        {draft.payload.exampleMode === "MANUAL" && !jsonOpen ? (
                          <label className="manual-box">직접 입력한 Payload 예시 JSON
                            <textarea data-issue="ws:manual" value={draft.payload.manualText} onChange={(event) => applyExample({ ...draft.payload, manualText: event.target.value })} />
                          </label>
                        ) : null}
                      </section>

                      <section className="rest-card mqtt-step">
                        <h3 className="mqtt-step-title"><span>3</span>추가 설정</h3>
                        <div className="rest-grid two">
                          <Field label="대응 메시지 (요청·응답 연결)" hint="요청에 대응하는 응답 메시지가 있다면 연결하여 요청·응답 관계를 확인할 수 있습니다." error={itemErrors.get("ws:related")}>
                            <select data-issue="ws:related" aria-invalid={Boolean(itemErrors.get("ws:related"))} value={draft.relatedItemUid} onChange={(event) => updateDraft({ ...draft, relatedItemUid: event.target.value })}>
                              <option value="">연결 안 함</option>
                              {relatedOptions(items, draftFor, draft.messageKind).map((group) => (
                                <optgroup key={group.label} label={group.label}>
                                  {group.items.map((item) => <option key={item.itemUid} value={item.itemUid}>{messageLabel(item)}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </Field>
                          <Field label="상태">
                            <select value={draft.status} onChange={(event) => updateDraft({ ...draft, status: event.target.value as WsDraft["status"] })}>
                              <option value="ACTIVE">사용 중 (ACTIVE)</option>
                              <option value="DEPRECATED">사용 중단 (DEPRECATED)</option>
                            </select>
                          </Field>
                        </div>
                        {relatedHint ? <p className="mqtt-note is-info">안내: {relatedHint}</p> : null}
                        {auth.token ? (
                          <div className="mqtt-errors">
                            <ErrorCodePicker projectId={projectId} token={auth.token} selected={draft.errorCodeIds ?? []} onChange={(errorCodeIds) => updateDraft({ ...draft, errorCodeIds })} />
                          </div>
                        ) : null}
                      </section>
                    </>
                  ) : (
                    <>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">기본 정보</h3>
                        <dl className="rest-facts">
                          <div className="wide"><dt>메시지 식별자</dt><dd><code>{view.eventName}</code> <button type="button" className="copy-chip" aria-label="메시지 식별자 복사" onClick={() => void copyText(view.eventName.trim(), "메시지 식별자")}>복사</button></dd></div>
                          <div><dt>이름</dt><dd>{view.name}</dd></div>
                          <div><dt>상태</dt><dd>{view.status === "DEPRECATED" ? "사용 중단 (DEPRECATED)" : "사용 중 (ACTIVE)"}</dd></div>
                          <div><dt>방향</dt><dd>{directionText(view.direction)}</dd></div>
                          <div><dt>메시지 종류</dt><dd>{kindText(view.messageKind)}{kind ? <em> · {kind.hint}</em> : null}</dd></div>
                          <div className="wide"><dt>요약</dt><dd>{view.summary || <em>미설정</em>}</dd></div>
                          <div className="wide"><dt>상세 설명</dt><dd className="rest-desc">{view.description || <em>미설정</em>}</dd></div>
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">Payload 구조</h3>
                        <SchemaTable fields={view.payload.fields} readOnly emptyText="정의된 Payload 필드가 없습니다. 데이터가 없는 메시지이거나 아직 작성하지 않았습니다." />
                      </section>
                      <section className="rest-card rest-read" id="ws-json">
                        <h3 className="mqtt-read-title">
                          Payload 예시 JSON <small>{view.payload.exampleMode === "MANUAL" ? "직접 입력" : "필드 예시로 자동 생성"} · 메시지 공통 구조(envelope) 제외</small>
                          <button type="button" className="copy-chip" onClick={() => void copyText(preview?.text || "{}", "JSON 예시")}>JSON 복사</button>
                        </h3>
                        {preview?.problem ? <p className="banner warning">{preview.problem}</p> : null}
                        {view.payload.fields.length === 0 && view.payload.exampleMode !== "MANUAL" ? <p className="rest-card-note">Payload 필드가 정의되지 않아 예시가 빈 객체({"{}"})입니다.</p> : null}
                        <div className="mqtt-json-block"><JsonBlock text={preview?.text || "{}"} /></div>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">요청·응답 관계</h3>
                        <dl className="rest-facts">
                          <div>
                            <dt>이 메시지가 연결한 대응 메시지</dt>
                            <dd>{related ? <button type="button" className="link-button no-gap" onClick={() => openMessage(related.itemUid)}>{messageLabel(related)}</button> : view.relatedItemUid ? <em>찾을 수 없는 메시지</em> : <em>연결 안 함</em>}</dd>
                          </div>
                          <div>
                            <dt>이 메시지를 대응 메시지로 연결한 메시지</dt>
                            <dd>{linkedFrom.length ? linkedFrom.map((item) => <button key={item.itemUid} type="button" className="link-button no-gap ws-backlink" onClick={() => openMessage(item.itemUid)}>{messageLabel(item)}</button>) : <em>없음</em>}</dd>
                          </div>
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">관련 오류 코드</h3>
                        {(selected?.errorCodes ?? []).length === 0 ? <p className="rest-card-note">연결된 오류 코드가 없습니다.</p> : (
                          <ul className="mqtt-codes">
                            {(selected?.errorCodes ?? []).map((code) => <li key={code.id}><code>{code.code}</code> {code.category ? `${code.category} · ` : ""}{code.description}</li>)}
                          </ul>
                        )}
                      </section>
                    </>
                  )}
                </div>

                {writer && jsonOpen && draft ? (
                  <aside className="json-panel">
                    <header>
                      <h2>Payload 예시 JSON</h2>
                      <div className="seg">
                        <button type="button" aria-pressed={draft.payload.exampleMode === "AUTO"} onClick={() => setMode("AUTO")}>자동</button>
                        <button type="button" aria-pressed={draft.payload.exampleMode === "MANUAL"} onClick={() => setMode("MANUAL")}>직접</button>
                        <button type="button" className="copy" onClick={() => void copyText(preview?.text || "{}", "JSON 예시")}>복사</button>
                      </div>
                    </header>
                    <p>Payload 부분만 보여 줍니다. 메시지 공통 구조(envelope)는 이 문서 모델에 따로 정의되어 있지 않습니다.</p>
                    {preview?.problem ? <p>{preview.problem}</p> : null}
                    {draft.payload.fields.length === 0 && draft.payload.exampleMode === "AUTO" ? <p>Payload 필드가 없어 빈 객체가 만들어집니다.</p> : null}
                    {draft.payload.exampleMode === "MANUAL" ? (
                      <textarea aria-label="직접 입력 JSON" data-issue="ws:manual" value={draft.payload.manualText} onChange={(event) => applyExample({ ...draft.payload, manualText: event.target.value })} />
                    ) : (
                      <JsonBlock text={preview?.text || "{}"} />
                    )}
                  </aside>
                ) : null}
              </div>

              {confirmDelete ? (
                <div className="modal-backdrop">
                  <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                    <h2>메시지 삭제</h2>
                    <p>이 메시지만 삭제합니다. 문서와 다른 메시지는 남습니다.</p>
                    <label>변경 사유<input value={deleteReason} placeholder="예: 사용하지 않는 메시지 정리" onChange={(event) => setDeleteReason(event.target.value)} /></label>
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
                  {conflict.notes.length > 0 ? <ul>{conflict.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>다른 메시지 변경은 없습니다.</p>}
                  <div className="compare-grid">
                    <div><h4>내 입력</h4><pre>{draft ? `${draft.direction} ${draft.eventName}\n${previewText(draft.payload).text}` : ""}</pre></div>
                    <div><h4>서버 최신</h4><pre>{conflict.latest ? `${conflict.latest.payload.direction ?? ""} ${conflict.latest.payload.eventName ?? ""}\n${JSON.stringify(conflict.latest.payload.example ?? {}, null, 2)}` : "서버에 이 메시지가 없습니다."}</pre></div>
                  </div>
                  <button type="button" className="btn primary" disabled={saving} onClick={() => void saveWithLatest()}>{conflict.latest ? "이 메시지를 최신 버전 기준으로 저장" : "새 메시지로 저장"}</button>
                </section>
              ) : null}
            </form>
          ) : <p className="state-panel">메시지를 불러오는 중입니다.</p>}
        </section>
      </div>
    );
  }

  return (
    <main className="studio rest-studio mqtt-studio ws-studio">
      <div className="studio-main">
        {header}
        {!spec && notice ? noticeBanner : null}
        {body}
      </div>
    </main>
  );
}

function relatedOptions(items: SpecItem[], self: string | null, kind: string) {
  const others = items.filter((item) => item.itemUid !== self);
  const preferred = kind === "REQUEST" ? "RESPONSE" : kind === "RESPONSE" ? "REQUEST" : null;
  if (!preferred) {
    return [{ label: "메시지", items: others }];
  }
  return [
    { label: `${preferred === "RESPONSE" ? "Response" : "Request"} 메시지 (권장)`, items: others.filter((item) => item.payload.messageKind === preferred) },
    { label: "기타 메시지", items: others.filter((item) => item.payload.messageKind !== preferred) },
  ].filter((group) => group.items.length > 0);
}

function pairingHint(kind: string, related: SpecItem | null) {
  if (!related) {
    return kind === "REQUEST" ? "응답 메시지가 있으면 Response 메시지를 먼저 만든 뒤 여기서 연결하세요." : null;
  }
  const other = related.payload.messageKind;
  if (kind === "REQUEST" && other !== "RESPONSE") {
    return "보통 Request는 Response 메시지와 연결합니다. 의도한 연결인지 확인해 주세요. (저장은 가능합니다)";
  }
  if (kind === "RESPONSE" && other !== "REQUEST") {
    return "보통 Response는 Request 메시지와 연결합니다. 의도한 연결인지 확인해 주세요. (저장은 가능합니다)";
  }
  return null;
}

function copyWithSelection(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) {
    throw new Error("copy failed");
  }
}

function saveTone(notice: Notice, dirty: boolean, saving: boolean, conflict: boolean, invalid: boolean) {
  if (conflict) return "conflict";
  if (saving) return "saving";
  if (invalid || notice?.tone === "danger") return "error";
  if (dirty) return "dirty";
  return "clean";
}

function saveLabel(tone: string, version: number, conflictVersion: number | undefined, issueCount: number) {
  if (tone === "conflict") return `버전 충돌 · 서버 v${conflictVersion ?? ""}`;
  if (tone === "saving") return "저장 중";
  if (tone === "error") return issueCount > 0 ? `오류 ${issueCount}건 · 저장 안 됨` : "저장 실패 · 입력 유지";
  if (tone === "dirty") return "저장되지 않은 변경";
  return `변경 없음 · v${version}`;
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

function overviewSignature(overview: WsOverviewDraft) {
  return {
    title: overview.title.trim(),
    url: overview.url.trim(),
    heartbeat: overview.heartbeat.trim(),
    authType: overview.authType,
    authDescription: overview.authDescription.trim(),
    closeCodes: overview.closeCodes.map((code) => ({ code: String(code.code).trim(), description: code.description.trim() })),
  };
}
