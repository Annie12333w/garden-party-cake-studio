# Garden Party Cake Studio: design notes

## Brand
- **Voice:** "Fruits, florals, foliage." Martha Stewart–style entertaining, a long garden table, what's in season.
- **Position:** high-end and natural. Buttercream only, fresh flowers, fruit, nuts and icing sugar; **no fondant, nothing artificial-looking**. The copy says so plainly ("If you want a grocery-store cake, the grocery store does it well"), and the Order Taker steers customers the same way.
- **Feel:** quiet luxury. Lots of cream space, thin rules, serif headlines, small uppercase eyebrows, soft shadows.

## Palette (`src/styles.css` `:root`)
| Token | Hex | Use |
|---|---|---|
| cream | `#faf6ef` | page background |
| paper | `#fffdf9` | cards, panels |
| linen | `#f3ecdf` | tinted sections, assistant chat bubbles |
| sage / sage-soft | `#8a9a6b` / `#dfe5d2` | accents, selected states, bars, "open" days |
| olive | `#6f7f5a` | eyebrows, outline buttons |
| moss / moss-2 | `#2f3a26` / `#4d5b3a` | text, primary buttons, footer |
| blush / blush-soft | `#e7b3ad` / `#f6e3df` | petals, highlights, changed-field glow, pickups |
| rose / plum | `#b8475a` / `#6f2c3f` | links on hover, current step, deliveries |
| honey / gold | `#c98a5a` / `#9a7b3f` | flower centres, shopping events, cash |
| ok / warn / bad | `#4f7a43` / `#b0722a` / `#a43d3d` | status and flags |

## Typography
- **Display:** Cormorant Garamond (Google Fonts), falling back to Georgia. Used for headlines, prices, stat values and card titles.
- **Body:** Jost (Google Fonts), falling back to Helvetica Neue / Segoe UI / system. Light weight for lead paragraphs, small uppercase letter-spaced eyebrows.

## Imagery
- `public/gallery/*.svg` holds 8 **placeholder** botanical cake illustrations, made with `scratchpad/make_gallery.py`: meadow, berry-crown, citrus-grove, pressed-petal, fig-pistachio, sugared-plum, wildflower-tier, lemon-elderflower. Replace them with real photos; see `public/gallery/README.md`.
- `public/logo-mark.svg` is a small round cake-and-leaf mark, also used as the favicon. The wordmark is "Garden Party" in serif over "CAKE STUDIO" in spaced sans.

## Page map
**Public site** (`SiteLayout`: sticky header, moss footer)
- `/` Home: hero, brand story ("Natural, never artificial"), featured gallery, a 5-step "How ordering works" (dream → request → owner review → deposit → bake and pick up).
- `/menu` Menu and pricing: the pricing rule `max($150, servings × rate) + add-ons` as a formula card, sizes (with tier drawings), flavors, add-ons by category, policies (deposit, notice, style, pickup days).
- `/gallery` Gallery: cards with tags and "Start from this →" (opens `/order?inspo=slug`, which pre-fills the size, add-ons and notes).
- `/order` **Order page (the centrepiece):** two columns.
  - **Left:** the Order Taker chat. It has a static greeting (no LLM call), starter chips, idea cards with "Use this idea", suggested-date chips, a thinking indicator, Enter to send / Shift+Enter for a new line, and the cost of the last reply.
  - **Right:** the live Order Builder, in 7 numbered sections: occasion, size, flavors, personal touches (add-ons with quantity), inspiration photo (vision analysis), allergies, and date and pickup (capacity calendar, time, delivery zone).
  - Below the builder are the live quote box and "Request this date".
- `/login`: sign-in / create-account tabs.
- `/account` (logged in): upcoming and past orders, each with:
  - a status stepper
  - invoices with **Pay deposit (demo)**
  - Add to Google Calendar
  - cancel while still requested
  - details and timeline

  A sidebar shows "Ideas for your next cake" from order history.

**Studio portal** (`/staff`, staff role only; `StaffLayout` with a sidebar):
- **Dashboard:** cash, requests to review, awaiting deposit, this week's hours vs capacity, AI spend vs limit, this week's agenda, low stock, recent safety catches.
- **Orders:** status filter tabs, a list, and a detail view. The detail view has:
  - the spec, the calculated quote and any flags
  - the inspiration photo and its analysis
  - **Run AI review**, with the run log streaming live
  - the decision box: final price (prefilled with the quote) and note, then Accept & send deposit invoice, or Decline with a reason
  - status buttons, Record balance paid (demo), and the timeline
