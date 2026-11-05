import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiRequest, type ApiError } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import type { ProjectSummary } from "../projectTypes";
import { usePageChrome } from "../Shell";

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

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>프로젝트</h1>
        </div>
      </div>
      <div className="list-tools">
        <div className="search-field">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="프로젝트명 검색..."
            aria-label="프로젝트명 검색"
          />
          {query ? <button type="button" className="search-clear" onClick={() => setQuery("")}>지우기</button> : null}
        </div>
        <Link className="btn primary" to="/projects/new">프로젝트 생성</Link>
      </div>
      {message ? <p className="banner danger">{message}</p> : null}
      {projects === null && !message ? <p className="state-panel">불러오는 중입니다.</p> : null}
      {projects !== null && projects.length === 0 ? <p className="state-panel">등록된 프로젝트가 없습니다.</p> : null}
      {visible !== null && projects !== null && projects.length > 0 && visible.length === 0 ? <p className="state-panel">검색 결과가 없습니다.</p> : null}
      {visible !== null && visible.length > 0 ? (
        <div className="table-wrap">
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
                    <td>{project.title}</td>
                    <td><span className={project.status === "ARCHIVED" ? "badge" : "badge success"}>{project.status === "ARCHIVED" ? "보관" : "활성"}</span></td>
                    <td>{project.createdBy.name}</td>
                    <td>{formatWhen(project.createdAt)}</td>
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
      navigate(`/projects/${created.id}`);
    } catch (error) {
      setMessage(authErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>프로젝트 생성</h1>
          <p className="lede">공식 규격을 함께 관리할 프로젝트를 등록합니다.</p>
        </div>
      </div>
      <form className="card" onSubmit={onSubmit}>
        <label>
          프로젝트명
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <label>
          설명
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </label>
        {message ? <p className="banner danger">{message}</p> : null}
        <div className="form-actions">
          <button type="submit" disabled={submitting}>{submitting ? "생성 중" : "생성"}</button>
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
