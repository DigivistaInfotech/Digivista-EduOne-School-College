# School ERP — Rang-Biranga Edition Visual Design System

## 1. Brand Identity & Creative Direction

**Product Name:** School ERP (Rang-Biranga Edition)  
**Target Context:** Established Indian CBSE K-12 Institution (Classes 1–12, 1,200+ Students)  
**Visual Personality:**
- Vibrant, welcoming, culturally harmonious Indian school administration platform.
- Rigorous financial and operational clarity for management, principals, coordinators, and accountants.
- Delightful, uncluttered, intuitive experience for teachers, parents, and students.
- Deliberate information hierarchy preventing sensory overload through calm background grounding (`#FFF9EC`) contrasted with structured dark-teal navigation (`#0B3F4B`) and vibrant accents.

---

## 2. Colour System & Token Architecture

All colors are tokenized via CSS custom properties in `apps/web/src/index.css` and mapped into Tailwind / component styling:

### 2.1 Core Palette Tokens
| Token Name | Hex Code | Role & Usage |
|---|---|---|
| `--color-deep-teal` | `#0B3F4B` | Global sidebar background, top headers, primary branding anchor |
| `--color-dark-teal` | `#103F49` | Sidebar submenu hover, deep table header borders, hero cards |
| `--color-warm-cream` | `#FFF9EC` | Workspace foundation, main application background |
| `--color-coral` | `#FF756B` | Primary call-to-action buttons, high-priority notifications, badges |
| `--color-golden-yellow` | `#FFC83D` | Active navigation pill, attention-seeking badges, pending status |
| `--color-mint` | `#37CDA8` | Success badges, verified payments, full attendance status, approval buttons |
| `--color-sky-blue` | `#55BDEB` | Informational cards, timetable blocks, CBSE circular indicators |
| `--color-purple` | `#A979E8` | Library catalogue badges, examination tags, category accents |
| `--color-main-text` | `#24424A` | High-contrast readable typography for all data, tables, and prose |
| `--color-muted-text` | `#71858A` | Subtitles, helper text, table column labels, disabled states |
| `--color-white-surface` | `#FFFFFF` | Card containers, modals, table rows, dropdown panels |

### 2.2 Pastel KPI Indicator Palette
- **Pastel Coral:** `rgba(255, 117, 107, 0.12)` (Shortage warnings, fee overdue)
- **Pastel Yellow:** `rgba(255, 200, 61, 0.18)` (Pending verifications, offline queue)
- **Pastel Mint:** `rgba(55, 205, 168, 0.14)` (Verified payments, high attendance, active fleet)
- **Pastel Sky:** `rgba(85, 189, 235, 0.15)` (Active student counts, homework submitted)
- **Pastel Purple:** `rgba(169, 121, 232, 0.14)` (Staff profiles, book loans issued)

---

## 3. Typography & Hierarchy

### 3.1 Dual-Type Architecture
1. **Headings & Brand Titles:**
   - Font family: `Playfair Display`, `Georgia`, serif
   - Weight: `600`, `700`
   - Usage: App logo, welcome banner greetings, dashboard page titles, modal titles, certificate headers.
2. **Body, Navigation, Forms & Data Tables:**
   - Font family: `Inter`, system-ui, -apple-system, `Segoe UI`, Roboto, sans-serif
   - Weight: `400` (regular), `500` (medium), `600` (semibold), `700` (bold)
   - Usage: Form inputs, numeric values, tabular grids, badges, tooltips.

---

## 4. Main Application Shell

### 4.1 Desktop Layout (>= 1024px)
- **Sidebar (`<AppShell />`):**
  - Width: Fixed `260px` (or collapsed `72px`).
  - Background: Deep Teal (`#0B3F4B`).
  - School logo and CBSE affiliation tag at header.
  - Categorized navigation: Academic, Operations, People, Finance, Portals, Governance.
  - Selected navigation state: Rounded golden-yellow pill (`#FFC83D`) with deep teal typography (`#0B3F4B`) and shadow.
- **Top Bar:**
  - Background: Warm Cream / Translucent White with subtle border.
  - Shows current Academic Year (`2026-27 ACTIVE`), School Selector, Search, Notification Bell, and User Profile.
- **Workspace:**
  - Background: Warm Cream (`#FFF9EC`).
  - Padded content container (`max-w-7xl mx-auto p-6 md:p-8`).

### 4.2 Mobile Responsiveness (< 1024px)
- Sidebar collapses into an accessible slide-over drawer toggled via the hamburger icon.
- Golden-yellow active links and high-contrast touch targets (minimum 44x44px).
- KPI cards stack cleanly in a single-column or 2x2 grid.
- Tables support responsive horizontal scrolling with sticky primary column (`Admission Number` / `Student Name`).

---

## 5. Standard Component Guidelines

1. **KPI Cards:**
   - Rounded corners (`rounded-2xl`).
   - White surface with 4px bottom border in accent color (coral, yellow, mint, sky, purple).
   - Large bold figure (`text-3xl font-bold text-teal-950`).
   - Interactive hover lift (`transition hover:-translate-y-0.5 shadow-sm hover:shadow-md`).
2. **Buttons:**
   - **Primary Action:** Coral (`bg-[#FF756B] hover:bg-[#ff6257] text-white font-semibold rounded-xl px-4 py-2`).
   - **Secondary Action:** Teal outline (`border border-[#0B3F4B] text-[#0B3F4B] hover:bg-teal-50 rounded-xl px-4 py-2`).
   - **Success / Approval:** Mint (`bg-[#37CDA8] hover:bg-[#2eb996] text-white font-semibold rounded-xl px-4 py-2`).
   - **Destructive:** Rose red (`bg-rose-600 hover:bg-rose-700 text-white rounded-xl px-4 py-2`).
3. **Status Badges:**
   - Pill-shaped (`rounded-full px-2.5 py-0.5 text-xs font-semibold`).
   - `verified` / `present`: Mint background with dark green text.
   - `pending` / `more_info_needed`: Yellow background with dark amber text.
   - `absent` / `rejected` / `shortage`: Coral background with dark red text.
