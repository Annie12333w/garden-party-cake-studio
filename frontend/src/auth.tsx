import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (b: { name: string; email: string; password: string; phone?: string }) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Browser-tab storage for the in-progress order: the Order Taker chat, the draft, and who it belongs to. */
export const ORDER_DRAFT_KEY = "gp_order_draft";
export const ORDER_CHAT_KEY = "gp_order_chat";
export const ORDER_OWNER_KEY = "gp_order_owner";

export function clearOrderSession(): void {
  for (const k of [ORDER_DRAFT_KEY, ORDER_CHAT_KEY, ORDER_OWNER_KEY]) sessionStorage.removeItem(k);
}

/** A different account signing in must never see the previous person's chat or draft. A guest who signs in
 *  mid-order keeps theirs (same person, same tab). */
function guardOrderSession(next: User | null): void {
  const owner = sessionStorage.getItem(ORDER_OWNER_KEY);
  const me = next ? String(next.id) : "anon";
  if (owner && owner !== "anon" && owner !== me) clearOrderSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.me();
      guardOrderSession(r.user);
      setUser(r.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await api.login({ email, password });
    guardOrderSession(r.user);
    setUser(r.user);
    return r.user;
  };
  const register = async (b: { name: string; email: string; password: string; phone?: string }) => {
    const r = await api.register(b);
    guardOrderSession(r.user);
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    try {
      await api.logout();
    } finally {
      clearOrderSession(); // signing out wipes the chat and draft from this tab
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, refresh, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
