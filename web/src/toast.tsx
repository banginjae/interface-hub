import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; text: string };
type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
const toneLabel: Record<ToastTone, string> = { success: "완료", error: "실패", info: "안내" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((tone: ToastTone, text: string) => {
    seq.current += 1;
    const id = seq.current;
    setItems((current) => [...current.slice(-3), { id, tone, text }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (text) => push("success", text),
    error: (text) => push("error", text),
    info: (text) => push("info", text),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast is-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
            <span className="toast-mark" aria-hidden="true">{item.tone === "success" ? "✓" : item.tone === "error" ? "!" : "i"}</span>
            <p><strong>{toneLabel[item.tone]}</strong> {item.text}</p>
            <button type="button" aria-label="알림 닫기" onClick={() => dismiss(item.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("ToastProvider is missing");
  }
  return api;
}
