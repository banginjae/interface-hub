import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { MarkdownView } from "../docs/MarkdownView";
import { markdownFilename, parseMarkdown, unsupportedImages } from "../docs/markdownDoc";
import { notifySpecChanged } from "../project/ProjectNav";
import type { ProjectDetail } from "../projectTypes";
import { useNavGuard, usePageChrome } from "../Shell";
import { reasonProblem } from "../spec/restValidation";
import { noChangeMessage, sameValue } from "../spec/saveCompare";
import { Field, formatDate } from "../spec/workspaceUi";
import { useToast } from "../toast";

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

type Draft = { title: string; content: string; changeReason: string; importedFrom: string };
type Revision = { version: number; changeReason: string; actor: Person; createdAt: string; summary: { op?: string; title?: string } };
type CompareBody = { title: string; department: string; content: string };
type CompareResult = { fromVersion: number; toVersion: number; before: CompareBody; after: CompareBody };
type Conflict = { current: number; latest: DocDetail | null };
type EditMode = "write" | "preview" | "split";

const contentLimit = 200_000;
const titleLimit = 200;
const fileSizeLimit = 2 * 1024 * 1024;
const emptyDraft: Draft = { title: "", content: "", changeReason: "", importedFrom: "" };

function draftKey(projectId: string, target: string, version: number) {
  return target === "new" ? `draft:general:new:${projectId}` : `draft:general:${target}:${version}`;
}

function docBody(doc: { title: string; content: string }) {
  return { title: doc.title.trim(), content: doc.content };
}

function charCount(text: string) {
  return Array.from(text).length;
}

function operationLabel(op?: string) {
  if (op === "CREATE_DOCUMENT") return "문서 생성";
  if (op === "UPDATE_DOCUMENT") return "문서 수정";
  if (op === "DELETE_DOCUMENT") return "문서 삭제";
  return op || "변경";
}

function useWideScreen(query: string) {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return wide;
}

