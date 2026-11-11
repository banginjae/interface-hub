import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiRequest, type AccountUser } from "../api";
import { appConfig } from "../appConfig";
import { authErrorMessage, useAuth } from "../auth";
import { usePageChrome } from "../Shell";
import { useToast } from "../toast";

const emptyForm = {
  employeeNo: "",
  name: "",
  email: "",
  password: "",
  role: "MEMBER",
};

export function UsersPage() {
  const auth = useAuth();
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");
  const toast = useToast();
  usePageChrome("", []);

  async function load(token: string) {
    const rows = await apiRequest<AccountUser[]>("/api/master/users", { token });
    setUsers(rows);
  }

  useEffect(() => {
    if (!auth.token || auth.user?.role !== "MASTER") {
      return;
    }
    load(auth.token).catch((error) => setMessage(authErrorMessage(error)));
  }, [auth.token, auth.user?.role]);

  if (!auth.ready) {
    return (
      <main className="page">
        <p className="state-panel">확인 중입니다.</p>
      </main>
    );
  }
  if (!auth.user) {
    return <Navigate to="/login" replace />;
  }
  if (auth.user.role !== "MASTER") {
    return (
      <main className="page">
        <h1>계정 관리</h1>
        <p className="banner warning">이 화면은 MASTER만 사용할 수 있습니다.</p>
      </main>
    );
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!auth.token) {
      return;
    }
    setMessage("");
    try {
      await apiRequest("/api/master/users", { method: "POST", token: auth.token, body: form });
      const created = `${form.name.trim()}(${form.employeeNo.trim()})`;
      setForm(emptyForm);
      await load(auth.token);
      toast.success(`${created} 계정을 등록했습니다.`);
    } catch (error) {
      setForm((current) => ({ ...current, password: "" }));
      setMessage(authErrorMessage(error));
      toast.error(`계정을 등록하지 못했습니다. ${authErrorMessage(error)}`);
    }
  }

  async function deactivate(user: AccountUser) {
    if (!auth.token) {
      return;
    }
    if (!window.confirm("이 계정을 비활성화할까요?")) {
      return;
    }
    setMessage("");
    try {
      await apiRequest(`/api/master/users/${user.id}`, {
        method: "PUT",
        token: auth.token,
        body: { name: user.name, email: user.email, role: user.role, active: false },
      });
      await load(auth.token);
      toast.success(`${user.name}(${user.employeeNo}) 계정을 비활성화했습니다.`);
    } catch (error) {
      setMessage(authErrorMessage(error));
      toast.error(`계정을 비활성화하지 못했습니다. ${authErrorMessage(error)}`);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>계정 관리</h1>
          <p className="lede">{appConfig.serviceName} 직원 계정을 개별 등록합니다.</p>
        </div>
      </div>
      <form className="card" onSubmit={onCreate}>
        <label>
          사번
          <input value={form.employeeNo} onChange={(event) => setForm({ ...form, employeeNo: event.target.value })} />
        </label>
        <label>
          성명
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          이메일
          <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            autoComplete="new-password"
          />
        </label>
        <label>
          역할
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="MEMBER">MEMBER</option>
            <option value="MASTER">MASTER</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="submit">등록</button>
        </div>
      </form>
      {message ? <p className="banner danger">{message}</p> : null}
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>사번</th>
            <th>성명</th>
            <th>이메일</th>
            <th>역할</th>
            <th>활성</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.employeeNo}</td>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.role}</td>
              <td>{user.active ? "활성" : "비활성"}</td>
              <td>
                {user.active ? (
                  <button type="button" onClick={() => deactivate(user)}>
                    비활성화
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </main>
  );
}
