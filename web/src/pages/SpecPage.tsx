import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { useToast } from "../toast";
import { ErrorCodePicker } from "../spec/ErrorCodePicker";
import { JsonBlock } from "../spec/jsonView";
import {
  fullUrl,
  issueMap,
  reasonProblem,
  validateItem,
  validateOverview,
  type EditorTab,
  type Issue,
} from "../spec/restValidation";
import { itemChanged, itemSaveBody, noChangeMessage, sameValue, type ItemSaveBody } from "../spec/saveCompare";
import { SchemaTable } from "../spec/SchemaTable";
import { SortableList } from "../spec/SortableList";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import {
  blankField,
  blankItem,
  blankResponse,
  draftKey,
  fieldFromApi,
  fieldToApi,
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
const commonStatuses = ["200", "201", "204", "400", "401", "403", "404", "409", "500"];

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

type Tone = "success" | "warning" | "danger" | "info";
type Notice = { text: string; tone: Tone } | null;
type DocView = "settings" | "history" | "markdown";
type Route = { item?: string | null; mode?: "edit" | null; view?: DocView | null };

const tabInfo: Record<EditorTab, { label: string; caption: string }> = {
  request: { label: "요청 Body", caption: "서버로 보내는 Request Body(JSON) 필드입니다. GET처럼 Body가 없는 API는 비워 두면 됩니다." },
  response: { label: "응답", caption: "서버가 돌려주는 Response Body입니다. 상태 코드별로 응답을 나눠 작성합니다." },
  header: { label: "Header", caption: "요청에 함께 보내는 HTTP 헤더와 인증 방식입니다." },
  path: { label: "Path", caption: "URL 경로 안의 변수입니다. 예: /users/{userId} 의 userId" },
  query: { label: "Query", caption: "URL 뒤에 ?key=value 형태로 붙는 쿼리 파라미터입니다." },
  errors: { label: "오류 코드", caption: "이 Endpoint에서 발생할 수 있는 오류를 프로젝트 오류 코드 목록에서 고릅니다." },
};
const tabOrder: EditorTab[] = ["request", "response", "header", "path", "query", "errors"];
const docViewLabel: Record<DocView, string> = { settings: "문서 설정", history: "변경 이력", markdown: "Markdown" };

export function SpecPage() {
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
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [baseline, setBaseline] = useState<ItemSaveBody | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<OverviewDraft | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overviewLock, setOverviewLock] = useState<number | null>(null);
  const [tab, setTab] = useState<EditorTab>("request");
  const [responseIndex, setResponseIndex] = useState(0);
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
  const selectedView = useMemo(() => (selected ? itemFromApi(selected) : null), [selected]);
  const overviewDirty = Boolean(spec && overview && !sameValue(overviewSignature(overview), overviewSignature(overviewFrom(spec))));
  const currentBody = useMemo(() => itemSaveBody(draft, itemToPayload), [draft]);
  const dirty = Boolean(draft && draftFor) && itemChanged(draftFor === "new", baseline, currentBody);

  usePageChrome(project?.title ?? "REST API", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "REST API" },
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
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/API`, { token });
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
        say(error instanceof ApiError && error.status === 401 ? "로그인이 만료되었습니다." : authErrorMessage(error), "danger");
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
    if (!spec) {
      return;
    }
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
    if (draftFor === editTarget) {
      return;
    }
    const found = spec.items.find((item) => item.itemUid === editTarget);
    if (editTarget !== "new" && !found) {
      return;
    }
    let next = found ? itemFromApi(found) : blankItem();
    let wasRestored = false;
    const saved = sessionStorage.getItem(draftKey(spec.id, editTarget, spec.version));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { draft?: ItemDraft };
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
    setBaseline(found ? itemSaveBody(itemFromApi(found), itemToPayload) : null);
    setRestored(wasRestored);
    setBaseVersion(spec.version);
    setConflict(null);
    setAttempted(false);
    setReasonError("");
    setSaveOpen(false);
    setTab("request");
    setResponseIndex(0);
    if (editTarget === "new" && !wasRestored) {
      setFocusTarget("item:path");
    }
  }, [spec, editTarget, draftFor]);

  useEffect(() => {
    setResponseIndex(0);
    setConfirmDelete(false);
  }, [itemParam]);

  useEffect(() => {
    if (!spec || !draft || !draftFor) {
      return;
    }
    if (!dirty) {
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      return;
    }
    sessionStorage.setItem(draftKey(spec.id, draftFor, baseVersion), JSON.stringify({ official: false, draft }));
  }, [spec, draft, draftFor, dirty, baseVersion]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty && !overviewDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty, overviewDirty]);

  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-issue="${CSS.escape(focusTarget)}"]`);
      if (element) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
        element.focus({ preventScroll: true });
      }
      setFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget, tab, responseIndex, docView, itemParam, draftFor]);

  if (!auth.ready) {
    return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  if (denied) {
    return <main className="spec-screen"><h1>REST API</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
  }
  if (loading) {
    return <main className="spec-screen"><p className="state-panel">불러오는 중입니다.</p></main>;
  }
  if (!project) {
    return <main className="spec-screen"><p>{notice?.text || "프로젝트를 찾지 못했습니다."}</p></main>;
  }

  function go(next: Route, options: { keepNotice?: boolean; replace?: boolean } = {}) {
    const search = new URLSearchParams();
    if (next.view) search.set("view", next.view);
    if (next.item) search.set("item", next.item);
    if (next.mode) search.set("mode", next.mode);
    if (!options.keepNotice) {
      setNotice(null);
    }
    setSearchParams(search, { replace: options.replace });
  }

  function guardEndpoint() {
    return !dirty || window.confirm("저장하지 않은 Endpoint 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 임시로 남습니다.");
  }

  function guardLeave() {
    if (!dirty && !overviewDirty) {
      return true;
    }
    const parts = [dirty ? "Endpoint" : "", overviewDirty ? "문서 설정" : ""].filter(Boolean).join("와 ");
    return window.confirm(`저장하지 않은 ${parts} 변경이 있습니다. 이 화면을 떠나면 공식 규격에 반영되지 않습니다.${dirty ? " Endpoint 초안만 이 브라우저에 임시로 남습니다." : ""}`);
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
    if (draftFor && !guardEndpoint()) {
      return;
    }
    go({});
  }

  function openEndpoint(uid: string) {
    if (uid === draftFor) {
      go({ item: uid, mode: uid === "new" ? null : "edit" });
      return;
    }
    if (draftFor && !guardEndpoint()) {
      return;
    }
    go({ item: uid });
  }

  function beginEndpoint() {
    if (!spec || !canEdit) {
      return;
    }
    if (draftFor && draftFor !== "new" && !guardEndpoint()) {
      return;
    }
    go({ item: "new" });
  }

  function beginEdit() {
    if (!selected || !canEdit) {
      return;
    }
    go({ item: selected.itemUid, mode: "edit" });
  }

  function cancelEdit() {
    if (dirty && !window.confirm("저장하지 않은 변경을 버리고 조회 화면으로 돌아갈까요?")) {
      return;
    }
    const target = draftFor;
    if (spec && target) {
      sessionStorage.removeItem(draftKey(spec.id, target, baseVersion));
    }
    dropDraft();
    go(target && target !== "new" ? { item: target } : {});
  }

  function openDocView(view: DocView) {
    go(editTarget ? { view, item: editTarget, mode: editTarget === "new" ? null : "edit" } : { view });
  }

  function closeDocView() {
    go(editTarget ? { item: editTarget, mode: editTarget === "new" ? null : "edit" } : {});
  }

  function updateDraft(next: ItemDraft) {
    setDraft(next);
  }

  function editOverview(next: OverviewDraft) {
    overviewTouched.current = true;
    setOverview(next);
  }

  function goToIssue(issue: Issue) {
    if (issue.target.startsWith("doc:") || issue.where.startsWith("문서 설정")) {
      if (docView !== "settings") {
        openDocView("settings");
      }
    } else {
      if (docView) {
        closeDocView();
      }
      if (issue.tab) {
        setTab(issue.tab);
      }
      if (issue.responseIndex !== undefined) {
        setResponseIndex(issue.responseIndex);
      }
    }
    setFocusTarget(issue.target);
  }

  async function createDocument() {
    if (!auth.token || !canEdit) {
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "API", title: "API 규격" } });
      await loadSpec(auth.token);
      notifySpecChanged();
      say("REST API 규격 문서를 만들었습니다.", "success");
    } catch (error) {
      say(authErrorMessage(error), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) {
      return;
    }
    const found = validateOverview(overview);
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
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/API`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: sentVersion,
          changeReason: overview.changeReason.trim(),
          title: overview.title.trim(),
          overview: {
            baseUrl: overview.baseUrl.trim(),
            auth: { type: overview.authType, description: overview.authDescription.trim() },
            commonHeaders: overview.headers.map((field) => fieldToApi(field)),
          },
        },
      });
      setOverviewLock(null);
      overviewTouched.current = false;
      setSettingsAttempted(false);
      const document = await loadSpec(auth.token);
      if (document) {
        setOverview(overviewFrom(document));
        if (draftFor) {
          setBaseVersion(document.version);
        }
      }
      notifySpecChanged();
      if (result.version === sentVersion) {
        say(noChangeMessage, "info");
        return;
      }
      say(dirty
        ? `문서 설정을 저장했습니다 · 문서 버전 v${result.version}. 편집 중인 Endpoint 초안은 그대로 유지됩니다.`
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
    if (!draft || !dirty) {
      return;
    }
    const found = validateItem(draft);
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
    setSaveOpen(true);
    setFocusTarget("item:changeReason");
  }

  async function saveItem(version = baseVersion, create = draftFor === "new") {
    if (!auth.token || !spec || !draft || !draftFor || saving || (!dirty && !conflict)) {
      return;
    }
    const found = validateItem(draft);
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
      setFocusTarget("item:changeReason");
      return;
    }
    setSaving(true);
    setNotice(null);
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
        : `/api/projects/${projectId}/specs/API/items/${draftFor}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, {
        method: create ? "POST" : "PUT",
        token: auth.token,
        body,
      });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      const uid = result.itemUid ?? draftFor;
      await loadSpec(auth.token);
      notifySpecChanged();
      dropDraft();
      go({ item: uid }, { keepNotice: true });
      say(!create && result.version === version ? noChangeMessage : `저장했습니다 · 문서 버전 v${result.version}`, !create && result.version === version ? "info" : "success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setSaveOpen(false);
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && draftFor !== "new") {
        say("이 Endpoint는 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.", "warning");
        const latest = await loadSpec(auth.token);
        if (latest) {
          setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 Endpoint가 삭제되었습니다."] });
        }
      } else if (error instanceof ApiError && error.code === "EXAMPLE_SCHEMA_MISMATCH") {
        say("예시가 필드 구조와 맞지 않아 저장하지 않았습니다. 입력은 그대로 남아 있습니다.", "danger");
      } else {
        say(`저장하지 못했습니다. ${authErrorMessage(error)} 입력은 그대로 남아 있습니다.`, "danger");
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
      .filter((item) => item.itemUid !== draftFor && !previous.includes(`${item.itemUid}:${item.name}`))
      .map((item) => `${item.payload.method ?? ""} ${item.payload.path ?? item.name}`.trim());
    const removed = spec.items
      .filter((item) => item.itemUid !== draftFor && !latest.items.some((next) => next.itemUid === item.itemUid))
      .map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setOverview((current) => (current && overviewTouched.current ? current : overviewFrom(latest)));
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === draftFor) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    say("다른 사용자가 먼저 저장했습니다. 이 항목의 입력은 남아 있습니다. 다른 항목은 이 저장에 포함되지 않습니다.", "warning");
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
    if (!auth.token || !spec || !draftFor || draftFor === "new" || !deleteReason.trim()) {
      say("삭제 사유를 입력하세요.", "danger");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/API/items/${draftFor}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      setConfirmDelete(false);
      setDeleteReason("");
      dropDraft();
      await loadSpec(auth.token);
      notifySpecChanged();
      go({}, { keepNotice: true });
      say(`Endpoint를 삭제했습니다 · 문서 버전 v${result.version}`, "success");
    } catch (error) {
      say(error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT"
        ? "다른 저장이 먼저 반영되어 삭제하지 않았습니다."
        : authErrorMessage(error), "danger");
      if (auth.token) {
        await loadSpec(auth.token);
      }
    } finally {
      setSaving(false);
    }
  }

  function startOrdering() {
    if (!spec) {
      return;
    }
    setQuery("");
    setNotice(null);
    setOrdering(spec.items.map((item) => item.itemUid));
  }

  function moveOrder(from: number, to: number) {
    setOrdering((current) => {
      if (!current || to < 0 || to >= current.length || from === to) {
        return current;
      }
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveOrdering() {
    if (!auth.token || !spec || !ordering) {
      return;
    }
    if (ordering.join(",") === spec.items.map((item) => item.itemUid).join(",")) {
      setOrdering(null);
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/API/items/order`, {
        method: "PUT",
        token: auth.token,
        body: { version: spec.version, changeReason: "Endpoint 순서 변경", itemUids: ordering },
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

  const items = spec?.items ?? [];
  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) => `${item.name} ${item.summary} ${item.payload.method ?? ""} ${item.payload.path ?? ""}`.toLowerCase().includes(needle));
  const orderedItems = ordering ? ordering.map((uid) => items.find((item) => item.itemUid === uid)).filter((item): item is SpecItem => Boolean(item)) : [];
  const orderChanged = Boolean(ordering) && !sameValue(ordering, items.map((item) => item.itemUid));
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const view: ItemDraft | null = writer ? draft : selectedView;
  const isNew = itemParam === "new";
  const responseCursor = view ? Math.min(responseIndex, Math.max(view.responses.length - 1, 0)) : 0;
  const activeExample: ExampleDraft | null = view
    ? (tab === "response" ? view.responses[responseCursor] ?? null : view.requestBody)
    : null;
  const preview = activeExample ? previewText(activeExample) : null;
  const jsonTitle = tab === "response"
    ? `응답 ${view?.responses[responseCursor]?.status ?? ""} 예시 JSON`
    : "요청 Body 예시 JSON";
  const missingPath = view ? pathWarning(view.path, view.pathParams) : [];
  const itemIssues = draft && attempted ? validateItem(draft) : [];
  const itemErrors = issueMap(itemIssues);
  const settingsIssues = overview && settingsAttempted ? validateOverview(overview) : [];
  const settingsErrors = issueMap(settingsIssues);
  const tone = saveTone(notice, dirty, saving, Boolean(conflict), itemIssues.length > 0);
  const address = view ? fullUrl(spec?.overview.baseUrl, view.method, view.path) : null;
  const pendingEndpoint = dirty && draft ? `${draft.method} ${draft.path.trim() || "새 Endpoint"}` : "";
  const crumbTail = docView
    ? docViewLabel[docView]
    : isNew ? "새 Endpoint" : selected ? `${selected.payload.method ?? ""} ${selected.payload.path ?? ""}`.trim() : null;

  function tabErrors(target: EditorTab, index?: number) {
    return itemIssues.filter((issue) => issue.tab === target && (index === undefined || issue.responseIndex === index)).length;
  }

  function updateResponse(index: number, next: ItemDraft["responses"][number]) {
    if (!draft) {
      return;
    }
    updateDraft({ ...draft, responses: draft.responses.map((response, responseIndex) => (responseIndex === index ? next : response)) });
  }

  function addResponse() {
    if (!draft) {
      return;
    }
    const used = new Set(draft.responses.map((response) => response.status.trim()));
    const status = commonStatuses.find((code) => !used.has(code)) ?? String(200 + draft.responses.length);
    const next = blankResponse(status);
    if (Number(status) >= 400) {
      next.name = "실패";
    }
    updateDraft({ ...draft, responses: [...draft.responses, next] });
    setTab("response");
    setResponseIndex(draft.responses.length);
  }

  function addPathParams(names: string[]) {
    if (!draft) {
      return;
    }
    updateDraft({ ...draft, pathParams: [...draft.pathParams, ...names.map((name) => blankField(name))] });
    setTab("path");
  }

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

  const noticeBanner = notice ? <p className={`banner rest-banner ${noticeTone(notice.tone)}`}>{notice.text}</p> : null;

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guardLeave()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {crumbTail ? <button type="button" className="crumb-link" onClick={toList}>REST API</button> : <strong>REST API</strong>}
        {crumbTail ? <><span aria-hidden="true">/</span><strong className="crumb-current">{crumbTail}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>REST API 규격</h1>
          {spec ? (
            <p className="rest-doc-meta">
              {spec.title.trim() && spec.title.trim() !== "API 규격" ? <span>{spec.title}</span> : null}
              <span>문서 v{spec.version}</span>
              <span>Endpoint {items.length}개</span>
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

  const draftBanner = docView && pendingEndpoint ? (
    <p className="banner rest-banner">
      편집 중인 Endpoint <code>{pendingEndpoint}</code>는 저장되지 않은 상태로 그대로 유지됩니다.
      <button type="button" className="link-button" onClick={closeDocView}>Endpoint 편집으로 돌아가기</button>
    </p>
  ) : null;

  function endpointRow(item: SpecItem, compact: boolean) {
    const current = item.itemUid === itemParam && !docView;
    const editingThis = item.itemUid === draftFor && dirty;
    return (
      <li key={item.itemUid}>
        <button type="button" className={current ? "ep-row is-current" : "ep-row"} aria-current={current ? "true" : undefined} onClick={() => openEndpoint(item.itemUid)}>
          <span className={`method method-${(item.payload.method ?? "get").toLowerCase()}`}>{item.payload.method}</span>
          <span className="ep-main">
            <code>{item.payload.path}</code>
            <span className="ep-name">
              {item.name}
              {!compact && item.summary ? <em> · {item.summary}</em> : null}
            </span>
          </span>
          {item.status === "DEPRECATED" ? <span className="ep-tag">사용 중단</span> : null}
          {editingThis ? <span className="ep-tag is-draft">수정 중</span> : null}
        </button>
      </li>
    );
  }

  const newRow = draftFor === "new" && draft ? (
    <li key="new">
      <button type="button" className={isNew && !docView ? "ep-row is-current" : "ep-row"} onClick={() => openEndpoint("new")}>
        <span className={`method method-${draft.method.toLowerCase()}`}>{draft.method}</span>
        <span className="ep-main"><code>{draft.path.trim() || "경로 미입력"}</code><span className="ep-name">새 Endpoint</span></span>
        <span className="ep-tag is-draft">작성 중</span>
      </button>
    </li>
  ) : null;

  let body: ReactNode = null;

  if (missing) {
    body = (
      <section className="rest-empty-state">
        <h2>아직 REST API 규격 문서가 없습니다.</h2>
        <p>이 프로젝트의 REST API 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 Endpoint를 추가합니다.</p>
        {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>REST API 규격 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
      </section>
    );
  } else if (spec && docView === "history" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>REST API 문서 변경 이력</h2>
          <p>이 REST API 문서의 버전별 변경 내역과 두 버전 비교입니다. 프로젝트 전체 활동은 좌측 메뉴의 '최근 변경'에서 봅니다.</p>
        </div>
        <SpecHistory projectId={projectId} token={auth.token} heading={null} />
      </section>
    );
  } else if (spec && docView === "markdown" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>REST API 문서</h2>
          <p>저장된 REST API 문서를 읽기 좋은 형태로 보여 줍니다. 복사와 다운로드는 Markdown 원본을 사용합니다.</p>
        </div>
        <SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} rendered />
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
          <p>모든 Endpoint에 공통으로 적용되는 문서 단위 설정입니다. Endpoint 저장과 별도로 저장됩니다.</p>
          <span className={`save-state is-${overviewDirty ? "dirty" : "clean"}`}>{overviewDirty ? "저장되지 않은 변경" : `저장됨 · v${spec.version}`}</span>
        </div>
        <div className="rest-card">
          <div className="rest-grid two">
            <Field label="문서 제목" required error={settingsErrors.get("doc:title")}>
              <input data-issue="doc:title" aria-invalid={Boolean(settingsErrors.get("doc:title"))} value={overview.title} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, title: event.target.value })} />
            </Field>
            <Field label="Base URL" hint="Endpoint의 전체 주소를 만들 때 앞에 붙습니다." error={settingsErrors.get("doc:baseUrl")}>
              <input className="mono" data-issue="doc:baseUrl" aria-invalid={Boolean(settingsErrors.get("doc:baseUrl"))} placeholder="https://api.example.com" value={overview.baseUrl} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, baseUrl: event.target.value })} />
            </Field>
            <Field label="공통 인증 방식">
              <select value={overview.authType} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authType: event.target.value })}>
                {authTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="인증 설명" error={settingsErrors.get("doc:authDescription")}>
              <input data-issue="doc:authDescription" aria-invalid={Boolean(settingsErrors.get("doc:authDescription"))} placeholder="예: Authorization 헤더에 Bearer 토큰을 넣습니다." value={overview.authDescription} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authDescription: event.target.value })} />
            </Field>
          </div>
        </div>
        <div className="rest-card">
          <h3 className="rest-card-title">공통 헤더</h3>
          <p className="rest-card-note">모든 요청에 공통으로 붙는 헤더입니다. Endpoint마다 다른 헤더는 Endpoint의 Header 탭에 작성합니다.</p>
          <SchemaTable
            fields={overview.headers}
            readOnly={!canEdit}
            issues={settingsErrors}
            addLabel="공통 헤더 추가"
            emptyText="공통 헤더가 없습니다."
            namePlaceholder="예: Authorization"
            onChange={canEdit ? (headers) => editOverview({ ...overview, headers }) : undefined}
          />
        </div>
        {canEdit ? (
          <div className="rest-card rest-save">
            <Field label="변경 사유" required hint="변경 이력(Revision)에 함께 기록되어, 나중에 누가 왜 바꿨는지 확인할 수 있습니다." error={settingsReasonError}>
              <input data-issue="doc:changeReason" aria-invalid={Boolean(settingsReasonError)} placeholder="예: 운영 서버 Base URL 변경" value={overview.changeReason} onChange={(event) => { setSettingsReasonError(""); editOverview({ ...overview, changeReason: event.target.value }); }} />
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
                <input className="ep-search" type="search" aria-label="Endpoint 검색" placeholder="Method, 경로, 이름으로 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
                <div className="ep-toolbar-actions">
                  {canEdit && items.length > 1 ? <button type="button" className="btn" onClick={startOrdering}>순서 변경</button> : null}
                  {canEdit && items.length > 0 ? <button type="button" className="btn primary" onClick={beginEndpoint}>+ Endpoint 추가</button> : null}
                </div>
              </>
            )}
          </div>
          {items.length === 0 ? (
            <div className="rest-empty-state">
              <h2>아직 등록된 Endpoint가 없습니다.</h2>
              <p>Method와 URL 경로를 정하고 요청·응답 필드를 작성하면 REST API 문서가 만들어집니다.</p>
              {canEdit ? <button type="button" className="btn primary" onClick={beginEndpoint}>+ 첫 Endpoint 작성</button> : <p>조회 권한으로는 Endpoint를 추가할 수 없습니다.</p>}
            </div>
          ) : null}
          {items.length > 0 && list.length === 0 ? <p className="ep-empty">'{query.trim()}'와 일치하는 Endpoint가 없습니다.</p> : null}
          {ordering ? (
            <SortableList
              items={list}
              itemKey={(item) => item.itemUid}
              itemLabel={(item) => `${item.payload.method ?? ""} ${item.payload.path ?? item.name}`}
              disabled={saving}
              onMove={moveOrder}
            >
              {(item) => (
                <>
                  <span className={`method method-${(item.payload.method ?? "get").toLowerCase()}`}>{item.payload.method}</span>
                  <span className="ep-main"><code>{item.payload.path}</code><span className="ep-name">{item.name}</span></span>
                </>
              )}
            </SortableList>
          ) : (
            <ul className="ep-list">
              {newRow}
              {list.map((item) => endpointRow(item, false))}
            </ul>
          )}
        </div>
      </section>
    );
  } else if (spec && itemParam) {
    const notFound = !isNew && !selected;
    const readOnlyNew = isNew && !canEdit;
    body = (
      <div className="rest-split">
        <aside className="ep-pane" aria-label="Endpoint 목록">
          <input className="ep-search" type="search" aria-label="Endpoint 검색" placeholder="Endpoint 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginEndpoint}>+ Endpoint 추가</button> : null}
          <ul className="ep-list is-compact">
            {newRow}
            {visible.map((item) => endpointRow(item, true))}
          </ul>
          {items.length > 0 && visible.length === 0 ? <p className="ep-empty">일치하는 Endpoint가 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">
          {notFound || readOnlyNew ? (
            <div className="rest-empty-state">
              <h2>{readOnlyNew ? "조회 권한으로는 Endpoint를 추가할 수 없습니다." : "Endpoint를 찾을 수 없습니다."}</h2>
              <p>{readOnlyNew ? "목록에서 Endpoint를 선택해 조회하세요." : "삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요."}</p>
              <button type="button" className="btn" onClick={() => go({})}>Endpoint 목록으로</button>
            </div>
          ) : view ? (
            <form className="rest-editor" onSubmit={(event) => event.preventDefault()}>
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">{isNew ? "새 Endpoint 작성" : writer ? "Endpoint 편집" : "Endpoint 조회"}</p>
                  <h2><span className={`method method-${view.method.toLowerCase()}`}>{view.method}</span> <code>{view.path.trim() || "경로 미입력"}</code></h2>
                </div>
                <div className="toolbar">
                  {writer ? <span className={`save-state is-${tone}`}>{saveLabel(tone, spec.version, conflict?.currentVersion, itemIssues.length)}</span> : <span className="save-state">문서 v{spec.version}</span>}
                  <button type="button" className="btn" aria-pressed={jsonOpen} onClick={() => setJsonOpen((open) => !open)}>{jsonOpen ? "예시 JSON 닫기" : "예시 JSON"}</button>
                  {!writer && canEdit && selected ? <button type="button" className="btn primary" onClick={beginEdit}>편집</button> : null}
                  {writer && !isNew ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                  {writer ? <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button> : null}
                  {writer ? <button type="button" className="btn primary" disabled={saving || Boolean(conflict) || !dirty} title={dirty ? undefined : noChangeMessage} onClick={startSave}>{saving ? "저장 중" : "저장"}</button> : null}
                  {writer && saveOpen && draft ? (
                    <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                      <Field label="변경 사유" required hint="변경 이력(Revision)에 기록되어, 누가 왜 바꿨는지 나중에 확인할 수 있습니다." error={reasonError}>
                        <input
                          data-issue="item:changeReason"
                          aria-invalid={Boolean(reasonError)}
                          placeholder="예: 로그인 응답에 accessToken 필드 추가"
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
              {!canEdit && project.status === "ACTIVE" ? <p className="banner rest-banner">조회 권한입니다. Endpoint를 수정할 수 없습니다.</p> : null}
              {project.status !== "ACTIVE" ? <p className="banner rest-banner warning">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
              {writer ? <IssueSummary issues={itemIssues} onPick={goToIssue} /> : null}
              {writer && attempted && itemIssues.length === 0 ? <p className="banner rest-banner success">오류를 모두 고쳤습니다. 다시 '저장'을 눌러 주세요.</p> : null}
              {restored && writer ? (
                <p className="banner rest-banner">이 브라우저에 남아 있던 임시 초안을 불러왔습니다. 아직 공식 규격이 아닙니다.
                  <button type="button" className="link-button" onClick={() => {
                    if (!spec || !draftFor) return;
                    sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
                    setDraft(selected ? itemFromApi(selected) : blankItem());
                    setRestored(false);
                    resetIssues();
                  }}>{selected ? "공식 규격으로 되돌리기" : "빈 양식으로 다시 시작"}</button>
                </p>
              ) : null}

              <div className={jsonOpen ? "studio-work is-json" : "studio-work"}>
                <div className="rest-column">
                  {writer ? (
                    <section className="rest-card rest-basic">
                      <div className="rest-url">
                        <Field label="HTTP Method" required>
                          <select className="method-select" value={view.method} onChange={(event) => updateDraft({ ...draft!, method: event.target.value })}>
                            {methods.map((method) => <option key={method}>{method}</option>)}
                          </select>
                        </Field>
                        <Field label="URL 경로 (Path)" required error={itemErrors.get("item:path")}>
                          <input className="mono" data-issue="item:path" aria-invalid={Boolean(itemErrors.get("item:path"))} placeholder="/api/v1/auth/login" value={view.path} onChange={(event) => updateDraft({ ...draft!, path: event.target.value })} />
                        </Field>
                      </div>
                      <AddressLine address={address} hasBase={Boolean(spec.overview.baseUrl?.trim())} onSettings={() => openDocView("settings")} />
                      <div className="rest-grid meta">
                        <Field label="Endpoint 이름" required error={itemErrors.get("item:name")}>
                          <input data-issue="item:name" aria-invalid={Boolean(itemErrors.get("item:name"))} placeholder="예: 로그인" value={view.name} onChange={(event) => updateDraft({ ...draft!, name: event.target.value })} />
                        </Field>
                        <Field label="요약" error={itemErrors.get("item:summary")}>
                          <input data-issue="item:summary" aria-invalid={Boolean(itemErrors.get("item:summary"))} placeholder="예: 사번과 비밀번호로 액세스 토큰을 발급합니다." value={view.summary} onChange={(event) => updateDraft({ ...draft!, summary: event.target.value })} />
                        </Field>
                        <Field label="상태">
                          <select value={view.status} onChange={(event) => updateDraft({ ...draft!, status: event.target.value as ItemDraft["status"] })}>
                            <option value="ACTIVE">사용 중 (ACTIVE)</option>
                            <option value="DEPRECATED">사용 중단 (DEPRECATED)</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="설명" error={itemErrors.get("item:description")}>
                        <textarea data-issue="item:description" aria-invalid={Boolean(itemErrors.get("item:description"))} rows={2} placeholder="동작, 호출 조건, 주의 사항 등을 적습니다." value={view.description} onChange={(event) => updateDraft({ ...draft!, description: event.target.value })} />
                      </Field>
                    </section>
                  ) : (
                    <section className="rest-card rest-read">
                      <dl className="rest-facts">
                        <div className="wide"><dt>전체 주소</dt><dd>{address ? <code>{address}</code> : <><code>{`${view.method} ${view.path}`}</code> <em>Base URL 미설정</em></>}</dd></div>
                        <div><dt>이름</dt><dd>{view.name}</dd></div>
                        <div><dt>상태</dt><dd>{view.status === "DEPRECATED" ? "사용 중단 (DEPRECATED)" : "사용 중 (ACTIVE)"}</dd></div>
                        <div className="wide"><dt>요약</dt><dd>{view.summary || <em>요약이 없습니다.</em>}</dd></div>
                        <div className="wide"><dt>설명</dt><dd className="rest-desc">{view.description || <em>설명이 없습니다.</em>}</dd></div>
                      </dl>
                    </section>
                  )}

                  {missingPath.length > 0 ? (
                    <p className="banner rest-banner warning">
                      URL 경로의 {missingPath.map((name) => `{${name}}`).join(", ")}가 Path 변수에 없습니다.{writer ? " 저장은 가능합니다." : ""}
                      {writer ? <button type="button" className="link-button" onClick={() => addPathParams(missingPath)}>Path 변수로 추가</button> : null}
                    </p>
                  ) : null}

                  <section className="rest-card rest-tabs-card">
                    <div className="tabs rest-tabs" role="tablist">
                      {tabOrder.map((key) => {
                        const count = tabErrors(key);
                        const size = key === "response" ? view.responses.length
                          : key === "header" ? view.headers.length
                          : key === "path" ? view.pathParams.length
                          : key === "query" ? view.queryParams.length
                          : key === "request" ? view.requestBody.fields.length
                          : view.errorCodeIds.length;
                        return (
                          <button type="button" role="tab" key={key} aria-selected={tab === key} className={count > 0 ? "has-error" : ""} onClick={() => setTab(key)}>
                            {tabInfo[key].label}
                            {size > 0 ? <span className="tab-size">{size}</span> : null}
                            {count > 0 ? <span className="tab-error">오류 {count}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                    <p className="tab-caption">{tabInfo[tab].caption}</p>

                    {tab === "request" ? (
                      <SchemaTable
                        fields={view.requestBody.fields}
                        readOnly={!writer}
                        issues={itemErrors}
                        emptyText={writer ? "Request Body 필드가 없습니다. Body가 없는 API라면 비워 둔 채 저장해도 됩니다." : "Request Body가 없습니다."}
                        onChange={writer ? (fields) => updateDraft({ ...draft!, requestBody: { ...draft!.requestBody, fields } }) : undefined}
                      />
                    ) : null}

                    {tab === "response" ? (
                      <div className="rest-response">
                        <div className="response-chips" role="tablist" aria-label="응답 목록">
                          {view.responses.map((response, index) => {
                            const count = tabErrors("response", index);
                            return (
                              <button type="button" key={response.clientKey} aria-selected={responseCursor === index} className={count > 0 ? "has-error" : ""} onClick={() => setResponseIndex(index)}>
                                <strong>{response.status || "???"}</strong> {response.name || "이름 없음"}
                                {count > 0 ? <span className="tab-error">오류 {count}</span> : null}
                              </button>
                            );
                          })}
                          {writer ? <button type="button" className="chip-add" onClick={addResponse}>+ 응답 추가</button> : null}
                        </div>
                        {view.responses[responseCursor] ? (
                          <>
                            {writer ? (
                              <div className="rest-grid response-meta">
                                <Field label="상태 코드" required error={itemErrors.get(`response:${view.responses[responseCursor].clientKey}:status`)}>
                                  <input
                                    className="mono"
                                    inputMode="numeric"
                                    data-issue={`response:${view.responses[responseCursor].clientKey}:status`}
                                    aria-invalid={Boolean(itemErrors.get(`response:${view.responses[responseCursor].clientKey}:status`))}
                                    placeholder="200"
                                    value={view.responses[responseCursor].status}
                                    onChange={(event) => updateResponse(responseCursor, { ...draft!.responses[responseCursor], status: event.target.value })}
                                  />
                                </Field>
                                <Field label="응답 이름" required error={itemErrors.get(`response:${view.responses[responseCursor].clientKey}:name`)}>
                                  <input
                                    data-issue={`response:${view.responses[responseCursor].clientKey}:name`}
                                    aria-invalid={Boolean(itemErrors.get(`response:${view.responses[responseCursor].clientKey}:name`))}
                                    placeholder="예: 성공"
                                    value={view.responses[responseCursor].name}
                                    onChange={(event) => updateResponse(responseCursor, { ...draft!.responses[responseCursor], name: event.target.value })}
                                  />
                                </Field>
                                <Field label="설명" error={itemErrors.get(`response:${view.responses[responseCursor].clientKey}:description`)}>
                                  <input
                                    data-issue={`response:${view.responses[responseCursor].clientKey}:description`}
                                    aria-invalid={Boolean(itemErrors.get(`response:${view.responses[responseCursor].clientKey}:description`))}
                                    placeholder="예: 로그인에 성공하면 토큰을 돌려줍니다."
                                    value={view.responses[responseCursor].description}
                                    onChange={(event) => updateResponse(responseCursor, { ...draft!.responses[responseCursor], description: event.target.value })}
                                  />
                                </Field>
                              </div>
                            ) : (
                              <p className="rest-read-line">
                                <strong>{view.responses[responseCursor].status} {view.responses[responseCursor].name}</strong>
                                {view.responses[responseCursor].description ? ` · ${view.responses[responseCursor].description}` : ""}
                              </p>
                            )}
                            <SchemaTable
                              key={view.responses[responseCursor].clientKey}
                              fields={view.responses[responseCursor].fields}
                              readOnly={!writer}
                              issues={itemErrors}
                              emptyText={writer ? "응답 Body 필드가 없습니다. 본문이 없는 응답(예: 204)이면 비워 둡니다." : "응답 Body가 없습니다."}
                              onChange={writer ? (fields) => updateResponse(responseCursor, { ...draft!.responses[responseCursor], fields }) : undefined}
                            />
                            {writer && view.responses.length > 1 ? (
                              <button type="button" className="btn danger quiet rest-remove-response" onClick={() => { updateDraft({ ...draft!, responses: draft!.responses.filter((_, index) => index !== responseCursor) }); setResponseIndex(0); }}>
                                응답 {view.responses[responseCursor].status} 삭제
                              </button>
                            ) : null}
                          </>
                        ) : <p className="schema-empty">등록된 응답이 없습니다.</p>}
                      </div>
                    ) : null}

                    {tab === "header" ? (
                      <div className="rest-params">
                        {writer ? (
                          <div className="rest-grid auth">
                            <Field label="인증 방식">
                              <select value={view.authType} onChange={(event) => updateDraft({ ...draft!, authType: event.target.value })}>
                                {authTypes.map((type) => <option key={type}>{type}</option>)}
                              </select>
                            </Field>
                            <Field label="인증 설명" error={itemErrors.get("item:authDescription")}>
                              <input data-issue="item:authDescription" aria-invalid={Boolean(itemErrors.get("item:authDescription"))} placeholder="예: 로그인 후 받은 accessToken" value={view.authDescription} onChange={(event) => updateDraft({ ...draft!, authDescription: event.target.value })} />
                            </Field>
                            <label className="check rest-check">
                              <input type="checkbox" checked={view.useDocumentAuth} onChange={(event) => updateDraft({ ...draft!, useDocumentAuth: event.target.checked })} />
                              문서 공통 인증 사용
                            </label>
                          </div>
                        ) : (
                          <p className="rest-read-line">
                            <strong>인증 {view.authType}</strong>
                            {view.authDescription ? ` · ${view.authDescription}` : ""}
                            {view.useDocumentAuth ? " · 문서 공통 인증 사용" : ""}
                          </p>
                        )}
                        <h3 className="rest-sub">요청 헤더</h3>
                        <SchemaTable
                          fields={view.headers}
                          readOnly={!writer}
                          issues={itemErrors}
                          addLabel="헤더 추가"
                          emptyText="이 Endpoint 전용 헤더가 없습니다. 공통 헤더는 문서 설정에서 관리합니다."
                          namePlaceholder="예: X-Request-Id"
                          onChange={writer ? (headers) => updateDraft({ ...draft!, headers }) : undefined}
                        />
                      </div>
                    ) : null}

                    {tab === "path" ? (
                      <SchemaTable
                        fields={view.pathParams}
                        readOnly={!writer}
                        issues={itemErrors}
                        addLabel="Path 변수 추가"
                        emptyText="Path 변수가 없습니다. URL 경로에 {userId}처럼 변수가 있으면 여기에 정의합니다."
                        namePlaceholder="예: userId"
                        onChange={writer ? (pathParams) => updateDraft({ ...draft!, pathParams }) : undefined}
                      />
                    ) : null}

                    {tab === "query" ? (
                      <SchemaTable
                        fields={view.queryParams}
                        readOnly={!writer}
                        issues={itemErrors}
                        addLabel="Query 파라미터 추가"
                        emptyText="Query 파라미터가 없습니다."
                        namePlaceholder="예: page"
                        onChange={writer ? (queryParams) => updateDraft({ ...draft!, queryParams }) : undefined}
                      />
                    ) : null}

                    {tab === "errors" && writer && auth.token && draft ? (
                      <ErrorCodePicker projectId={projectId} token={auth.token} selected={draft.errorCodeIds ?? []} onChange={(errorCodeIds) => updateDraft({ ...draft, errorCodeIds })} />
                    ) : null}
                    {tab === "errors" && !writer ? (
                      <div className="rest-linked">
                        {(selected?.errorCodes ?? []).length === 0 ? <p className="schema-empty">연결된 오류 코드가 없습니다.</p> : (selected?.errorCodes ?? []).map((code) => (
                          <p key={code.id}><code>{code.code}</code> {code.category} · {code.description}</p>
                        ))}
                      </div>
                    ) : null}

                    {writer && activeExample && activeExample.exampleMode === "MANUAL" && !jsonOpen && (tab === "request" || tab === "response") ? (
                      <label className="manual-box">직접 입력한 예시 JSON
                        <textarea
                          data-issue={tab === "response" ? `manual:${view.responses[responseCursor]?.clientKey}` : "manual:request"}
                          value={activeExample.manualText}
                          onChange={(event) => applyExample({ ...activeExample, manualText: event.target.value })}
                        />
                      </label>
                    ) : null}
                  </section>
                </div>

                {jsonOpen ? (
                  <aside className="json-panel">
                    <header>
                      <h2>{jsonTitle}</h2>
                      <div className="seg">
                        {writer && activeExample && (tab === "request" || tab === "response") ? (
                          <>
                            <button type="button" aria-pressed={activeExample.exampleMode === "AUTO"} onClick={() => setMode(activeExample, "AUTO", applyExample)}>자동</button>
                            <button type="button" aria-pressed={activeExample.exampleMode === "MANUAL"} onClick={() => setMode(activeExample, "MANUAL", applyExample)}>직접</button>
                          </>
                        ) : null}
                        <button type="button" className="copy" onClick={() => { void navigator.clipboard.writeText(preview?.text || "{}"); say("JSON을 복사했습니다.", "info"); }}>복사</button>
                      </div>
                    </header>
                    {preview?.problem ? <p>{preview.problem}</p> : null}
                    {writer && activeExample?.exampleMode === "MANUAL" ? (
                      <textarea
                        aria-label="직접 입력 JSON"
                        data-issue={tab === "response" ? `manual:${view.responses[responseCursor]?.clientKey}` : "manual:request"}
                        value={activeExample.manualText}
                        onChange={(event) => applyExample({ ...activeExample, manualText: event.target.value })}
                      />
                    ) : (
                      <JsonBlock text={preview?.text || "{}"} />
                    )}
                  </aside>
                ) : null}
              </div>

              {confirmDelete ? (
                <div className="modal-backdrop">
                  <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                    <h2>Endpoint 삭제</h2>
                    <p>이 Endpoint만 삭제합니다. 문서와 다른 Endpoint는 남습니다.</p>
                    <label>변경 사유<input value={deleteReason} placeholder="예: 사용하지 않는 API 정리" onChange={(event) => setDeleteReason(event.target.value)} /></label>
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
          ) : <p className="state-panel">Endpoint를 불러오는 중입니다.</p>}
        </section>
      </div>
    );
  }

  return (
    <main className="studio rest-studio">
      <div className="studio-main">
        {header}
        {!spec && notice ? noticeBanner : null}
        {body}
      </div>
    </main>
  );
}

function AddressLine({ address, hasBase, onSettings }: { address: string | null; hasBase: boolean; onSettings: () => void }) {
  return (
    <p className="rest-address">
      <span>전체 주소</span>
      {address ? <code>{address}</code> : (
        <em>
          {hasBase ? "URL 경로를 입력하면 표시됩니다." : "문서 설정에 Base URL이 없어 전체 주소를 표시하지 않습니다."}
          {!hasBase ? <button type="button" className="link-button" onClick={onSettings}>문서 설정 열기</button> : null}
        </em>
      )}
    </p>
  );
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={error ? "rest-field has-error" : "rest-field"}>
      <span className="rest-label">{label}{required ? <b className="req-mark" aria-label="필수">*</b> : null}</span>
      {children}
      {error ? <span className="field-error">오류: {error}</span> : hint ? <span className="rest-hint">{hint}</span> : null}
    </label>
  );
}

function IssueSummary({ issues, onPick }: { issues: Issue[]; onPick: (issue: Issue) => void }) {
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
      {issues.length > shown.length ? <p>외 {issues.length - shown.length}건은 각 탭의 '오류' 표시를 확인하세요.</p> : null}
    </div>
  );
}

function saveTone(notice: Notice, dirty: boolean, saving: boolean, conflict: boolean, invalid: boolean) {
  if (conflict) return "conflict";
  if (saving) return "saving";
  if (invalid || notice?.tone === "danger") return "error";
  if (dirty) return "dirty";
  if (notice?.tone === "success") return "saved";
  return "clean";
}

function saveLabel(tone: string, version: number, conflictVersion: number | undefined, issueCount: number) {
  if (tone === "conflict") return `버전 충돌 · 서버 v${conflictVersion ?? ""}`;
  if (tone === "saving") return "저장 중";
  if (tone === "error") return issueCount > 0 ? `오류 ${issueCount}건 · 저장 안 됨` : "저장 실패 · 입력 유지";
  if (tone === "dirty") return "저장되지 않은 변경";
  return `변경 없음 · v${version}`;
}

function noticeTone(tone: Tone) {
  return tone === "info" ? "" : tone;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function overviewSignature(overview: OverviewDraft) {
  return {
    title: overview.title.trim(),
    baseUrl: overview.baseUrl.trim(),
    authType: overview.authType,
    authDescription: overview.authDescription.trim(),
    headers: overview.headers.map((field) => fieldToApi(field)),
  };
}