export function DocsPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [rows, setRows] = useState<DocSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [detailMissing, setDetailMissing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<{ title: string; content: string } | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [baseDepartment, setBaseDepartment] = useState("");
  const [restored, setRestored] = useState(false);
  const [mode, setMode] = useState<EditMode>("write");
  const [attempted, setAttempted] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reasonError, setReasonError] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [imageNote, setImageNote] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [compareRaw, setCompareRaw] = useState(false);
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const wide = useWideScreen("(min-width: 1700px)");

  const itemParam = searchParams.get("item");
  const editParam = searchParams.get("mode") === "edit";
  const historyView = searchParams.get("view") === "history";
  const canEdit = Boolean(project && project.status === "ACTIVE" && (auth.user?.role === "MASTER" || project.myPermission === "WRITE"));
  const isNew = itemParam === "new";
  const activeId = itemParam && !isNew ? Number(itemParam) : !itemParam && rows.length > 0 ? rows[0].id : null;
  const activeRow = rows.find((row) => row.id === activeId) ?? null;
  const editTarget = canEdit && (isNew ? "new" : itemParam && editParam ? itemParam : null);
  const writer = Boolean(editTarget && draft && draftFor === editTarget);
  const dirty = Boolean(draft && draftFor) && (draftFor === "new"
    ? Boolean(draft?.title.trim() || draft?.content.trim())
    : !baseline || !sameValue(docBody(draft as Draft), baseline));
  const previewSource = useDeferredValue(draft?.content ?? "");

  usePageChrome(project ? `${project.title} 일반 문서` : "일반 문서", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "프로젝트", to: project ? `/projects/${project.id}` : "/projects" },
    { label: "일반 문서" },
  ]);
  useNavGuard(() => guard(), dirty);

  async function loadList(token: string) {
    const result = await apiRequest<{ documents: DocSummary[] }>(`/api/projects/${projectId}/general-docs`, { token });
    const list = result.documents ?? [];
    setRows(list);
    return list;
  }

  async function fetchDetail(id: number) {
    return apiRequest<DocDetail>(`/api/projects/${projectId}/general-docs/${id}`, { token: auth.token as string });
  }

  useEffect(() => {
    if (!auth.token || !projectId) return;
    let cancel = false;
    apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token: auth.token })
      .then((next) => {
        if (cancel) return undefined;
        setProject(next);
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
    if (!auth.token || activeId === null) {
      setDetail(null);
      setDetailMissing(false);
      return;
    }
    let cancel = false;
    setDetailMissing(false);
    fetchDetail(activeId)
      .then((next) => { if (!cancel) setDetail(next); })
      .catch((error: unknown) => {
        if (cancel) return;
        setDetail(null);
        if (error instanceof ApiError && error.status === 404) setDetailMissing(true);
        else setNotice(authErrorMessage(error));
      });
    return () => { cancel = true; };
  }, [auth.token, projectId, activeId, activeRow?.version]);

  useEffect(() => {
    if (!loaded) return;
    if (!editTarget) {
      if (draftFor !== null) dropDraft();
      return;
    }
    if (draftFor === editTarget) return;
    if (editTarget !== "new" && (!detail || String(detail.id) !== editTarget)) return;
    const version = editTarget === "new" ? 0 : (detail as DocDetail).version;
    let next: Draft = editTarget === "new" ? emptyDraft : { ...emptyDraft, title: (detail as DocDetail).title, content: (detail as DocDetail).content };
    let wasRestored = false;
    const stored = sessionStorage.getItem(draftKey(projectId, editTarget, version));
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<Draft>;
        next = { ...next, title: parsed.title ?? next.title, content: parsed.content ?? next.content, importedFrom: parsed.importedFrom ?? "" };
        wasRestored = true;
      } catch {
        sessionStorage.removeItem(draftKey(projectId, editTarget, version));
      }
    }
    setDraft(next);
    setDraftFor(editTarget);
    setBaseline(editTarget === "new" ? null : docBody(detail as DocDetail));
    setBaseVersion(version);
    setBaseDepartment(editTarget === "new" ? "" : (detail as DocDetail).department ?? "");
    setRestored(wasRestored);
    setMode("write");
    setAttempted(false);
    setSaveOpen(false);
    setReasonError("");
    setConflict(null);
    setShowLatest(false);
    setImageNote([]);
  }, [loaded, editTarget, draftFor, detail]);

  useEffect(() => {
    if (!draft || !draftFor) return;
    const key = draftKey(projectId, draftFor, baseVersion);
    if (!dirty) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify({ title: draft.title, content: draft.content, importedFrom: draft.importedFrom }));
  }, [draft, draftFor, dirty, baseVersion, projectId]);

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
    setConfirmDelete(false);
    setDeleteReason("");
    setCompare(null);
  }, [itemParam]);

  useEffect(() => {
    if (!historyView || !auth.token || activeId === null) return;
    let cancel = false;
    apiRequest<{ revisions: Revision[] }>(`/api/projects/${projectId}/general-docs/${activeId}/revisions`, { token: auth.token })
      .then((result) => {
        if (cancel) return;
        const list = result.revisions ?? [];
        setRevisions(list);
        setFromVersion(list[1] ? String(list[1].version) : "");
        setToVersion(list[0] ? String(list[0].version) : "");
      })
      .catch((error: unknown) => { if (!cancel) toast.error(`변경 이력을 불러오지 못했습니다. ${authErrorMessage(error)}`); });
    return () => { cancel = true; };
  }, [historyView, auth.token, projectId, activeId, activeRow?.version]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.title} ${row.updatedBy.name}`.toLowerCase().includes(needle));
  }, [rows, query]);

  if (!auth.ready) return <main className="spec-screen"><p className="state-panel">확인 중입니다.</p></main>;
  if (!auth.user) return <Navigate to="/login" replace />;
  if (denied) {
    return (
      <main className="spec-screen">
        <p className="banner warning">이 프로젝트의 일반 문서를 볼 권한이 없습니다.</p>
        <Link to="/projects">프로젝트 목록</Link>
      </main>
    );
  }
  if (!project || !loaded) return <main className="spec-screen"><p className="state-panel">{notice || "불러오는 중입니다."}</p></main>;

  function go(next: { item?: string | null; mode?: "edit" | null; view?: "history" | null }) {
    const search = new URLSearchParams();
    if (next.item) search.set("item", next.item);
    if (next.mode) search.set("mode", next.mode);
    if (next.view) search.set("view", next.view);
    setNotice("");
    setSearchParams(search);
  }

  function guard() {
    return !dirty || window.confirm("저장하지 않은 문서 변경이 있습니다. 이동해도 내용은 이 브라우저에 임시 초안으로 남고, 다시 편집하면 불러옵니다.");
  }

  function dropDraft() {
    setDraft(null);
    setDraftFor(null);
    setBaseline(null);
    setRestored(false);
    setAttempted(false);
    setSaveOpen(false);
    setReasonError("");
    setConflict(null);
    setImageNote([]);
  }

  function openDoc(id: number) {
    if (String(id) === draftFor) {
      go({ item: String(id), mode: "edit" });
      return;
    }
    if (draftFor && !guard()) return;
    go({ item: String(id) });
  }

  function beginNew() {
    if (!canEdit) return;
    if (draftFor === "new") {
      go({ item: "new" });
      return;
    }
    if (draftFor && !guard()) return;
    go({ item: "new" });
  }

  function cancelEdit() {
    if (dirty && !window.confirm("저장하지 않은 변경을 버리고 조회 화면으로 돌아갈까요?")) return;
    const target = draftFor;
    if (target) sessionStorage.removeItem(draftKey(projectId, target, baseVersion));
    dropDraft();
    go(target && target !== "new" ? { item: target } : {});
  }

  function update(next: Draft) {
    setDraft(next);
  }

  function validation(next: Draft) {
    const title = next.title.trim();
    const titleError = !title ? "제목을 입력하세요." : charCount(title) > titleLimit ? `제목은 ${titleLimit}자까지 입력할 수 있습니다.` : "";
    const size = charCount(next.content);
    const contentError = !next.content.trim() ? "본문을 입력하거나 .md 파일을 가져오세요." : size > contentLimit ? `본문은 ${contentLimit.toLocaleString()}자까지 저장할 수 있습니다. 현재 ${size.toLocaleString()}자입니다.` : "";
    return { titleError, contentError };
  }

  function focusField(name: "title" | "content") {
    if (name === "content" && mode === "preview") setMode("write");
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-issue="doc:${name}"]`)?.focus());
  }

  function startSave() {
    if (!draft || !draftFor || (draftFor !== "new" && !dirty)) return;
    const found = validation(draft);
    if (found.titleError || found.contentError) {
      setAttempted(true);
      setSaveOpen(false);
      focusField(found.titleError ? "title" : "content");
      toast.error(`저장하지 못했습니다. ${found.titleError || found.contentError}`);
      return;
    }
    setAttempted(false);
    if (draftFor === "new") {
      void save();
      return;
    }
    setReasonError("");
    setSaveOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-issue="doc:reason"]')?.focus());
  }

  async function save(version = baseVersion, retry = false) {
    if (!auth.token || !draft || !draftFor || saving) return;
    const create = draftFor === "new";
    if (!create && !dirty && !retry) return;
    const found = validation(draft);
    if (found.titleError || found.contentError) {
      setAttempted(true);
      setSaveOpen(false);
      return;
    }
    const title = draft.title.trim();
    const reason = create
      ? (draft.importedFrom ? `Markdown 파일 가져오기: ${draft.importedFrom}` : `문서 추가: ${title}`).slice(0, 500)
      : draft.changeReason.trim();
    if (!create) {
      const problem = reasonProblem(draft.changeReason);
      setReasonError(problem ?? "");
      if (problem) {
        setSaveOpen(true);
        return;
      }
    }
    setSaving(true);
    const body = { title, department: create ? "" : baseDepartment, content: draft.content, changeReason: reason, version: create ? 0 : version };
    try {
      let id: number;
      let next: number;
      if (create) {
        const result = await apiRequest<{ id: number; version: number }>(`/api/projects/${projectId}/general-docs`, { method: "POST", token: auth.token, body });
        id = result.id;
        next = result.version;
      } else {
        const result = await apiRequest<{ version: number }>(`/api/projects/${projectId}/general-docs/${draftFor}`, { method: "PUT", token: auth.token, body });
        id = Number(draftFor);
        next = result.version;
      }
      sessionStorage.removeItem(draftKey(projectId, draftFor, baseVersion));
      dropDraft();
      go({ item: String(id) });
      await loadList(auth.token);
      notifySpecChanged();
      if (create) toast.success(`문서를 등록했습니다 · Version ${next}`);
      else if (next === version) toast.info(noChangeMessage);
      else toast.success(`문서를 저장했습니다 · Version ${next}`);
    } catch (error: unknown) {
      setSaveOpen(false);
      if (error instanceof ApiError && error.code === "GENERAL_DOC_VERSION_CONFLICT" && !create) {
        let latest: DocDetail | null = null;
        try {
          latest = await fetchDetail(Number(draftFor));
        } catch {
          latest = null;
        }
        setConflict({ current: error.currentVersion ?? latest?.version ?? version, latest });
        setShowLatest(false);
        await loadList(auth.token).catch(() => undefined);
        toast.error("다른 사용자가 먼저 저장했습니다. 입력한 내용은 그대로 남아 있습니다.");
      } else if (error instanceof ApiError && error.status === 404 && !create) {
        toast.error("이 문서는 이미 삭제되었습니다. 입력한 내용은 화면에 남아 있으니 필요하면 복사해 새 문서로 등록하세요.");
      } else {
        toast.error(`저장하지 못했습니다. ${authErrorMessage(error)} 입력한 내용은 그대로 남아 있습니다.`);
      }
    } finally {
      setSaving(false);
    }
  }

  function resave() {
    if (!conflict) return;
    if (!window.confirm("다시 저장하면 다른 사용자가 바꾼 내용을 내 내용으로 덮어씁니다. 계속할까요?")) return;
    const version = conflict.current;
    setConflict(null);
    setBaseVersion(version);
    if (!draft?.changeReason.trim()) {
      setSaveOpen(true);
      setReasonError("변경 사유를 입력한 뒤 다시 저장을 누르세요.");
      return;
    }
    void save(version, true);
  }

  async function importFile(file: File | undefined) {
    if (!file || !draft) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      toast.error(".md 또는 .markdown 파일만 가져올 수 있습니다.");
      return;
    }
    if (file.size > fileSizeLimit) {
      toast.error("파일이 너무 큽니다. 2MB 이하의 Markdown 파일만 가져올 수 있습니다.");
      return;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      toast.error("UTF-8로 읽을 수 없는 파일입니다. 편집기에서 UTF-8로 저장한 뒤 다시 가져오세요.");
      return;
    }
    text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (charCount(text) > contentLimit) {
      toast.error(`본문은 ${contentLimit.toLocaleString()}자까지 저장할 수 있습니다. 파일이 더 깁니다.`);
      return;
    }
    if (draft.content.trim() && !window.confirm(`현재 본문을 '${file.name}' 내용으로 바꿀까요? 지금 입력한 본문은 사라집니다.`)) return;
    const title = draft.title.trim() ? draft.title : file.name.replace(/\.(md|markdown)$/i, "").trim().slice(0, titleLimit);
    update({ ...draft, title, content: text, importedFrom: file.name });
    setImageNote(unsupportedImages(parseMarkdown(text)));
    setMode(wide ? "split" : "preview");
    toast.info(`'${file.name}'을(를) 가져왔습니다. 저장하기 전까지는 초안입니다.`);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragOver(false);
    void importFile(event.dataTransfer.files[0]);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragOver(true);
  }

  async function removeDocument() {
    if (!auth.token || !detail || !canEdit) return;
    const problem = reasonProblem(deleteReason);
    if (problem) {
      toast.error(`삭제하지 못했습니다. ${problem}`);
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/projects/${projectId}/general-docs/${detail.id}`, {
        method: "DELETE",
        token: auth.token,
        body: { version: detail.version, changeReason: deleteReason.trim() },
      });
      sessionStorage.removeItem(draftKey(projectId, String(detail.id), detail.version));
      setConfirmDelete(false);
      dropDraft();
      go({});
      await loadList(auth.token);
      notifySpecChanged();
      toast.success(`'${detail.title}' 문서를 삭제했습니다. 변경 이력은 남아 있습니다.`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === "GENERAL_DOC_VERSION_CONFLICT") {
        toast.error("다른 사용자가 먼저 수정해 삭제하지 않았습니다. 최신 내용을 확인해 주세요.");
      } else {
        toast.error(`삭제하지 못했습니다. ${authErrorMessage(error)}`);
      }
      await loadList(auth.token).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  async function downloadMarkdown() {
    if (!auth.token || activeId === null) return;
    try {
      const latest = await fetchDetail(activeId);
      const blob = new Blob([latest.content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = markdownFilename(latest.title);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${link.download} 파일로 내려받았습니다 · Version ${latest.version}`);
    } catch (error: unknown) {
      toast.error(`내려받지 못했습니다. ${authErrorMessage(error)}`);
    }
  }

  async function runCompare() {
    if (!auth.token || activeId === null || !fromVersion || !toVersion) return;
    setCompare(null);
    try {
      setCompare(await apiRequest<CompareResult>(`/api/projects/${projectId}/general-docs/${activeId}/revisions/compare?from=${fromVersion}&to=${toVersion}`, { token: auth.token }));
    } catch (error: unknown) {
      toast.error(`비교하지 못했습니다. ${authErrorMessage(error)}`);
    }
  }

  const errors = draft && attempted ? validation(draft) : { titleError: "", contentError: "" };
  const crumbTail = isNew ? "새 문서" : itemParam ? detail?.title ?? activeRow?.title ?? "" : null;
  const readOnlyNote = !canEdit ? (project.status !== "ACTIVE" ? "보관된 프로젝트는 조회만 할 수 있습니다." : "조회 권한입니다. 문서를 보고 내려받을 수만 있습니다.") : "";

  const header = (
    <header className="rest-doc-head">
      <nav className="rest-crumbs" aria-label="현재 위치">
        <Link to={`/projects/${project.id}`} onClick={(event) => { if (!guard()) event.preventDefault(); }}>{project.title}</Link>
        <span aria-hidden="true">/</span>
        {crumbTail !== null ? <button type="button" className="crumb-link" onClick={() => { if (!draftFor || guard()) go({}); }}>일반 문서</button> : <strong>일반 문서</strong>}
        {crumbTail ? <><span aria-hidden="true">/</span><strong className="crumb-current doc-crumb">{crumbTail}</strong></> : null}
      </nav>
      <div className="rest-doc-row">
        <div className="rest-doc-title">
          <h1>일반 문서</h1>
          <p className="rest-doc-meta">
            <span>문서 {rows.length}개</span>
            <span>Markdown 원문으로 저장 · 직접 작성하거나 .md 파일을 가져와 등록</span>
          </p>
        </div>
      </div>
    </header>
  );

  const newRow = draftFor === "new" && draft ? (
    <li key="new">
      <button type="button" className={isNew ? "ep-row doc-row is-current" : "ep-row doc-row"} onClick={() => go({ item: "new" })}>
        <span className="ep-main"><strong className="doc-row-title">{draft.title.trim() || "제목 없는 새 문서"}</strong><span className="ep-name">작성 중인 초안</span></span>
        <span className="ep-tag is-draft">작성 중</span>
      </button>
    </li>
  ) : null;

  function docRow(row: DocSummary) {
    const current = row.id === activeId && !isNew;
    return (
      <li key={row.id}>
        <button type="button" className={current ? "ep-row doc-row is-current" : "ep-row doc-row"} aria-current={current ? "true" : undefined} onClick={() => openDoc(row.id)}>
          <span className="ep-main">
            <strong className="doc-row-title">{row.title}</strong>
            <span className="ep-name">{row.updatedBy.name} · {formatDate(row.updatedAt)}</span>
          </span>
          {String(row.id) === draftFor && dirty ? <span className="ep-tag is-draft">편집 중</span> : null}
        </button>
      </li>
    );
  }

  let body: ReactNode;
  if (rows.length === 0 && !isNew) {
    body = (
      <section className="rest-panel">
        {readOnlyNote ? <p className="banner rest-banner">{readOnlyNote}</p> : null}
        <div className="rest-empty-state doc-empty">
          <h2>아직 등록된 문서가 없습니다.</h2>
          <p>Markdown 문서를 직접 작성하거나 기존 .md 파일을 가져와 등록해 보세요.</p>
          {canEdit ? <button type="button" className="btn primary" onClick={beginNew}>+ 첫 문서 추가</button> : <p>조회 권한으로는 문서를 추가할 수 없습니다.</p>}
        </div>
      </section>
    );
  } else {
    let detailBody: ReactNode;
    if (isNew && !canEdit) {
      detailBody = (
        <div className="rest-empty-state">
          <h2>조회 권한으로는 문서를 추가할 수 없습니다.</h2>
          <p>목록에서 문서를 선택해 조회하세요.</p>
          <button type="button" className="btn" onClick={() => go({})}>문서 목록으로</button>
        </div>
      );
    } else if (writer && draft) {
      detailBody = editorView(draft);
    } else if (detailMissing) {
      detailBody = (
        <div className="rest-empty-state">
          <h2>문서를 찾을 수 없습니다.</h2>
          <p>삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택하세요.</p>
          <button type="button" className="btn" onClick={() => go({})}>문서 목록으로</button>
        </div>
      );
    } else if (detail && detail.id === activeId) {
      detailBody = historyView ? historyPanel(detail) : readerView(detail);
    } else {
      detailBody = <p className="state-panel">문서를 불러오는 중입니다.</p>;
    }
    body = (
      <div className="rest-split">
        <aside className="ep-pane" aria-label="문서 목록">
          <input className="ep-search" type="search" aria-label="문서 검색" placeholder="제목 또는 수정자로 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          {canEdit ? <button type="button" className="btn ep-pane-add" onClick={beginNew}>+ 문서 추가</button> : null}
          <ul className="ep-list is-compact">
            {newRow}
            {filtered.map(docRow)}
          </ul>
          {rows.length > 0 && filtered.length === 0 ? <p className="ep-empty">'{query.trim()}'와 일치하는 문서가 없습니다.</p> : null}
        </aside>
        <section className="rest-detail">{detailBody}</section>
      </div>
    );
  }

  function readerView(doc: DocDetail) {
    return (
      <div className="rest-editor">
        <header className="rest-bar">
          <div className="rest-bar-title">
            <p className="rest-kicker">일반 문서</p>
            <h2 className="doc-bar-title">{doc.title}</h2>
            <p className="mqtt-bar-meta">
              <span>작성 {doc.createdBy.name} · {formatDate(doc.createdAt)}</span>
              <span>최종 수정 {doc.updatedBy.name} · {formatDate(doc.updatedAt)}</span>
              <span>Version {doc.version}</span>
            </p>
          </div>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => go({ item: String(doc.id), view: "history" })}>변경 이력</button>
            <button type="button" className="btn" onClick={() => void downloadMarkdown()}>Markdown 다운로드</button>
            {canEdit ? <button type="button" className="btn primary" onClick={() => go({ item: String(doc.id), mode: "edit" })}>편집</button> : null}
          </div>
        </header>
        {readOnlyNote ? <p className="banner rest-banner">{readOnlyNote}</p> : null}
        <article className="doc-reader">
          {doc.content.trim() ? <MarkdownView source={doc.content} /> : <p className="doc-empty-body">본문이 비어 있습니다.</p>}
        </article>
      </div>
    );
  }

  function historyPanel(doc: DocDetail) {
    return (
      <div className="rest-editor">
        <header className="rest-bar">
          <div className="rest-bar-title">
            <p className="rest-kicker">변경 이력</p>
            <h2 className="doc-bar-title">{doc.title}</h2>
            <p className="mqtt-bar-meta"><span>현재 Version {doc.version}</span><span>이력 {revisions.length}건</span></p>
          </div>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => go({ item: String(doc.id) })}>문서로 돌아가기</button>
          </div>
        </header>
        <section className="rest-card rest-read">
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
                {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
              </select>
              <select aria-label="이후 버전" value={toVersion} onChange={(event) => setToVersion(event.target.value)}>
                {revisions.map((revision) => <option key={revision.version} value={revision.version}>Version {revision.version}</option>)}
              </select>
              <button type="button" className="btn" disabled={!fromVersion || !toVersion || fromVersion === toVersion} onClick={() => void runCompare()}>두 버전 비교</button>
            </div>
          ) : null}
        </section>
        {compare ? (
          <section className="rest-card rest-read">
            <div className="doc-compare-head">
              <h3 className="mqtt-read-title">Version {compare.fromVersion} → Version {compare.toVersion}</h3>
              <div className="seg-tabs" role="tablist" aria-label="비교 보기 방식">
                <button type="button" role="tab" aria-selected={!compareRaw} onClick={() => setCompareRaw(false)}>문서 보기</button>
                <button type="button" role="tab" aria-selected={compareRaw} onClick={() => setCompareRaw(true)}>Markdown 원문</button>
              </div>
            </div>
            {compare.before.title !== compare.after.title ? <p className="rest-card-note">제목 변경: {compare.before.title} → {compare.after.title}</p> : null}
            {compare.before.content === compare.after.content ? <p className="rest-card-note">본문은 두 버전이 같습니다.</p> : null}
            <div className="doc-compare">
              {[{ label: `Version ${compare.fromVersion}`, value: compare.before }, { label: `Version ${compare.toVersion}`, value: compare.after }].map((side) => (
                <div key={side.label}>
                  <h4>{side.label} · {side.value.title}</h4>
                  {compareRaw ? <pre className="doc-raw">{side.value.content}</pre> : <MarkdownView source={side.value.content} className="is-compact" />}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function editorView(current: Draft) {
    const tone = conflict ? "conflict" : attempted && (errors.titleError || errors.contentError) ? "error" : dirty ? "dirty" : "clean";
    const stateText = tone === "conflict" ? `충돌 · 서버 v${conflict?.current}` : tone === "error" ? "입력 확인 필요" : dirty ? (isNew ? "저장되지 않은 새 문서" : "저장되지 않은 변경") : isNew ? "새 문서" : `변경 없음 · v${baseVersion}`;
    const showPreview = mode !== "write";
    const showEditor = mode !== "preview";
    const size = charCount(current.content);
    return (
      <form className="rest-editor doc-editor" onSubmit={(event) => event.preventDefault()}>
        <header className="rest-bar">
          <div className="rest-bar-title">
            <p className="rest-kicker">{isNew ? "새 문서" : "문서 편집"}</p>
            <h2 className="doc-bar-title">{current.title.trim() || (isNew ? "제목 없는 새 문서" : "제목 없음")}</h2>
          </div>
          <div className="toolbar">
            <span className={`save-state is-${tone === "conflict" ? "error" : tone}`}>{stateText}</span>
            <button type="button" className="btn" aria-pressed={showPreview} onClick={() => setMode(showPreview ? "write" : wide ? "split" : "preview")}>{showPreview ? "미리보기 닫기" : "미리보기"}</button>
            {!isNew ? <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>삭제</button> : null}
            <button type="button" className="btn" disabled={saving} onClick={cancelEdit}>취소</button>
            <button type="button" className="btn primary" disabled={saving || Boolean(conflict) || (!isNew && !dirty)} title={!isNew && !dirty ? noChangeMessage : undefined} onClick={startSave}>{saving ? "저장 중" : isNew ? "문서 등록" : "문서 저장"}</button>
            {saveOpen && !isNew ? (
              <div className="save-pop" role="dialog" aria-label="변경 사유 입력">
                <Field label="변경 사유" required hint="이 문서의 변경 이력에 기록됩니다." error={reasonError}>
                  <input
                    data-issue="doc:reason"
                    aria-invalid={Boolean(reasonError)}
                    placeholder="예: 설치 순서 2단계 수정"
                    value={current.changeReason}
                    onChange={(event) => { setReasonError(""); update({ ...current, changeReason: event.target.value }); }}
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
        {restored ? (
          <p className="banner rest-banner">이 브라우저에 남아 있던 저장하지 않은 초안을 불러왔습니다.
            <button type="button" className="link-button" onClick={() => {
              sessionStorage.removeItem(draftKey(projectId, draftFor as string, baseVersion));
              update(isNew || !detail ? emptyDraft : { ...emptyDraft, title: detail.title, content: detail.content });
              setRestored(false);
              setImageNote([]);
            }}>{isNew ? "빈 양식으로 다시 시작" : "저장본으로 되돌리기"}</button>
          </p>
        ) : null}
        {conflict ? (
          <div className="banner rest-banner warning" role="alert">
            다른 사용자가 먼저 저장해 서버의 최신 버전이 {conflict.current}입니다. 내가 입력한 내용은 그대로 남아 있습니다.
            {conflict.latest ? <button type="button" className="link-button" onClick={() => setShowLatest((open) => !open)}>{showLatest ? "최신본 닫기" : "최신본 보기"}</button> : null}
            <button type="button" className="link-button" onClick={resave}>최신 버전 기준으로 다시 저장</button>
          </div>
        ) : null}
        {conflict && showLatest && conflict.latest ? (
          <section className="rest-card rest-read">
            <h3 className="mqtt-read-title">서버 최신본 · Version {conflict.latest.version} <small>{conflict.latest.updatedBy.name} · {formatDate(conflict.latest.updatedAt)}</small></h3>
            <MarkdownView source={conflict.latest.content} className="is-compact" />
          </section>
        ) : null}
        <section className="rest-card doc-form">
          <Field label="제목" required error={errors.titleError || undefined}>
            <input className="doc-title-input" data-issue="doc:title" aria-invalid={Boolean(errors.titleError)} placeholder="예: 게이트웨이 설치 가이드" value={current.title} maxLength={titleLimit + 50} onChange={(event) => update({ ...current, title: event.target.value })} />
          </Field>
          <div className="doc-tools">
            <div className="seg-tabs" role="tablist" aria-label="편집 보기 방식">
              <button type="button" role="tab" aria-selected={mode === "write"} onClick={() => setMode("write")}>작성</button>
              <button type="button" role="tab" aria-selected={mode === "preview"} onClick={() => setMode("preview")}>미리보기</button>
              {wide ? <button type="button" role="tab" aria-selected={mode === "split"} onClick={() => setMode("split")}>나란히 보기</button> : null}
            </div>
            <button type="button" className="btn doc-import" onClick={() => fileInput.current?.click()}>Markdown 파일 가져오기</button>
            <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
            <span className={size > contentLimit ? "doc-count is-over" : "doc-count"}>{size.toLocaleString()} / {contentLimit.toLocaleString()}자</span>
          </div>
          {current.importedFrom ? <p className="doc-note">가져온 파일: <strong>{current.importedFrom}</strong> · 파일은 따로 보관하지 않고 본문 텍스트로만 저장됩니다.</p> : null}
          {imageNote.length > 0 ? (
            <p className="doc-note is-warning">상대경로나 로컬 이미지 {imageNote.length}개는 서버에 올라가지 않아 표시되지 않습니다. 이미지가 필요하면 외부 https 주소로 바꿔 주세요. ({imageNote.slice(0, 3).join(", ")}{imageNote.length > 3 ? " 외" : ""})</p>
          ) : null}
          {errors.contentError ? <p className="field-error doc-body-error">오류: {errors.contentError}</p> : null}
          <div className={`doc-workspace is-${mode}${dragOver ? " is-drop" : ""}`} onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
            {showEditor ? (
              <div className="doc-pane">
                {isNew && !current.content ? (
                  <div className="doc-start">
                    <strong>기존 Markdown 파일이 있나요?</strong>
                    <span>.md 파일을 가져오면 제목과 본문이 채워집니다. 파일을 이 영역에 끌어다 놓아도 됩니다.</span>
                    <button type="button" className="btn primary" onClick={() => fileInput.current?.click()}>.md 파일 가져오기</button>
                    <span className="doc-start-or">또는 아래에 바로 작성하세요.</span>
                  </div>
                ) : null}
                <textarea
                  ref={bodyInput}
                  className="doc-source"
                  data-issue="doc:content"
                  aria-label="Markdown 본문"
                  aria-invalid={Boolean(errors.contentError)}
                  spellCheck={false}
                  placeholder={"# 제목\n\n본문을 Markdown 또는 일반 텍스트로 작성합니다.\n\n- 목록\n- [ ] 체크리스트\n\n```bash\n명령어\n```"}
                  value={current.content}
                  onChange={(event) => update({ ...current, content: event.target.value })}
                />
              </div>
            ) : null}
            {showPreview ? (
              <div className="doc-pane doc-preview" aria-label="미리보기">
                {previewSource.trim() ? <MarkdownView source={previewSource} /> : <p className="doc-empty-body">미리볼 내용이 없습니다. 본문을 작성하거나 .md 파일을 가져오세요.</p>}
              </div>
            ) : null}
            {dragOver ? <div className="doc-drop-hint">여기에 놓으면 .md 파일을 가져옵니다.</div> : null}
          </div>
        </section>
      </form>
    );
  }

  return (
    <main className="studio rest-studio mqtt-studio ec-studio doc-studio">
      <div className="studio-main">
        {header}
        {notice ? <p className="banner rest-banner danger">{notice}</p> : null}
        {body}
        {confirmDelete && detail ? (
          <div className="modal-backdrop">
            <form className="modal" onSubmit={(event) => { event.preventDefault(); void removeDocument(); }}>
              <h2>'{detail.title}' 삭제</h2>
              <p>목록에서 숨겨지고, 변경 이력은 남습니다.{dirty ? " 편집 중인 내용도 함께 버려집니다." : ""}</p>
              <label>변경 사유<input value={deleteReason} placeholder="예: 새 가이드로 대체" onChange={(event) => setDeleteReason(event.target.value)} /></label>
              <div className="form-actions">
                <button type="submit" className="danger" disabled={saving}>삭제 확인</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>취소</button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  );
}
