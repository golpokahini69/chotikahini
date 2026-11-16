# Admin Panel Technical Audit — Chotikahini

> Audit date: 2026-11-06. Scope: `/admin` UI, `app/api/admin/**` routes, RBAC, data model, publishing workflow, and the existing documentation.
> Every claim below was verified against the source files at the paths and line numbers given.
> Project: Next.js **14.2** App Router (`package.json` pins `next: ^14.2.0`), React 18.3, Tailwind 3.4, Supabase.

## 0. Executive Summary / Key Findings

| # | Finding | Severity |
|---|---|---|
| 1 | **Next.js is v14.2.35, not 15** (`package.json` pins `next: ^14.2.0`; installed `node_modules/next` = 14.2.35) | Correction to premise |
| 2 | `CMS_INSTRUCTIONS.md` describes a **GitHub-file-based CMS** that no longer exists — the panel is now Supabase-backed | **Critical doc/code gap** |
| 3 | `GET /api/admin/site-settings` has **no auth check at all** (`app/api/admin/site-settings/route.ts:13-43`) | **High** |
| 4 | `DELETE /api/admin/crawler/publish` performs **permanent story deletion** gated only by `content.create` — bypasses the documented permanent-delete workflow (`app/api/admin/crawler/publish/route.ts:268-287`) | **High** |
| 5 | `app/admin/comments/page.tsx`, `reports/page.tsx`, `audit-logs/page.tsx` use **hard-coded role arrays** instead of `hasPermission()` — violates the stated "single source of truth" rule | Medium |
| 6 | `app/admin/users/page.tsx` has **no client-side permission guard** (relies only on the API's 401) | Medium |
| 7 | `StoryEditor.handleSave(isDraft)` **ignores the `isDraft` parameter** — "Save Draft" and "Publish" hit the same endpoint | Medium |
| 8 | `notifications` PATCH/DELETE single-item paths **omit the role/type scope filter** (`.eq("id", id)` only) | Medium |
| 9 | `README.md` / `PROJECT_ARCHITECTURE.md` document a **GitHub/MDX + 4-role model**; reality is Supabase + **6 roles** | **Critical doc/code gap** |
| 10 | `PROJECT_ARCHITECTURE.md` references `GET/DELETE /api/admin/github` — **this route does not exist** | Doc gap |

---

## 1. Entry Point & Routing

### Architecture
A **Next.js App Router** panel (not a SPA). The public site lives under `app/(bn)/` (a route group); `app/admin/` is a **real path segment** (not a group), so it has no root layout to inherit.

### Files

**`app/admin/layout.tsx`** (45 lines) — the server-side gate:
- L7-18: `metadata` with `robots: { index: false, follow: false, nocache: true, googleBot: {...} }`
- L22: `export const dynamic = "force-dynamic"` — auth re-evaluated every request
- L34: `const isAuthed = await isAdminAuthenticated()`
- L41-43: renders `<AdminShell>{isAuthed ? children : <AccessDenied title="Admin access required" />}</AdminShell>`

**`app/admin/page.tsx`** (43 lines):
- L14: `await isAdminAuthenticated()` → renders inline "Access Denied" block (L17-24) — **duplicates** the layout's `AccessDenied` component
- L28-40: `getAllPostsAsync()` → maps to `publishedPosts` with a **hard-coded `status: "published"`** (L38) and `history: []` (L39)
- L42: `<AdminDashboard publishedPosts={publishedPosts} />`

**`components/layouts/AdminShell.tsx`** (152 lines) — renders `<html>`/`<body>` itself (L97-113), injects `ThemeStyles` (L40-89) with `--color-*` CSS vars, a dark-mode flash-guard inline script (L102-108), GA/GTM tags, and wraps children in `<ThemeProvider><AuthProvider>` (L146-148).

### Route inventory

| Route | File | Type | Permission |
|---|---|---|---|
| `/admin` | `app/admin/page.tsx` | Server | `isAdminAuthenticated()` (canAccessAdmin) |
| `/admin/announcement` | `app/admin/announcement/page.tsx` (222 L) | Client | `announcements.edit` (L32, L90) |
| `/admin/applications` | `app/admin/applications/page.tsx` (190 L) | Client | `authors.manage` (L22, L107) |
| `/admin/audit-logs` | `app/admin/audit-logs/page.tsx` (139 L) | Client | hard-coded `["admin","superadmin"]` (L35) |
| `/admin/comments` | `app/admin/comments/page.tsx` (271 L) | Client | hard-coded `["superadmin","admin","moderator"]` (L32, L64) |
| `/admin/editor` | `app/admin/editor/page.tsx` (149 L) | Server | `isAuthorAuthenticated()` (L18) — **not** admin-only |
| `/admin/pictures` | `app/admin/pictures/page.tsx` (53 L) | Server | `media.upload` (L16) |
| `/admin/reports` | `app/admin/reports/page.tsx` (193 L) | Client | hard-coded `["superadmin","admin","moderator"]` (L32) |
| `/admin/settings` | `app/admin/settings/page.tsx` (53 L) | Client | `settings.view` (L22) |
| `/admin/users` | `app/admin/users/page.tsx` (577 L) | Client | **none** (no `hasPermission` check) |
| `/admin/videos` | `app/admin/videos/page.tsx` (39 L) | Server | `media.upload` (L16) |

**Sub-section routing.** The dashboard is a **single page with 9 in-page sections** driven by `?section=`. `AdminDashboard.tsx:105-108`:
```
"dashboard" | "review" | "authors" | "messages" | "notifications"
| "verify" | "deletions" | "similarity" | "autopost"
```
Render guards use `hasPerm(user?.role, ...)` at L2008, L2405, L2411, L2537, L2610, L2817, L2993, L3062.

The media hubs use a separate `?view=` param: `pictures` → `all|publish|list|settings` (`app/admin/pictures/page.tsx:31-40`); `videos` → `publish|list|settings` (`app/admin/videos/page.tsx:28`).

### Client-side app
`components/admin/` — 19 components (see §3). There is **no** separate SPA bundle or router; the panel is server-rendered pages + client components under `components/admin/`.

---

## 2. Authentication & Authorization

### Auth mechanism
**Custom JWT cookie** (not Supabase Auth). `lib/auth.ts`:
- L74-88 `setSession()` — HS256 JWT in an HTTP-only `user_session` cookie, `sameSite: "lax"`, `secure` in prod, 30-day expiry
- L6-17 — **hard-fails at boot** in production if `JWT_SECRET` is missing or equals the default (`"default_fallback_secret_do_not_use_in_prod"`)
- L100-111 `getSession()` — verifies JWT **then re-hydrates the role from the DB** via `hydrateSessionUser()` (L44-69), so role changes apply on the next request without re-login
- L125-135 `getSessionRaw()` — JWT-only, **must not** be used for authorization (documented L113-124)
- L140-151 `getSessionFromRequest(req)`

**Login** (`app/api/auth/login/route.ts`):
- L14-20: rate limit — 20 attempts / IP / 5 min
- L35: `safeIdentifier()` sanitizes the login string against PostgREST `.or()` injection
- L54-108: **env-override superadmin path** — `ADMIN_USERNAME`/`ADMIN_PASSWORD` compared with `constantTimeEquals` / `constantTimeEqualsIgnoreCase` (L172-182), then `setSession({ role: "superadmin" })`
- L110-138: all other roles authenticate via `bcrypt.compare(password, dbUser.password_hash)`

### Middleware
**`middleware.ts`** (33 lines) does **only** canonical-host301 redirects (`golopokahini.lol` / `www.*` → `chotikahini.vercel.app`, L6-20). **It does not gate `/admin` at all.** The admin gate is the layout + per-route checks.

### Roles (`lib/permissions.ts`)
```
Role = "superadmin" | "admin" | "content_manager" | "moderator" | "author" | "user"
```
`ROLE_LEVELS` (L17-24): superadmin 100, admin 80, content_manager 60, moderator 40, author 30, user 10.

`canAccessAdmin(role)` (L257-259) = `isAtLeast(role, "moderator")` → **moderator and above** can reach `/admin/*`.

### Permission strings — 84 exact values (`ALL_PERMISSIONS`, L27-145)

- **content** (10): `content.view` `.create` `.edit` `.publish` `.unpublish` `.reject` `.request_revision` `.hide` `.restore` `.delete_permanent`
- **story** (10): `story.view` `.submit` `.view_own` `.edit_own` `.resubmit` `.edit_any` `.review` `.approve` `.reject` `.request_revision`
- **users** (7): `users.view` `.manage` `.suspend` `.restore` `.verify` `.reset_password` `.delete_permanent`
- **roles** (4): `roles.view` `.assign` `.assign_admin` `.remove_admin`
- **comments** (7): `comments.view` `.create` `.reply` `.hide` `.restore` `.pin` `.delete_permanent`
- **posts** (9): `posts.view` `.create` `.edit_own` `.delete_own` `.like` `.repost` `.comment` `.moderate` `.ban`
- **reports** (3): `reports.view` `.manage` `.dismiss`
- **authors** (3): `authors.view` `.manage` `.verify`
- **analytics** (5): `analytics.view` `.content` `.users` `.system` `.own`
- **notifications** (2): `notifications.view` `.manage`
- **audit_logs** (2): `audit_logs.view` `.export`
- **settings** (5): `settings.view` `.content` `.appearance` `.security` `.integrations`
- **announcements** (4): `announcements.view` `.create` `.edit` `.delete`
- **deletion_requests** (4): `deletion_requests.view` `.create` `.approve` `.reject`
- **media** (4): `media.view` `.upload` `.edit` `.delete`
- **recycle_bin** (3): `recycle_bin.view` `.restore` `.permanent_delete`
- **permissions/admins** (2): `permissions.manage` `.admin.manage`

### Authorization helper functions — exact names

**`lib/admin-auth.ts`** (73 lines) — the server boundary:
| Function | Line | Semantics |
|---|---|---|
| `getAuthorizedSession()` | L19 | raw session or null |
| `isAdminAuthenticated()` | L24 | `canAccessAdmin(session.role)` (moderator+) |
| `isFullAdmin()` | L31 | `isAtLeast(role, "admin")` (admin+superadmin) |
| `isAuthorAuthenticated()` | L38 | `role !== "user"` |
| `isSuperAdmin()` | L45 | `role === "superadmin"` |
| `requirePermission(permission)` | L56 | → `{ authorized, session }` |
| `authorizePermission(permission)` | L68 | → `{ session, authorized }` |

**`lib/permissions.ts`** core helpers: `hasPermission` (L227), `hasAnyPermission` (L236), `hasAllPermissions` (L241), `isAtLeast` (L246), `isAdminOrAbove` (L252), `canAccessAdmin` (L257), `isSuperAdminRole` (L261), plus named checks L267-341: `canDeletePermanently`, `canHideContent`, `canPublishContent`, `canRejectContent`, `canEditOwnStory`, `canEditAnyStory`, `canManageUsers`, `canVerifyUsers`, `canManageComments`, `canManageReports`, `canAssignRoles`, `canAssignAdmin`, `canManageSettings`, `canViewSettings`, `canViewAuditLogs`, `canManageAnnouncements`, `canWriteStories`, `isLimitedAdmin`.

UI metadata: `getRoleLabel` (L345), `getRoleDescription` (L357), `getAssignableRoles` (L370), `getRoleTier` (L382).

### Two enforcement layers
**Client:** `useAuth()` (`contexts/AuthContext.tsx`, fetch `/api/auth/me`) → `hasPermission(user.role, "...")` used in page bodies and `AdminSidebar.tsx:444` (`group.items.filter(item => hasPermission(role, item.permission))`).

**Server:** every API route independently re-checks. `lib/permissions.ts:8-11` states the rule: *"UI helpers are for UX only. Server-side authorization is the real security boundary."*

### Audit logging (`lib/audit.ts`, 67 lines)
- `logAudit()` (L53) — **fail-open**, regular content actions
- `logAuditCritical()` (L61) — **fail-closed**, returns `false` so the caller aborts (role change, permanent delete)
- Writes to `admin_audit_logs`: `actor_id`, `actor_username`, `action`, `target_type`, `target_id`, `prev_state` (JSONB), `new_state` (JSONB), `created_at`

### `lib/bot-guard.ts` (180 lines)
**Not admin-related.** It blocks scraper UAs on *unauthenticated expensive* endpoints only. `ALLOWED_BOT_MARKERS` (L23-77) whitelists search engines + social unfurlers; `BLOCKED_BOT_MARKERS` (L85-147) blocks scrapy/curl/ahrefs/semrush/etc. `isObviousBot()` L157, `isBotRequest()` L177.

---

## 3. Full Feature Inventory — `components/admin/` (19 files)

| Component | Lines | Description | Backing API |
|---|---|---|---|
| `AdminDashboard.tsx` | 3815 | Main SPA-ish dashboard; 9 `?section=` tabs; stats, review center, authors, notifications, verification, deletions, similarity, autopost, contact messages | `posts/manage`, `authors`, `analytics`, `stats`, `notifications`, `verify-requests`, `deletion-requests`, `contact-messages`, `generate-reset-link`, `story-coauthors`, `story-similarity`, `similarity-clusters`, `crawler/*`, `share-suggestions` |
| `AdminSidebar.tsx` | 620 | Permission-aware nav; `NAV_GROUPS` (L64) in 6 groups; mobile drawer; role badge; badges | — |
| `StoryEditor.tsx` | 39396 B | Story create/edit: rich toolbar, file import, URL import, translate, similarity check, scheduling, cover picker | `POST /api/author/submit-story`, `GET /api/posts/lookup`, `POST /api/translate` |
| `AdminSettings.tsx` | 325 | Author CRUD + category CRUD (both DB-backed) | `GET/POST /api/admin/authors`, `GET/POST/PATCH/DELETE /api/admin/categories` |
| `PictureManager.tsx` | 800 | Picture gallery hub: publish form, stats, paginated list, row actions, copy link | `GET/POST/PATCH/DELETE /api/admin/pictures` |
| `VideoManager.tsx` | 795 | Video hub: publish form, stats, paginated list, row actions, copy link | `GET/POST/PATCH/DELETE /api/admin/videos` |
| `PictureFormFields.tsx` | 465 | Picture form fields (URL, cover, meta) | — |
| `VideoFormFields.tsx` | 411 | Video form fields (URL, embed, thumbnail, credit) | — |
| `FeatureToggles.tsx` | 173 | `useFeatureToggle()` hook (L21), `VideoSectionToggle` (L72), `PictureSectionToggle` (L98) | `GET/PATCH /api/admin/site-settings` |
| `PictureFeaturePanel.tsx` | 22 | Picture-section on/off panel | `PATCH /api/admin/site-settings` |
| `VideoFeaturePanel.tsx` | 29 | Video-section on/off panel | `PATCH /api/admin/site-settings` |
| `PictureHubNav.tsx` | 55 | Picture sub-nav tabs (সব/পাবলিশ/লিস্ট/সেটিংস) | — |
| `VideoHubNav.tsx` | 58 | Video sub-nav tabs (পাবলিশ/লিস্ট/সেটিংস) | — |
| `AdminPagination.tsx` | 92 | Client-side numbered pager with `…` windowing | — |
| `AccessDenied.tsx` | 26 | 403 page — shield icon, Bengali copy, back-link | — |
| `RoleGuide.tsx` | 136 | Role/permission reference table for admins | — |
| `SimilarityCheck.tsx` | 150 | Live duplicate-content checker | `POST /api/admin/similarity` |
| `SimilarityClusters.tsx` | 176 | Duplicate-cluster viewer (union-find) | `GET /api/admin/similarity-clusters` |

**All 19 are imported somewhere** — no dead components. Import graph:
`AdminDashboard` → `RoleGuide`, `SimilarityCheck`, `SimilarityClusters`; `StoryEditor` → `SimilarityCheck`; `PictureManager` → `PictureFormFields`, `AdminPagination`; `VideoManager` → `VideoFormFields`, `AdminPagination`.

### Features present in code but NOT in the sidebar/docs
- **Cover backfill** (`POST /api/admin/backfill-covers`) — no UI button found
- **Story export** (`GET /api/admin/export-stories?format=json|csv`) — `AdminSettings` header mentions "ব্যাকআপ" (L43 of `app/admin/settings/page.tsx`) but no export call site in the component
- **Story co-authors** (`/api/admin/story-coauthors` GET/POST/DELETE) — used in `AdminDashboard.tsx:475` (review drawer)
- **Welcome emails** (`/api/admin/welcome-emails`) — `AdminDashboard.tsx:152,170`
- **Share suggestions** (`/api/admin/share-suggestions`) — `AdminDashboard.tsx:568`
- **Auto-post by URL** (`/api/admin/auto-post`) and **URL import** (`/api/admin/import-url`)
- **Crawler** (sources CRUD, run, publish queue)
- **Contact messages** (`/api/admin/contact-messages`)

---

## 4. API Routes Under `app/api/admin/` (35 route files)

| File | Methods | Purpose | Auth check |
|---|---|---|---|
| `analytics/route.ts` | GET | Aggregate admin analytics | ✅ `hasPermission(role,"analytics.view")` L12 |
| `announcement/route.ts` | GET, PUT | Sitewide banner read/write | GET: **none (public by design**, CDN-cached L27-30); PUT: ✅ `requirePermission("announcements.edit")` L56 |
| `applications/route.ts` | GET, POST | Author applications list / approve-reject | ✅ `requirePermission("authors.manage")` L11, L35 |
| `audit-logs/route.ts` | GET | Audit log list (limit 200) | ✅ `requirePermission("audit_logs.view")` L8 |
| `authors/route.ts` | GET, POST | Registered authors / create DB author | ✅ `authors.view` L113; `authors.manage` L22 |
| `auto-post/route.ts` | POST | Paste URL → fetch → extract → create story | ✅ `content.create` L127 |
| `backfill-covers/route.ts` | POST | Re-assign missing covers (unused-first) | ✅ `content.edit` L16 |
| `categories/route.ts` | GET, POST, PATCH, DELETE | Category CRUD | GET: **none** (public data); others: ✅ `settings.view` L41, L63, L86 |
| `comments-data/route.ts` | GET | All comments + story title map | ✅ `requirePermission("comments.hide")` L8 |
| `comments/[id]/route.ts` | PATCH, DELETE | Hide/restore/delete comment | ✅ `comments.hide` L12, L50 |
| `contact-messages/route.ts` | GET, PATCH, DELETE | Contact-form messages | ✅ `requirePermission("notifications.manage")` L6, L51, L74 |
| `crawler/publish/route.ts` | GET, POST, PATCH, DELETE | Crawled-story review queue | ✅ `content.create` L15, L126, L202, L269 — **⚠️ DELETE is a permanent delete** |
| `crawler/run/route.ts` | POST | Run the crawler now | ✅ `content.create` L97 |
| `crawler/sources/route.ts` | GET, POST, DELETE | Crawler source CRUD | ✅ `content.create` L10, L24, L51 |
| `deletion-requests/route.ts` | GET, POST, PATCH | Safe-deletion workflow | GET: `deletion_requests.view` L13; PATCH: `deletion_requests.approve` L158; POST: session-only L70 + ownership L81-90 |
| `export-stories/route.ts` | GET | Full story export (JSON/CSV) | ✅ `content.edit` L12 |
| `generate-reset-link/route.ts` | POST | 1-hour single-use password reset token | ✅ `isFullAdmin()` L11 (admin+superadmin) |
| `import-url/route.ts` | POST | URL import into editor | ✅ `content.create` L14 |
| `notifications/route.ts` | GET, PATCH, DELETE | Admin notification center | ✅ session + role-type map L10-54 — **⚠️ single-item PATCH/DELETE omit the scope filter** |
| `pictures/route.ts` | GET, POST, PATCH, DELETE | Picture gallery CRUD | ✅ local `authorize()` L19-22 → `media.upload` / `media.delete` |
| `posts/manage/route.ts` | POST | **Story lifecycle state machine** | ✅ `isAdminAuthenticated()` L109 + per-action `hasPermission` |
| `reports/route.ts` | GET, PATCH | Comment/story reports | ✅ `requirePermission("reports.manage")` L8, L55 |
| `share-suggestions/route.ts` | GET | Share-suggestion analytics | ✅ `analytics.view` L57 |
| `similarity/route.ts` | POST | Duplicate check for one text | ✅ `canEditAnyStory(role)` L16 |
| `similarity-clusters/route.ts` | GET | Duplicate clusters (10-min cache) | ✅ `story.review` L34 |
| `site-settings/route.ts` | GET, PATCH | Site config/navigation/features | **GET: ⚠️ NO AUTH CHECK (L13-43)**; PATCH: ✅ `settings.view` L48 |
| `stats/route.ts` | GET | Dashboard counters | ✅ `analytics.view` L9 |
| `story-coauthors/route.ts` | GET, POST, DELETE | Co-author add/remove | ✅ `story.edit_any` OR `authors.manage` L17, L69, L152 |
| `story-similarity/route.ts` | GET | Per-story max similarity (10-min cache) | ✅ session + ownership scoping L20-29, L43-45 |
| `users/route.ts` | GET, PUT, DELETE | User list / role+password+verify / delete | GET: ✅ `isFullAdmin()` L13; PUT: ✅ `users.manage` L50; DELETE: ✅ `users.delete_permanent` L157 |
| `verify-requests/route.ts` | GET, PATCH | Verified-badge requests | ✅ `requirePermission("users.verify")` L9, L72 |
| `videos/route.ts` | GET, POST, PATCH, DELETE | Video CRUD | ✅ local `authorize()` L50-53 → `media.upload` / `media.delete` |
| `welcome-emails/route.ts` | GET, POST | Welcome-email send log / send | ✅ `requirePermission("notifications.manage")` L21, L117 |

### Routes to flag

1. **`GET /api/admin/site-settings` — no authorization (L13-43).** Returns the full site config, navigation and feature flags to anyone. The PATCH is gated but the GET is not, and `FeatureToggles.tsx:29` reads from it unauthenticated.
2. **`DELETE /api/admin/crawler/publish` — permanent delete with only `content.create` (L268-287).** Calls `supabase.from("stories").delete().eq("uid", uid)` — a **hard delete**. This bypasses the documented workflow in `ROLES_AND_PERMISSIONS.md` §7 (hide → `deletion_requests` → superadmin approval) and the `content.delete_permanent` permission. `content_manager` and `moderator` both hold `content.create`, so both can permanently delete stories.
3. **`notifications` PATCH (L196) / DELETE (L231)** — the bulk paths correctly apply `.or(scope).in("type", allowedTypes)`, but the single-item paths use only `.eq("id", id)`. A `moderator` could mark-read or delete an arbitrary notification id.
4. **`GET /api/admin/categories` — no auth.** Acceptable: `categories` is public-read RLS, and `lib/config.ts` exposes it publicly.
5. **`GET /api/admin/announcement` — no auth.** Deliberate (CDN-cached public banner), documented L21-30.

---

## 5. Data Model (Supabase)

Schema files live in `scripts/*.sql` (25 SQL files). There is **no** consolidated schema file.

### Core tables

**`users`** (`scripts/setup-supabase.sql:2-11`)
`id TEXT PK`, `username TEXT UNIQUE NOT NULL`, `email`, `password_hash`, `role TEXT DEFAULT 'user'`, `name`, `profile_pic`, `bio`, `saved_posts JSONB DEFAULT '[]'`, `created_at`.
Added later: `is_verified` (used in code), `is_trusted BOOLEAN` (`migration-social-features.sql:187`), `can_post INTEGER DEFAULT 1` (`posts-feature.sql:18`), `last_seen_at`, `reset_token`, `reset_token_expires` (used by `generate-reset-link`).

**`stories`** (`scripts/migrate-stories.sql:5-25`) — **the main content table**
`id UUID PK`, `uid TEXT UNIQUE`, `slug TEXT UNIQUE`, `title`, `description`, `content`, `author_id → users(id)`, `category TEXT DEFAULT 'golpo'`, `tags TEXT[]`, `cover`, `previous_post`, **`status TEXT DEFAULT 'published'`**, `featured BOOLEAN`, `history JSONB DEFAULT '[]'`, `rejection_reason`, `published_at TIMESTAMPTZ`, `created_at`, `updated_at`.
Added later: `reading_time TEXT` (`migrate-stories.sql:80`), **`scheduled_at TIMESTAMPTZ`** (`migration-social-features.sql:44`).
Indexes on slug, uid, author_id, status, category, published_at DESC.
RLS: public SELECT only where `status = 'published'`; authors read own; admins full.

**Status values** — from `migrate-stories.sql:14` comment and code usage:
`'published'`, `'pending'`, `'revision_requested'`, `'rejected'`, `'draft'`, plus `'hidden'` (soft-delete, used in `posts/manage/route.ts:138,359`).

**`site_settings`** (`scripts/migration-social-features.sql:172-176`, also `crawler-setup.sql:7-11`)
`key TEXT PK`, `value JSONB NOT NULL`, `updated_at TIMESTAMPTZ`.
Known keys: `config`, `navigation`, `features`, `crawler_config`.
RLS: public SELECT; `REVOKE ALL` from anon/authenticated for writes.

**`categories`** (`scripts/categories.sql:6-11`, `migration-social-features.sql:138-144`)
`id TEXT PK`, `name`, `icon TEXT DEFAULT 'feather'`, `description`, `created_at`. Seeded with 8+ Bangla categories (`migration-social-features.sql:156-164`).

### Supporting tables

| Table | Key columns | Source |
|---|---|---|
| `post_metadata` | `mdx_uid` (UNIQUE), `slug`, `author_id`, `status`, `category`, `published_at`, `story_id` | `migrate-schema.sql:8-19` |
| `author_applications` | `user_id`, `username`, `real_name`, `sample_link`, `message`, `status` (pending/approved/rejected), `reviewer_id`, `reviewed_at` | `migration-social-features.sql:92-104` |
| `announcements` | `text`, `active`, `color`, `link`, `created_by`, `updated_at` | `setup-supabase.sql:186-193` |
| `comments` | `post_slug`, `user_id`, `content`, `parent_comment_id`, `status`, `is_pinned`, `is_spoiler` | `setup-supabase.sql:15-26`, `migration-social-features.sql:37-41` |
| `reports` | `reporter_id`, `target_type` (story\|comment), `target_id`, `reason`, `status` (pending/reviewed/dismissed) | `migration-social-features.sql:21-30` |
| `deletion_requests` | `target_type` (story\|comment\|user), `target_id`, `requested_by`, `reason`, `status` | `migration-social-features.sql:107-115` |
| `verification_requests` | `user_id` (UNIQUE), `reason`, `status` | `migration-social-features.sql:80-87` |
| `admin_audit_logs` | `actor_id`, `actor_username`, `action`, `target_type`, `target_id`, `prev_state` JSONB, `new_state` JSONB, `created_at` | `migration-social-features.sql:120-130` |
| `story_coauthors` | `story_uid → stories(uid)`, `user_id`, UNIQUE(story_uid,user_id) | `migration-social-features.sql:67-73` |
| `crawler_sources` | `url` (UNIQUE), `category`, `default_tags`, `active`, `last_crawled_at`, `feed_url` | `migration-social-features.sql:190-210` |
| `video_posts` | `title`, `description`, `source_url`, `embed_url`, `thumbnail_url`, `credit`, `status` (draft/published/deleted), `created_by`, `published_at`, **`scheduled_at`** | `video-library.sql:3-18`, `media-schedule.sql:22-23` |
| `picture_galleries` | `title`, `description`, `source_url`, `cover_url`, `images JSONB`, `image_count`, `model_name`, `channel_name`, `categories TEXT[]`, `tags TEXT[]`, `source_views`, `status` (draft/published/deleted), `created_by`, `published_at`, **`scheduled_at`** | `picture-gallery.sql:16-38`, `media-schedule.sql:25-26` |
| `notifications` | `user_id`, `type`, `actor_id`, `actor_name`, `post_slug`, `comment_id`, `snippet`, `is_read` | `setup-supabase.sql:73-84` |
| `posts` (+ `_history`, `_likes`, `_reposts`, `_comments`) | micro-post social features | `posts-feature.sql` |
| `comment_reactions`, `story_progress`, `post_likes`, `post_reactions`, `post_views`, `post_view_counts`, `chat_messages`, `conversations`, `private_messages`, `bookmarks`, `reading_history`, `user_follows`, `page_visits`, `share_suggestion_log`, `share_suggestion_daily` | | various |

### `features` flag mechanism

**Definition** — `lib/site-defaults.ts:115-118`:
```ts
export const DEFAULT_FEATURES = {
  videoSection: true,
  pictureSection: true,
};
```

**Storage** — `site_settings` row with `key = 'features'`, value JSONB.

**Server read** — `lib/config.ts`:
- L220-222: `featuresCache = deepMerge(DEFAULT_FEATURES, map.get("features"))` (deep-merged so a pre-flag DB row still resolves the default)
- L251-253: `getFeatures(): Features`
- L256-258: `isVideoSectionEnabled()` → `getFeatures().videoSection !== false`
- L261-263: `isPictureSectionEnabled()` → `getFeatures().pictureSection !== false`

**Consumers** — `lib/routes/home.ts:34-35`, `components/HomeVideoStrip.tsx:29`, `components/HomePictureStrip.tsx:27`, `app/sitemap.xml/route.ts:214,251`, and all `app/(bn)/videos/*`, `app/(bn)/pictures/*` pages call `notFound()` when disabled.

**Write path** — `app/api/admin/site-settings/route.ts:60-72`: the toggle UI sends `featuresPatch`; the server reads the current `features` row and `deepMerge`s the patch over it, so adding a new flag in code never erases it. Then `invalidateTags([CACHE_TAGS.siteSettings, CACHE_TAGS.categories])` (L91) + `await loadSiteSettings()` (L92).

**UI** — `components/admin/FeatureToggles.tsx`: `useFeatureToggle(flag)` (L21) does an **optimistic** toggle (L47-49) with **rollback on failure** (L61-63); `VideoSectionToggle` (L72), `PictureSectionToggle` (L98).

**Loader** — `lib/site-settings.ts:13-35`: `cachedRead("site-settings", ...)` with `revalidate: 15`, tags `[siteSettings, categories]`, `ttlMs: 5_000`.

---

## 6. Media / Covers Workflow

### Cover pool location
`lib/cover.ts:20-44` — `getCoverState()` resolves the directory from site config:
```ts
const urlDir = (config.coverFallbackDir || "/images/Cover_pic/").replace(/\/?$/, "/");
const fsDir = path.join(process.cwd(), "public", urlDir);
```
Files are read via `fs.readdirSync(fsDir)`, filtered by `IMAGE_RE = /\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)$/i` (L5), and sorted (L33).

**Caching** — module-level `cachedFiles`/`cachedDir`/`cachedAt` with `CACHE_TTL_MS = 5 * 60 * 1000` (L9). Refreshed every 5 min so newly-dropped covers appear without a redeploy.

### `getUnusedCover(supabase)` — `lib/cover.ts:113-150`
1. L118: `SELECT cover FROM stories` (all rows)
2. L119-126: build `usedCounts` — a `Map<fileName, count>` of covers whose path starts with `urlDir`
3. L129-133: **prefer a completely-unused picture** (first in sorted order with no count) → returns `${urlDir}${f}`
4. L136-145: **all used → reuse the least-used** one (even spread)
5. L146-149: on DB error, deterministic fallback `files[Date.now() % files.length]`

### `isCoverAvailable(cover)` — `lib/cover.ts:82-107`
- empty → `false`
- `data:image` prefix or `length > 500` → `false` (raw bytes forbidden in DB)
- `http(s)://` → `true` (external, can't verify locally)
- path under `urlDir` / `/cover_pic/` / `/images/cover_pic/` → `true` **only if the file exists on disk**
- other local paths → `true` (keep as-is)

### `normalizeCoverUrl(cover)` — `lib/cover.ts:59-72`
Rejects base64/>500 chars, passes through `http(s)://` unchanged, and rewrites a bare filename to `${urlDir}${fileName}` if it exists on disk.

### Backfill API — `app/api/admin/backfill-covers/route.ts` (59 lines)
- L16: gate `hasPermission(session.role, "content.edit")`
- L21-24: `getCoverPool()`; empty → 400 "cover_pic ফোল্ডার খালি।"
- L26-29: `SELECT uid, slug, title, cover FROM stories LIMIT 5000`
- L36-48: for each story where `!isCoverAvailable(story.cover)` → `getUnusedCover(supabase)` → `UPDATE stories SET cover, updated_at WHERE uid=… OR slug=…`; `break` if the pool is exhausted
- L50-55: returns `{ success, updated, total, message }`

### Interactive cover assignment — `components/admin/StoryEditor.tsx`
- L20: prop `availableCovers?: string[]`
- L115-142: on a **new** post with no cover, the client picks one from a **localStorage "cover bag"** (L122-136): a shuffled array is persisted under `cover_bag`, popped one at a time, and reshuffled when it no longer matches `availableCovers` (L127-129). Fallback at L138-142 uses `getClientSiteConfig().coverFallbackDir`.
- L668-675: the cover input is editable; `setFormData(prev => ({...prev, cover: val}))`
- L396: the chosen cover is sent to the API as `cover`
- L231: `importPreviousPost` also copies the previous post's cover (L231)

**Server-side cover list** — `app/admin/editor/page.tsx:120-127`: `fs.readdirSync(coversDir)` filtered to non-dotfiles.

**Note:** `app/admin/page.tsx:36` sets `cover: post.cover || ""` for the dashboard list; the admin-side cover *picker* is client-only — the server does not verify the submitted cover is in the pool on save.

---

## 7. Content Publishing Workflow

### Draft → published

**The editor's save path** — `components/admin/StoryEditor.tsx:381-425` `handleSave(isDraft, asNew)`:
- **L381: the `isDraft` parameter is accepted but never used** — both "Save Draft" (L438-444) and "Publish" (L445-451) call `handleSave(true)` / `handleSave(false)` and hit the **same** endpoint
- L387: `POST /api/author/submit-story`
- L399-400: `slug`/`uid` are sent as `undefined` when `asNew` is true (→ "Publish as New", L454-463)
- L404: `scheduledAt: formData.scheduledAt ? formData.scheduledAt : null` — with the tri-state comment at L402-403: *null = explicitly clear the schedule; value = set/reschedule; absent = preserve*
- L405: `featured`
- L416: `router.push("/admin")` after 1500 ms on success

**`app/api/author/submit-story/route.ts`** — the real state machine:
- L15-17: session required; L22: must be an author-tier role
- **L148: `const targetStatus = isAdmin || authorIsTrusted ? "published" : "pending";`**
- L175: ownership check on edit (`403` if not permitted)
- L238: `status: targetStatus` on the story row
- L246-256: preserves the **original** `published_at` on edits; only stamps it when absent
- L258-282: **scheduling** — when `scheduledAt` is set: `scheduled_at = iso`, `published_at = iso` (future), `status = "published"`, and a `scheduled` event is pushed into `history` (L268-269). When `scheduledAt === null` (explicit clear): `scheduled_at = null` and, if `published_at` was in the future, `published_at = nowIso` (L273-280). When `scheduledAt === undefined` (field absent): the existing schedule is preserved (L282 comment).
- L340: ISR cache refresh so admin-published stories go live at once

**The admin review path** — `app/api/admin/posts/manage/route.ts` (POST only). Actions:
| `action` | Line | Result |
|---|---|---|
| `bulk` + `bulkAction: "publish"` | L128-132 | `status = 'published'` (requires `content.publish`) |
| `bulk` + `bulkAction: "delete"` | L133-141 | `canDeletePermanently` → hard delete; else `canHideContent` → `status = 'hidden'` + create `deletion_requests` (status `pending`) |
| `bulk` + `bulkAction: "archive"` | L160-164 | `status = 'rejected'` |
| `approve_publish` | L192-210 | `status = 'published'` + `logAudit("story.approve")` |
| `edit_publish` | L215-283 | Full edit + publish |
| `request_revision` | L285-303 | `status = 'revision_requested'` + feedback |
| `reject` | L305-322 | `status = 'rejected'` + reason |
| `unpublish` | L325-341 | `status = 'draft'` |
| `delete` | L344-382 | `logAuditCritical` (**fail-closed**, L346-349) → if `canDeletePermanently` hard delete; else `status = 'hidden'` + `deletion_requests` |

### `scheduledAt` / `includeFuture` / `includePending`

**`scheduledAt`** — the future publish moment, stored in `stories.scheduled_at`. Visibility is achieved **without a background job**: the row is written with `status = 'published'` and a **future** `published_at`, and every public read path filters `published_at <= now()`. See `lib/media-schedule.ts:9-14` and `scripts/media-schedule.sql:5-13`.

**`includeFuture`** (`lib/posts.ts:390-397`) — when false, posts whose `publishedAt` is in the future are filtered out. `getAllPostsAsync({ includeFuture: true })` opts in (used by `app/(bn)/[slug]/page.tsx:43-44`, `lib/routes/story.ts:156-157,201-202`).

**`includePending`** (`lib/posts.ts:207, 221, 377`) — separates the public feed from the admin feed:
```ts
if (!includePending) query = query.eq("status", "published");
```
The cache key is `[includePending ? "all" : "published"]` (L221), so the two variants get independent cache entries. Admin callers use `getAllPostsAsync({ includePending: true })` (`app/admin/editor/page.tsx:34`).

**Media scheduling helpers** — `lib/media-schedule.ts`:
- `parseScheduledAt(raw)` L33 — accepts ISO or `datetime-local`; unparseable → `{ iso: null, isFuture: false }` (never blocks a publish)
- `resolvePublishState({ scheduledAt, draft })` L72 — `draft` → `{ status: "draft", published_at: null, scheduled_at: null }`; future ISO → `{ status: "published", published_at: iso, scheduled_at: iso }`; else → publish now
- `resolveSchedulePatch(scheduledAt)` L115 — tri-state: `undefined` → `{}` (don't touch), `null` → publish now, string → set/reschedule
- `isScheduledRow(row)` L152 — `status === "published" && scheduled_at` in the future

### Cron routes — `app/api/cron/`

**Only one route exists: `app/api/cron/publish-scheduled-media/route.ts`** (157 lines).

**`vercel.json`:**
```json
{ "crons": [{ "path": "/api/cron/publish-scheduled-media", "schedule": "0 3 * * *" }] }
```
→ **daily at 03:00 UTC**.

**`authorizeCron(request)` L41-61:**
1. If `process.env.CRON_SECRET` is set: expect `Authorization: Bearer <secret>`. The comparison is a **constant-time loop** (L49-54): length check first, then a char-by-char XOR accumulate (`mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i)`), returning `mismatch === 0`.
2. If `CRON_SECRET` is **unset** (local dev): fall back to an admin session — `!!session && hasPermission(session.role, "media.upload")` (L59-60) — so the endpoint is never anonymous.

`.env.example` documents `CRON_SECRET=` (empty locally) with the exact fallback note.

**`publishDueRows(table)` L70-123** — for `video_posts` and `picture_galleries`:
```ts
.select("id, title, scheduled_at, published_at")
.eq("status", "published")
.not("scheduled_at", "is", null)
.lte("scheduled_at", nowIso)
.limit(200);
```
Then per row: set `published_at = row.scheduled_at || row.published_at || nowIso` (preserving the admin's chosen date rather than "now"), `scheduled_at = null`, `updated_at = nowIso`. Guarded by `.not("scheduled_at", "is", null)` so a second run is a no-op (L107-108).

L131-134 runs both tables in parallel via `Promise.all`. L138-140 fires `announceVideoPublished(id, title)` for videos only (pictures have no announcement helper).

L84-89: a missing `scheduled_at` column (migration not run) is treated as a **configuration state, not a crash** — `console.warn` and return `{ published: 0 }`.

**Note:** there is **no cron route for stories** — `stories.scheduled_at` relies purely on the `published_at <= now()` filter, with no background job clearing `scheduled_at`.

---

## 8. UI / Styling Conventions

### Stack
- **Next.js 14.2.35 App Router** (not 15) — `next.config.js` + `package.json`
- **React 18.3**, **Tailwind CSS 3.4** + `@tailwindcss/typography`
- **No component library** — `components/ui/` **does not exist**. There are **no shared UI primitives**; every admin component hand-rolls its Tailwind classes.
- **Icons:** `lucide-react` ^0.400.0
- **Forms:** **no** `react-hook-form`, **no** `zod`. Plain `useState` + manual `fetch` + manual `JSON.stringify` bodies + manual validation (`if (!title || !content) ...`).
- **Toasts:** **no** toast library. The pattern is an inline `status`/`msg` state object:
  - `app/admin/announcement/page.tsx:26` — `useState<{ type: "success" | "error" | ""; msg: string }>`
  - `components/admin/AdminSettings.tsx:28` — `useState({ type: "", text: "" })`
  - `components/admin/AdminDashboard.tsx` — same shape
- **Modals:** hand-rolled conditional-render modals with backdrop divs — `app/admin/users/page.tsx:18-28` (`editingUser`, `resetModalData`), `components/admin/AdminSettings.tsx:23-24` (`editingAuthorId`, `editingCategoryId`)
- **Confirm dialogs:** `window.confirm` — grep in the admin components
- **Tables:** raw `<table>` elements with Tailwind classes; rows are extracted into dedicated components — `PictureManager.tsx:552` `AdminPictureRow`, `:686` `ActionButtons`, `:752` `CopySiteLink`; `VideoManager.tsx:537`, `:681`, `:748` (mirrored structure)
- **Loading:** inline spinners (`Loader2` from lucide with `animate-spin`) and `animate-pulse` skeletons — `StoryEditor.tsx:428` `<div className="p-8 text-center text-fg-muted animate-pulse">Loading editor...</div>`

### Styling conventions
**Semantic CSS variables** defined in `tailwind.config.ts:33-50`:
`bg-surface`, `bg-surface-alt`, `bg-surface-hover`, `border-border`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `bg-accent`, `accent-hover`, `max-w-article` (680px), `max-w-wide` (1200px).

Values are CSS custom properties (`app/globals.css:10-38`) injected at runtime by `ThemeStyles` in `AdminShell.tsx:40-89` from `site.themeColors`, with `:root` / `.dark` variants. `darkMode: "class"` (`tailwind.config.ts:4`).

**Custom fonts** — `font-latin` (Inter, `AdminShell.tsx:34-38`) and `font-bengali` ("BengaliCustom" / Bornomala-Regular.ttf, `app/globals.css:42-57`).

**Animation tokens** — `fade-in`, `fade-in-up`, `scale-in` (`tailwind.config.ts:52-74`).

### Representative pattern (`components/admin/FeatureToggles.tsx`)
- `"use client"` directive at L1
- `useCallback` for loaders, `useEffect` for mount
- Optimistic UI with rollback on server error (L47-63)
- Error banner rendered above the control (L77-81)
- `aria-pressed`, `aria-label` on the toggle button (L150-151)
- Buttons: `min-h-10` touch target, `rounded-full`, `font-semibold`
- Dark mode handled with paired `dark:` variants

### Shared layout pattern
Every page uses the same shell:
```tsx
<div className="min-h-screen bg-surface md:flex md:h-screen md:overflow-hidden">
  <AdminSidebar />
  <main className="min-w-0 flex-1 overflow-y-auto">…</main>
</div>
```
(`app/admin/pictures/page.tsx:40-42`, `app/admin/videos/page.tsx:34-36`, `app/admin/settings/page.tsx:26-28`)

---

## 9. Known Rough Edges

### Security-relevant

1. **`GET /api/admin/site-settings` — no auth check** (`app/api/admin/site-settings/route.ts:13-43`). Leaks full site config, navigation, and feature flags to anonymous callers. **Fix: add `requirePermission("settings.view")`.**

2. **`DELETE /api/admin/crawler/publish` — permanent story delete on `content.create`** (`app/api/admin/crawler/publish/route.ts:268-287`). Bypasses `content.delete_permanent` and the documented hide→request→approve workflow. `content_manager` and `moderator` both hold `content.create`. **Fix: require `content.delete_permanent` (superadmin only) or route through `deletion_requests` like `posts/manage` does.**

3. **`notifications` single-item PATCH/DELETE lack scope filtering** (`app/api/admin/notifications/route.ts:196, 231`). Bulk paths use `.or(scope).in("type", allowedTypes)`; single-item paths use only `.eq("id", id)` — a moderator can mutate any notification by id.

4. **`app/admin/users/page.tsx` has no client-side permission gate.** It calls `fetchUsers()` unconditionally in a mount effect (L30-32) with no `hasPermission` check and no `AccessDenied` render. Compare `app/admin/settings/page.tsx:22`. The API still 401s, but the page renders an empty shell instead of a 403.

### Consistency / correctness

5. **Hard-coded role arrays bypass the RBAC registry** in three pages:
   - `app/admin/comments/page.tsx:32, 64` → `["superadmin","admin","moderator"]`
   - `app/admin/reports/page.tsx:32` → `["superadmin","admin","moderator"]`
   - `app/admin/audit-logs/page.tsx:35` → `["admin","superadmin"]`
   
   `ROLES_AND_PERMISSIONS.md:253` explicitly claims *"AdminSidebar শুধু পারমিশন থাকলে item দেখায় (`hasPermission`-ভিত্তিক, hard-coded role check নেই)"*. The sidebar honours this; the pages do not.

6. **`StoryEditor.handleSave(isDraft)` ignores `isDraft`** (`components/admin/StoryEditor.tsx:381-425`). "Save Draft" and "Publish" are behaviourally identical — a draft requested via the Draft button still publishes (the status is decided server-side by `targetStatus` at `submit-story/route.ts:148`). The `isDraft` argument should either be forwarded to the API or removed.

7. **Duplicate "Access Denied" implementations.** `app/admin/page.tsx:17-24` hand-rolls one; `app/admin/editor/page.tsx:20-28` hand-rolls another; `app/admin/pictures/page.tsx:17-28` and `app/admin/videos/page.tsx:17-26` hand-roll a third variant (different copy). `components/admin/AccessDenied.tsx` exists and is used by only 5 places.

8. **`app/admin/page.tsx:38-39` hard-codes `status: "published"` and `history: []`** for every post passed to `AdminDashboard` — the dashboard's per-story status is therefore unreliable even though `posts/manage` returns the real values.

### Code quality

9. **No TODO/FIXME/HACK comments anywhere in `app/admin/` or `components/admin/`** — verified by grep. No `console.log`/`console.debug` in `components/admin/` either (only `console.error`).

10. **Very large files.** `AdminDashboard.tsx` = **3815 lines**; `StoryEditor.tsx` = 39396 bytes; `PictureManager.tsx` = 800 lines; `VideoManager.tsx` = 795 lines. `PictureManager` and `VideoManager` are near-identical structurally (same state shape, same `StatTile`/`ActionButtons`/`CopySiteLink` sub-components, same `loadX` pattern) — a clear extraction candidate.

11. **Duplicated `deepMerge`** — `app/api/admin/site-settings/route.ts:102-112` and `lib/config.ts` both implement it.

12. **`eslint-disable react-hooks/exhaustive-deps`** in both media managers (`PictureManager.tsx:~137`, `VideoManager.tsx:~129`) — deliberate, but signals a stale-closure risk.

13. **Empty `catch {}` blocks** are common: `app/admin/editor/page.tsx` (several), `app/api/admin/announcement/route.ts:47,90`, `app/api/admin/applications/route.ts:90`, `app/api/auth/login/route.ts:93,118,143`. Failures are silently swallowed.

14. **`app/admin/audit-logs/page.tsx:50-56`** — the `catch` block is empty, so a failed audit-log fetch renders an empty table with no error state.

15. **Mixed status codes for auth failures.** `requirePermission`-style routes return `401`; `pictures`/`videos` return `403`; `story-coauthors` returns `403` for permission and `401` for no session. Inconsistent but not broken.

16. **`lib/cover.ts` is server-only** (`fs`, `path`) but has no `import "server-only"` guard — a client import would break the build rather than fail gracefully.

17. **`app/api/admin/posts/manage/route.ts:107-109`** calls `getSession()` *and* `isAdminAuthenticated()` (which calls `getSession()` again) — two DB round-trips for one session lookup on every request.

---

## 10. Existing Documentation — Coverage & Gaps

### `ROLES_AND_PERMISSIONS.md` (335 lines, Bangla) — **the most accurate doc**
**Covers:** role hierarchy table (L9-16); the full permission list (L26-72) — **matches `ALL_PERMISSIONS` exactly**; the role→permission matrix (L78-108); ownership-based permission (L112-131); the helper catalogue (L135-168); the API authorization rule (L172-191); the safe-deletion workflow (L195-214); role management (L218-232); the admin-panel section/permission table (L238-253); live role changes (L257-260); audit logging (L264-283); notification visibility (L287-298); a security checklist (L302-311); a file reference table (L315-334).

**Gaps / mismatches:**
- **L281** says the audit-log UI is at `/admin/audit-logs` with permission `audit_logs.view` — *"admin + superadmin"*. Correct, but the **page** hard-codes the role array instead of using `audit_logs.view` (finding #5).
- **L212** claims *"সব ডিলিট এন্ডপয়েন্ট এই নিয়ম enforce করে (`posts/manage`, `comments/[id]`, `deletion-requests`)"* — **false for `crawler/publish` DELETE** (finding #2).
- **L306** claims *"Client-side-only authorization নেই (সব API server-side check)"* — technically true, but `GET /api/admin/site-settings` has **no** check at all (finding #1).
- **L329** describes `comments/[id]` as gated by `comments.manage` — the actual string is **`comments.hide`** (`app/api/admin/comments/[id]/route.ts:12,50`).
- **L298** says *"কখনো অন্যের private নোটিফিকেশন দেখানো হয় না — `user_id` দিয়ে ফিল্টার"* — true for the bulk paths, false for single-item PATCH/DELETE (finding #3).
- **L168** lists `requirePermission(perm)` but omits `authorizePermission(perm)` (`lib/admin-auth.ts:68`).

### `CMS_INSTRUCTIONS.md` (27 lines, English) — **severely outdated**
**Claims vs. reality:**

| CMS_INSTRUCTIONS.md claims | Actual code |
|---|---|
| L3: "publish stories directly to your **GitHub repository**" | Stories go to **Supabase** `stories` table |
| L9-14: env vars `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH` | Only `ADMIN_USERNAME`/`ADMIN_PASSWORD` are used (`app/api/auth/login/route.ts:54-55`, `lib/notify.ts:80`). **`GITHUB_TOKEN`/`GITHUB_OWNER`/`GITHUB_REPO`/`GITHUB_BRANCH` appear ONLY in docs — zero code references** (verified by grep). Also absent from `.env.example`. |
| L18: "Go to `/admin` and enter the `ADMIN_USERNAME` and `ADMIN_PASSWORD`" | That path now issues a **superadmin** session for the env user (`login/route.ts:84`). All other roles log in via bcrypt at `/api/auth/login`. |
| L19: "drafts you have saved (loaded from **GitHub**)" | Drafts are DB rows (`stories.status = 'draft'`). `StoryEditor.tsx:77` says *"Drafts are DB stories (status=draft) — load from the database, not GitHub."* |
| L21: "The text editor automatically formats your paragraphs" | The editor is a **plain textarea + toolbar**; no auto-formatting exists |
| L22: "Save Draft pushes the story to the `content/drafts` directory in your GitHub repo" | **False** — `handleSave` posts to `/api/author/submit-story` (Supabase). `content/drafts/` no longer exists in the repo. |
| L23: "Publish pushes to `content/posts/` … triggering a Vercel deployment" | **False** — no GitHub write, no commit, no deploy. |
| L25-27: "Editing a published story → click Edit → Publish pushes the updated MDX file to GitHub" | Edits go through `POST /api/author/submit-story` with `uid`/`slug` (`StoryEditor.tsx:399-400`) |

**Not documented at all:** the 6-role model, Supabase, `CRON_SECRET`, scheduled publishing, the video/picture hubs, feature flags, similarity/crawler tools, audit logs, deletion requests, the RBAC permission strings.

**Recommendation: rewrite `CMS_INSTRUCTIONS.md` entirely.**

### `README.md` — **partially outdated**
**Accurate:** L49-55 admin file tree; L87 `admin-auth.ts`; L292-302 admin panel section list (dashboard, applications, users, comments, announcement, settings, editor); L318 admin SEO exclusion; L340-349 public API table; L364-369 admin API table; L344 password-reset flow.

**Mismatches:**
- **L118**: *"`role` (TEXT, DEFAULT `'user'`): Role enum: `'user'`, `'author'`, `'admin'`, `'superadmin'`"* — **missing `content_manager` and `moderator`**. The real union is `lib/permissions.ts:14` / `lib/auth.ts:37`.
- **L110**: *"The env-based admin override (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) is the only exception"* — accurate.
- **L227**: *"`GET/DELETE /api/admin/github`: Direct GitHub repository file fetch and delete helper"* — **this route does not exist**. No `app/api/admin/github/` directory.
- **L282-284**: lists `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` as env vars — **all unused in code** and absent from `.env.example`.
- **L239**: *"Admin Panel Access: ❌ ❌ ❌ ✅ ✅"* (user/author/admin/superadmin) — **outdated**: `canAccessAdmin` = moderator+, so `moderator` and `content_manager` **do** get access.
- **L228-241**: the permission matrix table only has 5 roles — missing `content_manager` and `moderator`.
- **L293-302**: the admin panel list omits `/admin/videos`, `/admin/pictures`, `/admin/audit-logs`, `/admin/reports`.
- **Missing:** `CRON_SECRET`, the feature-flag system, the media hubs.

### `PROJECT_ARCHITECTURE.md` — **most outdated of the three**
**Mismatches:**
- **L140-142**: describes drafts living in `content/drafts/` and moving to `content/posts/` on publish — **no such directories exist**. The whole MDX-file workflow is gone.
- **L221**: *"POST /api/author/submit-story: Formats MDX content, calculates stats, writes file to `content/drafts/`"* — **false**.
- **L224**: *"POST /api/admin/posts/manage: `approve_publish` (moves draft to posts)"* — the action names are correct, but nothing moves files; it updates `stories.status`.
- **L225**: *"GET /api/admin/authors: Aggregates registered authors from `private/users.json`"* — **false**; it now queries the `users` table (`app/api/admin/authors/route.ts:120-122`).
- **L227**: *"GET/DELETE /api/admin/github"* — **route does not exist**.
- **L104-106**: 4-role model only — missing `content_manager`/`moderator`.
- **L73**: `drafts/` directory listed — doesn't exist.
- **L280-283**: `GITHUB_TOKEN`/`GITHUB_OWNER` — unused.
- **L189**: mentions `components/admin/StoryEditor.tsx` `.txt` reading via `FileReader.readAsText` — the code now uses `extractTextFromFile` (`lib/file-import.ts`) via `StoryEditor.tsx:266`, which supports `.txt`/`.docx`/`.pdf`.

**Accurate:** L46-48 admin tree (partially); L84 `admin-auth.ts`; L220 `/api/author/my-stories`; L236-253 admin panel & workspaces section structure; L272 server-side authorization note; L302 pagination (10/page admin, 5/page author).

### `SECURITY.md` (6.2 KB) — not admin-panel-specific; mentions `ADMIN_PASSWORD` hardening (L10-12).

### Gap summary| Document | Verdict |
|---|---|
| `ROLES_AND_PERMISSIONS.md` | **Accurate and comprehensive** for RBAC. 3 concrete mismatches (all minor, listed above). The reference target for the new doc. |
| `CMS_INSTRUCTIONS.md` | **Must be rewritten.** Describes a GitHub/MDX CMS that no longer exists. |
| `README.md` | **Update** the role list, the admin-access matrix, the admin API table, and the env-var list. |
| `PROJECT_ARCHITECTURE.md` | **Heavily outdated** — the whole MDX/GitHub storage model is obsolete. Needs a rewrite of §9 (Admin Panel & Workspaces) and the API sections. |

---

## Key Files Reference| Path | Lines | Role |
|---|---|---|
| `app/admin/layout.tsx` | 45 | Server auth gate + noindex metadata |
| `app/admin/page.tsx` | 43 | Dashboard entry |
| `components/layouts/AdminShell.tsx` | 152 | `<html>`/`<body>` shell, theme injection |
| `lib/permissions.ts` | 389 | RBAC registry — 84 permissions, 6 roles |
| `lib/admin-auth.ts` | 73 | Server authorization gates |
| `lib/auth.ts` | 152 | JWT session + live DB role |
| `lib/audit.ts` | 67 | Fail-open / fail-closed audit |
| `lib/cover.ts` | 151 | Cover pool, `getUnusedCover`, `isCoverAvailable` |
| `lib/media-schedule.ts` | 161 | Shared scheduling helpers |
| `lib/site-settings.ts` | 45 | Cached DB settings loader |
| `lib/site-defaults.ts` | — | `DEFAULT_FEATURES` (L115-118) |
| `lib/config.ts` | — | `isVideoSectionEnabled` (L256), `isPictureSectionEnabled` (L261) |
| `lib/posts.ts` | — | `includeFuture` (L390), `includePending` (L207) |
| `middleware.ts` | 33 | Canonical redirects only — **no admin gating** |
| `app/api/cron/publish-scheduled-media/route.ts` | 157 | The only cron route |
| `vercel.json` | 6 | Cron schedule `0 3 * * *` |
| `components/admin/AdminSidebar.tsx` | 620 | Permission-aware nav (L64 groups, L444 filter) |
| `components/admin/AdminDashboard.tsx` | 3815 | 9-section dashboard |
| `components/admin/StoryEditor.tsx` | ~1100 | Story editor |
| `components/admin/FeatureToggles.tsx` | 173 | Feature flags UI |

**No files were modified.** This was a read-only investigation.

---

## Verification performed for this audit

Every high-severity finding was re-checked directly against the source before being written up:

| Claim | Verified by |
|---|---|
| `GET /api/admin/site-settings` has no auth check | Read `app/api/admin/site-settings/route.ts:13-43` — no `getSession()` call in the GET handler; the PATCH at L46-49 does check |
| `DELETE /api/admin/crawler/publish` hard-deletes on `content.create` | Read `app/api/admin/crawler/publish/route.ts:268-287` — `supabase.from("stories").delete().eq("uid", uid)` gated only by `hasPermission(role, "content.create")` |
| Notifications single-item paths omit the scope filter | Read `app/api/admin/notifications/route.ts` — bulk path uses `.or(scope).in("type", allowedTypes)`; single-item PATCH (L196) and DELETE (L231) use only `.eq("id", id)` |
| Three admin pages hard-code role arrays | Grepped `app/admin/comments/page.tsx` (L32, L64), `reports/page.tsx` (L32, L73), `audit-logs/page.tsx` (L35) — all use `.includes(user.role)` instead of `hasPermission()` |
| `app/admin/users/page.tsx` has no permission guard | Grepped the file — only `useAuth()`; no `hasPermission` call |
| `StoryEditor.handleSave(isDraft)` ignores `isDraft` | Read `components/admin/StoryEditor.tsx:381-407` — the parameter is accepted at L381 and never referenced in the body; both buttons call the same endpoint |
| `GITHUB_*` env vars are unused | Grepped all `.ts`/`.tsx`/`.js` outside `node_modules` — zero matches; `app/api/admin/github/` does not exist |
| Permission registry has 84 entries | Parsed `ALL_PERMISSIONS` out of `lib/permissions.ts` and counted — 84, grouped in §2 |
| Role union and hierarchy | Read `lib/permissions.ts:14` (union) and `:17-24` (`ROLE_LEVELS`) |

---

## Suggested remediation order

| Priority | Action | Effort |
|---|---|---|
| 1 | Add `requirePermission("settings.view")` to `GET /api/admin/site-settings` | 1 line |
| 2 | Change `DELETE /api/admin/crawler/publish` to require `content.delete_permanent`, or route it through `deletion_requests` as `posts/manage` already does | Small |
| 3 | Add the scope filter to the single-item notification PATCH/DELETE | 2 lines |
| 4 | Replace the three hard-coded role arrays with `hasPermission(role, …)` | Small |
| 5 | Forward `isDraft` to the API (or remove the parameter) in `StoryEditor` | Small |
| 6 | Add a permission guard to `app/admin/users/page.tsx` | Small |
| 7 | Rewrite `CMS_INSTRUCTIONS.md`; update the role list, admin-access matrix and admin API table in `README.md`; rewrite the admin sections of `PROJECT_ARCHITECTURE.md` | Large |
| 8 | Extract the shared `PictureManager` / `VideoManager` structure into one component | Medium |
| 9 | Split `AdminDashboard.tsx` (3815 lines) into per-section components | Medium |

---

*This was a read-only investigation; no source files were modified in producing it.*