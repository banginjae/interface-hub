import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import background from "../../../image/loginBackgroundImage.png";
import { ApiError, apiRequest } from "../api";
import { appConfig } from "../appConfig";
import { authErrorMessage, useAuth } from "../auth";

const features = [
  { title: "통신 규격 통합 관리", icon: "code" },
  { title: "팀 간 문서 공유", icon: "users" },
  { title: "버전 및 변경 이력", icon: "history" },
  { title: "Markdown 내보내기", icon: "file" },
] as const;

export function LoginPage() {
  const auth = useAuth();
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  if (!auth.ready) {
    return <main className="state-panel"><p>확인 중입니다.</p></main>;
  }
  if (auth.user) {
    return <Navigate to="/projects" replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      await auth.login(employeeNo, password);
      setPassword("");
    } catch (error) {
      setPassword("");
      setMessage(authErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <section className="login-brand" style={{ backgroundImage: `url(${background})` }}>
        <div className="login-brand-inner">
          <div className="login-intro">
            <div className="brand">
              <span className="brand-mark">{appConfig.brandMark}</span>
              <span>
                <strong>{appConfig.serviceName}</strong>
                <small>인터페이스 규격과 프로젝트 협업 플랫폼</small>
              </span>
            </div>
            <span className="login-rule" aria-hidden="true" />
            <div className="login-copy">
              <h1>연구소의 통신 규격과<br />개발 문서를 하나로 관리하세요.</h1>
              <p>REST API, MQTT, WebSocket, 장비 프로토콜 등<br />프로젝트의 인터페이스 규격을 통합하고,<br />변경 이력을 함께 추적할 수 있습니다.</p>
            </div>
            <ul className="login-features">
              {features.map((feature) => (
                <li key={feature.title}>
                  <FeatureIcon name={feature.icon} />
                  <span>{feature.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="login-panel">
        {resetOpen ? (
          <ResetCard onClose={() => setResetOpen(false)} />
        ) : (
          <main className="login-card">
            <h2>로그인</h2>
            <p className="lede">Interface Hub에 로그인하여<br />프로젝트의 인터페이스 규격을 관리하세요.</p>
            <form onSubmit={onSubmit}>
              <label>
                사번
                <span className="login-field">
                  <UserIcon />
                  <input
                    value={employeeNo}
                    onChange={(event) => setEmployeeNo(event.target.value)}
                    autoComplete="username"
                    placeholder="사번을 입력하세요"
                  />
                </span>
              </label>
              <label>
                비밀번호
                <span className="login-field login-password">
                  <LockIcon />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="비밀번호를 입력하세요"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    <EyeIcon hidden={showPassword} />
                  </button>
                </span>
              </label>
              {message ? <p className="banner danger">{message}</p> : null}
              <button type="submit" className="login-submit" disabled={submitting}>{submitting ? "로그인 중" : "로그인"}</button>
            </form>
            <button type="button" className="login-forgot" onClick={() => { setMessage(""); setResetOpen(true); }}>비밀번호를 잊으셨나요?</button>
          </main>
        )}
      </section>
    </div>
  );
}

function ResetCard({ onClose }: { onClose: () => void }) {
  const [employeeNo, setEmployeeNo] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"danger" | "success">("danger");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      await apiRequest("/api/auth/password-reset/request", {
        method: "POST",
        body: { employeeNo },
      });
      setTone("success");
      setMessage("요청을 접수했습니다. 등록된 계정이면 이메일로 임시 비밀번호를 보냅니다. 로그인 후 비밀번호를 변경하세요.");
    } catch (error) {
      setTone("danger");
      setMessage(error instanceof ApiError ? error.message : authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-card">
      <h2>비밀번호 재설정</h2>
      <p className="lede">사번을 입력하면 등록된 이메일로 임시 비밀번호를 보냅니다. 계정이 있는지는 알려 주지 않습니다.</p>
      <form onSubmit={onSubmit}>
        <label>
          사번
          <span className="login-field">
            <UserIcon />
            <input
              value={employeeNo}
              onChange={(event) => setEmployeeNo(event.target.value)}
              autoComplete="username"
              placeholder="사번을 입력하세요"
            />
          </span>
        </label>
        {message ? <p className={tone === "success" ? "banner success" : "banner danger"}>{message}</p> : null}
        <button type="submit" className="login-submit" disabled={submitting}>{submitting ? "요청 중" : "임시 비밀번호 받기"}</button>
      </form>
      <button type="button" className="login-forgot" onClick={onClose}>로그인으로 돌아가기</button>
    </main>
  );
}

function FeatureIcon({ name }: { name: (typeof features)[number]["icon"] }) {
  if (name === "code") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7.5-4.5 4.5L8 16.5M16 7.5l4.5 4.5L16 16.5M13.2 5.5l-2.4 13" /></svg>;
  }
  if (name === "users") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8.2" r="2.7" />
        <path d="M4.2 18.8v-.7A3.5 3.5 0 0 1 7.7 14.6h2.6a3.5 3.5 0 0 1 3.5 3.5v.7" />
        <circle cx="16.2" cy="8.8" r="2.15" />
        <path d="M16.4 14.8a3.2 3.2 0 0 1 3.2 2.7v1.3" />
      </svg>
    );
  }
  if (name === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8.1V12l2.4 2.2" />
        <path d="M4.2 11.4a7.8 7.8 0 1 1 .7 3.5" />
        <path d="M4.2 19.2V14.8h4.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.2h6.8L19 8.4V20a1.3 1.3 0 0 1-1.3 1.3H7A1.3 1.3 0 0 1 5.7 20V4.5A1.3 1.3 0 0 1 7 3.2Z" />
      <path d="M13.6 3.4V8.5H19" />
      <path d="M9 13.4h6" />
    </svg>
  );
}

function UserIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19.2c.8-3 3.2-4.7 6.5-4.7s5.7 1.7 6.5 4.7" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="1.6" /><path d="M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11" /></svg>;
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {hidden ? <path d="M4 5l16 14" /> : null}
    </svg>
  );
}
