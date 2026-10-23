// Types copied from output/api_contract.md. Keep in sync with the backend.

export type Role = "customer" | "staff";
export interface User {
  id: number; name: string; email: string; role: Role; phone?: string | null;
  allergies?: string | null; preferences?: string | null;
}

export interface SizeOption {
  id: number; code: string; label: string; tiers: number; servings: number;
  labor_hours: number; base_price: number; description: string;
}
export interface Flavor {
  code: string; name: string; kind: "cake" | "filling" | "frosting"; premium: boolean;
  upcharge: number; allergens: string[]; description: string;
}
export type PriceType = "flat" | "per_tier" | "per_serving" | "percent";
export type AddonCategory = "florals" | "fruit_nuts" | "finish" | "dietary" | "extras";
export interface Addon {
  id: number; code: string; name: string; category: AddonCategory;
  price: number; price_type: PriceType; labor_hours: number; allergens: string[];
  description: string; needs_review: boolean;
}
export interface GalleryItem {
  id: number; slug: string; title: string; image: string;
  description: string; tags: string[]; addon_codes: string[]; size_code: string; from_price: number;
  kind?: "photo" | "concept"; related?: string[];
  cake_flavor?: string | null; filling?: string | null; frosting?: string | null;
}
export interface WorkBlock { weekday: number; start: string; end: string }
export interface Policies {
  min_price: number; per_serving_rate: number; deposit_pct: number; min_lead_days: number;
  hold_hours: number; rush_days: number; rush_pct: number; delivery_fees: Record<string, number>;
  work_blocks: WorkBlock[]; pickup_weekdays: number[]; style_note: string;
}
export interface Menu {
  sizes: SizeOption[]; flavors: { cake: Flavor[]; filling: Flavor[]; frosting: Flavor[] };
  addons: Addon[]; gallery: GalleryItem[]; policies: Policies;
}

export interface AddonPick { code: string; qty: number }
export interface OrderSpec {
  occasion: string; guest_count?: number | null; recipient_name?: string | null;
  size_code: string; cake_flavor: string; filling: string; frosting: string;
  addons: AddonPick[]; design_notes: string; message_on_cake?: string | null;
  inspiration_image_id?: number | null; allergies: string; dietary?: string | null;
  pickup_date: string | null; pickup_time: string | null;
  fulfillment: "pickup" | "delivery"; delivery_zone?: "new_haven" | "nearby" | "far" | null;
  delivery_address?: string | null;
}
export interface Flag { code: string; severity: "info" | "warn" | "block"; message: string }
export interface QuoteLine { code: string; label: string; amount: number }
export interface Quote {
  lines: QuoteLine[]; servings: number; base_price: number; addons_total: number;
  rush_fee: number; delivery_fee: number; total: number; deposit: number; balance: number;
  labor_hours: number; rule: string; flags: Flag[];
}

export type DayStatus = "available" | "limited" | "full" | "too_soon" | "closed" | "past";
export interface AvailabilityDay { date: string; status: DayStatus; free_hours_before: number; note?: string }
export interface Availability {
  labor_hours: number; lead_days: number; first_available: string | null; days: AvailabilityDay[];
}

export type OrderStatus = "requested" | "accepted" | "confirmed" | "in_production" | "ready" | "completed"
  | "declined" | "cancelled" | "expired";
export interface Invoice {
  id: number; kind: "deposit" | "balance"; amount: number; status: "issued" | "paid";
  issued_at: string; paid_at: string | null; due_date: string | null;
}
export interface TimelineEntry { ts: string; status: string; actor: string; note: string }
export interface InspirationAnalysis {
  summary: string; elements: string[]; colors: string[];
  tiers_estimate: number | null; natural_style_fit: "great" | "adaptable" | "off_brand";
  matched_addons: string[]; concerns: string[];
}
export interface RecipeRef { id: number; name: string; source: string }
export interface Order {
  id: number; status: OrderStatus; created_at: string; hold_expires_at: string | null;
  customer: { id: number; name: string; email: string; phone?: string | null };
  spec: OrderSpec; quote: Quote; final_price: number | null; deposit_amount: number | null;
  balance_amount: number | null; invoices: Invoice[]; timeline: TimelineEntry[];
  owner_note: string | null; decline_reason: string | null; flags: Flag[];
  inspiration: { image_url: string; analysis: InspirationAnalysis | null } | null;
  recipes: { cake?: RecipeRef; filling?: RecipeRef; frosting?: RecipeRef } | null;
  ai_review: { run_id: string; summary: string; recommendation: string; created_at: string;
    risks?: string[]; suggested_price?: number | null } | null;
  calendar: { google_link: string; ics_url: string } | null;
}

// ----- Order Taker chat ---------------------------------------------------------------
export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ChatRequest {
  message: string; history: ChatTurn[]; draft: Partial<OrderSpec>; inspiration_image_id?: number | null;
}
export interface IdeaCard { title: string; description: string; addon_codes: string[]; gallery_slug?: string | null }
export interface Usage { input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number }
export interface ChatResponse {
  reply: string; draft: Partial<OrderSpec>; changed_fields: string[]; ideas: IdeaCard[];
  quote: Quote | null; suggested_dates: string[]; flags: Flag[]; usage: Usage;
}

