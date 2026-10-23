# Garden Party Cake Studio: API contract (backend ↔ frontend)

This is the working contract used to build the frontend and backend in parallel. It gets folded into `harness.md`.

- **Backend:** FastAPI on `http://localhost:8000`. Run from the project root with `python -m uvicorn backend.main:app --port 8000`.
- **Frontend:** Vite on `http://localhost:5173`. It proxies `/api/*` to `:8000`, so cookies are same-origin and there's no CORS.
- **Auth:**
  - Logging in sets an httpOnly cookie, `gp_session`. The server stores only a SHA-256 hash of the token.
  - Roles are `customer` and `staff`, enforced on the server.
  - Errors return `{ "detail": string }` with codes 400, 401, 403, 404, 409 or 429.
- **Data:** money is USD in dollars (`number`, 2 decimals). Dates are `YYYY-MM-DD`. Times are `HH:MM` (24h). Timestamps are ISO strings.

## Shared types (TypeScript)

```ts
type Role = "customer" | "staff";
interface User { id: number; name: string; email: string; role: Role; phone?: string | null;
  allergies?: string | null; preferences?: string | null; }

interface SizeOption { id: number; code: string; label: string; tiers: number; servings: number;
  labor_hours: number; base_price: number; description: string; }
interface Flavor { code: string; name: string; kind: "cake" | "filling" | "frosting"; premium: boolean;
  upcharge: number; allergens: string[]; description: string; }
type PriceType = "flat" | "per_tier" | "per_serving" | "percent";
interface Addon { id: number; code: string; name: string;
  category: "florals" | "fruit_nuts" | "finish" | "dietary" | "extras";
  price: number; price_type: PriceType; labor_hours: number; allergens: string[];
  description: string; needs_review: boolean; }
interface GalleryItem { id: number; slug: string; title: string; image: string; // e.g. "/gallery/meadow.svg"
  description: string; tags: string[]; addon_codes: string[]; size_code: string; from_price: number; }
interface Policies { min_price: number; per_serving_rate: number; deposit_pct: number; min_lead_days: number;
  hold_hours: number; rush_days: number; rush_pct: number; delivery_fees: Record<string, number>;
  work_blocks: { weekday: number; start: string; end: string }[]; // weekday 0=Mon..6=Sun
  pickup_weekdays: number[]; style_note: string; }
interface Menu { sizes: SizeOption[]; flavors: { cake: Flavor[]; filling: Flavor[]; frosting: Flavor[] };
  addons: Addon[]; gallery: GalleryItem[]; policies: Policies; }

interface AddonPick { code: string; qty: number; }
interface OrderSpec {
  occasion: string; guest_count?: number | null; recipient_name?: string | null;
  size_code: string; cake_flavor: string; filling: string; frosting: string;
  addons: AddonPick[]; design_notes: string; message_on_cake?: string | null;
  inspiration_image_id?: number | null; allergies: string; dietary?: string | null;
  pickup_date: string | null; pickup_time: string | null;
  fulfillment: "pickup" | "delivery"; delivery_zone?: "new_haven" | "nearby" | "far" | null;
  delivery_address?: string | null;
}
interface Flag { code: string; severity: "info" | "warn" | "block"; message: string; }
interface QuoteLine { code: string; label: string; amount: number; }
interface Quote { lines: QuoteLine[]; servings: number; base_price: number; addons_total: number;
  rush_fee: number; delivery_fee: number; total: number; deposit: number; balance: number;
  labor_hours: number; rule: string; flags: Flag[]; }

type DayStatus = "available" | "limited" | "full" | "too_soon" | "closed" | "past";
interface AvailabilityDay { date: string; status: DayStatus; free_hours_before: number; note?: string; }
interface Availability { labor_hours: number; lead_days: number; first_available: string | null;
  days: AvailabilityDay[]; }

type OrderStatus = "requested" | "accepted" | "confirmed" | "in_production" | "ready" | "completed"
  | "declined" | "cancelled" | "expired";
interface Invoice { id: number; kind: "deposit" | "balance"; amount: number; status: "issued" | "paid";
  issued_at: string; paid_at: string | null; due_date: string | null; }
interface TimelineEntry { ts: string; status: string; actor: string; note: string; }
interface InspirationAnalysis { summary: string; elements: string[]; colors: string[];
  tiers_estimate: number | null; natural_style_fit: "great" | "adaptable" | "off_brand";
  matched_addons: string[]; concerns: string[]; }
interface Order {
  id: number; status: OrderStatus; created_at: string; hold_expires_at: string | null;
  customer: { id: number; name: string; email: string; phone?: string | null };
  spec: OrderSpec; quote: Quote; final_price: number | null; deposit_amount: number | null;
  balance_amount: number | null; invoices: Invoice[]; timeline: TimelineEntry[];
  owner_note: string | null; decline_reason: string | null; flags: Flag[];
  inspiration: { image_url: string; analysis: InspirationAnalysis | null } | null;
  recipes: { cake?: RecipeRef; filling?: RecipeRef; frosting?: RecipeRef } | null;
  ai_review: { run_id: string; summary: string; recommendation: string; created_at: string } | null;
  calendar: { google_link: string; ics_url: string } | null;
}
interface RecipeRef { id: number; name: string; source: string; }
```

