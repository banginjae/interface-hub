import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { appConfig } from "./appConfig";
import { useAuth } from "./auth";
import { ProjectNav } from "./project/ProjectNav";

type Crumb = { label: string; to?: string };
type Chrome = { title: string; crumbs: Crumb[] };

const defaultChrome: Chrome = { title: appConfig.serviceName, crumbs: [] };

const ChromeContext = createContext<{
  chrome: Chrome;
  setChrome: (chrome: Chrome) => void;
  setGuard: (guard: () => boolean) => void;
} | null>(null);

export function usePageChrome(title: string, crumbs: Crumb[]) {
  const shell = useContext(ChromeContext);
  const key = JSON.stringify({ title, crumbs });
  useEffect(() => {
    shell?.setChrome(JSON.parse(key) as Chrome);
  }, [shell, key]);
}

export function useNavGuard(guard: () => boolean, token: boolean) {
  const shell = useContext(ChromeContext);
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    if (!shell) {
      return;
    }
    shell.setGuard(() => guardRef.current());
    return () => shell.setGuard(() => true);
  }, [shell, token]);
}

function UserMenu({ allow }: { allow: (event: { preventDefault: () => void }) => void }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!auth.user) {
    return null;
  }

  const roleText = auth.user.role === "MASTER" ? "MASTER" : "일반 사용자";
  const email = auth.user.email?.trim();
  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        title={email ? `${auth.user.name} (${email})` : auth.user.name}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="profile-avatar" aria-hidden="true"><UserGlyph /></span>
        <span className="profile-text">
          <span className="profile-line">
            <strong>{auth.user.name}</strong>
            {email ? <span className="profile-email">({email})</span> : null}
          </span>
          <small>{auth.user.employeeNo} · {roleText}</small>
        </span>
        <span className="profile-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id="account-menu" className="user-menu-panel" role="menu">
          <div className="user-menu-id">
            <strong>{auth.user.name}</strong>
            <span>{auth.user.employeeNo}</span>
            <span>{auth.user.email}</span>
          </div>
          <Link role="menuitem" to="/account" onClick={(event) => { allow(event); setOpen(false); }}>내 정보 수정</Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); auth.logout(); }}>로그아웃</button>
        </div>
      ) : null}
    </div>
  );
}

function UserGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19.2c.8-3 3.2-4.7 6.5-4.7s5.7 1.7 6.5 4.7" />
    </svg>
  );
}

function BrandLink({ subtitle, allow }: { subtitle: string; allow: (event: { preventDefault: () => void }) => void }) {
  return (
    <Link to="/projects" className="brand brand-link" title="프로젝트 목록으로 이동" aria-label={`${appConfig.serviceName} · 프로젝트 목록으로 이동`} onClick={allow}>
      <span className="brand-mark" aria-hidden="true">{appConfig.brandMark}</span>
      <span className="brand-text">
        <strong>{appConfig.serviceName}</strong>
        <small>{subtitle}</small>
      </span>
    </Link>
  );
}

function projectIdFromPath(pathname: string) {
  const match = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  return match?.[1] ?? null;
}

export function Shell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const projectId = projectIdFromPath(location.pathname);
  const [chrome, setChromeState] = useState<Chrome>(defaultChrome);
  const guardRef = useRef<() => boolean>(() => true);
  const setChrome = useCallback((next: Chrome) => {
    setChromeState((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);
  const setGuard = useCallback((guard: () => boolean) => {
    guardRef.current = guard;
  }, []);
  const shell = useMemo(() => ({ chrome, setChrome, setGuard }), [chrome, setChrome, setGuard]);
  function allow(event: { preventDefault: () => void }) {
    if (!guardRef.current()) {
      event.preventDefault();
    }
  }

  if (location.pathname === "/login") {
    return <ChromeContext.Provider value={shell}>{children}</ChromeContext.Provider>;
  }
  if (!auth.user) {
    return (
      <ChromeContext.Provider value={shell}>
        <div className="public-shell">
          <header className="public-bar">
            <strong>{appConfig.serviceName}</strong>
            <Link to="/login">로그인</Link>
          </header>
          <div className="public-content">{children}</div>
        </div>
      </ChromeContext.Provider>
    );
  }

  if (projectId) {
    return (
      <ChromeContext.Provider value={shell}>
        <div className="app-shell workspace-app">
          <aside className="sidebar project-side">
            <BrandLink subtitle="프로젝트 작업 공간" allow={allow} />
            <ProjectNav projectId={projectId} allow={allow} />
          </aside>
          <div className="workspace">
            <header className="workspace-userbar">
              <UserMenu allow={allow} />
            </header>
            <div className="content">{children}</div>
          </div>
        </div>
      </ChromeContext.Provider>
    );
  }

  return (
    <ChromeContext.Provider value={shell}>
      <div className="app-shell">
        <aside className="sidebar">
          <BrandLink subtitle={appConfig.tagline} allow={allow} />
          <nav aria-label="주 메뉴">
            <NavLink to="/projects" onClick={allow}>프로젝트</NavLink>
            {auth.user.role === "MASTER" ? <NavLink to="/master/users" onClick={allow}>계정 관리</NavLink> : null}
          </nav>
        </aside>
        <div className="workspace">
          <header className={chrome.crumbs.some((crumb) => crumb.to) ? "shell-header" : "shell-header is-compact"}>
            {chrome.crumbs.some((crumb) => crumb.to) ? (
              <div className="crumbs">
                {chrome.crumbs.map((crumb, index) => (
                  <span key={`${crumb.label}-${index}`}>
                    {index > 0 ? <span> / </span> : null}
                    {crumb.to ? <Link to={crumb.to} onClick={allow}>{crumb.label}</Link> : crumb.label}
                  </span>
                ))}
              </div>
            ) : <span />}
            <UserMenu allow={allow} />
          </header>
          <div className="content">{children}</div>
        </div>
      </div>
    </ChromeContext.Provider>
  );
}
