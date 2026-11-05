import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiRequest, type AccountUser } from "./api";

const tokenKey = "interface_hub_access_token";

type AuthValue = {
  ready: boolean;
  token: string | null;
  user: AccountUser | null;
  login: (employeeNo: string, password: string) => Promise<void>;
  logout: () => void;
  markPasswordChanged: () => void;
  replaceUser: (user: AccountUser) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(tokenKey);
    if (!saved) {
      setReady(true);
      return;
    }
    apiRequest<AccountUser>("/api/me", { token: saved })
      .then((current) => {
        setToken(saved);
        setUser(current);
      })
      .catch(() => {
        sessionStorage.removeItem(tokenKey);
        setToken(null);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      token,
      user,
      login: async (employeeNo: string, password: string) => {
        const result = await apiRequest<{ accessToken: string }>("/api/auth/login", {
          method: "POST",
          body: { employeeNo, password },
        });
        const current = await apiRequest<AccountUser>("/api/me", { token: result.accessToken });
        sessionStorage.setItem(tokenKey, result.accessToken);
        setToken(result.accessToken);
        setUser(current);
      },
      logout: () => {
        sessionStorage.removeItem(tokenKey);
        setToken(null);
        setUser(null);
      },
      markPasswordChanged: () => {
        setUser((current) => (current ? { ...current, passwordMustChange: false } : current));
      },
      replaceUser: (next) => {
        setUser(next);
      },
    }),
    [ready, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("auth provider missing");
  }
  return value;
}

export function authErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "요청을 처리하지 못했습니다.";
}