## Public routes
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true, today: string, llm_configured: boolean }` |
| GET | `/api/menu` | – | `Menu` |
| POST | `/api/quote` | `OrderSpec` (partial ok) | `Quote` |
| GET | `/api/availability?size_code=&addons=code1,code2&days=75` | – | `Availability` |
| POST | `/api/auth/register` | `{ name, email, password, phone? }` | `{ user: User }` (and sets cookie) |
| POST | `/api/auth/login` | `{ email, password }` | `{ user: User }`. 429 when rate-limited |
| POST | `/api/auth/logout` | – | `{ ok: true }` |
| GET | `/api/auth/me` | – | `{ user: User \| null }` |

## Order Taker chat (the customer-facing agent)
**POST `/api/concierge/chat`.** Anonymous users are allowed, rate-limited by IP. A logged-in user also gets their order history.

The client keeps the conversation and sends the last turns:

```ts
interface ChatTurn { role: "user" | "assistant"; content: string; }
interface ChatRequest { message: string; history: ChatTurn[]; draft: Partial<OrderSpec>;
  inspiration_image_id?: number | null; }
interface IdeaCard { title: string; description: string; addon_codes: string[]; gallery_slug?: string | null; }
interface ChatResponse {
  reply: string;                 // plain text, may contain line breaks
  draft: Partial<OrderSpec>;     // merged draft: the agent fills fields it learned
  changed_fields: string[];      // fields the agent changed this turn (highlight them)
  ideas: IdeaCard[];             // 0-3 inspiration cards
  quote: Quote | null;           // present when the draft has enough to price
  suggested_dates: string[];     // up to 5 available pickup dates (from the capacity tool)
  flags: Flag[];                 // e.g. injection_detected, off_brand_request
  usage: { input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number };
}
```

## Customer routes (login required)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/uploads/inspiration` | multipart `file` (jpg/png/webp, max 6 MB) | `{ image_id, url, analysis: InspirationAnalysis }` |
| GET | `/api/uploads/{image_id}` | – | the image (owner or staff only) |
| POST | `/api/orders` | `OrderSpec` | `Order` (status `requested`). 409 if the date is no longer available |
| GET | `/api/orders/mine` | – | `Order[]` (newest first) |
| GET | `/api/orders/{id}` | – | `Order` (own order, or staff) |
| POST | `/api/orders/{id}/cancel` | – | `Order` (only while `requested`) |
| POST | `/api/orders/{id}/invoices/{invoice_id}/pay` | – | `Order`. **Demo payment, no money moves**; the cash ledger records a demo receipt |
| GET | `/api/ideas` | – | `{ ideas: IdeaCard[], based_on: string[] }`. Ideas from order history, cached per user per day |

