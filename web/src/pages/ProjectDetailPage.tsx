import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiRequest } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { MemberPicker, type MemberCandidate } from "../project/MemberPicker";
import { permissionLabel, type ProjectDetail, type ProjectMember } from "../projectTypes";
import { usePageChrome } from "../Shell";
import { useToast } from "../toast";

function projectError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "MEMBER_ALREADY_EXISTS":
        return "이미 이 프로젝트의 멤버입니다.";
      case "NOT_FOUND":
        return `${fallback} 대상을 찾을 수 없습니다. 화면을 새로고침해 주세요.`;
      case "PROJECT_VERSION_CONFLICT":
        return "다른 사용자가 먼저 저장했습니다. 최신 내용을 불러왔으니 다시 확인해 주세요.";
      case "FORBIDDEN":
        return `${fallback} 권한이 없습니다.`;
      case "INVALID_REQUEST":
        return `${fallback} 입력값을 확인해 주세요.`;
      default:
        return `${fallback} ${error.message}`;
    }
  }
  return `${fallback} ${authErrorMessage(error)}`;
}

export function ProjectDetailPage() {
  const auth = useAuth();
  const params = useParams();
  const projectId = params.id ?? "";
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [candidate, setCandidate] = useState<MemberCandidate | null>(null);
  const [permission, setPermission] = useState("READ");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = searchParams.get("panel");
  const location = useLocation();
  const [endpointCount, setEndpointCount] = useState<number | null>(null);
  const [endpoints, setEndpoints] = useState<ApiLink[]>([]);
  const [changes, setChanges] = useState<ChangeLink[]>([]);
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [commandCount, setCommandCount] = useState<number | null>(null);
  const [generalDocs, setGeneralDocs] = useState<GeneralDocSummary[] | null>(null);
  usePageChrome(project?.title ?? "프로젝트", [
    { label: "프로젝트", to: "/projects" },
    { label: project?.title ?? "상세" },
  ]);

  async function load(token: string) {
    const detail = await apiRequest<ProjectDetail>(`/api/projects/${projectId}`, { token });
    const memberResult = await apiRequest<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`, { token });
    setProject(detail);
    setTitle(detail.title);
    setDescription(detail.description);
    setMembers(memberResult.members);
  }

  useEffect(() => {
    if (!auth.token || !projectId) {
      return;
    }
    load(auth.token).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) {
        setDenied(true);
        return;
      }
      setMessage(authErrorMessage(error));
    });
  }, [auth.token, projectId]);

  useEffect(() => {
    if (!auth.token || !project) {
      return;
    }
    const api = project.specSummaries.find((item) => item.kind === "API");
    const mqtt = project.specSummaries.find((item) => item.kind === "MQTT");
    const socket = project.specSummaries.find((item) => item.kind === "WEBSOCKET");
    const device = project.specSummaries.find((item) => item.kind === "DEVICE_PROTOCOL");
    if (!api?.exists) setEndpointCount(null);
    if (!mqtt?.exists) setTopicCount(null);
    if (!socket?.exists) setMessageCount(null);
    if (!device?.exists) setCommandCount(null);
    let cancel = false;
    if (api?.exists && auth.token) {
      apiRequest<{ items?: ApiLink[] }>(`/api/projects/${project.id}/specs/API`, { token: auth.token })
        .then((document) => {
          if (cancel) return;
          const items = document.items ?? [];
          setEndpointCount(items.length);
          setEndpoints(items);
        })
        .catch(() => { if (!cancel) setEndpointCount(null); });
    }
    if (mqtt?.exists && auth.token) {
      apiRequest<{ items?: unknown[] }>(`/api/projects/${project.id}/specs/MQTT`, { token: auth.token })
        .then((document) => { if (!cancel) setTopicCount(document.items?.length ?? 0); })
        .catch(() => { if (!cancel) setTopicCount(null); });
    }
    if (socket?.exists && auth.token) {
      apiRequest<{ items?: unknown[] }>(`/api/projects/${project.id}/specs/WEBSOCKET`, { token: auth.token })
        .then((document) => { if (!cancel) setMessageCount(document.items?.length ?? 0); })
        .catch(() => { if (!cancel) setMessageCount(null); });
    }
    if (device?.exists && auth.token) {
      apiRequest<{ items?: unknown[] }>(`/api/projects/${project.id}/specs/DEVICE_PROTOCOL`, { token: auth.token })
        .then((document) => { if (!cancel) setCommandCount(document.items?.length ?? 0); })
        .catch(() => { if (!cancel) setCommandCount(null); });
    }
    return () => {
      cancel = true;
    };
  }, [auth.token, project]);

  useEffect(() => {
    if (!auth.token || !project) {
      return;
    }
    let cancel = false;
    apiRequest<{ documents: GeneralDocSummary[] }>(`/api/projects/${project.id}/general-docs`, { token: auth.token })
      .then((result) => { if (!cancel) setGeneralDocs(result.documents ?? []); })
      .catch(() => { if (!cancel) setGeneralDocs(null); });
    return () => {
      cancel = true;
    };
  }, [auth.token, project]);

  useEffect(() => {
    if (!auth.token || !project) {
      return;
    }
    let cancel = false;
    const specs: Array<{ kind: string; label: string; to: string }> = [
      { kind: "API", label: "REST API", to: `/projects/${project.id}/specs/api` },
      { kind: "MQTT", label: "MQTT", to: `/projects/${project.id}/specs/mqtt` },
      { kind: "WEBSOCKET", label: "WebSocket", to: `/projects/${project.id}/specs/websocket` },
      { kind: "DEVICE_PROTOCOL", label: "장비 프로토콜", to: `/projects/${project.id}/specs/device` },
    ];
    const jobs = specs
      .filter((spec) => project.specSummaries.some((item) => item.kind === spec.kind && item.exists))
      .map(async (spec) => {
        const result = await apiRequest<{ revisions?: RevisionRow[] }>(`/api/projects/${project.id}/specs/${spec.kind}/revisions`, { token: auth.token });
        return (result.revisions ?? []).slice(0, 4).map((revision) => ({
          at: revision.createdAt,
          title: revision.changeReason || revision.summary?.name || spec.label,
          kind: `${spec.label} v${revision.version}`,
          actor: revision.actor?.name ?? "",
          to: revision.summary?.itemUid && spec.kind === "API" ? `${spec.to}?item=${revision.summary.itemUid}` : `${spec.to}?view=history`,
        }));
      });
    Promise.all(jobs)
      .then(async (groups) => {
        const docs = await apiRequest<{ documents?: Array<{ id: number; title: string; version: number; updatedAt: string; updatedBy?: { name: string } }> }>(`/api/projects/${project.id}/general-docs`, { token: auth.token }).catch(() => ({ documents: [] }));
        const docChanges = (docs.documents ?? []).slice(0, 4).map((doc) => ({
          at: doc.updatedAt,
          title: doc.title,
          kind: `일반 문서 v${doc.version}`,
          actor: doc.updatedBy?.name ?? "",
          to: `/projects/${project.id}/docs`,
        }));
        const rows = [...groups.flat(), ...docChanges].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 6);
        if (!cancel) setChanges(rows);
      })
      .catch(() => {
        if (!cancel) setChanges([]);
      });
    return () => {
      cancel = true;
    };
  }, [auth.token, project]);

  const loaded = Boolean(project);
  const scrollTop = Boolean((location.state as { scrollTop?: boolean } | null)?.scrollTop);
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const target = location.hash === "#changes" ? "changes" : panel === "members" || panel === "settings" ? "manage" : scrollTop ? "project-top" : null;
    if (!target) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loaded, location.hash, location.key, panel, scrollTop]);

  if (!auth.ready) {
    return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  if (denied) {
    return (
      <main className="page">
        <h1>프로젝트</h1>
        <p className="banner warning">이 프로젝트의 상세는 볼 수 없습니다.</p>
        <Link to="/projects">목록으로</Link>
      </main>
    );
  }
  if (!project && !message) {
    return <main className="page"><p className="state-panel">불러오는 중입니다.</p></main>;
  }
  if (!project) {
    return <main className="page"><p className="banner danger">{message || "프로젝트를 찾지 못했습니다."}</p></main>;
  }

  const canManage = auth.user.role === "MASTER" || project.createdBy.id === auth.user.id;
  const active = project.status === "ACTIVE";
  const canEditSpec = active && (auth.user.role === "MASTER" || project.myPermission === "WRITE");
  const deviceSpec = project.specSummaries.find((item) => item.kind === "DEVICE_PROTOCOL");

  async function saveProject(event: FormEvent) {
    event.preventDefault();
    if (!auth.token || !project || busy) {
      return;
    }
    if (!title.trim()) {
      toast.error("프로젝트명을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${project.id}`, {
        method: "PUT",
        token: auth.token,
        body: { version: project.version, title, description, status: project.status },
      });
      await load(auth.token);
      toast.success("프로젝트 정보를 저장했습니다.");
    } catch (error) {
      toast.error(projectError(error, "프로젝트 정보를 저장하지 못했습니다."));
      if (error instanceof ApiError && error.code === "PROJECT_VERSION_CONFLICT") {
        await load(auth.token).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "ACTIVE" | "ARCHIVED") {
    if (!auth.token || !project || busy) {
      return;
    }
    if (status === "ARCHIVED" && !window.confirm("프로젝트를 보관할까요? 보관하면 복구하기 전까지 규격과 문서를 수정할 수 없습니다.")) {
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${project.id}`, {
        method: "PUT",
        token: auth.token,
        body: { version: project.version, title: project.title, description: project.description, status },
      });
      await load(auth.token);
      toast.success(status === "ARCHIVED" ? "프로젝트를 보관했습니다." : "프로젝트를 복구했습니다.");
    } catch (error) {
      toast.error(projectError(error, status === "ARCHIVED" ? "프로젝트를 보관하지 못했습니다." : "프로젝트를 복구하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!auth.token || !project || busy) {
      return;
    }
    if (!candidate) {
      toast.error("추가할 사용자를 이름이나 사번으로 검색해 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${project.id}/members`, {
        method: "POST",
        token: auth.token,
        body: { employeeNo: candidate.employeeNo, permission },
      });
      setCandidate(null);
      setPermission("READ");
      await load(auth.token);
      toast.success(`${candidate.name}(${candidate.employeeNo}) 님을 ${permissionLabel(permission)} 권한으로 추가했습니다.`);
    } catch (error) {
      toast.error(projectError(error, "멤버를 추가하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function changeMember(member: ProjectMember, next: string) {
    if (!auth.token || !project || busy) {
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${project.id}/members/${member.userId}`, {
        method: "PUT",
        token: auth.token,
        body: { permission: next },
      });
      await load(auth.token);
      toast.success(`${member.name} 님의 권한을 ${permissionLabel(next)}(으)로 변경했습니다.`);
    } catch (error) {
      toast.error(projectError(error, "권한을 변경하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: ProjectMember) {
    if (!auth.token || !project || busy) {
      return;
    }
    if (!window.confirm(`${member.name} 님의 프로젝트 권한을 회수할까요?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${project.id}/members/${member.userId}`, {
        method: "DELETE",
        token: auth.token,
      });
      await load(auth.token);
      toast.success(`${member.name} 님의 권한을 회수했습니다.`);
    } catch (error) {
      toast.error(projectError(error, "권한을 회수하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  const apiSpec = project.specSummaries.find((item) => item.kind === "API");
  const mqttSpec = project.specSummaries.find((item) => item.kind === "MQTT");
  const socketSpec = project.specSummaries.find((item) => item.kind === "WEBSOCKET");

  const continueItems = endpoints.slice(0, 3);

  return (
    <main className="studio">
      <div className="studio-main studio-home">
      {project.status === "ARCHIVED" ? (
        <p className="banner warning">보관된 프로젝트입니다. 수정하려면 생성자 또는 MASTER가 복구해야 합니다.</p>
      ) : null}
      <div className="home-head" id="project-top">
        <div>
          <h1>{project.title}</h1>
          <p className="lede">{project.description || "설명이 없습니다."}</p>
          <div className="home-badges">
            <span className={active ? "badge status-badge success" : "badge status-badge"}>{active ? "활성" : "보관"}</span>
            <span className={project.myPermission === "WRITE" ? "badge info" : "badge"}>{permissionLabel(project.myPermission)}</span>
            <span>규격 {project.specSummaries.filter((item) => item.exists).length}종</span>
            <span>문서 {project.generalDocumentCount}</span>
            <span>오류 코드 {project.errorCodeCount}</span>
            {latestUpdate(project) ? <span>최근 수정 {formatWhen(latestUpdate(project))}</span> : null}
          </div>
        </div>
        <div className="inline-actions">
          {canManage && active ? <button type="button" className="btn quiet" onClick={() => setStatus("ARCHIVED")}>보관</button> : null}
          {canManage && !active ? <button type="button" className="btn" onClick={() => setStatus("ACTIVE")}>복구</button> : null}
        </div>
      </div>
      {message ? <p className="banner">{message}</p> : null}
      <div className="home-grid">
        <section className="home-panel">
          <h2 className="section-title">이어서 작업</h2>
          <div className="resume">
            {continueItems.map((item) => (
              <ResumeLink
                key={item.itemUid}
                to={`/projects/${project.id}/specs/api?item=${item.itemUid}`}
                mark={item.payload?.method || "API"}
                title={item.payload?.path || item.name}
                detail={`${item.name} · REST API`}
              />
            ))}
            {continueItems.length === 0 ? (
              <div className="resume-empty">
                <p>{apiSpec?.exists ? (endpointCount === null ? "Endpoint를 확인하는 중입니다." : "아직 등록된 Endpoint가 없습니다.") : "아직 REST API 문서가 없습니다."}</p>
                {canEditSpec && !(apiSpec?.exists && endpointCount === null) ? (
                  <Link className="btn primary" to={`/projects/${project.id}/specs/api${apiSpec?.exists ? "?item=new" : ""}`}>{apiSpec?.exists ? "첫 Endpoint 작성" : "규격 작성 시작"}</Link>
                ) : null}
              </div>
            ) : null}
            {mqttSpec?.exists ? <ResumeLink to={`/projects/${project.id}/specs/mqtt`} mark="MQTT" title="MQTT" detail={`v${mqttSpec.version} 이어서 열기`} /> : null}
            {socketSpec?.exists ? <ResumeLink to={`/projects/${project.id}/specs/websocket`} mark="WS" title="WebSocket" detail={`v${socketSpec.version} 이어서 열기`} /> : null}
            {deviceSpec?.exists ? <ResumeLink to={`/projects/${project.id}/specs/device`} mark="DEV" title="장비 프로토콜" detail={`v${deviceSpec.version} 이어서 열기`} /> : null}
          </div>
        </section>
        <section className="home-panel" id="changes">
          <h2 className="section-title">최근 변경</h2>
          {changes.length === 0 ? <p className="schema-hint">아직 표시할 변경이 없습니다.</p> : (
            <ul className="feed">
              {changes.map((change) => (
                <li key={`${change.to}-${change.at}-${change.title}`}>
                  <Link className="feed-row" to={change.to}>
                    <time>{formatWhen(change.at)}</time>
                    <span>
                      <strong>{change.title}</strong>
                      <small><span>{change.kind}</span>{change.actor ? <span>{change.actor}</span> : null}</small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="home-block">
        <h2 className="section-title">규격과 문서</h2>
        <div className="spec-list">
          <div className="spec-row">
            <div className="grow"><strong>REST API</strong><em>{apiSpecText(apiSpec, endpointCount)}</em></div>
            <div className="spec-actions">{apiAction(canEditSpec, apiSpec, endpointCount, `/projects/${project.id}/specs/api`)}</div>
          </div>
          <div className="spec-row">
            <div className="grow"><strong>MQTT</strong><em>{mqttSpecText(mqttSpec, topicCount)}</em></div>
            <div className="spec-actions">{mqttAction(canEditSpec, mqttSpec, topicCount, `/projects/${project.id}/specs/mqtt`)}</div>
          </div>
          <div className="spec-row">
            <div className="grow"><strong>WebSocket</strong><em>{socketSpecText(socketSpec, messageCount)}</em></div>
            <div className="spec-actions">{socketAction(canEditSpec, socketSpec, messageCount, `/projects/${project.id}/specs/websocket`)}</div>
          </div>
          <div className="spec-row">
            <div className="grow"><strong>장비 프로토콜</strong><em>{deviceSpecText(deviceSpec, commandCount)}</em></div>
            <div className="spec-actions">{deviceAction(canEditSpec, deviceSpec, commandCount, `/projects/${project.id}/specs/device`)}</div>
          </div>
          <div className="spec-row">
            <div className="grow"><strong>오류 코드</strong><em>{project.errorCodeCount}개</em></div>
            <div className="spec-actions"><Link className="btn" to={`/projects/${project.id}/error-codes`}>열기</Link></div>
          </div>
          <div className="spec-row">
            <div className="grow"><strong>일반 문서</strong><em>{generalDocText(generalDocs)}</em></div>
            <div className="spec-actions"><Link className="btn" to={`/projects/${project.id}/docs`}>열기</Link></div>
          </div>
        </div>
      </section>
      <section className="home-manage" id="manage">
      <h2 className="section-title">프로젝트 관리</h2>
      <div className="tabs" role="tablist">
        {canManage ? <button type="button" role="tab" aria-selected={panel === "settings"} onClick={() => setSearchParams(panel === "settings" ? {} : { panel: "settings" })}>프로젝트 설정</button> : null}
        <button type="button" role="tab" aria-selected={panel === "members"} onClick={() => setSearchParams(panel === "members" ? {} : { panel: "members" })}>멤버</button>
      </div>
      {panel === "settings" && canManage && active ? (
        <form className="card" onSubmit={saveProject}>
          <h2>프로젝트 정보</h2>
          <label>
            프로젝트명
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            설명
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={busy}>{busy ? "저장 중" : "저장"}</button>
          </div>
        </form>
      ) : null}
      {panel === "settings" && canManage && !active ? <p className="state-panel">보관된 프로젝트의 기본 정보는 복구 후에 수정할 수 있습니다.</p> : null}
      {panel === "members" ? (
        <section className="card">
          <h2>멤버</h2>
          {members.length === 0 ? <p className="state-panel">멤버가 없습니다.</p> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>사번</th>
                  <th>성명</th>
                  <th>권한</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId}>
                    <td>{member.employeeNo}</td>
                    <td>{member.name}{member.creator ? " (생성자)" : ""}</td>
                    <td>{permissionLabel(member.permission)}</td>
                    <td>
                      {canManage && active && !member.creator ? (
                        <>
                          <button type="button" onClick={() => changeMember(member, member.permission === "READ" ? "WRITE" : "READ")}>
                            {member.permission === "READ" ? "편집으로 변경" : "조회로 변경"}
                          </button>
                          <button type="button" className="danger" onClick={() => removeMember(member)}>권한 회수</button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && active && auth.token ? (
            <form onSubmit={addMember}>
              <h2>멤버 추가</h2>
              <div className="member-add">
                <label>
                  사용자
                  <MemberPicker projectId={project.id} token={auth.token} value={candidate} onChange={setCandidate} />
                </label>
                <label>
                  권한
                  <select value={permission} onChange={(event) => setPermission(event.target.value)}>
                    <option value="READ">조회</option>
                    <option value="WRITE">편집</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="submit" disabled={busy || !candidate}>{busy ? "처리 중" : "추가"}</button>
                </div>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      </section>
      </div>
    </main>
  );
}

function ResumeLink({ to, mark, title, detail }: { to: string; mark: string; title: string; detail: string }) {
  return (
    <Link className="resume-row" to={to}>
      <span className="resume-mark">{mark}</span>
      <span className="resume-copy"><strong>{title}</strong><small>{detail}</small></span>
      <span className="resume-arrow" aria-hidden="true">›</span>
    </Link>
  );
}

type ApiLink = { itemUid: string; name: string; payload?: { method?: string; path?: string } };
type ChangeLink = { at: string; title: string; kind: string; actor: string; to: string };

function latestUpdate(project: ProjectDetail) {
  const times = project.specSummaries.map((item) => item.updatedAt).filter((value): value is string => Boolean(value));
  times.sort((left, right) => Date.parse(right) - Date.parse(left));
  return times[0] ?? "";
}
type RevisionRow = { version: number; changeReason: string; createdAt: string; actor?: { name: string }; summary?: { itemUid?: string; name?: string } };

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat("ko-KR", sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric" }).format(date);
}

type GeneralDocSummary = { title: string; updatedAt: string; updatedBy?: { name: string } };

function generalDocText(docs: GeneralDocSummary[] | null) {
  if (!docs) {
    return "문서 수를 확인하지 못했습니다.";
  }
  if (docs.length === 0) {
    return "아직 일반 문서가 없습니다. Markdown을 직접 작성하거나 .md 파일을 가져와 등록할 수 있습니다.";
  }
  const latest = docs[0];
  const who = latest.updatedBy?.name ? ` · ${latest.updatedBy.name}` : "";
  return `${docs.length}개 · 최근 수정 '${latest.title}' ${formatWhen(latest.updatedAt)}${who}`;
}

function apiSpecText(
  spec: { exists: boolean; version?: number; updatedByName?: string; updatedAt?: string } | undefined,
  endpointCount: number | null,
) {
  if (!spec?.exists) {
    return "공식 REST API 문서는 프로젝트당 하나입니다. 아직 문서가 없습니다.";
  }
  const version = `버전 ${spec.version ?? ""}`;
  const count = endpointCount === null ? "Endpoint 확인 중" : endpointCount === 0 ? "아직 등록된 Endpoint가 없습니다." : `Endpoint ${endpointCount}개`;
  const who = spec.updatedByName ? ` · ${spec.updatedByName}` : "";
  const when = spec.updatedAt ? ` · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(spec.updatedAt))}` : "";
  return `${version} · ${count}${who}${when}`;
}

function apiAction(
  canEdit: boolean,
  spec: { exists: boolean } | undefined,
  endpointCount: number | null,
  to: string,
) {
  if (!spec?.exists) {
    if (!canEdit) {
      return <p className="section-empty">조회 권한으로는 규격을 시작할 수 없습니다.</p>;
    }
    return <Link className="btn primary" to={to}>규격 작성 시작</Link>;
  }
  if (endpointCount === 0 && canEdit) {
    return <Link className="btn primary" to={`${to}?item=new`}>첫 Endpoint 작성</Link>;
  }
  return <Link className="btn" to={to}>{canEdit ? "열기" : "보기"}</Link>;
}

function mqttSpecText(
  spec: { exists: boolean; version?: number; updatedByName?: string; updatedAt?: string } | undefined,
  topicCount: number | null,
) {
  if (!spec?.exists) {
    return "공식 MQTT 문서는 프로젝트당 하나입니다. 아직 문서가 없습니다.";
  }
  const version = `버전 ${spec.version ?? ""}`;
  const count = topicCount === null ? "Topic 확인 중" : topicCount === 0 ? "아직 등록된 Topic이 없습니다." : `Topic ${topicCount}개`;
  const who = spec.updatedByName ? ` · ${spec.updatedByName}` : "";
  const when = spec.updatedAt ? ` · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(spec.updatedAt))}` : "";
  return `${version} · ${count}${who}${when}`;
}

function mqttAction(
  canEdit: boolean,
  spec: { exists: boolean } | undefined,
  topicCount: number | null,
  to: string,
) {
  if (!spec?.exists) {
    if (!canEdit) {
      return <p className="section-empty">조회 권한으로는 규격을 시작할 수 없습니다.</p>;
    }
    return <Link className="btn primary" to={to}>규격 작성 시작</Link>;
  }
  if (topicCount === 0 && canEdit) {
    return <Link className="btn primary" to={to}>첫 Topic 작성</Link>;
  }
  return <Link className="btn" to={to}>{canEdit ? "열기" : "보기"}</Link>;
}

function socketSpecText(
  spec: { exists: boolean; version?: number; updatedByName?: string; updatedAt?: string } | undefined,
  messageCount: number | null,
) {
  if (!spec?.exists) {
    return "공식 WebSocket 문서는 프로젝트당 하나입니다. 아직 문서가 없습니다.";
  }
  const version = `버전 ${spec.version ?? ""}`;
  const count = messageCount === null ? "메시지 확인 중" : messageCount === 0 ? "아직 등록된 메시지가 없습니다." : `메시지 ${messageCount}개`;
  const who = spec.updatedByName ? ` · ${spec.updatedByName}` : "";
  const when = spec.updatedAt ? ` · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(spec.updatedAt))}` : "";
  return `${version} · ${count}${who}${when}`;
}

function socketAction(
  canEdit: boolean,
  spec: { exists: boolean } | undefined,
  messageCount: number | null,
  to: string,
) {
  if (!spec?.exists) {
    if (!canEdit) {
      return <p className="section-empty">조회 권한으로는 규격을 시작할 수 없습니다.</p>;
    }
    return <Link className="btn primary" to={to}>규격 작성 시작</Link>;
  }
  if (messageCount === 0 && canEdit) {
    return <Link className="btn primary" to={to}>첫 메시지 추가</Link>;
  }
  return <Link className="btn" to={to}>{canEdit ? "열기" : "보기"}</Link>;
}

function deviceSpecText(
  spec: { exists: boolean; version?: number; updatedByName?: string; updatedAt?: string } | undefined,
  commandCount: number | null,
) {
  if (!spec?.exists) {
    return "공식 장비 프로토콜 문서는 프로젝트당 하나입니다. 아직 문서가 없습니다.";
  }
  const version = `버전 ${spec.version ?? ""}`;
  const count = commandCount === null ? "명령 확인 중" : commandCount === 0 ? "아직 등록된 명령이 없습니다." : `명령 ${commandCount}개`;
  const who = spec.updatedByName ? ` · ${spec.updatedByName}` : "";
  const when = spec.updatedAt ? ` · ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(spec.updatedAt))}` : "";
  return `${version} · ${count}${who}${when}`;
}

function deviceAction(
  canEdit: boolean,
  spec: { exists: boolean } | undefined,
  commandCount: number | null,
  to: string,
) {
  if (!spec?.exists) {
    if (!canEdit) {
      return <p className="section-empty">조회 권한으로는 규격을 시작할 수 없습니다.</p>;
    }
    return <Link className="btn primary" to={to}>규격 작성 시작</Link>;
  }
  if (commandCount === 0 && canEdit) {
    return <Link className="btn primary" to={to}>첫 명령 추가</Link>;
  }
  return <Link className="btn" to={to}>{canEdit ? "열기" : "보기"}</Link>;
}
