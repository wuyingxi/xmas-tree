# Wish Bookmarks (匿名圣诞祝福书签) — Approved Design

- **Goal**: Let every visitor anonymously write a Christmas wish (no admin token needed) and hang it as a 3D bookmark/wish-tag ornament on the Christmas tree, shared across all visitors on the Linux server.
- **Approach**: Extend existing Python stdlib backend (`server/app.py`) with JSON persistence (`data/wishes.json`) + per-IP rate limiting + admin delete; add a standalone Three.js module (`web/js/wishes.js`) rendering high-DPI vertical gold-trimmed bookmark ornaments that hang, sway, scatter, and gather with the tree, plus click-to-read lightbox and a write/browse UI. Rejected adding a DB or separate framework to keep zero extra dependencies.
- **API**:
  - `GET /api/wishes` -> `{"wishes": [{id, text, author, theme, t}]}` (newest first)
  - `POST /api/wishes` (public, JSON `{text, author?, theme?}`, rate-limited 5 req/min per IP, text 1..80 chars, author 0..16 chars, max 120 wishes) -> `201 {"wish": ...}`
  - `DELETE /api/wishes/<id>` (`X-Admin-Token` required) -> `200 {"ok": true}`
- **Visual & UX**:
  - 5 festive bookmark themes (`crimson`, `emerald`, `gold`, `midnight`, `burgundy`) with punched top eyelet, gold hanging string, tassel tip, foil border, and crisp text preview.
  - Clicking any 3D bookmark (formed or scattered) opens a crisp reading modal; toolbar `🔖 写祝福` opens the write + browse-all modal; admin drawer gains a wishes tab/section to delete any wish when authenticated.
  - OK hand gesture stays dedicated to showcasing photos.