## Staff routes (role `staff`)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/staff/dashboard` | – | `Dashboard` (below) |
| GET | `/api/staff/orders?status=` | – | `Order[]` |
| POST | `/api/staff/orders/{id}/accept` | `{ final_price: number, owner_note?: string }` | `Order` → `accepted`; issues the deposit invoice, a draft email and a tentative calendar hold |
| POST | `/api/staff/orders/{id}/decline` | `{ reason: string }` | `Order` |
| POST | `/api/staff/orders/{id}/status` | `{ status: "in_production" \| "ready" \| "completed" }` | `Order` |
| POST | `/api/staff/orders/{id}/balance-paid` | – | `Order` (demo payment of the balance at pickup) |
| POST | `/api/staff/orders/{id}/review` | – | `{ run_id }`: the agent team reviews the order (background) |
| POST | `/api/staff/plan-week` | `{ week_start?: string }` (a Monday) | `{ run_id }`: Boss → Recipe → Inventory → Cash → Task |
| GET | `/api/staff/runs` | – | `RunInfo[]` (newest first) |
| GET | `/api/staff/runs/{run_id}` | – | `RunInfo & { events: RunEvent[] }` |
| GET | `/api/staff/calendar?start=&end=` | – | `{ events: CalEvent[] }` |
| GET | `/api/staff/calendar.ics` | – | text/calendar file (all confirmed and tentative events) |
| GET | `/api/staff/plan?week_start=` | – | `ProductionPlan \| null` (latest plan for that week) |
| GET | `/api/staff/shopping-list?week_start=` | – | `ShoppingList \| null` |
| POST | `/api/staff/shopping-list/{id}/approve` | – | `ShoppingList` |
| GET | `/api/staff/inventory` | – | `InventoryItem[]` |
| PATCH | `/api/staff/inventory/{id}` | `{ qty_on_hand: number }` | `InventoryItem` |
| GET | `/api/staff/recipes` | – | `Recipe[]` |
| POST | `/api/staff/recipes/{id}/approve` | – | `Recipe` (web-found recipes need owner approval before use) |
| GET | `/api/staff/cash` | – | `CashSummary` |
| POST | `/api/staff/receipts` | multipart `file` | `Receipt` (status `pending`, items extracted by vision) |
| POST | `/api/staff/receipts/{id}/confirm` | `{ vendor, date, total, items: ReceiptItem[] }` | `Receipt` (`confirmed`) → cash out, inventory updated |
| GET | `/api/staff/drafts` | – | `Draft[]` (emails, never sent; each has a Gmail compose link) |
| GET | `/api/staff/tokenomics` | – | `Tokenomics` |
| GET | `/api/staff/safety` | – | `{ events: SafetyEvent[] }` |
| GET | `/api/staff/settings` | – | `Settings` |
| PUT | `/api/staff/settings` | `Partial<Settings>` | `Settings` |
| POST | `/api/staff/reset-demo` | – | `{ ok: true }`: rebuilds the demo database from the seed |

