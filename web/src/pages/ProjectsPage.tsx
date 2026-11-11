import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiRequest, type ApiError } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import type { ProjectSummary } from "../projectTypes";
import { usePageChrome } from "../Shell";
import { useToast } from "../toast";

export function ProjectsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  usePageChrome("", []);
  const visible = useMemo(() => filterProjects(projects, query), [projects, query]);

  useEffect(() => {
    if (!auth.token) {
      return;
    }
    apiRequest<{ projects: ProjectSummary[] }>("/api/projects", { token: auth.token })
      .then((result) => setProjects(result.projects))
      .catch((error: ApiError) => setMessage(authErrorMessage(error)));
  }, [auth.token]);

  if (!auth.ready) {
    return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }

  const total = projects?.length ?? 0;
  const archived = projects?.filter((project) => project.status === "ARCHIVED").length ?? 0;
  const openable = projects?.filter((project) => project.myPermission !== "NONE").length ?? 0;

  return (
    <main className="page projects-page">
      <div className="page-head">
        <div>
          <h1>프로젝트</h1>
          <p className="lede">프로젝트별 인터페이스 규격과 문서를 관리합니다. 행을 선택하면 프로젝트로 이동합니다.</p>
          {projects !== null && total > 0 ? (
            <p className="page-meta">
              <span>전체 {total}개</span>
              <span>활성 {total - archived}</span>
              {archived > 0 ? <span>보관 {archived}</span> : null}
              {openable < total ? <span>접근 가능 {openable}</span> : null}
            </p>
          ) : null}
        </div>
        {total > 0 ? <Link className="btn primary" to="/projects/new">+ 프로젝트 생성</Link> : null}
      </div>
      {message ? <p className="banner danger">{message}</p> : null}
      {projects === null && !message ? <p className="state-panel">불러오는 중입니다.</p> : null}
      {projects !== null && total === 0 ? (
        <div className="empty-panel">
          <h2>아직 프로젝트가 없습니다.</h2>
          <p>프로젝트를 만들면 REST API, MQTT, WebSocket, 장비 프로토콜 규격과 문서를 한곳에서 관리할 수 있습니다.</p>
          <Link className="btn primary" to="/projects/new">+ 첫 프로젝트 생성</Link>
        </div>
      ) : null}
      {projects !== null && total > 0 ? (
        <div className="list-tools">
          <div className="search-field">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트명 검색"
              aria-label="프로젝트명 검색"
            />
            {query ? <button type="button" className="search-clear" onClick={() => setQuery("")}>지우기</button> : null}
          </div>
          {query.trim() && visible ? <span className="list-count">{visible.length} / {total}개</span> : null}
        </div>
      ) : null}
      {visible !== null && total > 0 && visible.length === 0 ? (
        <div className="empty-panel is-compact">
          <p>'{query.trim()}'와 일치하는 프로젝트가 없습니다.</p>
          <button type="button" className="btn" onClick={() => setQuery("")}>검색어 지우기</button>
        </div>
      ) : null}
      {visible !== null && visible.length > 0 ? (
        <div className="table-wrap project-table">
          <table>
            <thead>
              <tr>
                <th>프로젝트명</th>
                <th>상태</th>
                <th>생성자</th>
                <th>생성일</th>
                <th>내 권한</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((project) => {
                const canOpen = project.myPermission !== "NONE";
                const permission = listPermission(project.myPermission, auth.user?.role ?? "");
                return (
                  <tr
                    key={project.id}
                    className={canOpen ? "is-link" : "is-locked"}
                    tabIndex={canOpen ? 0 : undefined}
                    role={canOpen ? "link" : undefined}
                    title={canOpen ? undefined : "프로젝트 접근 권한이 없습니다."}
                    aria-label={canOpen ? `${project.title} 상세로 이동` : `${project.title}, 프로젝트 접근 권한이 없습니다.`}
                    aria-disabled={canOpen ? undefined : true}
                    onClick={(event) => openProject(event, canOpen, () => navigate(`/projects/${project.id}`))}
                    onKeyDown={(event) => {
                      if (!canOpen || (event.key !== "Enter" && event.key !== " ")) {
                        return;
                      }
                      event.preventDefault();
                      navigate(`/projects/${project.id}`);
                    }}
                  >
                    <td className="project-cell"><strong>{project.title}</strong></td>
                    <td><span className={project.status === "ARCHIVED" ? "badge status-badge" : "badge status-badge success"}>{project.status === "ARCHIVED" ? "보관" : "활성"}</span></td>
                    <td className="nowrap">{project.createdBy.name}</td>
                    <td className="nowrap muted">{formatWhen(project.createdAt)}</td>
                    <td><span className={`badge ${permission.tone}`}>{permission.text}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

export function ProjectNewPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  usePageChrome("프로젝트 생성", [{ label: "프로젝트", to: "/projects" }, { label: "생성" }]);

  if (!auth.ready) {
    return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!auth.token) {
      return;
    }
    setMessage("");
    setSubmitting(true);
    try {
      const created = await apiRequest<{ id: number }>("/api/projects", {
        method: "POST",
        token: auth.token,
        body: { title, description },
      });
      toast.success("프로젝트를 만들었습니다.");
      navigate(`/projects/${created.id}`);
    } catch (error) {
      setMessage(authErrorMessage(error));
      toast.error(`프로젝트를 만들지 못했습니다. ${authErrorMessage(error)}`);
      setSubmitting(false);
    }
  }

  return (
    <main className="page form-page">
      <div className="page-head">
        <div>
          <h1>프로젝트 생성</h1>
          <p className="lede">공식 규격을 함께 관리할 프로젝트를 등록합니다. 생성한 사람은 프로젝트를 관리하고 멤버를 초대할 수 있습니다.</p>
        </div>
      </div>
      <form className="card form-card" onSubmit={onSubmit}>
        <label>
          <span className="field-label">프로젝트명 <b className="req-mark" aria-hidden="true">*</b><span className="sr-only">(필수)</span></span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="예: 스마트 도어락 2.0" autoFocus />
          <span className="field-hint">목록과 문서 제목에 표시됩니다. 200자까지 입력할 수 있습니다.</span>
        </label>
        <label>
          <span className="field-label">설명 <span className="field-optional">선택</span></span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="프로젝트의 목적, 대상 장비나 서비스 등을 간단히 적어 주세요." />
        </label>
        {message ? <p className="banner danger" role="alert">{message}</p> : null}
        <div className="form-actions form-footer">
          <Link className="btn" to="/projects">취소</Link>
          <button type="submit" className="btn primary" disabled={submitting || !title.trim()}>{submitting ? "생성 중…" : "프로젝트 생성"}</button>
        </div>
      </form>
    </main>
  );
}

function listPermission(permission: string, role: string) {
  if (role === "MASTER") {
    return { text: "전체 관리", tone: "perm-master" };
  }
  if (permission === "WRITE") {
    return { text: "편집 가능", tone: "perm-write" };
  }
  if (permission === "READ") {
    return { text: "조회 가능", tone: "perm-read" };
  }
  return { text: "접근 권한 없음", tone: "perm-none" };
}

function filterProjects(projects: ProjectSummary[] | null, query: string) {
  if (!projects) {
    return null;
  }
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  if (!needle) {
    return projects;
  }
  return projects.filter((project) => {
    const title = project.title.toLocaleLowerCase("ko-KR");
    const description = (project.description ?? "").toLocaleLowerCase("ko-KR");
    return title.includes(needle) || description.includes(needle);
  });
}

function openProject(event: { target: EventTarget | null }, canOpen: boolean, go: () => void) {
  if (!canOpen) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest("a, button, input, select, textarea")) {
    return;
  }
  go();
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