- **Calendar:** two-week grid, colour by kind (pickup, delivery, prep, shopping, tentative hold), dashed borders for tentative events, **Download .ics**, and a "+ Google" link on each event.
- **Production plan:** week picker and **Plan my week** (live run log). Tasks are grouped by day, with time, kind icon, **batch** badge, order links, notes and storage. Also shows warnings and minutes saved by batching.
- **Shopping list:** the Monday list grouped by category: need / on hand / to buy / packs / estimated cost / for orders. Each line has a tick-off checkbox. Also shows estimated total, cash after shopping, and Approve and Print buttons.
- **Inventory:** editable quantities, items below par highlighted, filters.
- **Recipes:** library cards (source, rating and review count, shelf life, freezer-friendly); web-found recipes wait as *needs review* with an Approve button.
- **Cash:** balance, seed, money in and out, the ledger (demo entries marked), margin by order, and **Upload a receipt**. The AI-extracted lines are editable, and nothing is recorded until you confirm.
- **Agent runs:** a team diagram (Boss → Order Taker, Recipe Collector, Inventory, Cash Manager, Task Planner), a run list, and a narrated event log with an avatar for each agent and the cost of each step.
- **Tokenomics:** totals, cache share, per order and per customer per month, cost by agent and by feature (CSS bars), a projections table (1 / 100 / 10,000 bakeries), an orders-per-month slider, assumptions, and the cost-cutting list.
- **Safety:** a defenses summary and a guardrail-catch table (severity, kind, where, excerpt).
- **Email drafts:** drafts only, each with **Open in Gmail** (a compose link, so no Google login).
- **Settings:** per-serving rate, minimum price, deposit %, lead days, work blocks editor, spend limit, **Reset demo data**.

## Key UX decisions
1. **Chat and form side by side, sharing one draft.** The agent fills fields as it learns them, and the fields it changed glow blush for about 4.5 seconds. The customer can always edit the form directly, so the AI never boxes them in.
2. **Prices are always shown as calculated by the backend price table** (debounced `POST /api/quote`), with the rule printed under the total. Every quote is labelled an estimate, and the studio sets the final price when it accepts.
3. **Capacity-aware calendar.** Days are coloured open / limited / booked / too soon / closed. You can only pick open or limited days, and each day's tooltip explains why. The text says how many studio hours the cake needs, which makes the scarcity feel honest rather than arbitrary.
4. **Login is only asked for when needed.** Browsing, chatting and building a quote need no account. Uploading a photo or submitting opens an inline sign-in or register form, and the draft and chat are kept in `sessionStorage`, so nothing is lost.
5. **Every payment is clearly labelled a demo** ("Pay deposit (demo)", "Record balance paid (demo)", "no card is charged").
6. **The human makes every irreversible call:** accept or decline, final price, approving web recipes, approving the shopping list, confirming receipts. Agents propose; buttons dispose.
7. **Plain-English agent logs**, with per-step cost, make the team's work visible for debugging, for the demo, and for the report screenshots.
8. **Responsive:**
   - Under 1080 px, the order page stacks with the chat on top.
   - Under 820 px, the site nav collapses to a burger, and the staff sidebar becomes an off-canvas drawer.
   - The calendar becomes a list.
   - The print stylesheet hides the navigation, for the shopping list.

## Restyle in the HW 4 style (2026-10-20)
The public site now follows the same quiet-luxury system as the HW 4 Campus Customs restyle (modelled on J.Press), using Garden Party's colors: cream, moss and blush.

| Change | What we did | Why it helps |
|---|---|---|
| Announcement bar and centered logo | A thin moss bar ("Custom cakes by request · New Haven, Connecticut"). Menu, Gallery and Order on the left, the wordmark centered, Sign in and Create account on the right. Small, widely spaced uppercase links with a hairline underline on hover and on the current page. | Looks like an established atelier. |
| Full-bleed photo banners | The home hero, "Made for candlelight", and slim banners on Menu and Gallery all use the owner's real photos with `object-fit: cover` (cropped, never stretched). The hero has a left-side shade so the headline stays readable over flowers, and centered banners get an even tint. | The cakes themselves sell the studio. |
| Editorial splits | "Fresh from the garden" (florals photo) and "Showstoppers" (croquembouche), alternating image and text. | Gives visitors a reason to click at each stop down the page. |
| Borderless, image-led cards | Cakes sit on a stone backdrop in 4:5 frames, with no borders or shadows, and zoom slightly on hover. Name, "from" price and one line of description sit below. | Reads as a curated collection, not a spreadsheet. |
| Square buttons and hairlines | Square buttons with uppercase letter-spacing, text links with an underline, square cards in the staff portal too. | Calm and consistent; it justifies premium prices. |
| Photo login | A split layout: the Sweetheart cake on one side, a form with underline-style fields on the other. Sign in and Create account are tabs, and `?mode=register` opens the second. | Makes creating an account feel inviting. |
| Value row | Buttercream only · Grown, not printed · Reviewed by hand. | Repeats the brand promise before the footer. |

**Files:**
- new: `src/editorial.css`, `components/Banner.tsx`, `components/Editorial.tsx`
- rewritten: `SiteLayout.tsx`, `HomePage.tsx`, `GalleryPage.tsx`
- updated: the `LoginPage` layout and the `MenuPage` banner

**Screenshots:** `output/screenshots/style/`
