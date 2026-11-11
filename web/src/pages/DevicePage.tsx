import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { ByteFieldTable, ByteFieldView } from "../spec/ByteFieldTable";
import {
  blankDevice,
  commandIdExamples,
  deviceDirections,
  deviceFromApi,
  deviceTerms,
  deviceToPayload,
  directionText,
  exampleDraftOf,
  fillOffsets,
  hexByteCount,
  layoutSummary,
  overviewFromDevice,
  transports,
  type DeviceDraft,
  type DeviceOverviewDraft,
} from "../spec/deviceModel";
import { hexProblem, sameCommandIds, validateCommand, validateDeviceOverview, type DeviceIssue } from "../spec/deviceValidation";
import { ErrorCodePicker } from "../spec/ErrorCodePicker";
import { JsonBlock } from "../spec/jsonView";
import { issueMap, reasonProblem } from "../spec/restValidation";
import { itemChanged, itemSaveBody, noChangeMessage, sameValue, type ItemSaveBody } from "../spec/saveCompare";
import { SortableList } from "../spec/SortableList";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import { draftKey, previewText, type SpecDocument, type SpecItem } from "../spec/specModel";
import { Field, IssueSummary, formatDate } from "../spec/workspaceUi";
import { useToast } from "../toast";

type ConflictView = { currentVersion: number; latest: SpecItem | null; notes: string[] };
type Tone = "success" | "warning" | "danger" | "info";
type Notice = { text: string; tone: Tone } | null;
type DocView = "settings" | "history" | "markdown";
type Route = { item?: string | null; mode?: "edit" | null; view?: DocView | null };

const docViewLabel: Record<DocView, string> = { settings: "문서 설정", history: "변경 이력", markdown: "Markdown" };
const transportLabel: Record<string, string> = { TCP: "TCP", UDP: "UDP", UART: "UART (시리얼)", RS485: "RS-485", OTHER: "기타" };