// ----- Staff ---------------------------------------------------------------------------
export interface SafetyEvent {
  ts: string; kind: string; where: string; severity: "info" | "warn" | "block"; message: string;
  excerpt?: string | null;
}
export interface Dashboard {
  today: string; cash_balance: number; pending_requests: number; awaiting_deposit: number;
  this_week: { date: string; order_id: number; customer: string; title: string; time: string; fulfillment: string }[];
  week_hours: { committed: number; capacity: number };
  spend: { total_usd: number; limit_usd: number; today_usd: number };
  low_stock: { item: string; qty_on_hand: number; par_level: number; unit: string }[];
  recent_safety: SafetyEvent[];
}
export interface RunUsage {
  llm_calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number;
}
export interface RunInfo {
  run_id: string; kind: "order_review" | "plan_week"; status: "running" | "done" | "error" | "stopped";
  started_at: string; finished_at: string | null; summary: string | null; order_id?: number | null;
  week_start?: string | null; usage: RunUsage;
}
export interface RunEvent {
  seq: number; ts: string; agent: string | null; event: string; text: string;
  tool?: string | null; to_agent?: string | null; tokens?: number; cost_usd?: number;
}
export type RunDetail = RunInfo & { events: RunEvent[] };
export interface CalEvent {
  id: number; kind: "pickup" | "delivery" | "prep" | "shopping" | "hold";
  title: string; start: string; end: string; location: string | null; order_id: number | null;
  status: "tentative" | "confirmed"; google_link: string;
}
export interface PlanTask {
  id: string; day: string; start: string; end: string; title: string;
  kind: "bake" | "frosting" | "filling" | "assemble" | "decorate" | "deliver" | "pickup" | "shop" | "prep";
  order_ids: number[]; batch: boolean; notes: string; storage?: string | null;
}
export interface ProductionPlan {
  id: number; week_start: string; created_at: string; status: "draft" | "final";
  run_id: string | null; tasks: PlanTask[]; summary: string; warnings: string[]; batching_savings_minutes: number;
}
export interface ShoppingItem {
  item: string; category: string; need: number; on_hand: number; to_buy: number; unit: string;
  packs: number; pack_label: string; est_cost: number; for_orders: number[];
}
export interface ShoppingList {
  id: number; week_start: string; shop_date: string; created_at: string; status: "draft" | "approved";
  items: ShoppingItem[]; est_total: number; cash_after: number;
}
export interface InventoryItem {
  id: number; item: string; label?: string; category: "ingredient" | "supply"; unit: string; qty_on_hand: number;
  par_level: number; unit_cost: number; pack_size: number; pack_label: string; store: string;
}
export interface Recipe {
  id: number; name: string; kind: "cake" | "frosting" | "filling"; source: "owner" | "web" | "sample";
  source_url: string | null; rating: number | null; review_count: number | null; status: "approved" | "needs_review";
  yield_note: string; ingredients: { item: string; qty: number; unit: string }[]; steps: string[];
  active_minutes: number; shelf_life_days: number; freezer_ok: boolean; flavor_codes: string[];
}
export interface LedgerEntry {
  id: number; date: string; direction: "in" | "out"; amount: number; category: string;
  description: string; order_id: number | null; receipt_id: number | null; demo: boolean;
}
export interface ReceiptItem { item: string; qty: number; unit: string; line_total: number; inventory_id: number | null; inventory_label?: string | null }
export interface Receipt {
  id: number; status: "pending" | "confirmed" | "rejected"; vendor: string; date: string; total: number;
  items: ReceiptItem[]; image_url: string; flags: Flag[]; reject_reason?: string | null;
}
export interface CashSummary {
  balance: number; seed: number; money_in: number; money_out: number; ledger: LedgerEntry[];
  by_order: { order_id: number; customer: string; revenue: number; ingredient_cost_est: number; margin_est: number }[];
  pending_receipts: Receipt[];
}
export interface Draft {
  id: number; kind: string; to: string; subject: string; body: string; order_id: number | null;
  created_at: string; gmail_link: string;
}
export interface TokenRow {
  llm_calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number;
}
export interface Tokenomics {
  prices: { model: string; input_per_m: number; cached_input_per_m: number; output_per_m: number };
  totals: TokenRow;
  by_agent: (TokenRow & { agent: string })[];
  by_feature: { feature: string; runs: number; avg_cost_usd: number; avg_input_tokens: number; avg_output_tokens: number; avg_cached_tokens: number }[];
  per_order_usd: number; per_user_month_usd: number; per_bakery_month_usd: number;
  projections: { users: number; monthly_usd: number }[];
  assumptions: string[]; cost_cutting: { step: string; effect: string }[];
}
export interface Settings {
  per_serving_rate: number; min_price: number; deposit_pct: number; min_lead_days: number;
  spend_limit_usd: number; work_blocks: WorkBlock[];
}
