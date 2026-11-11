import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiRequest, type AccountUser } from "../api";
import { authErrorMessage, useAuth } from "../auth";
import { usePageChrome } from "../Shell";
import { useToast } from "../toast";

export function AccountPage() {
  const auth = useAuth();
  usePageChrome("", []);
  if (!auth.ready) {
    return <main className="page"><p className="state-panel">확인 중입니다.</p></main>;
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  return <AccountEditor user={auth.user} />;
}

function AccountEditor({ user }: { user: AccountUser }) {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(Boolean(user.passwordMustChange));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [changing, setChanging] = useState(false);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!auth.token) {
      return;
    }
    const nextName = name.trim();
    const nextEmail = email.trim();
    if (!nextName || nextName.length > 100 || !nextEmail.includes("@")) {
      setProfileError(true);
      setProfileMessage("이름과 이메일을 확인해 주세요.");
      return;
    }
    setSaving(true);
    setProfileMessage("");
    try {
      const updated = await apiRequest<AccountUser>("/api/me", {
        method: "PUT",
        token: auth.token,
        body: { name: nextName, email: nextEmail },
      });
      auth.replaceUser(updated);
      setName(updated.name);
      setEmail(updated.email);
      setProfileError(false);
      setProfileMessage("기본 정보를 저장했습니다.");
      toast.success("기본 정보를 저장했습니다.");
    } catch (error) {
      setProfileError(true);
      setProfileMessage(authErrorMessage(error));
      toast.error(`기본 정보를 저장하지 못했습니다. ${authErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!auth.token) {
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 72) {
      setPasswordError(true);
      setPasswordMessage("새 비밀번호는 8자 이상 72자 이하여야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(true);
      setPasswordMessage("새 비밀번호가 서로 다릅니다.");
      return;
    }
    setChanging(true);
    setPasswordMessage("");
    try {
      await apiRequest("/api/me/password", {
        method: "PUT",
        token: auth.token,
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      auth.markPasswordChanged();
      setPasswordError(false);
      setPasswordMessage("비밀번호를 변경했습니다.");
      toast.success("비밀번호를 변경했습니다.");
    } catch (error) {
      setPasswordError(true);
      setPasswordMessage(authErrorMessage(error));
      toast.error(`비밀번호를 변경하지 못했습니다. ${authErrorMessage(error)}`);
    } finally {
      setChanging(false);
    }
  }

  return (
    <main className="page account-page">
      <div className="page-head">
        <div>
          <h1>내 정보</h1>
          <p className="lede">이름과 이메일, 비밀번호를 수정할 수 있습니다. 사번과 역할은 바꿀 수 없습니다.</p>
        </div>
      </div>
      {user.passwordMustChange ? <p className="banner warning">임시 비밀번호로 로그인했습니다. 새 비밀번호로 변경하세요.</p> : null}
      <form className="card account-form" onSubmit={saveProfile}>
        <h2>기본 정보</h2>
        <label>
          사번
          <input value={user.employeeNo} readOnly />
        </label>
        <label>
          역할
          <input value={roleLabel(user.role)} readOnly />
        </label>
        <label>
          이름
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        </label>
        <label>
          이메일
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        {profileMessage ? <p className={profileError ? "banner danger" : "banner success"}>{profileMessage}</p> : null}
        <div className="form-actions">
          <button type="submit" disabled={saving}>{saving ? "저장 중" : "변경사항 저장"}</button>
        </div>
      </form>
      <section className="card account-form">
        <div className="account-password-head">
          <h2>비밀번호 변경</h2>
          {passwordOpen ? null : <button type="button" onClick={() => setPasswordOpen(true)}>비밀번호 변경</button>}
        </div>
        {passwordOpen ? (
          <form onSubmit={changePassword}>
            <label>
              현재 비밀번호
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <label>
              새 비밀번호
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
            </label>
            <label>
              새 비밀번호 확인
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
            </label>
            {passwordMessage ? <p className={passwordError ? "banner danger" : "banner success"}>{passwordMessage}</p> : null}
            <div className="form-actions">
              <button type="submit" disabled={changing}>{changing ? "변경 중" : "비밀번호 변경"}</button>
            </div>
          </form>
        ) : <p className="lede">비밀번호를 바꾸지 않으면 기존 비밀번호는 그대로 유지됩니다.</p>}
      </section>
    </main>
  );
}

function roleLabel(role: string) {
  if (role === "MASTER") {
    return "MASTER";
  }
  return "일반 사용자";
}