export function DevicePage() {
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
  const [draft, setDraft] = useState<DeviceDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [baseline, setBaseline] = useState<ItemSaveBody | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<DeviceOverviewDraft | null>(null);
  const [overviewLock, setOverviewLock] = useState<number | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const [settingsAttempted, setSettingsAttempted] = useState(false);
  const [settingsReasonError, setSettingsReasonError] = useState("");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string[] | null>(null);
  const overviewTouched = useRef(false);
  const prefill = useRef<Partial<DeviceDraft> | null>(null);
  const toast = useToast();

  const viewParam = searchParams.get("view");
  const docView: DocView | null = viewParam === "settings" || viewParam === "history" || viewParam === "markdown" ? viewParam : null;
  const itemParam = searchParams.get("item");
  const modeParam = searchParams.get("mode") === "edit" ? "edit" : null;
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const editTarget = canEdit && itemParam && (itemParam === "new" || modeParam === "edit") ? itemParam : null;
  const selected = spec?.items.find((item) => item.itemUid === itemParam) ?? null;
  const selectedView = useMemo(() => (selected ? deviceFromApi(selected) : null), [selected]);
  const overviewDirty = Boolean(spec && overview && !sameValue(overviewSignature(overview), overviewSignature(overviewFromDevice(spec))));
  const currentBody = useMemo(() => itemSaveBody(draft, deviceToPayload), [draft]);
  const dirty = Boolean(draft && draftFor) && itemChanged(draftFor === "new", baseline, currentBody);

  usePageChrome(project?.title ?? "장비 프로토콜", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "장비 프로토콜" },
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
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/DEVICE_PROTOCOL`, { token });
      setSpec(document);
      setMissing(false);
      setOverview((current) => (current && overviewTouched.current ? current : overviewFromDevice(document)));
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
    let next = found ? deviceFromApi(found) : { ...blankDevice(), ...(prefill.current ?? {}) };
    prefill.current = null;
    let wasRestored = false;
    const saved = sessionStorage.getItem(draftKey(spec.id, editTarget, spec.version));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { draft?: DeviceDraft };
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
    setBaseline(found ? itemSaveBody(deviceFromApi(found), deviceToPayload) : null);
    setRestored(wasRestored);
    setBaseVersion(spec.version);
    setConflict(null);
    setAttempted(false);
    setReasonError("");
    setSaveOpen(false);
    if (editTarget === "new" && !wasRestored) setFocusTarget(next.commandId ? "device:name" : "device:commandId");
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
  if (denied) return <main className="spec-screen"><h1>장비 프로토콜</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
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

  function guardCommand() {
    return !dirty || window.confirm("저장하지 않은 명령 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 임시로 남습니다.");
  }

  function guardLeave() {
    if (!dirty && !overviewDirty) return true;
    const parts = [dirty ? "명령" : "", overviewDirty ? "문서 설정" : ""].filter(Boolean).join("과 ");
    return window.confirm(`저장하지 않은 ${parts} 변경이 있습니다. 이 화면을 떠나면 공식 규격에 반영되지 않습니다.${dirty ? " 명령 초안만 이 브라우저에 임시로 남습니다." : ""}`);
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
    if (draftFor && !guardCommand()) return;
    go({});
  }

  function openCommand(uid: string) {
    if (uid === draftFor) {
      go({ item: uid, mode: uid === "new" ? null : "edit" });
      return;
    }
    if (draftFor && !guardCommand()) return;
    go({ item: uid });
  }

  function beginCommand() {
    if (!spec || !canEdit) return;
    if (draftFor && draftFor !== "new" && !guardCommand()) return;
    go({ item: "new" });
  }

  function beginResponse(request: SpecItem) {
    if (!spec || !canEdit) return;
    if (draftFor && !guardCommand()) return;
    sessionStorage.removeItem(draftKey(spec.id, "new", spec.version));
    dropDraft();
    prefill.current = {
      commandId: request.payload.commandId ?? "",
      direction: "RESPONSE",
      name: `${request.name} 응답`,
      relatedItemUid: request.itemUid,
    };
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

  function updateDraft(next: DeviceDraft) {
    setDraft(next);
  }

  function editOverview(next: DeviceOverviewDraft) {
    overviewTouched.current = true;
    setOverview(next);
  }

  function goToIssue(issue: DeviceIssue) {
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
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "DEVICE_PROTOCOL", title: "장비 프로토콜" } });
      await loadSpec(auth.token);
      notifySpecChanged();
      say("장비 프로토콜 문서를 만들었습니다.", "success");
    } catch (error) {
      say(authErrorMessage(error), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) return;
    const found = validateDeviceOverview(overview);
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
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/DEVICE_PROTOCOL`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: sentVersion,
          changeReason: overview.changeReason.trim(),
          title: overview.title.trim(),
          overview: { transport: overview.transport, defaultEndian: overview.defaultEndian, framing: overview.framing.trim() },
        },
      });
      setOverviewLock(null);
      overviewTouched.current = false;
      setSettingsAttempted(false);
      const document = await loadSpec(auth.token);
      if (document) {
        setOverview(overviewFromDevice(document));
        if (draftFor) setBaseVersion(document.version);
      }
      notifySpecChanged();
      if (result.version === sentVersion) {
        say(noChangeMessage, "info");
        return;
      }
      say(dirty
        ? `문서 설정을 저장했습니다 · 문서 버전 v${result.version}. 편집 중인 명령 초안은 그대로 유지됩니다.`
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
    const found = validateCommand(draft, draftFor);
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
      updateDraft({ ...draft, changeReason: `명령 추가: ${draft.commandId.trim()} ${draft.name.trim()}`.trim() });
    }
    setSaveOpen(true);
    setFocusTarget("device:changeReason");
  }

  async function saveItem(version = baseVersion, create = draftFor === "new") {
    if (!auth.token || !spec || !draft || !draftFor || saving || (!dirty && !conflict)) return;
    const found = validateCommand(draft, draftFor);
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
      setFocusTarget("device:changeReason");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const body = {
        version,
        changeReason: draft.changeReason.trim(),
        name: draft.name.trim(),
        summary: draft.summary.trim(),
        status: draft.status,
        payload: deviceToPayload(draft),
        errorCodeIds: draft.errorCodeIds ?? [],
      };
      const path = create ? `/api/projects/${projectId}/specs/DEVICE_PROTOCOL/items` : `/api/projects/${projectId}/specs/DEVICE_PROTOCOL/items/${draftFor}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, { method: create ? "POST" : "PUT", token: auth.token, body });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      const uid = result.itemUid ?? draftFor;
      await loadSpec(auth.token);
      notifySpecChanged();
      dropDraft();
      go({ item: uid }, { keepNotice: true });
      say(!create && result.version === version ? noChangeMessage : `명령을 저장했습니다 · 문서 버전 v${result.version}`, !create && result.version === version ? "info" : "success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setSaveOpen(false);
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && draftFor !== "new") {
        say("이 명령은 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.", "warning");
        const latest = await loadSpec(auth.token);
        if (latest) setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 명령이 삭제되었습니다."] });
      } else if (error instanceof ApiError && error.code === "EXAMPLE_SCHEMA_MISMATCH") {
        say("해석 JSON이 바이너리 필드 구조와 맞지 않아 저장하지 않았습니다. 입력은 그대로 남아 있습니다.", "danger");
      } else {
        say(`저장하지 못했습니다. ${error instanceof Error ? error.message : authErrorMessage(error)} 입력은 그대로 남아 있습니다.`, "danger");
      }
    } finally {
      setSaving(false);
    }
  }

  async function showConflict(currentVersion?: number) {
    if (!auth.token || !spec) return;
    const latest = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/DEVICE_PROTOCOL`, { token: auth.token });
    const previous = spec.items.map((item) => `${item.itemUid}:${item.name}`);
    const notes = latest.items.filter((item) => item.itemUid !== draftFor && !previous.includes(`${item.itemUid}:${item.name}`)).map((item) => item.payload.commandId || item.name);
    const removed = spec.items.filter((item) => item.itemUid !== draftFor && !latest.items.some((next) => next.itemUid === item.itemUid)).map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setOverview((current) => (current && overviewTouched.current ? current : overviewFromDevice(latest)));
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === draftFor) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    say("다른 사용자가 먼저 저장했습니다. 이 명령의 입력은 남아 있습니다. 다른 명령은 이 저장에 포함되지 않습니다.", "warning");
  }

  async function saveWithLatest() {
    if (!conflict) return;
    if (conflict.latest && !window.confirm("다시 저장하면 이 명령만 내 내용으로 바뀝니다.")) return;
    await saveItem(conflict.currentVersion, !conflict.latest);
  }

  async function removeItem() {
    if (!auth.token || !spec || !draftFor || draftFor === "new" || !deleteReason.trim()) {
      say("삭제 사유를 입력하세요.", "danger");
      return;
    }
    if (spec.items.some((item) => item.itemUid !== draftFor && item.payload.relatedItemUid === draftFor)) {
      say("다른 명령이 이 명령을 대응 명령으로 가리키고 있습니다. 연결을 해제한 뒤 삭제하세요.", "danger");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/DEVICE_PROTOCOL/items/${draftFor}`, {
        method: "DELETE", token: auth.token, body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      setConfirmDelete(false);
      setDeleteReason("");
      dropDraft();
      await loadSpec(auth.token);
      notifySpecChanged();
      go({}, { keepNotice: true });
      say(`명령을 삭제했습니다 · 문서 버전 v${result.version}`, "success");
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
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/DEVICE_PROTOCOL/items/order`, {
        method: "PUT", token: auth.token, body: { version: spec.version, changeReason: "명령 순서 변경", itemUids: ordering },
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
  const defaultEndian = spec?.overview.defaultEndian || "BIG";
  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) => `${item.payload.commandId ?? ""} ${item.name} ${item.summary}`.toLowerCase().includes(needle));
  const orderedItems = ordering ? ordering.map((uid) => items.find((item) => item.itemUid === uid)).filter((item): item is SpecItem => Boolean(item)) : [];
  const orderChanged = Boolean(ordering) && !sameValue(ordering, items.map((item) => item.itemUid));
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const view: DeviceDraft | null = writer ? draft : selectedView;
  const isNew = itemParam === "new";
  const json = view ? previewText(exampleDraftOf(view)) : null;
  const summary = view ? layoutSummary(view.fields) : null;
  const hexBytes = view ? hexByteCount(view.exampleHex) : 0;
  const itemIssues = draft && attempted ? validateCommand(draft, draftFor) : [];
  const itemErrors = issueMap(itemIssues);
  const settingsIssues = overview && settingsAttempted ? validateDeviceOverview(overview) : [];
  const settingsErrors = issueMap(settingsIssues);
  const tone = saveTone(notice, dirty, saving, Boolean(conflict), itemIssues.length > 0);
  const pendingCommand = dirty && draft ? (draft.commandId.trim() || "새 명령") : "";
  const crumbTail = docView ? docViewLabel[docView] : isNew ? "새 명령" : selected ? `${selected.payload.commandId ?? ""} ${selected.name}`.trim() : null;
  const selfUid = writer ? draftFor : itemParam;
  const related = view?.relatedItemUid ? items.find((item) => item.itemUid === view.relatedItemUid) ?? null : null;
  const linkedFrom = selfUid && selfUid !== "new" ? items.filter((item) => item.itemUid !== selfUid && item.payload.relatedItemUid === selfUid) : [];
  const siblings = view ? sameCommandIds(items, view.commandId, selfUid) : [];
  const sameDirection = siblings.filter((item) => item.payload.direction === view?.direction);
  const direction = deviceDirections.find((option) => option.value === view?.direction);
  const hexIssue = writer && draft ? hexProblem(draft.exampleHex) : null;

  function applyCommandExample(value: string) {
    if (!draft) return;
    const current = draft.commandId.trim();
    if (current && current !== value && !window.confirm(`현재 Command ID '${current}'를 '${value}'(으)로 바꿀까요?`)) return;
    updateDraft({ ...draft, commandId: value });
  }

  function autoOffsets() {
    if (!draft) return;
    const result = fillOffsets(draft.fields);
    if (result.filled === 0) {
      toast.info("채울 수 있는 Offset이 없습니다. 맨 위 필드부터 길이(Byte)를 입력하면 순서대로 계산합니다.");
      return;
    }
    updateDraft({ ...draft, fields: result.fields });
    toast.success(`비어 있던 Offset ${result.filled}개를 앞 필드 길이의 합으로 채웠습니다. 기존 값은 바꾸지 않았습니다.`);
  }

  function setJsonMode(exampleMode: "AUTO" | "MANUAL") {
    if (!draft) return;
    if (exampleMode === "MANUAL" && !draft.manualText) {
      updateDraft({ ...draft, exampleMode, manualText: previewText({ ...exampleDraftOf(draft), exampleMode: "AUTO" }).text || "{}" });
      return;
    }
    updateDraft({ ...draft, exampleMode });
  }

  function commandLabel(item: SpecItem) {
    return `${item.payload.commandId || "ID 없음"} ${item.name} · ${directionText(item.payload.direction ?? "")}`;
  }

  const noticeBanner = notice ? <p className={`banner rest-banner ${notice.tone === "info" ? "" : notice.tone}`}>{notice.text}</p> : null;

  const summaryLine = summary && view && view.fields.length > 0 ? (
    <p className="device-sum">
      {summary.fixedSum > 0 ? <span>고정 길이 합계 <strong>{summary.fixedSum} Bytes</strong></span> : <span>길이가 입력된 고정 필드가 없습니다</span>}
      {summary.variable.length ? <span>+ 가변 {summary.variable.length}개 ({summary.variable.join(", ")})</span> : null}
      {summary.unknown ? <span>길이 미입력 {summary.unknown}개는 합계에서 제외</span> : null}
    </p>
  ) : null;

  const hexLine = view && view.exampleHex.trim() ? (
    <p className="device-sum">
      <span>HEX {hexBytes} Bytes</span>
      {summary && summary.complete && summary.fixedSum > 0
        ? <span className={hexBytes === summary.fixedSum ? "is-ok" : "is-warn"}>{hexBytes === summary.fixedSum ? "고정 길이 합계와 일치" : `고정 길이 합계(${summary.fixedSum} Bytes)와 다릅니다 · 저장은 가능합니다`}</span>
        : summary && summary.fixedSum > 0 ? <span>가변·미입력 필드가 있어 길이를 비교하지 않습니다</span> : null}
    </p>
  ) : null;

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guardLeave()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {crumbTail ? <button type="button" className="crumb-link" onClick={toList}>장비 프로토콜</button> : <strong>장비 프로토콜</strong>}
        {crumbTail ? <><span aria-hidden="true">/</span><strong className="crumb-current">{crumbTail}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>장비 프로토콜 규격</h1>
          {spec ? (
            <p className="rest-doc-meta">
              {spec.title.trim() && spec.title.trim() !== "장비 프로토콜" ? <span>{spec.title}</span> : null}
              <span>문서 v{spec.version}</span>
              <span>명령 {items.length}개</span>
              <span>{transportLabel[spec.overview.transport ?? ""] ?? spec.overview.transport} · 기본 {defaultEndian} Endian</span>
              <span>최종 수정 {formatDate(spec.updatedAt)}{spec.updatedBy?.name ? ` · ${spec.updatedBy.name}` : ""}</span>
            </p>
          ) : null}
        </div>
        {spec ? (
          <div className="rest-doc-actions" role="group" aria-label="문서 작업">
            {(["settings", "history", "markdown"] as DocView[]).map((key) => (
              <button key={key} type="button" className={docView === key ? "btn is-current" : "btn"} aria-current={docView === key ? "page" : undefined} onClick={() => (docView === key ? closeDocView() : openDocView(key))}>
                {docViewLabel[key]}{key === "settings" && overviewDirty ? " · 저장 안 됨" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );

  const draftBanner = docView && pendingCommand ? (
    <p className="banner rest-banner">
      편집 중인 명령 <code>{pendingCommand}</code>은 저장되지 않은 상태로 그대로 유지됩니다.
      <button type="button" className="link-button" onClick={closeDocView}>명령 편집으로 돌아가기</button>
    </p>
  ) : null;

  function commandRow(item: SpecItem, compact: boolean) {
    const current = item.itemUid === itemParam && !docView;
    const dir = item.payload.direction ?? "";
    return (
      <li key={item.itemUid}>
        <button type="button" className={current ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} aria-current={current ? "true" : undefined} onClick={() => openCommand(item.itemUid)}>
          <span className="device-id">{item.payload.commandId || "ID"}</span>
          <span className="ep-main">
            <code className="device-name">{item.name}</code>
            {!compact && item.summary ? <span className="ep-name">{item.summary}</span> : null}
          </span>
          <span className={`device-dir dir-${dir.toLowerCase()}`}>{directionText(dir)}</span>
          {item.status === "DEPRECATED" ? <span className="ep-tag">사용 중단</span> : null}
          {item.itemUid === draftFor && dirty ? <span className="ep-tag is-draft">수정 중</span> : null}
        </button>
      </li>
    );
  }

  const newRow = draftFor === "new" && draft ? (
    <li key="new">
      <button type="button" className={isNew && !docView ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} onClick={() => openCommand("new")}>
        <span className="device-id">{draft.commandId.trim() || "ID"}</span>
        <span className="ep-main"><code className="device-name">{draft.name.trim() || "새 명령"}</code></span>
        <span className="ep-tag is-draft">작성 중</span>
      </button>
    </li>
  ) : null;

  let body: ReactNode = null;

  if (missing) {
    body = (
      <section className="rest-panel">
        <div className="rest-empty-state">
          <h2>아직 장비 프로토콜 문서가 없습니다.</h2>
          <p>이 프로젝트의 장비 프로토콜 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 명령을 추가합니다.</p>
          {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>장비 프로토콜 작성 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
        </div>
      </section>
    );
  } else if (spec && docView === "history" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>장비 프로토콜 문서 변경 이력</h2>
          <p>이 장비 프로토콜 문서의 버전별 변경 내역과 두 버전 비교입니다. 프로젝트 전체 활동은 좌측 메뉴의 '최근 변경'에서 봅니다.</p>
        </div>
        <SpecHistory projectId={projectId} token={auth.token} kind="DEVICE_PROTOCOL" heading={null} />
      </section>
    );
  } else if (spec && docView === "markdown" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>장비 프로토콜 문서</h2>
          <p>저장된 장비 프로토콜 문서를 읽기 좋은 형태로 보여 줍니다. 복사와 다운로드는 Markdown 원본을 사용합니다.</p>
        </div>
        <SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} kind="DEVICE_PROTOCOL" rendered />
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
          <p>장비 프로토콜 문서 전체에 적용되는 전송 방식, 기본 Endian, 공통 패킷 구조 설명입니다. 명령 저장과 별도로 저장됩니다.</p>
          <span className={`save-state is-${overviewDirty ? "dirty" : "clean"}`}>{overviewDirty ? "저장되지 않은 변경" : `저장됨 · v${spec.version}`}</span>
        </div>
        <div className="rest-card">
          <div className="rest-grid device-settings-grid">
            <Field label="문서 제목" required error={settingsErrors.get("doc:title")}>
              <input data-issue="doc:title" aria-invalid={Boolean(settingsErrors.get("doc:title"))} value={overview.title} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, title: event.target.value })} />
            </Field>
            <Field label="전송 방식" error={settingsErrors.get("doc:transport")}>
              <select data-issue="doc:transport" value={overview.transport} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, transport: event.target.value })}>
                {transports.map((item) => <option key={item} value={item}>{transportLabel[item] ?? item}</option>)}
              </select>
            </Field>
            <Field label="기본 Endian" hint="필드에 Endian을 따로 정하지 않으면 이 값을 따릅니다." error={settingsErrors.get("doc:defaultEndian")}>
              <select data-issue="doc:defaultEndian" value={overview.defaultEndian} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, defaultEndian: event.target.value })}>
                <option value="BIG">BIG (높은 자리 바이트 먼저)</option>
                <option value="LITTLE">LITTLE (낮은 자리 바이트 먼저)</option>
              </select>
            </Field>
          </div>
          <Field label="공통 패킷 구조 설명 (프레이밍)" hint="문장으로 적는 설명입니다. 개별 명령의 필드에 자동으로 적용되지 않으니, 명령마다 필요한 필드는 따로 적어 주세요." error={settingsErrors.get("doc:framing")}>
            <textarea
              data-issue="doc:framing"
              aria-invalid={Boolean(settingsErrors.get("doc:framing"))}
              rows={5}
              disabled={!canEdit}
              placeholder={"예: Start(1) + Command(1) + ErrorCode(2) + Param1(2) + Param2(2) + Param3(4) + ExtraDataLength(2) + Header Checksum(1) + ExtraData Checksum(1) + ExtraData(n).\n기본 길이 16 Bytes + n, 2바이트 이상 숫자는 Little Endian."}
              value={overview.framing}
              onChange={(event) => editOverview({ ...overview, framing: event.target.value })}
            />
          </Field>
        </div>
        {canEdit ? (
          <div className="rest-card rest-save">
            <Field label="변경 사유" required hint="변경 이력(Revision)에 함께 기록되어, 나중에 누가 왜 바꿨는지 확인할 수 있습니다." error={settingsReasonError}>
              <input data-issue="doc:changeReason" aria-invalid={Boolean(settingsReasonError)} placeholder="예: 공통 패킷 구조 설명 추가" value={overview.changeReason} onChange={(event) => { setSettingsReasonError(""); editOverview({ ...overview, changeReason: event.target.value }); }} />
            </Field>
            <div className="rest-save-actions">
              <button type="button" className="btn" disabled={saving || !overviewDirty} onClick={() => { overviewTouched.current = false; setOverview(overviewFromDevice(spec)); setSettingsAttempted(false); setSettingsReasonError(""); }}>변경 취소</button>
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
            <h2>아직 등록된 명령이 없습니다.</h2>
            <p>장비와 주고받는 명령의 Command ID와 이름을 등록하고, 필요한 경우 요청·응답 바이트 구조를 추가해 보세요.</p>
            {canEdit ? <button type="button" className="btn primary" onClick={beginCommand}>+ 첫 명령 추가</button> : <p>조회 권한으로는 명령을 추가할 수 없습니다.</p>}
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
                  <input className="ep-search" type="search" aria-label="명령 검색" placeholder="Command ID 또는 명령 이름으로 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
                  <div className="ep-toolbar-actions">
                    {canEdit && items.length > 1 ? <button type="button" className="btn" onClick={() => { setQuery(""); setNotice(null); setOrdering(items.map((item) => item.itemUid)); }}>순서 변경</button> : null}
                    {canEdit ? <button type="button" className="btn primary" onClick={beginCommand}>+ 명령 추가</button> : null}
                  </div>
                </>
              )}
            </div>
            {list.length === 0 ? <p className="ep-empty">'{query.trim()}'와 일치하는 명령이 없습니다.</p> : null}
            {ordering ? (
              <SortableList items={list} itemKey={(item) => item.itemUid} itemLabel={(item) => `${item.payload.commandId ?? ""} ${item.name}`} disabled={saving} onMove={moveOrder}>
                {(item) => (
                  <>
                    <span className="device-id">{item.payload.commandId || "ID"}</span>
                    <span className="ep-main"><code className="device-name">{item.name}</code><span className="ep-name">{directionText(item.payload.direction ?? "")}</span></span>
                  </>
                )}
              </SortableList>
            ) : (
              <ul className="ep-list">
                {newRow}
                {list.map((item) => commandRow(item, false))}
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
        <aside className="ep-pane" aria-label="명령 목록">
          <input className="ep-search" type="search" aria-label="명령 검색" placeholder="명령 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginCommand}>+ 명령 추가</button> : null}
          <ul className="ep-list is-compact">
            {newRow}
            {visible.map((item) => commandRow(item, true))}
          </ul>
          {items.length > 0 && visible.length === 0 ? <p className="ep-empty">일치하는 명령이 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">
          {notFound || readOnlyNew ? (
            <div className="rest-empty-state">
              <h2>{readOnlyNew ? "조회 권한으로는 명령을 추가할 수 없습니다." : "명령을 찾을 수 없습니다."}</h2>
              <p>{readOnlyNew ? "목록에서 명령을 선택해 조회하세요." : "삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요."}</p>
              <button type="button" className="btn" onClick={() => go({})}>명령 목록으로</button>
            </div>
          ) : view ? (
            <form className="rest-editor" onSubmit={(event) => event.preventDefault()}>
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">{isNew ? "새 명령 작성" : writer ? "명령 편집" : "명령 조회"}</p>
                  <h2>
                    <code>{view.commandId.trim() || "Command ID 미입력"}</code>
                    <span className="device-title-name">{view.name.trim() || (isNew ? "새 명령" : "")}</span>
                    {!writer && view.commandId.trim() ? <button type="button" className="copy-chip" aria-label="Command ID 복사" onClick={() => void copyText(view.commandId.trim(), "Command ID")}>복사</button> : null}
                  </h2>
                  {!writer ? (
                    <p className="mqtt-bar-meta">
                      <span>{directionText(view.direction)}</span>
                      <span>필드 {view.fields.length}개</span>
                      {summary && summary.fixedSum > 0 ? <span>고정 {summary.fixedSum} Bytes{summary.variable.length ? " + 가변" : ""}</span> : null}
                      <span>{view.status === "DEPRECATED" ? "사용 중단" : "사용 중"}</span>
                      <span>문서 v{spec.version}</span>
                    </p>
                  ) : null}
                </div>
                <div className="toolbar">
                  {writer ? <span className={`save-state is-${tone}`}>{saveLabel(tone, spec.version, conflict?.currentVersion, itemIssues.length)}</span> : null}
                  {writer ? <button type="button" className="btn" aria-pressed={previewOpen} onClick={() => setPreviewOpen((open) => !open)}>{previewOpen ? "패킷 미리보기 닫기" : "패킷 미리보기"}</button> : null}
                  {!writer && canEdit && selected && selected.payload.direction === "REQUEST" ? <button type="button" className="btn" onClick={() => beginResponse(selected)}>+ 응답 명령 추가</button> : null}
                  {!writer && canEdit && selected ? <button type="button" className="btn primary" onClick={beginEdit}>편집</button> : null}
                  {writer && !isNew ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                  {writer ? <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button> : null}
                  {writer ? <button type="button" className="btn primary" disabled={saving || Boolean(conflict) || !dirty} title={dirty ? undefined : noChangeMessage} onClick={startSave}>{saving ? "저장 중" : "명령 저장"}</button> : null}
                  {writer && saveOpen && draft ? (
                    <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                      <Field label="변경 사유" required hint="변경 이력(Revision)에 기록되어, 누가 왜 바꿨는지 나중에 확인할 수 있습니다." error={reasonError}>
                        <input
                          data-issue="device:changeReason"
                          aria-invalid={Boolean(reasonError)}
                          placeholder="예: 문열기 응답에 결과 코드 필드 추가"
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
              {!canEdit && project.status === "ACTIVE" ? <p className="banner rest-banner">조회 권한입니다. 명령을 수정할 수 없습니다.</p> : null}
              {project.status !== "ACTIVE" ? <p className="banner rest-banner warning">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
              {writer ? <IssueSummary issues={itemIssues} onPick={goToIssue} /> : null}
              {writer && attempted && itemIssues.length === 0 ? <p className="banner rest-banner success">오류를 모두 고쳤습니다. 다시 '명령 저장'을 눌러 주세요.</p> : null}
              {restored && writer ? (
                <p className="banner rest-banner">이 브라우저에 남아 있던 임시 초안을 불러왔습니다. 아직 공식 규격이 아닙니다.
                  <button type="button" className="link-button" onClick={() => {
                    if (!spec || !draftFor) return;
                    sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
                    setDraft(selected ? deviceFromApi(selected) : blankDevice());
                    setRestored(false);
                    resetIssues();
                  }}>{selected ? "공식 규격으로 되돌리기" : "빈 양식으로 다시 시작"}</button>
                </p>
              ) : null}

              <div className={writer && previewOpen ? "studio-work is-json" : "studio-work"}>
                <div className="rest-column">
                  {writer && draft ? (
                    <>
                      <section className="rest-card mqtt-step">
                        <div className="mqtt-step-head">
                          <h3 className="mqtt-step-title"><span>1</span>기본 정보</h3>
                          <details className="mqtt-terms">
                            <summary>장비 프로토콜 용어 안내</summary>
                            <dl>
                              {deviceTerms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.text}</dd></div>)}
                              <div className="ws-terms-note">위 설명은 일반적인 개념입니다. 실제 패킷 규칙(헤더 구성, 체크섬 계산 등)은 장비마다 다릅니다.</div>
                            </dl>
                          </details>
                        </div>
                        <div className="rest-grid mqtt-topic-grid">
                          <Field label="Command ID" required error={itemErrors.get("device:commandId")}>
                            <input className="mono" data-issue="device:commandId" aria-invalid={Boolean(itemErrors.get("device:commandId"))} placeholder="0x03" value={draft.commandId} onChange={(event) => updateDraft({ ...draft, commandId: event.target.value })} />
                          </Field>
                          <Field label="명령 이름" required error={itemErrors.get("device:name")}>
                            <input data-issue="device:name" aria-invalid={Boolean(itemErrors.get("device:name"))} placeholder="예: 문열기" value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
                          </Field>
                        </div>
                        <div className="mqtt-topic-guide">
                          <p>Command ID는 문서에 적은 그대로 저장됩니다(0x03, 3 등 형식 제한 없음). 같은 Command ID로 요청·응답을 각각 등록할 수 있습니다. 예시를 누르면 입력됩니다.</p>
                          <div className="mqtt-examples">
                            {commandIdExamples.map((example) => (
                              <button key={example} type="button" className="mqtt-example" onClick={() => applyCommandExample(example)}><code>{example}</code></button>
                            ))}
                          </div>
                          {sameDirection.length > 0 ? (
                            <p className="mqtt-note is-warning" role="status">
                              주의: 같은 Command ID와 같은 방향의 명령이 이미 있습니다. 용도를 확인해 주세요. (저장은 가능합니다)
                              {sameDirection.map((item) => <span key={item.itemUid} className="mqtt-dup">{item.name} · {directionText(item.payload.direction ?? "")}</span>)}
                            </p>
                          ) : siblings.length > 0 ? (
                            <p className="mqtt-note is-info" role="status">
                              안내: 같은 Command ID의 다른 명령이 있습니다.
                              {siblings.map((item) => <span key={item.itemUid} className="mqtt-dup is-info">{item.name} · {directionText(item.payload.direction ?? "")}</span>)}
                            </p>
                          ) : null}
                        </div>
                        <div className="rest-grid ws-kind-grid">
                          <Field label="방향" required hint={direction?.hint} error={itemErrors.get("device:direction")}>
                            <select data-issue="device:direction" value={draft.direction} onChange={(event) => updateDraft({ ...draft, direction: event.target.value })}>
                              {deviceDirections.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                          </Field>
                          <Field label="요약" error={itemErrors.get("device:summary")}>
                            <input data-issue="device:summary" aria-invalid={Boolean(itemErrors.get("device:summary"))} placeholder="예: 앱이 단말기에 문열기를 요청합니다." value={draft.summary} onChange={(event) => updateDraft({ ...draft, summary: event.target.value })} />
                          </Field>
                        </div>
                        <Field label="상세 설명" error={itemErrors.get("device:description")}>
                          <textarea data-issue="device:description" aria-invalid={Boolean(itemErrors.get("device:description"))} rows={3} placeholder="발생 조건, Param 의미, 주의 사항 등을 적습니다." value={draft.description} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} />
                        </Field>
                      </section>

                      <section className="rest-card mqtt-step">
                        <div className="mqtt-step-head">
                          <h3 className="mqtt-step-title"><span>2</span>바이너리 필드 구조</h3>
                          {draft.fields.length > 0 ? <button type="button" className="btn device-auto" onClick={autoOffsets}>Offset 자동 계산</button> : null}
                        </div>
                        <p className="rest-card-note">
                          이 명령({directionText(draft.direction)}) 패킷의 필드를 순서대로 적습니다. 길이(Byte)는 선택이며, 길이를 적으면 시작 위치(Offset)도 함께 필요합니다.
                          Offset을 아직 모르면 길이도 비워 두고 저장할 수 있습니다. 'Offset 자동 계산'은 맨 위 필드부터 길이를 더해 비어 있는 Offset만 채웁니다. Endian·Encoding은 '상세'에서 정합니다.
                        </p>
                        <ByteFieldTable fields={draft.fields} issues={itemErrors} defaultEndian={defaultEndian} onChange={(fields) => updateDraft({ ...draft, fields })} />
                        {summaryLine}
                      </section>

                      <section className="rest-card mqtt-step">
                        <h3 className="mqtt-step-title"><span>3</span>추가 설정</h3>
                        <div className="rest-grid two">
                          <Field label="대응 명령 (요청·응답 연결)" hint="요청과 응답은 각각 별도 명령으로 등록하고, 여기서 서로 연결합니다." error={itemErrors.get("device:related")}>
                            <select data-issue="device:related" aria-invalid={Boolean(itemErrors.get("device:related"))} value={draft.relatedItemUid} onChange={(event) => updateDraft({ ...draft, relatedItemUid: event.target.value })}>
                              <option value="">연결 안 함</option>
                              {items.filter((item) => item.itemUid !== draftFor).map((item) => <option key={item.itemUid} value={item.itemUid}>{commandLabel(item)}</option>)}
                            </select>
                          </Field>
                          <Field label="상태">
                            <select value={draft.status} onChange={(event) => updateDraft({ ...draft, status: event.target.value as DeviceDraft["status"] })}>
                              <option value="ACTIVE">사용 중 (ACTIVE)</option>
                              <option value="DEPRECATED">사용 중단 (DEPRECATED)</option>
                            </select>
                          </Field>
                        </div>
                        <Field label="HEX 예시" hint="실제 패킷 한 개를 16진수 두 자리씩 공백으로 구분해 직접 입력합니다. 자동으로 만들어지지 않습니다." error={itemErrors.get("device:hex")}>
                          <input className="mono" data-issue="device:hex" aria-invalid={Boolean(itemErrors.get("device:hex") || hexIssue)} placeholder="예: 02 03 00 00 01 00 00 00 00 00 00 00 00 00 5A 00" value={draft.exampleHex} onChange={(event) => updateDraft({ ...draft, exampleHex: event.target.value })} />
                        </Field>
                        {hexIssue && !itemErrors.get("device:hex") ? <p className="mqtt-note is-warning">확인: {hexIssue}</p> : hexLine}
                        <div className="device-json">
                          <div className="device-json-head">
                            <span className="rest-label">해석 JSON</span>
                            <div className="seg-tabs" role="tablist" aria-label="해석 JSON 방식">
                              <button type="button" role="tab" aria-selected={draft.exampleMode === "AUTO"} onClick={() => setJsonMode("AUTO")}>필드 예시값으로 자동</button>
                              <button type="button" role="tab" aria-selected={draft.exampleMode === "MANUAL"} onClick={() => setJsonMode("MANUAL")}>직접 입력</button>
                            </div>
                          </div>
                          <p className="rest-hint">패킷이 JSON이라는 뜻이 아닙니다. HEX 예시를 필드별 값으로 풀어 쓴 설명용 예시이며, 필드 정의와 맞는지 검사합니다.</p>
                          {draft.exampleMode === "MANUAL" ? (
                            <textarea className="device-json-input" data-issue="device:manual" value={draft.manualText} onChange={(event) => updateDraft({ ...draft, manualText: event.target.value })} />
                          ) : (
                            <div className="mqtt-json-block"><JsonBlock text={json?.text || "{}"} /></div>
                          )}
                          {json?.problem ? <p className="mqtt-note is-warning">확인: {json.problem}</p> : null}
                        </div>
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
                          <div><dt>Command ID</dt><dd><code>{view.commandId}</code> <button type="button" className="copy-chip" aria-label="Command ID 복사" onClick={() => void copyText(view.commandId.trim(), "Command ID")}>복사</button></dd></div>
                          <div><dt>명령 이름</dt><dd>{view.name}</dd></div>
                          <div><dt>방향</dt><dd>{directionText(view.direction)}{direction ? <em> · {direction.hint}</em> : null}</dd></div>
                          <div><dt>상태</dt><dd>{view.status === "DEPRECATED" ? "사용 중단 (DEPRECATED)" : "사용 중 (ACTIVE)"}</dd></div>
                          <div className="wide"><dt>요약</dt><dd>{view.summary || <em>미설정</em>}</dd></div>
                          <div className="wide"><dt>상세 설명</dt><dd className="rest-desc">{view.description || <em>미설정</em>}</dd></div>
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">바이너리 필드 구조</h3>
                        <ByteFieldView fields={view.fields} defaultEndian={defaultEndian} />
                        {summaryLine}
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">요청·응답 관계</h3>
                        <dl className="rest-facts">
                          <div>
                            <dt>이 명령이 연결한 대응 명령</dt>
                            <dd>{related ? <button type="button" className="link-button no-gap" onClick={() => openCommand(related.itemUid)}>{commandLabel(related)}</button> : view.relatedItemUid ? <em>찾을 수 없는 명령</em> : <em>연결 안 함</em>}</dd>
                          </div>
                          <div>
                            <dt>이 명령을 대응 명령으로 연결한 명령</dt>
                            <dd>{linkedFrom.length ? linkedFrom.map((item) => <button key={item.itemUid} type="button" className="link-button no-gap ws-backlink" onClick={() => openCommand(item.itemUid)}>{commandLabel(item)}</button>) : <em>없음</em>}</dd>
                          </div>
                          {siblings.length ? (
                            <div className="wide">
                              <dt>같은 Command ID의 다른 명령</dt>
                              <dd>{siblings.map((item) => <button key={item.itemUid} type="button" className="link-button no-gap ws-backlink" onClick={() => openCommand(item.itemUid)}>{commandLabel(item)}</button>)}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">
                          HEX 예시와 해석 JSON
                          {view.exampleHex.trim() ? <button type="button" className="copy-chip" onClick={() => void copyText(view.exampleHex.trim(), "HEX 예시")}>HEX 복사</button> : null}
                        </h3>
                        {view.exampleHex.trim() ? (
                          <>
                            <pre className="device-hex">{view.exampleHex.trim()}</pre>
                            {hexLine}
                          </>
                        ) : <p className="rest-card-note">입력된 HEX 예시가 없습니다.</p>}
                        <p className="rest-label device-json-label">해석 JSON <small>{view.exampleMode === "MANUAL" ? "직접 입력" : "필드 예시값으로 자동 생성"} · HEX를 필드별 값으로 풀어 쓴 설명용 예시</small></p>
                        {view.fields.length === 0 && view.exampleMode !== "MANUAL" ? <p className="rest-card-note">필드가 없어 해석 JSON이 비어 있습니다.</p> : <div className="mqtt-json-block"><JsonBlock text={json?.text || "{}"} /></div>}
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

                {writer && previewOpen && draft ? (
                  <aside className="json-panel device-preview">
                    <header><h2>패킷 미리보기</h2></header>
                    <p>입력한 필드로 계산할 수 있는 정보만 보여 줍니다. 체크섬이나 바이트 값은 만들지 않습니다.</p>
                    {draft.fields.length === 0 ? <p>바이너리 필드가 없습니다.</p> : (
                      <table>
                        <thead><tr><th>필드</th><th>Offset</th><th>길이</th><th>Endian</th></tr></thead>
                        <tbody>
                          {draft.fields.map((field) => {
                            const mode = field.lengthMode.trim().toUpperCase();
                            return (
                              <tr key={field.clientKey}>
                                <td>{field.name || "이름 없음"}<small>{field.type}{field.encoding ? ` · ${field.encoding}` : ""}</small></td>
                                <td>{field.byteOffset.trim() || "—"}</td>
                                <td>{mode === "VARIABLE" ? "가변" : field.byteLength.trim() || "—"}</td>
                                <td>{mode ? field.endian || defaultEndian : "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {summary && draft.fields.length > 0 ? <p>고정 {summary.fixedSum} Bytes{summary.variable.length ? ` + 가변 ${summary.variable.length}개` : ""}{summary.unknown ? ` · 길이 미입력 ${summary.unknown}개` : ""}</p> : null}
                    <h3>HEX 예시</h3>
                    <pre>{draft.exampleHex.trim() || "입력된 HEX가 없습니다."}</pre>
                    {draft.exampleHex.trim() ? <p>{hexBytes} Bytes</p> : null}
                  </aside>
                ) : null}
              </div>

              {confirmDelete ? (
                <div className="modal-backdrop">
                  <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                    <h2>명령 삭제</h2>
                    <p>이 명령만 삭제합니다. 문서와 다른 명령은 남습니다.</p>
                    <label>변경 사유<input value={deleteReason} placeholder="예: 사용하지 않는 명령 정리" onChange={(event) => setDeleteReason(event.target.value)} /></label>
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
                  {conflict.notes.length > 0 ? <ul>{conflict.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>다른 명령 변경은 없습니다.</p>}
                  <div className="compare-grid">
                    <div><h4>내 입력</h4><pre>{draft ? `${draft.commandId} ${draft.name}\n${draft.exampleHex}` : ""}</pre></div>
                    <div><h4>서버 최신</h4><pre>{conflict.latest ? `${conflict.latest.payload.commandId ?? ""} ${conflict.latest.name}\n${conflict.latest.payload.exampleHex ?? ""}` : "서버에 이 명령이 없습니다."}</pre></div>
                  </div>
                  <button type="button" className="btn primary" disabled={saving} onClick={() => void saveWithLatest()}>{conflict.latest ? "이 명령을 최신 버전 기준으로 저장" : "새 명령으로 저장"}</button>
                </section>
              ) : null}
            </form>
          ) : <p className="state-panel">명령을 불러오는 중입니다.</p>}
        </section>
      </div>
    );
  }

  return (
    <main className="studio rest-studio mqtt-studio device-studio">
      <div className="studio-main">
        {header}
        {!spec && notice ? noticeBanner : null}
        {body}
      </div>
    </main>
  );
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

function overviewSignature(overview: DeviceOverviewDraft) {
  return { title: overview.title.trim(), transport: overview.transport, defaultEndian: overview.defaultEndian, framing: overview.framing.trim() };
}
