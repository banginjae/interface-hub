import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { ErrorCodePicker } from "../spec/ErrorCodePicker";
import { JsonBlock } from "../spec/jsonView";
import {
  blankMqtt,
  directionGuide,
  directionShort,
  directionText,
  mqttDirections,
  mqttFromApi,
  mqttTerms,
  mqttToPayload,
  qosOptions,
  topicExamples,
  topicNotes,
  type MqttDraft,
  type MqttOverviewDraft,
} from "../spec/mqttModel";
import { duplicateTopics, pendingActorIssues, validateMqttOverview, validateTopic, type MqttIssue } from "../spec/mqttValidation";
import { issueMap, reasonProblem } from "../spec/restValidation";
import { itemChanged, itemSaveBody, noChangeMessage, sameValue, type ItemSaveBody } from "../spec/saveCompare";
import { SchemaTable } from "../spec/SchemaTable";
import { SpecHistory } from "../spec/SpecHistory";
import { SpecMarkdown } from "../spec/SpecMarkdown";
import { draftKey, previewText, type ExampleDraft, type SpecDocument, type SpecItem } from "../spec/specModel";
import { Field, IssueSummary, TagInput, formatDate } from "../spec/workspaceUi";
import { useToast } from "../toast";

const authTypes = ["NONE", "BEARER", "BASIC", "API_KEY", "CUSTOM"];

type ConflictView = { currentVersion: number; latest: SpecItem | null; notes: string[] };
type Tone = "success" | "warning" | "danger" | "info";
type Notice = { text: string; tone: Tone } | null;
type DocView = "settings" | "history" | "markdown";
type Route = { item?: string | null; mode?: "edit" | null; view?: DocView | null };

const docViewLabel: Record<DocView, string> = { settings: "문서 설정", history: "변경 이력", markdown: "Markdown" };
const emptyActorText = { publishers: "", subscribers: "" };

