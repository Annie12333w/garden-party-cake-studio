// Thin fetch wrapper. Every call sends the gp_session cookie; errors become Error(detail).
import type {
  Availability, CashSummary, ChatRequest, ChatResponse, Dashboard, Draft, IdeaCard, InspirationAnalysis,
  InventoryItem, Menu, Order, OrderSpec, ProductionPlan, Quote, Receipt, ReceiptItem, Recipe, RunDetail,
  RunInfo, SafetyEvent, Settings, ShoppingList, Tokenomics, User, CalEvent,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const init: RequestInit = { method, credentials: "include", headers: {} };
  if (body !== undefined) {
    if (isForm) {
      init.body = body as FormData;
    } else {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "Can't reach the studio server. Is the backend running on port 8000?");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    if (data && typeof data === "object" && "detail" in data) {
      const d = (data as { detail: unknown }).detail;
      detail = typeof d === "string" ? d : JSON.stringify(d);
    }
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

const get = <T,>(p: string) => request<T>("GET", p);
const post = <T,>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const put = <T,>(p: string, b: unknown) => request<T>("PUT", p, b);
const patch = <T,>(p: string, b: unknown) => request<T>("PATCH", p, b);
const upload = <T,>(p: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return request<T>("POST", p, fd, true);
};

export const api = {
  // public
  health: () => get<{ ok: boolean; today: string; llm_configured: boolean }>("/api/health"),
  menu: () => get<Menu>("/api/menu"),
  quote: (spec: Partial<OrderSpec>) => post<Quote>("/api/quote", spec),
  availability: (sizeCode: string, addons: string[], days = 75) =>
    get<Availability>(
      `/api/availability?size_code=${encodeURIComponent(sizeCode)}&addons=${encodeURIComponent(addons.join(","))}&days=${days}`,
    ),
  register: (b: { name: string; email: string; password: string; phone?: string }) =>
    post<{ user: User }>("/api/auth/register", b),
  login: (b: { email: string; password: string }) => post<{ user: User }>("/api/auth/login", b),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  me: () => get<{ user: User | null }>("/api/auth/me"),

  // order taker
  chat: (b: ChatRequest) => post<ChatResponse>("/api/concierge/chat", b),

  // customer
  uploadInspiration: (file: File) =>
    upload<{ image_id: number; url: string; analysis: InspirationAnalysis }>("/api/uploads/inspiration", file),
  createOrder: (spec: OrderSpec) => post<Order>("/api/orders", spec),
  myOrders: () => get<Order[]>("/api/orders/mine"),
  order: (id: number) => get<Order>(`/api/orders/${id}`),
  cancelOrder: (id: number) => post<Order>(`/api/orders/${id}/cancel`),
  payInvoice: (orderId: number, invoiceId: number) => post<Order>(`/api/orders/${orderId}/invoices/${invoiceId}/pay`),
  ideas: () => get<{ ideas: IdeaCard[]; based_on: string[] }>("/api/ideas"),

  // staff
  dashboard: () => get<Dashboard>("/api/staff/dashboard"),
  staffOrders: (status?: string) => get<Order[]>(`/api/staff/orders${status ? `?status=${status}` : ""}`),
  accept: (id: number, final_price: number, owner_note?: string) =>
    post<Order>(`/api/staff/orders/${id}/accept`, { final_price, owner_note }),
  decline: (id: number, reason: string) => post<Order>(`/api/staff/orders/${id}/decline`, { reason }),
  setStatus: (id: number, status: "in_production" | "ready" | "completed") =>
    post<Order>(`/api/staff/orders/${id}/status`, { status }),
  balancePaid: (id: number) => post<Order>(`/api/staff/orders/${id}/balance-paid`),
  reviewOrder: (id: number) => post<{ run_id: string }>(`/api/staff/orders/${id}/review`),
  planWeek: (week_start?: string) => post<{ run_id: string }>("/api/staff/plan-week", week_start ? { week_start } : {}),
  runs: () => get<RunInfo[]>("/api/staff/runs"),
  run: (id: string) => get<RunDetail>(`/api/staff/runs/${encodeURIComponent(id)}`),
  calendar: (start: string, end: string) =>
    get<{ events: CalEvent[] }>(`/api/staff/calendar?start=${start}&end=${end}`),
  plan: (week_start: string) => get<ProductionPlan | null>(`/api/staff/plan?week_start=${week_start}`),
  shoppingList: (week_start: string) => get<ShoppingList | null>(`/api/staff/shopping-list?week_start=${week_start}`),
  approveShoppingList: (id: number) => post<ShoppingList>(`/api/staff/shopping-list/${id}/approve`),
  inventory: () => get<InventoryItem[]>("/api/staff/inventory"),
  updateInventory: (id: number, qty_on_hand: number) =>
    patch<InventoryItem>(`/api/staff/inventory/${id}`, { qty_on_hand }),
  recipes: () => get<Recipe[]>("/api/staff/recipes"),
  approveRecipe: (id: number) => post<Recipe>(`/api/staff/recipes/${id}/approve`),
  cash: () => get<CashSummary>("/api/staff/cash"),
  uploadReceipt: (file: File) => upload<Receipt>("/api/staff/receipts", file),
  rejectReceipt: (id: number, reason: string) => post<Receipt>(`/api/staff/receipts/${id}/reject`, { reason }),
  confirmReceipt: (id: number, b: { vendor: string; date: string; total: number; items: ReceiptItem[] }) =>
    post<Receipt>(`/api/staff/receipts/${id}/confirm`, b),
  drafts: () => get<Draft[]>("/api/staff/drafts"),
  tokenomics: () => get<Tokenomics>("/api/staff/tokenomics"),
  safety: () => get<{ events: SafetyEvent[] }>("/api/staff/safety"),
  settings: () => get<Settings>("/api/staff/settings"),
  saveSettings: (s: Partial<Settings>) => put<Settings>("/api/staff/settings", s),
  resetDemo: () => post<{ ok: true }>("/api/staff/reset-demo"),
};