```ts
interface Dashboard {
  today: string; cash_balance: number; pending_requests: number; awaiting_deposit: number;
  this_week: { date: string; order_id: number; customer: string; title: string; time: string; fulfillment: string }[];
  week_hours: { committed: number; capacity: number };
  spend: { total_usd: number; limit_usd: number; today_usd: number };
  low_stock: { item: string; qty_on_hand: number; par_level: number; unit: string }[];
  recent_safety: SafetyEvent[];
}
interface RunInfo { run_id: string; kind: "order_review" | "plan_week"; status: "running" | "done" | "error" | "stopped";
  started_at: string; finished_at: string | null; summary: string | null; order_id?: number | null;
  week_start?: string | null; usage: { llm_calls: number; input_tokens: number; cached_tokens: number;
  output_tokens: number; cost_usd: number }; }
interface RunEvent { seq: number; ts: string; agent: string | null; event: string; text: string; // plain-English narration
  tool?: string | null; to_agent?: string | null; tokens?: number; cost_usd?: number; }
interface CalEvent { id: number; kind: "pickup" | "delivery" | "prep" | "shopping" | "hold";
  title: string; start: string; end: string; location: string | null; order_id: number | null;
  status: "tentative" | "confirmed"; google_link: string; }
interface PlanTask { id: string; day: string; start: string; end: string; title: string; kind: "bake" | "frosting" |
  "filling" | "assemble" | "decorate" | "deliver" | "pickup" | "shop" | "prep";
  order_ids: number[]; batch: boolean; notes: string; storage?: string | null; }
interface ProductionPlan { id: number; week_start: string; created_at: string; status: "draft" | "final";
  run_id: string | null; tasks: PlanTask[]; summary: string; warnings: string[]; batching_savings_minutes: number; }
interface ShoppingItem { item: string; category: string; need: number; on_hand: number; to_buy: number; unit: string;
  packs: number; pack_label: string; est_cost: number; for_orders: number[]; }
interface ShoppingList { id: number; week_start: string; shop_date: string; created_at: string; status: "draft" | "approved";
  items: ShoppingItem[]; est_total: number; cash_after: number; }
interface InventoryItem { id: number; item: string; category: "ingredient" | "supply"; unit: string; qty_on_hand: number;
  par_level: number; unit_cost: number; pack_size: number; pack_label: string; store: string; }
interface Recipe { id: number; name: string; kind: "cake" | "frosting" | "filling"; source: "owner" | "web" | "sample";
  source_url: string | null; rating: number | null; review_count: number | null; status: "approved" | "needs_review";
  yield_note: string; ingredients: { item: string; qty: number; unit: string }[]; steps: string[];
  active_minutes: number; shelf_life_days: number; freezer_ok: boolean; flavor_codes: string[]; }
interface LedgerEntry { id: number; date: string; direction: "in" | "out"; amount: number; category: string;
  description: string; order_id: number | null; receipt_id: number | null; demo: boolean; }
interface CashSummary { balance: number; seed: number; money_in: number; money_out: number; ledger: LedgerEntry[];
  by_order: { order_id: number; customer: string; revenue: number; ingredient_cost_est: number; margin_est: number }[];
  pending_receipts: Receipt[]; }
interface ReceiptItem { item: string; qty: number; unit: string; line_total: number; inventory_id: number | null; }
interface Receipt { id: number; status: "pending" | "confirmed"; vendor: string; date: string; total: number;
  items: ReceiptItem[]; image_url: string; flags: Flag[]; }
interface Draft { id: number; kind: string; to: string; subject: string; body: string; order_id: number | null;
  created_at: string; gmail_link: string; }
interface Tokenomics {
  prices: { model: string; input_per_m: number; cached_input_per_m: number; output_per_m: number };
  totals: { llm_calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number };
  by_agent: { agent: string; llm_calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number }[];
  by_feature: { feature: string; runs: number; avg_cost_usd: number; avg_input_tokens: number; avg_output_tokens: number; avg_cached_tokens: number }[];
  per_order_usd: number; per_user_month_usd: number; per_bakery_month_usd: number;
  projections: { users: number; monthly_usd: number }[]; // 1, 100, 10000 bakeries
  assumptions: string[]; cost_cutting: { step: string; effect: string }[];
}
interface SafetyEvent { ts: string; kind: string; where: string; severity: "info" | "warn" | "block"; message: string;
  excerpt?: string | null; }
interface Settings { per_serving_rate: number; min_price: number; deposit_pct: number; min_lead_days: number;
  spend_limit_usd: number; work_blocks: { weekday: number; start: string; end: string }[]; }
```