export function MqttPage() {
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
  const [draft, setDraft] = useState<MqttDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [baseline, setBaseline] = useState<ItemSaveBody | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<ConflictView | null>(null);
  const [overview, setOverview] = useState<MqttOverviewDraft | null>(null);
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
  const [actorText, setActorText] = useState(emptyActorText);
  const overviewTouched = useRef(false);
  const toast = useToast();

  const viewParam = searchParams.get("view");
  const docView: DocView | null = viewParam === "settings" || viewParam === "history" || viewParam === "markdown" ? viewParam : null;
  const itemParam = searchParams.get("item");
  const modeParam = searchParams.get("mode") === "edit" ? "edit" : null;
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const editTarget = canEdit && itemParam && (itemParam === "new" || modeParam === "edit") ? itemParam : null;
  const selected = spec?.items.find((item) => item.itemUid === itemParam) ?? null;
  const selectedView = useMemo(() => (selected ? mqttFromApi(selected) : null), [selected]);
  const overviewDirty = Boolean(spec && overview && !sameValue(overviewSignature(overview), overviewSignature(overviewFrom(spec))));
  const currentBody = useMemo(() => itemSaveBody(draft, mqttToPayload), [draft]);
  const dirty = Boolean(draft && draftFor) && itemChanged(draftFor === "new", baseline, currentBody);

  usePageChrome(project?.title ?? "MQTT", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : undefined },
    { label: "MQTT" },
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
      const document = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/MQTT`, { token });
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
        if (cancel) return;
        if (error instanceof ApiError && error.status === 403) {
          setDenied(true);
          return;
        }
        say(error instanceof ApiError && error.status === 401 ? "로그인이 만료되었습니다." : authErrorMessage(error), "danger");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
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
        setActorText(emptyActorText);
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
    let next = found ? mqttFromApi(found) : blankMqtt();
    let wasRestored = false;
    const saved = sessionStorage.getItem(draftKey(spec.id, editTarget, spec.version));
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { draft?: MqttDraft };
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
    setBaseline(found ? itemSaveBody(mqttFromApi(found), mqttToPayload) : null);
    setRestored(wasRestored);
    setBaseVersion(spec.version);
    setConflict(null);
    setAttempted(false);
    setReasonError("");
    setSaveOpen(false);
    setActorText(emptyActorText);
    if (editTarget === "new" && !wasRestored) {
      setFocusTarget("mqtt:topic");
    }
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
  }, [focusTarget, docView, itemParam, draftFor]);

  if (!auth.ready) return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) return <main className="spec-screen"><h1>MQTT</h1><p>이 프로젝트의 규격을 볼 권한이 없습니다.</p><Link to="/projects">목록으로</Link></main>;
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

  function guardTopic() {
    return !dirty || window.confirm("저장하지 않은 Topic 변경이 있습니다. 이동하면 공식 규격에는 반영되지 않고, 초안만 이 브라우저에 임시로 남습니다.");
  }

  function guardLeave() {
    if (!dirty && !overviewDirty) return true;
    const parts = [dirty ? "Topic" : "", overviewDirty ? "문서 설정" : ""].filter(Boolean).join("과 ");
    return window.confirm(`저장하지 않은 ${parts} 변경이 있습니다. 이 화면을 떠나면 공식 규격에 반영되지 않습니다.${dirty ? " Topic 초안만 이 브라우저에 임시로 남습니다." : ""}`);
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
    setActorText(emptyActorText);
    resetIssues();
  }

  function toList() {
    if (draftFor && !guardTopic()) return;
    go({});
  }

  function openTopic(uid: string) {
    if (uid === draftFor) {
      go({ item: uid, mode: uid === "new" ? null : "edit" });
      return;
    }
    if (draftFor && !guardTopic()) return;
    go({ item: uid });
  }

  function beginTopic() {
    if (!spec || !canEdit) return;
    if (draftFor && draftFor !== "new" && !guardTopic()) return;
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

  function updateDraft(next: MqttDraft) {
    setDraft(next);
  }

  function editOverview(next: MqttOverviewDraft) {
    overviewTouched.current = true;
    setOverview(next);
  }

  function goToIssue(issue: MqttIssue) {
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
      await apiRequest(`/api/projects/${projectId}/specs`, { method: "POST", token: auth.token, body: { kind: "MQTT", title: "MQTT 규격" } });
      await loadSpec(auth.token);
      notifySpecChanged();
      say("MQTT 규격 문서를 만들었습니다.", "success");
    } catch (error) {
      say(authErrorMessage(error), "danger");
    } finally {
      setSaving(false);
    }
  }

  async function saveOverview() {
    if (!auth.token || !spec || !overview || !canEdit) return;
    const found = validateMqttOverview(overview);
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
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/MQTT`, {
        method: "PATCH",
        token: auth.token,
        body: {
          version: sentVersion,
          changeReason: overview.changeReason.trim(),
          title: overview.title.trim(),
          overview: {
            brokerUrl: overview.brokerUrl.trim(),
            protocolVersion: overview.protocolVersion.trim(),
            auth: { type: overview.authType, description: overview.authDescription.trim() },
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
        ? `문서 설정을 저장했습니다 · 문서 버전 v${result.version}. 편집 중인 Topic 초안은 그대로 유지됩니다.`
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

  function topicIssues(next: MqttDraft) {
    return [...validateTopic(next), ...pendingActorIssues(actorText)];
  }

  function startSave() {
    if (!draft || !dirty) return;
    const found = topicIssues(draft);
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
    setFocusTarget("mqtt:changeReason");
  }

  async function saveItem(version = baseVersion, create = draftFor === "new") {
    if (!auth.token || !spec || !draft || !draftFor || saving || (!dirty && !conflict)) return;
    const found = topicIssues(draft);
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
      setFocusTarget("mqtt:changeReason");
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
      payload: mqttToPayload(draft),
      errorCodeIds: draft.errorCodeIds ?? [],
    };
    try {
      const path = create ? `/api/projects/${projectId}/specs/MQTT/items` : `/api/projects/${projectId}/specs/MQTT/items/${draftFor}`;
      const result = await apiRequest<{ version: number; itemUid?: string }>(path, { method: create ? "POST" : "PUT", token: auth.token, body });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      const uid = result.itemUid ?? draftFor;
      await loadSpec(auth.token);
      notifySpecChanged();
      dropDraft();
      go({ item: uid }, { keepNotice: true });
      say(!create && result.version === version ? noChangeMessage : `Topic을 저장했습니다 · 문서 버전 v${result.version}`, !create && result.version === version ? "info" : "success");
    } catch (error) {
      if (error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT") {
        setSaveOpen(false);
        await showConflict(error.currentVersion);
      } else if (error instanceof ApiError && error.status === 404 && draftFor !== "new") {
        say("이 Topic은 이미 삭제되었습니다. 입력은 남아 있습니다. 새 항목으로 저장할 때만 다시 만듭니다.", "warning");
        const latest = await loadSpec(auth.token);
        if (latest) setConflict({ currentVersion: latest.version, latest: null, notes: ["서버에서 이 Topic이 삭제되었습니다."] });
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
    const latest = await apiRequest<SpecDocument>(`/api/projects/${projectId}/specs/MQTT`, { token: auth.token });
    const previous = spec.items.map((item) => `${item.itemUid}:${item.name}`);
    const notes = latest.items.filter((item) => item.itemUid !== draftFor && !previous.includes(`${item.itemUid}:${item.name}`)).map((item) => item.payload.topic || item.name);
    const removed = spec.items.filter((item) => item.itemUid !== draftFor && !latest.items.some((next) => next.itemUid === item.itemUid)).map((item) => `${item.name} 삭제`);
    setSpec(latest);
    setOverview((current) => (current && overviewTouched.current ? current : overviewFrom(latest)));
    setConflict({
      currentVersion: currentVersion ?? latest.version,
      latest: latest.items.find((item) => item.itemUid === draftFor) ?? null,
      notes: [...notes.map((name) => `${name} 변경`), ...removed],
    });
    say("다른 사용자가 먼저 저장했습니다. 이 Topic의 입력은 남아 있습니다. 다른 Topic은 이 저장에 포함되지 않습니다.", "warning");
  }

  async function saveWithLatest() {
    if (!conflict) return;
    if (conflict.latest && !window.confirm("다시 저장하면 이 Topic만 내 내용으로 바뀝니다.")) return;
    await saveItem(conflict.currentVersion, !conflict.latest);
  }

  async function removeItem() {
    if (!auth.token || !spec || !draftFor || draftFor === "new" || !deleteReason.trim()) {
      say("삭제 사유를 입력하세요.", "danger");
      return;
    }
    if (spec.items.some((item) => item.itemUid !== draftFor && item.payload.relatedItemUid === draftFor)) {
      say("다른 Topic이 이 Topic을 대응 Topic으로 가리키고 있습니다. 연결을 해제한 뒤 삭제하세요.", "danger");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/MQTT/items/${draftFor}`, {
        method: "DELETE", token: auth.token, body: { version: spec.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
      setConfirmDelete(false);
      setDeleteReason("");
      dropDraft();
      await loadSpec(auth.token);
      notifySpecChanged();
      go({}, { keepNotice: true });
      say(`Topic을 삭제했습니다 · 문서 버전 v${result.version}`, "success");
    } catch (error) {
      say(error instanceof ApiError && error.code === "DOCUMENT_VERSION_CONFLICT" ? "다른 저장이 먼저 반영되어 삭제하지 않았습니다." : authErrorMessage(error), "danger");
      if (auth.token) await loadSpec(auth.token);
    } finally {
      setSaving(false);
    }
  }

  function moveOrder(index: number, direction: -1 | 1) {
    setOrdering((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
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
      const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/specs/MQTT/items/order`, {
        method: "PUT", token: auth.token, body: { version: spec.version, changeReason: "Topic 순서 변경", itemUids: ordering },
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
  const visible = items.filter((item) => `${item.payload.topic ?? ""} ${item.name} ${item.summary}`.toLowerCase().includes(needle));
  const orderedItems = ordering ? ordering.map((uid) => items.find((item) => item.itemUid === uid)).filter((item): item is SpecItem => Boolean(item)) : [];
  const orderChanged = Boolean(ordering) && !sameValue(ordering, items.map((item) => item.itemUid));
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const view: MqttDraft | null = writer ? draft : selectedView;
  const isNew = itemParam === "new";
  const preview = view ? previewText(view.payload) : null;
  const itemIssues = draft && attempted ? topicIssues(draft) : [];
  const sameTopics = writer && draft ? duplicateTopics(items, draft.topic, draftFor) : [];
  const itemErrors = issueMap(itemIssues);
  const settingsIssues = overview && settingsAttempted ? validateMqttOverview(overview) : [];
  const settingsErrors = issueMap(settingsIssues);
  const tone = saveTone(notice, dirty, saving, Boolean(conflict), itemIssues.length > 0);
  const pendingTopic = dirty && draft ? (draft.topic.trim() || "새 Topic") : "";
  const crumbTail = docView ? docViewLabel[docView] : isNew ? "새 Topic" : selected ? (selected.payload.topic ?? selected.name) : null;
  const related = view?.relatedItemUid ? items.find((item) => item.itemUid === view.relatedItemUid) ?? null : null;

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

  function jumpToJson() {
    document.getElementById("mqtt-json")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const noticeBanner = notice ? <p className={`banner rest-banner ${notice.tone === "info" ? "" : notice.tone}`}>{notice.text}</p> : null;

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guardLeave()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {crumbTail ? <button type="button" className="crumb-link" onClick={toList}>MQTT</button> : <strong>MQTT</strong>}
        {crumbTail ? <><span aria-hidden="true">/</span><strong className="crumb-current">{crumbTail}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>MQTT 규격</h1>
          {spec ? (
            <p className="rest-doc-meta">
              {spec.title.trim() && spec.title.trim() !== "MQTT 규격" ? <span>{spec.title}</span> : null}
              <span>문서 v{spec.version}</span>
              <span>Topic {items.length}개</span>
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

  const draftBanner = docView && pendingTopic ? (
    <p className="banner rest-banner">
      편집 중인 Topic <code>{pendingTopic}</code>는 저장되지 않은 상태로 그대로 유지됩니다.
      <button type="button" className="link-button" onClick={closeDocView}>Topic 편집으로 돌아가기</button>
    </p>
  ) : null;

  function topicRow(item: SpecItem, compact: boolean) {
    const current = item.itemUid === itemParam && !docView;
    const direction = item.payload.direction ?? "";
    return (
      <li key={item.itemUid}>
        <button type="button" className={current ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} aria-current={current ? "true" : undefined} onClick={() => openTopic(item.itemUid)}>
          <span className={`mqtt-dir dir-${direction.toLowerCase()}`}>{directionShort(direction)}</span>
          <span className="ep-main">
            <code>{item.payload.topic}</code>
            <span className="ep-name">
              {item.name}
              {!compact && item.summary ? <em> · {item.summary}</em> : null}
            </span>
          </span>
          {compact ? null : <span className="mqtt-qos">QoS {item.payload.qos ?? 0}{item.payload.retain ? " · Retain" : ""}</span>}
          {item.status === "DEPRECATED" ? <span className="ep-tag">사용 중단</span> : null}
          {item.itemUid === draftFor && dirty ? <span className="ep-tag is-draft">수정 중</span> : null}
        </button>
      </li>
    );
  }

  const newRow = draftFor === "new" && draft ? (
    <li key="new">
      <button type="button" className={isNew && !docView ? "ep-row mqtt-row is-current" : "ep-row mqtt-row"} onClick={() => openTopic("new")}>
        <span className={`mqtt-dir dir-${draft.direction.toLowerCase()}`}>{directionShort(draft.direction)}</span>
        <span className="ep-main"><code>{draft.topic.trim() || "Topic 경로 미입력"}</code><span className="ep-name">{draft.name.trim() || "새 Topic"}</span></span>
        <span className="ep-tag is-draft">작성 중</span>
      </button>
    </li>
  ) : null;

  let body: ReactNode = null;

  if (missing) {
    body = (
      <section className="rest-panel">
        <div className="rest-empty-state">
          <h2>아직 MQTT 규격 문서가 없습니다.</h2>
          <p>이 프로젝트의 MQTT 공식 문서는 하나만 만듭니다. 문서를 시작한 뒤 Topic을 추가합니다.</p>
          {canEdit ? <button type="button" className="btn primary" disabled={saving} onClick={createDocument}>MQTT 규격 시작</button> : <p>조회 권한으로는 규격을 시작할 수 없습니다.</p>}
        </div>
      </section>
    );
  } else if (spec && docView === "history" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>MQTT 문서 변경 이력</h2>
          <p>이 MQTT 문서의 버전별 변경 내역과 두 버전 비교입니다. 프로젝트 전체 활동은 좌측 메뉴의 '최근 변경'에서 봅니다.</p>
        </div>
        <SpecHistory projectId={projectId} token={auth.token} kind="MQTT" heading={null} />
      </section>
    );
  } else if (spec && docView === "markdown" && auth.token) {
    body = (
      <section className="rest-panel">
        {draftBanner}
        <div className="rest-panel-head">
          <h2>MQTT 문서</h2>
          <p>저장된 MQTT 문서를 읽기 좋은 형태로 보여 줍니다. 복사와 다운로드는 Markdown 원본을 사용합니다.</p>
        </div>
        <SpecMarkdown projectId={projectId} token={auth.token} version={spec.version} kind="MQTT" rendered />
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
          <p>MQTT 문서 전체에 적용되는 브로커와 인증 정보입니다. Topic 저장과 별도로 저장됩니다.</p>
          <span className={`save-state is-${overviewDirty ? "dirty" : "clean"}`}>{overviewDirty ? "저장되지 않은 변경" : `저장됨 · v${spec.version}`}</span>
        </div>
        <div className="rest-card">
          <div className="rest-grid two">
            <Field label="문서 제목" required error={settingsErrors.get("doc:title")}>
              <input data-issue="doc:title" aria-invalid={Boolean(settingsErrors.get("doc:title"))} value={overview.title} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, title: event.target.value })} />
            </Field>
            <Field label="브로커 주소" hint="MQTT 클라이언트가 접속하는 브로커 주소입니다." error={settingsErrors.get("doc:brokerUrl")}>
              <input className="mono" data-issue="doc:brokerUrl" aria-invalid={Boolean(settingsErrors.get("doc:brokerUrl"))} placeholder="mqtt://lab.example:1883" value={overview.brokerUrl} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, brokerUrl: event.target.value })} />
            </Field>
            <Field label="프로토콜 버전" error={settingsErrors.get("doc:protocolVersion")}>
              <input data-issue="doc:protocolVersion" aria-invalid={Boolean(settingsErrors.get("doc:protocolVersion"))} placeholder="예: 3.1.1 또는 5.0" value={overview.protocolVersion} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, protocolVersion: event.target.value })} />
            </Field>
            <Field label="공통 인증 방식">
              <select value={overview.authType} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authType: event.target.value })}>
                {authTypes.map((type) => <option key={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="인증 설명" error={settingsErrors.get("doc:authDescription")}>
              <input data-issue="doc:authDescription" aria-invalid={Boolean(settingsErrors.get("doc:authDescription"))} placeholder="예: 장비별 사용자명/비밀번호로 접속합니다." value={overview.authDescription} disabled={!canEdit} onChange={(event) => editOverview({ ...overview, authDescription: event.target.value })} />
            </Field>
          </div>
        </div>
        {canEdit ? (
          <div className="rest-card rest-save">
            <Field label="변경 사유" required hint="변경 이력(Revision)에 함께 기록되어, 나중에 누가 왜 바꿨는지 확인할 수 있습니다." error={settingsReasonError}>
              <input data-issue="doc:changeReason" aria-invalid={Boolean(settingsReasonError)} placeholder="예: 운영 브로커 주소 변경" value={overview.changeReason} onChange={(event) => { setSettingsReasonError(""); editOverview({ ...overview, changeReason: event.target.value }); }} />
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
            <h2>아직 등록된 Topic이 없습니다.</h2>
            <p>MQTT Topic의 경로, 메시지 방향, Payload 구조를 등록해 보세요.</p>
            {canEdit ? <button type="button" className="btn primary" onClick={beginTopic}>+ 첫 Topic 추가</button> : <p>조회 권한으로는 Topic을 추가할 수 없습니다.</p>}
          </div>
        ) : (
          <div className="ep-board">
            <div className="ep-toolbar">
              {ordering ? (
                <>
                  <p className="ep-mode-note"><strong>순서 변경 중</strong> · 위/아래로 옮긴 뒤 '순서 저장'을 누르면 한 번에 저장됩니다.</p>
                  <div className="ep-toolbar-actions">
                    <button type="button" className="btn" disabled={saving} onClick={() => setOrdering(null)}>취소</button>
                    <button type="button" className="btn primary" disabled={saving || !orderChanged} title={orderChanged ? undefined : noChangeMessage} onClick={() => void saveOrdering()}>{saving ? "저장 중" : "순서 저장"}</button>
                  </div>
                </>
              ) : (
                <>
                  <input className="ep-search" type="search" aria-label="Topic 검색" placeholder="Topic 경로 또는 이름으로 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
                  <div className="ep-toolbar-actions">
                    {canEdit && items.length > 1 ? <button type="button" className="btn" onClick={() => { setQuery(""); setNotice(null); setOrdering(items.map((item) => item.itemUid)); }}>순서 변경</button> : null}
                    {canEdit ? <button type="button" className="btn primary" onClick={beginTopic}>+ Topic 추가</button> : null}
                  </div>
                </>
              )}
            </div>
            {list.length === 0 ? <p className="ep-empty">'{query.trim()}'와 일치하는 Topic이 없습니다.</p> : null}
            {ordering ? (
              <ol className="ep-list is-ordering">
                {list.map((item, index) => (
                  <li key={item.itemUid} className="ep-order-row">
                    <span className="ep-order-index">{index + 1}</span>
                    <span className={`mqtt-dir dir-${(item.payload.direction ?? "").toLowerCase()}`}>{directionShort(item.payload.direction ?? "")}</span>
                    <span className="ep-main"><code>{item.payload.topic}</code><span className="ep-name">{item.name}</span></span>
                    <span className="ep-order-actions">
                      <button type="button" aria-label={`${item.name} 위로`} disabled={saving || index === 0} onClick={() => moveOrder(index, -1)}>위로</button>
                      <button type="button" aria-label={`${item.name} 아래로`} disabled={saving || index === list.length - 1} onClick={() => moveOrder(index, 1)}>아래로</button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="ep-list">
                {newRow}
                {list.map((item) => topicRow(item, false))}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  } else if (spec && itemParam) {
    const notFound = !isNew && !selected;
    const readOnlyNew = isNew && !canEdit;
    const qos = qosOptions.find((option) => option.value === view?.qos);
    const direction = mqttDirections.find((option) => option.value === view?.direction);
    body = (
      <div className="rest-split">
        <aside className="ep-pane" aria-label="Topic 목록">
          <input className="ep-search" type="search" aria-label="Topic 검색" placeholder="Topic 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginTopic}>+ Topic 추가</button> : null}
          <ul className="ep-list is-compact">
            {newRow}
            {visible.map((item) => topicRow(item, true))}
          </ul>
          {items.length > 0 && visible.length === 0 ? <p className="ep-empty">일치하는 Topic이 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">
          {notFound || readOnlyNew ? (
            <div className="rest-empty-state">
              <h2>{readOnlyNew ? "조회 권한으로는 Topic을 추가할 수 없습니다." : "Topic을 찾을 수 없습니다."}</h2>
              <p>{readOnlyNew ? "목록에서 Topic을 선택해 조회하세요." : "삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요."}</p>
              <button type="button" className="btn" onClick={() => go({})}>Topic 목록으로</button>
            </div>
          ) : view ? (
            <form className="rest-editor" onSubmit={(event) => event.preventDefault()}>
              <header className="rest-bar">
                <div className="rest-bar-title">
                  <p className="rest-kicker">{isNew ? "새 Topic 작성" : writer ? "Topic 편집" : "Topic 조회"}</p>
                  <h2>
                    <code>{view.topic.trim() || "Topic 경로 미입력"}</code>
                    {view.topic.trim() ? <button type="button" className="copy-chip" aria-label="Topic 경로 복사" onClick={() => void copyText(view.topic.trim(), "Topic 경로")}>복사</button> : null}
                  </h2>
                  {!writer ? (
                    <p className="mqtt-bar-meta">
                      <span>{view.name}</span>
                      <span>{directionText(view.direction)}</span>
                      <span>권장 QoS {view.qos}</span>
                      <span>Retain {view.retain ? "사용" : "미사용"}</span>
                      <span>문서 v{spec.version}</span>
                    </p>
                  ) : null}
                </div>
                <div className="toolbar">
                  {writer ? <span className={`save-state is-${tone}`}>{saveLabel(tone, spec.version, conflict?.currentVersion, itemIssues.length)}</span> : null}
                  <button type="button" className="btn" aria-pressed={writer ? jsonOpen : undefined} onClick={() => (writer ? setJsonOpen((open) => !open) : jumpToJson())}>{writer && jsonOpen ? "JSON 예시 닫기" : "JSON 예시"}</button>
                  {!writer && canEdit && selected ? <button type="button" className="btn primary" onClick={beginEdit}>편집</button> : null}
                  {writer && !isNew ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
                  {writer ? <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button> : null}
                  {writer ? <button type="button" className="btn primary" disabled={saving || Boolean(conflict) || !dirty} title={dirty ? undefined : noChangeMessage} onClick={startSave}>{saving ? "저장 중" : "Topic 저장"}</button> : null}
                  {writer && saveOpen && draft ? (
                    <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                      <Field label="변경 사유" required hint="변경 이력(Revision)에 기록되어, 누가 왜 바꿨는지 나중에 확인할 수 있습니다." error={reasonError}>
                        <input
                          data-issue="mqtt:changeReason"
                          aria-invalid={Boolean(reasonError)}
                          placeholder="예: 상태 Topic에 배터리 잔량 필드 추가"
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
              {!canEdit && project.status === "ACTIVE" ? <p className="banner rest-banner">조회 권한입니다. Topic을 수정할 수 없습니다.</p> : null}
              {project.status !== "ACTIVE" ? <p className="banner rest-banner warning">보관된 프로젝트는 조회만 할 수 있습니다.</p> : null}
              {writer ? <IssueSummary issues={itemIssues} onPick={goToIssue} /> : null}
              {writer && attempted && itemIssues.length === 0 ? <p className="banner rest-banner success">오류를 모두 고쳤습니다. 다시 'Topic 저장'을 눌러 주세요.</p> : null}
              {restored && writer ? (
                <p className="banner rest-banner">이 브라우저에 남아 있던 임시 초안을 불러왔습니다. 아직 공식 규격이 아닙니다.
                  <button type="button" className="link-button" onClick={() => {
                    if (!spec || !draftFor) return;
                    sessionStorage.removeItem(draftKey(spec.id, draftFor, baseVersion));
                    setDraft(selected ? mqttFromApi(selected) : blankMqtt());
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
                            <summary>MQTT 용어 안내</summary>
                            <dl>{mqttTerms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.text}</dd></div>)}</dl>
                          </details>
                        </div>
                        <div className="rest-grid mqtt-topic-grid">
                          <Field label="Topic 경로" required error={itemErrors.get("mqtt:topic")}>
                            <input className="mono" data-issue="mqtt:topic" aria-invalid={Boolean(itemErrors.get("mqtt:topic"))} placeholder="gateway/{gatewayId}/heartbeat" value={draft.topic} onChange={(event) => updateDraft({ ...draft, topic: event.target.value })} />
                          </Field>
                          <Field label="Topic 이름" required error={itemErrors.get("mqtt:name")}>
                            <input data-issue="mqtt:name" aria-invalid={Boolean(itemErrors.get("mqtt:name"))} placeholder="예: 게이트웨이 하트비트" value={draft.name} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} />
                          </Field>
                        </div>
                        <div className="mqtt-topic-guide">
                          <p>메시지를 발행하거나 구독하는 경로입니다. 단계는 <code>/</code> 로 구분합니다. 예시를 누르면 경로에 입력됩니다.</p>
                          <ul className="mqtt-topic-rules">
                            <li><code>{"{gatewayId}"}</code> 같은 중괄호는 <strong>문서용 변수 표기</strong>입니다. "이 자리에 실제 값(GW001 등)이 들어간다"는 뜻이며 MQTT가 해석하지 않습니다.</li>
                            <li><code>+</code>(한 단계), <code>#</code>(마지막 이후 전체)는 <strong>Subscribe 필터용 와일드카드</strong>입니다. 실제로 발행(Publish)하는 Topic 이름에는 쓸 수 없습니다.</li>
                          </ul>
                          <div className="mqtt-examples">
                            {topicExamples.map((example) => (
                              <button key={example} type="button" className="mqtt-example" onClick={() => updateDraft({ ...draft, topic: example })}><code>{example}</code></button>
                            ))}
                          </div>
                          {topicNotes(draft.topic).map((note) => <p key={note.text} className={`mqtt-note is-${note.tone}`}>{note.tone === "warning" ? "주의: " : "안내: "}{note.text}</p>)}
                          {sameTopics.length > 0 ? (
                            <p className="mqtt-note is-warning" role="status">
                              주의: 같은 경로의 Topic이 이미 등록되어 있습니다. 용도와 메시지 방향을 확인해 주세요. (저장은 가능합니다)
                              {sameTopics.map((item) => <span key={item.itemUid} className="mqtt-dup">{item.name} · {directionShort(item.payload.direction ?? "")}</span>)}
                            </p>
                          ) : null}
                        </div>
                        <div className="rest-grid mqtt-delivery-grid">
                          <Field label="메시지 방향" required hint={direction?.hint ?? "실제 메시지를 발행하는 쪽을 기준으로 고릅니다."} error={itemErrors.get("mqtt:direction")}>
                            <select data-issue="mqtt:direction" value={draft.direction} onChange={(event) => updateDraft({ ...draft, direction: event.target.value })}>
                              {mqttDirections.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                          </Field>
                          <Field label="권장 QoS" required hint={qos?.hint} error={itemErrors.get("mqtt:qos")}>
                            <select data-issue="mqtt:qos" value={draft.qos} onChange={(event) => updateDraft({ ...draft, qos: Number(event.target.value) })}>
                              {qosOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </Field>
                          <div className="rest-field">
                            <span className="rest-label">Retain</span>
                            <div className="mqtt-retain-row">
                              <label className="mqtt-retain">
                                <input type="checkbox" checked={draft.retain} onChange={(event) => updateDraft({ ...draft, retain: event.target.checked })} />
                                <span>마지막 메시지 보관</span>
                              </label>
                              <span className={draft.retain ? "mqtt-retain-state is-on" : "mqtt-retain-state"}>{draft.retain ? "사용" : "미사용"}</span>
                            </div>
                            <span className="rest-hint">Broker가 이 Topic의 마지막 Retained 메시지를 보관했다가 새 구독자에게 바로 전달합니다.</span>
                          </div>
                        </div>
                        <Field label="요약" error={itemErrors.get("mqtt:summary")}>
                          <input data-issue="mqtt:summary" aria-invalid={Boolean(itemErrors.get("mqtt:summary"))} placeholder="예: 장비가 1분마다 현재 상태를 보고합니다." value={draft.summary} onChange={(event) => updateDraft({ ...draft, summary: event.target.value })} />
                        </Field>
                        <Field label="용도/설명" error={itemErrors.get("mqtt:purpose")}>
                          <textarea data-issue="mqtt:purpose" aria-invalid={Boolean(itemErrors.get("mqtt:purpose"))} rows={3} placeholder="발생 조건, 처리 결과, 주의 사항 등을 적습니다." value={draft.purpose} onChange={(event) => updateDraft({ ...draft, purpose: event.target.value })} />
                        </Field>
                      </section>

                      <section className="rest-card mqtt-step">
                        <h3 className="mqtt-step-title"><span>2</span>Payload 구조</h3>
                        <p className="rest-card-note">메시지 본문(JSON 객체)의 필드입니다. object는 하위 필드를, array는 요소 타입을 정합니다. Payload가 없으면 비워 둔 채 저장해도 됩니다.</p>
                        <details className="mqtt-type-guide">
                          <summary>타입을 고르면 예시 칸에 그 타입의 예시가 표시됩니다 · 타입별 예시 보기</summary>
                          <dl>
                            <dt><code>string</code></dt><dd>ON</dd>
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
                          namePlaceholder="예: deviceId"
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
                          <label className="manual-box">직접 입력한 예시 JSON
                            <textarea data-issue="mqtt:manual" value={draft.payload.manualText} onChange={(event) => applyExample({ ...draft.payload, manualText: event.target.value })} />
                          </label>
                        ) : null}
                      </section>

                      <section className="rest-card mqtt-step">
                        <h3 className="mqtt-step-title"><span>3</span>추가 설정</h3>
                        <div className="rest-grid two">
                          <Field label="발행 주체" hint="이 Topic으로 메시지를 발행(Publish)하는 쪽입니다. 입력 후 Enter 또는 '추가'." error={itemErrors.get("mqtt:publishers")}>
                            <TagInput values={draft.publishers} text={actorText.publishers} onTextChange={(publishers) => setActorText((current) => ({ ...current, publishers }))} target="mqtt:publishers" invalid={Boolean(itemErrors.get("mqtt:publishers"))} placeholder={directionGuide(draft.direction).publisherExample} onChange={(publishers) => updateDraft({ ...draft, publishers })} />
                          </Field>
                          <Field label="수신 주체" hint="이 Topic을 구독(Subscribe)해 메시지를 받는 쪽입니다." error={itemErrors.get("mqtt:subscribers")}>
                            <TagInput values={draft.subscribers} text={actorText.subscribers} onTextChange={(subscribers) => setActorText((current) => ({ ...current, subscribers }))} target="mqtt:subscribers" invalid={Boolean(itemErrors.get("mqtt:subscribers"))} placeholder={directionGuide(draft.direction).subscriberExample} onChange={(subscribers) => updateDraft({ ...draft, subscribers })} />
                          </Field>
                          <Field label="대응 Topic" hint="요청-응답처럼 짝을 이루는 Topic이 있으면 고릅니다." error={itemErrors.get("mqtt:related")}>
                            <select data-issue="mqtt:related" value={draft.relatedItemUid} onChange={(event) => updateDraft({ ...draft, relatedItemUid: event.target.value })}>
                              <option value="">없음</option>
                              {items.filter((item) => item.itemUid !== draftFor).map((item) => <option key={item.itemUid} value={item.itemUid}>{item.payload.topic || item.name}</option>)}
                            </select>
                          </Field>
                          <Field label="상태">
                            <select value={draft.status} onChange={(event) => updateDraft({ ...draft, status: event.target.value as MqttDraft["status"] })}>
                              <option value="ACTIVE">사용 중 (ACTIVE)</option>
                              <option value="DEPRECATED">사용 중단 (DEPRECATED)</option>
                            </select>
                          </Field>
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
                        <dl className="rest-facts mqtt-facts">
                          <div className="wide"><dt>Topic 경로</dt><dd><code>{view.topic}</code> <button type="button" className="copy-chip" aria-label="Topic 경로 복사" onClick={() => void copyText(view.topic.trim(), "Topic 경로")}>복사</button></dd></div>
                          <div><dt>이름</dt><dd>{view.name}</dd></div>
                          <div><dt>상태</dt><dd>{view.status === "DEPRECATED" ? "사용 중단 (DEPRECATED)" : "사용 중 (ACTIVE)"}</dd></div>
                          <div><dt>방향</dt><dd>{directionText(view.direction)}</dd></div>
                          <div><dt>권장 QoS</dt><dd>{qos?.label ?? view.qos}</dd></div>
                          <div><dt>Retain</dt><dd>{view.retain ? "사용 (마지막 메시지 보관)" : "미사용"}</dd></div>
                          <div className="wide"><dt>요약</dt><dd>{view.summary || <em>미설정</em>}</dd></div>
                          <div className="wide"><dt>용도/설명</dt><dd className="rest-desc">{view.purpose || <em>미설정</em>}</dd></div>
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">메시지 주체</h3>
                        <dl className="rest-facts">
                          <div><dt>발행 주체</dt><dd>{view.publishers.length ? <ChipList values={view.publishers} /> : <em>미설정</em>}</dd></div>
                          <div><dt>수신 주체</dt><dd>{view.subscribers.length ? <ChipList values={view.subscribers} /> : <em>미설정</em>}</dd></div>
                        </dl>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">Payload 구조</h3>
                        <SchemaTable fields={view.payload.fields} readOnly emptyText="정의된 Payload 필드가 없습니다. 본문이 없는 Topic이거나 아직 작성하지 않았습니다." />
                      </section>
                      <section className="rest-card rest-read" id="mqtt-json">
                        <h3 className="mqtt-read-title">
                          JSON 예시 <small>{view.payload.exampleMode === "MANUAL" ? "직접 입력" : "필드 예시로 자동 생성"}</small>
                          <button type="button" className="copy-chip" onClick={() => void copyText(preview?.text || "{}", "JSON 예시")}>JSON 복사</button>
                        </h3>
                        {preview?.problem ? <p className="banner warning">{preview.problem}</p> : null}
                        {view.payload.fields.length === 0 && view.payload.exampleMode !== "MANUAL" ? <p className="rest-card-note">Payload 필드가 정의되지 않아 예시가 빈 객체({"{}"})입니다. 편집에서 'Payload 구조'에 필드를 추가하면 예시가 만들어집니다.</p> : null}
                        <div className="mqtt-json-block"><JsonBlock text={preview?.text || "{}"} /></div>
                      </section>
                      <section className="rest-card rest-read">
                        <h3 className="mqtt-read-title">대응 Topic과 상태</h3>
                        <dl className="rest-facts">
                          <div>
                            <dt>대응 Topic</dt>
                            <dd>{related ? <button type="button" className="link-button no-gap" onClick={() => openTopic(related.itemUid)}>{related.payload.topic || related.name}</button> : view.relatedItemUid ? <em>삭제된 Topic</em> : <em>없음</em>}</dd>
                          </div>
                          <div><dt>상태</dt><dd>{view.status === "DEPRECATED" ? "사용 중단 (DEPRECATED)" : "사용 중 (ACTIVE)"}</dd></div>
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
                    {preview?.problem ? <p>{preview.problem}</p> : null}
                    {draft.payload.fields.length === 0 && draft.payload.exampleMode === "AUTO" ? <p>Payload 필드가 없어 빈 객체가 만들어집니다.</p> : null}
                    {draft.payload.exampleMode === "MANUAL" ? (
                      <textarea aria-label="직접 입력 JSON" data-issue="mqtt:manual" value={draft.payload.manualText} onChange={(event) => applyExample({ ...draft.payload, manualText: event.target.value })} />
                    ) : (
                      <JsonBlock text={preview?.text || "{}"} />
                    )}
                  </aside>
                ) : null}
              </div>

              {confirmDelete ? (
                <div className="modal-backdrop">
                  <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeItem(); }}>
                    <h2>Topic 삭제</h2>
                    <p>이 Topic만 삭제합니다. 문서와 다른 Topic은 남습니다.</p>
                    <label>변경 사유<input value={deleteReason} placeholder="예: 사용하지 않는 Topic 정리" onChange={(event) => setDeleteReason(event.target.value)} /></label>
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
                  {conflict.notes.length > 0 ? <ul>{conflict.notes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>다른 Topic 변경은 없습니다.</p>}
                  <div className="compare-grid">
                    <div><h4>내 입력</h4><pre>{draft ? `${draft.direction} ${draft.topic}\n${previewText(draft.payload).text}` : ""}</pre></div>
                    <div><h4>서버 최신</h4><pre>{conflict.latest ? `${conflict.latest.payload.direction ?? ""} ${conflict.latest.payload.topic ?? ""}\n${JSON.stringify(conflict.latest.payload.example ?? {}, null, 2)}` : "서버에 이 Topic이 없습니다."}</pre></div>
                  </div>
                  <button type="button" className="btn primary" disabled={saving} onClick={() => void saveWithLatest()}>{conflict.latest ? "이 Topic을 최신 버전 기준으로 저장" : "새 Topic으로 저장"}</button>
                </section>
              ) : null}
            </form>
          ) : <p className="state-panel">Topic을 불러오는 중입니다.</p>}
        </section>
      </div>
    );
  }

  return (
    <main className="studio rest-studio mqtt-studio">
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

function ChipList({ values }: { values: string[] }) {
  return <ul className="tag-chips is-read">{values.map((value) => <li key={value}><span>{value}</span></li>)}</ul>;
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

function overviewFrom(document: SpecDocument): MqttOverviewDraft {
  return {
    title: document.title,
    brokerUrl: document.overview.brokerUrl ?? "",
    protocolVersion: document.overview.protocolVersion ?? "",
    authType: document.overview.auth?.type ?? "NONE",
    authDescription: document.overview.auth?.description ?? "",
    changeReason: "",
  };
}

function overviewSignature(overview: MqttOverviewDraft) {
  return {
    title: overview.title.trim(),
    brokerUrl: overview.brokerUrl.trim(),
    protocolVersion: overview.protocolVersion.trim(),
    authType: overview.authType,
    authDescription: overview.authDescription.trim(),
  };
}
