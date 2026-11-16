# Cittakkho (চিত্তক্ষোভ) — Complete Technical Architecture & System Documentation

This document provides a comprehensive, production-grade technical specification of the entire **Cittakkho** web application. It describes the **actual implementation**, architecture, data flows, security mechanisms, API endpoints, storage structures, and design choices as they exist in the codebase.

---

## 1. Overview & Core Purpose

**Cittakkho** (চিত্তক্ষোভ) is a full-stack, dynamic Bengali literature and story-publishing platform built with **Next.js 14 (App Router)**. It provides:
- A high-performance, SEO-optimized public reader interface with category browsing, tag search, series navigation, reading history, and dynamic bookmarking.
- An **Author Workspace** allowing writers to submit stories, track review statuses, inspect admin feedback, review activity timelines, and edit/resubmit stories.
- An **Admin Story Review Center & Dashboard** featuring split-view review drawers, 5-state story status management (`draft`, `pending`, `revision_requested`, `published`, `rejected`), author management, comment moderation, announcement management, and automated RSS import capabilities.

---

## 2. Technology Stack & Environment

- **Framework**: Next.js 14.2.35 (App Router, Server Components & Client Components)
- **Language & Runtime**: TypeScript 5+ & Node.js (ES2022)
- **Styling & UI**: Vanilla CSS using custom CSS variables (Design Tokens) & Tailwind CSS utility classes; Lucide React Icons. Supports Light & Dark themes via CSS classes (`dark`).
- **Content Storage**: Markdown/MDX files with YAML frontmatter (`gray-matter`).
- **Data Persistence**:
  - Published Stories: Filesystem MDX files in `content/posts/` & `content/imported/`. All stories (published, pending, revision_requested, rejected) reside in `content/posts/` and are differentiated by their `status` frontmatter field.
  - Application Relational Data: JSON database files in `private/` (`users.json`, `comments.json`, `notifications.json`, `likes.json`) synced to GitHub via REST API.
- **Authentication**: JWT tokens signed using `jose` library, stored in HTTP-Only, SameSite cookies. Passwords hashed using `bcryptjs`.
- **Date/Time Standard**: All timestamps generated in `Asia/Dhaka` (+06:00 offset) ISO 8601 format via `Intl.DateTimeFormat`.

---

## 3. Project Structure

```
cittakkho/
├── app/                        # Next.js App Router root
│   ├── (main)/                 # Main site layout & pages
│   │   ├── page.tsx            # Home page with paginated post grid & hero
│   │   ├── [slug]/page.tsx     # Single story reader page & comments
│   │   ├── profile/page.tsx    # User Profile & Author Workspace
│   │   ├── archive/[year]/[month]/ # Monthly post archive
│   │   ├── authors/            # Public authors directory
│   │   ├── authors/[id]/       # Author profile & published stories
│   │   ├── categories/[category]/ # Category posts list
│   │   ├── tags/[tag]/         # Tag search & listing
│   │   ├── featured/           # Featured stories listing
│   │   └── series/             # Story series index
│   ├── admin/                  # Admin Panel pages
│   │   ├── page.tsx            # Admin Dashboard (Stats, Review Center, Authors)
│   │   ├── editor/             # Admin Story Editor (Create/Edit MDX)
│   │   ├── comments/           # Comment moderation
│   │   ├── applications/       # Author application review
│   │   ├── announcement/       # System announcement management
│   │   ├── users/              # User management & role assignment
│   │   └── settings/           # Site configuration & branding
│   └── api/                    # Next.js API Routes (Route Handlers)
│       ├── admin/              # Admin management endpoints
│       ├── auth/               # Login, Register, Logout, Me, Update
│       ├── author/             # Story submission & author story listing
│       ├── comments/           # Comment CRUD & report handling
│       ├── likes/              # Like toggle & user likes listing
│       ├── notifications/      # Notification list & mark-as-read
│       ├── posts/              # Public posts list & search
│       └── cron/               # Scheduled import cron tasks
├── components/                 # React Components
│   ├── Header.tsx              # Responsive navigation header & auth trigger
│   ├── Footer.tsx              # Site footer
│   ├── RelatedPosts.tsx        # 4-card related posts grid
│   ├── NotificationBell.tsx    # Live notification bell & dropdown
│   ├── admin/                  # Admin components (AdminDashboard, StoryEditor)
│   ├── author/                 # Author components (SubmitStoryForm)
│   └── auth/                   # Auth Modal (Login/Register tabs)
├── content/                    # Filesystem Content Storage
│   ├── posts/                  # All story MDX files (published/pending/rejected/revision) differentiated by status frontmatter
│   ├── drafts/                 # Admin-only local draft workspace files
│   ├── imported/               # RSS/Scraped imported MDX files
│   └── authors/                # Authors metadata JSON (`authors.json`)
├── private/                    # Private JSON storage & generated indices
│   ├── users.json              # Registered user accounts & hashed passwords
│   ├── comments.json           # Post comments, replies & moderation state
│   ├── notifications.json      # User notifications queue
│   ├── likes.json              # Post like counts & user like mappings
│   └── posts-index.md          # Generated index of all posts (build-time)
├── lib/                        # Core utilities & database modules
│   ├── auth.ts                 # JWT session encryption & cookie handling
│   ├── admin-auth.ts           # Admin session verification helper
│   ├── github-db.ts            # GitHub REST API JSON read/write module
│   ├── queue.ts                # Concurrency-safe BatchQueue for JSON writes
│   ├── posts.ts                # MDX post parser & getter functions
│   ├── story-formatter.ts      # Dhaka ISO timestamps & MDX formatting
│   └── utils.ts                # Date formatting & Bengali number converter
├── scripts/
│   └── generate-posts-index.ts # Pre-build script indexing all MDX posts
├── public/                     # Static public assets (images, icons, manifest)
├── next.config.js              # Next.js configuration & HTTP security headers
└── README.md                   # Complete technical specification
```

---

## 4. User Authentication & Role Hierarchy

### Role Hierarchy
The system enforces a strict 4-level role hierarchy:
1. `user`: Standard registered user. Can read stories, post comments, like posts, save bookmarks, and apply to become an author.
2. `author`: Verified writer. Has access to the **Author Workspace** (`/profile?tab=author`), can write stories, upload `.txt` files, submit stories for admin review, track timeline statuses, and resubmit stories upon admin revision requests.
3. `admin`: Administrator. Can review submitted stories, approve/publish, request revisions with feedback, reject stories, manage comments, process author applications, and update site settings.
4. `superadmin`: Root Administrator. Has full system access including User Management (`/admin/users`) and role modification.

### Authentication Mechanism
- **Endpoint**: `/api/auth/login` and `/api/auth/register`.
- **Password Protection**: Passwords are hashed using `bcryptjs` (salt round 10). Only bcrypt verification is accepted — no fallback bypass mechanisms exist. The env-based admin override (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) is the only exception, intended for the superadmin account.
- **Session Tokens**: JWT payloads containing `id`, `username`, `name`, `email`, `role`, and `createdAt` are signed using `jose` (`SignJWT`) with `JWT_SECRET`.
- **Cookie Security**:
  ```typescript
  cookies().set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  ```

---

## 5. Story Submission, Review & Status Workflow

### 5-State Story Lifecycle
Stories move through a defined state machine persisted directly within MDX YAML frontmatter:

```
[Draft] ──> [Pending Review] ──> [Approved & Published]
                   │
                   ├──> [Revision Requested] ──> Author Edits & Resubmits (version++) ──> [Pending Review]
                   │
                   └──> [Rejected]
```

1. **`draft`**: Local or server-saved unsubmitted draft. Visible only to the author.
2. **`pending`**: Submitted by author. Enters the Admin Review Center queue in `content/drafts/`.
3. **`revision_requested`**: Admin requests changes with required feedback text. Story stays in `content/drafts/`, author sees admin feedback in their Author Workspace and can click `[এডিট ও পুনরায় জমা দিন]` to edit and resubmit.
4. **`published`**: Admin approves story. File moves from `content/drafts/` to `content/posts/`, status updates to `published`, and story appears live on the website.
5. **`rejected`**: Admin rejects story with a required rejection reason.

### MDX Frontmatter Schema
```yaml
---
title: 'গল্পের শিরোনাম'
description: >-
  গল্পের সংক্ষিপ্ত বিবরণ
author: 'username'
category: 'hot'
tags:
  - 'গল্প'
  - 'উপন্যাস'
cover: 'https://imgur.com/example.jpg'
previousPost: 'null'
featured: false
uid: '22433565205174'
publishedAt: '2026-08-18T17:40:00+06:00'
updatedAt: '2026-08-18T18:00:00+06:00'
status: 'published'
version: 1
rejectionReason: 'পরামর্শ টেক্সট'
feedbackDate: '2026-08-18T17:40:00+06:00'
history:
  - event: 'created'
    at: '2026-08-18T16:00:00+06:00'
    actor: 'username'
  - event: 'submitted'
    at: '2026-08-18T16:30:00+06:00'
    actor: 'username'
  - event: 'published'
    at: '2026-08-18T17:40:00+06:00'
    actor: 'admin'
---
```

---

## 6. MDX Content & Formatting System

### Story Formatter Utility (`lib/story-formatter.ts`)
- **Dhaka ISO Generator (`getDhakaTimeISO`)**: Generates exact ISO 8601 timestamps in `Asia/Dhaka` timezone (+06:00 offset) regardless of client device location.
- **Content Normalization (`formatStoryContent`)**:
  1. Removes stray HTML line break tags (`<br>`, `<br/>`) and trailing line backslashes (`\`).
  2. Normalizes Windows line endings (`\r\n` -> `\n`).
  3. Groups trimmed text into double-newline-separated paragraphs (`\n\n`) for clean Markdown rendering without manual line editing.
- **Story Stats Calculation (`calculateStoryStats`)**: Calculates word count (`split(/\s+/)`) and estimated reading time (`Math.ceil(words / 180)`).
- **.txt File Text Extraction**: Story editors (`components/author/SubmitStoryForm.tsx` & `components/admin/StoryEditor.tsx`) feature a `.txt` file reader using `FileReader.readAsText(file, "UTF-8")` to extract raw text files directly into the editor while preserving formatting.

---

## 7. Data Storage & Concurrency Architecture

### Dual-Layer Storage Pattern
1. **MDX Filesystem Layer**: Stories and post metadata are stored as physical MDX files in `content/posts/`, `content/drafts/`, and `content/imported/`.
2. **GitHub API & JSON Database Layer**: User accounts, comments, notifications, and post likes are stored in `private/*.json`. In production serverless environments, writes are committed to GitHub via REST API.

### Concurrency-Safe Batch Queue (`lib/queue.ts`)
To prevent race conditions and GitHub API rate limits during concurrent writes, operations use a singleton `BatchQueue`:
```typescript
export const commentsQueue = new BatchQueue<any>("private/comments.json", "Auto-sync comments", 3000);
export const usersQueue = new BatchQueue<any>("private/users.json", "Auto-sync users", 2000);
export const notificationsQueue = new BatchQueue<any>("private/notifications.json", "Auto-sync notifications", 2000);
export const likesQueue = new BatchQueue<any>("private/likes.json", "Auto-sync post likes", 3000);
```

---

## 8. Backend APIs & Endpoint Summary

### Authentication APIs (`/api/auth/`)
- `POST /api/auth/login`: Authenticates user by username/email and password. Returns JWT session cookie.
- `POST /api/auth/register`: Creates new user account with generated unique username and hashed password.
- `POST /api/auth/logout`: Clears session cookie.
- `GET /api/auth/me`: Returns current authenticated user payload.
- `POST /api/auth/update`: Updates user display name, email, or profile picture URL.

### Author Workspace APIs (`/api/author/`)
- `GET /api/author/my-stories`: Returns story cards, status badges, timelines, and feedback for logged-in user. Supports `?all=true` for admin review queue and `?author=username` for filtering by author.
- `POST /api/author/submit-story`: Formats MDX content, calculates stats, writes file to `content/drafts/` with status `pending`, and enqueues admin notification.

### Admin APIs (`/api/admin/`)
- `POST /api/admin/posts/manage`: Performs post review actions: `approve_publish` (moves draft to posts), `request_revision` (saves feedback & updates status), `reject` (saves reason & updates status), `unpublish` (moves post to drafts), `delete` (removes file). Enqueues author notifications.
- `GET /api/admin/authors`: Aggregates registered authors from `private/users.json` and cross-references MDX post author stats (`published`, `pending`, `revision`, `rejected`).
- `GET /api/admin/stats`: Returns overall site counters (total posts, drafts, comments, categories, author applications).
- `GET/DELETE /api/admin/github`: Direct GitHub repository file fetch and delete helper.

### Comments & Notifications APIs
- `GET/POST /api/comments`: Fetches and posts comments/replies for stories.
- `GET /api/notifications`: Returns user notifications list.
- `POST /api/notifications/read`: Marks notification as read by ID.

---

## 9. Admin Panel & Workspaces

### 1. Dashboard Tab (`/admin`)
Displays quick stats counters (published posts, draft files, total authors, comments, categories, author applications), search bar, draft files list, and paginated published posts list (10 posts/page with page number buttons).

### 2. Story Review Center (`/admin?section=review`)
- Prioritizes pending approval requests: Category tabs include **`অপেক্ষমাণ (Pending)`** (default with badged count), `সব গল্প`, `সংশোধন প্রস্তাব`, `প্রকাশিত`, and `প্রত্যাখ্যাত`.
- Features an **Author Filter Dropdown** to isolate stories by author.
- Opens a **Review Modal Drawer**:
  - Desktop: Left = MDX content reading preview; Right = Author metadata, submission date, status, timeline log, and action buttons (`Approve & Publish`, `Request Revision`, `Reject`).
  - Mobile: Vertical responsive layout.

### 3. Registered Authors Tab (`/admin?section=authors`)
Displays cards for all registered authors showing avatar, username, role, and story statistics (`published`, `pending`, `revision`, `rejected`). Includes a **`[লেখকের সব গল্প দেখুন]`** button opening a dedicated modal with all stories by that author and direct `[রিভিউ]` buttons.

---

## 10. Profile Page & Author Workspace (`/profile`)

The profile page (`app/(main)/profile/page.tsx`) organizes user activities into clear tabs:
1. **`আমার ড্যাশবোর্ড (Author Workspace)`**: Default landing tab for authors/admins. Displays Overview Statistics cards (`Total`, `Published`, `Pending`, `Revision`, `Rejected`, `Draft`), filter tabs, paginated story cards (5 stories/page), admin feedback banners, collapsible activity timelines, and a `[+ নতুন গল্প লিখুন]` trigger.
2. **`আমার অ্যাক্টিভিটি (Activity)`**: Displays user's comments/replies history with actual **story titles** (not file slugs) and recently read stories (capped to max 5 items).
3. **`গল্প লিখুন / ড্রাফট (Write Story)`**: Full MDX story submission form with `.txt` file upload button.
4. **`সেটিংস (Settings)`**: Display name, email, and Profile Picture **Image URL link input** with live avatar preview (file uploads disabled for simplicity).

---

## 11. Security Mechanisms

- **HTTP Security Headers** (`next.config.js`):
  - `Content-Security-Policy`: Restricts script, style, image, and frame origins.
  - `X-Frame-Options: SAMEORIGIN`: Prevents clickjacking.
  - `X-Content-Type-Options: nosniff`: Prevents MIME-type sniffing.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Server-Side Authorization**: API routes verify session roles server-side (`isAdminAuthenticated()` or `getSession().role`) before allowing story modifications, status updates, or draft deletions.
- **Path Traversal Protection**: Slugs and filenames are sanitized (`fileSlug.replace(/\.mdx$/i, "")`) before accessing filesystem paths.

---

## 12. Environment Variables

- `JWT_SECRET`: Secret key used for JWT session signing and verification.
- `ADMIN_USERNAME`: Master admin username override.
- `ADMIN_PASSWORD`: Master admin password override.
- `GITHUB_TOKEN`: Personal access token for GitHub REST API writes.
- `GITHUB_OWNER`: GitHub repository owner or organization.
- `GITHUB_REPO`: GitHub repository name.

---

## 13. Build & Deployment System

- **Build Script** (`package.json`):
  ```json
  "build": "npx tsx scripts/generate-posts-index.ts && next build"
  ```
- **Pre-build Indexer**: `scripts/generate-posts-index.ts` scans `content/posts/` and `content/imported/` to generate `private/posts-index.md` containing a complete markdown inventory of all published posts.
- **Deployment Compatibility**: Fully compatible with Vercel and Node.js serverless runtimes. Routes using session cookies are configured with `export const dynamic = 'force-dynamic'`.

---

## 14. Known Technical Characteristics

- **Local Development vs Serverless**: Local development writes directly to filesystem MDX files and `private/*.json` files. Production serverless deployments commit JSON changes to GitHub via `github-db.ts` to ensure persistence across serverless invocations.
- **Client-Side Page Size**: Admin published posts pagination defaults to 10 items/page; Author profile story list pagination defaults to 5 items/page.

---

## 15. Supabase Database Setup

To set up the database you need a Supabase project:

1. **Create Project**: Go to [Supabase](https://supabase.com/) and create a new project.
2. **Run the setup script**: In the SQL Editor, open `scripts/setup.sql`, paste its contents, and run it.

`scripts/setup.sql` is the single, complete setup for this application. It creates every table, function, index, RLS policy and seed row the app needs — stories, comments, likes, reactions, chat, notifications, the video library, the picture gallery, analytics and the moderation tables.

The script is **idempotent**: running it again on an already-configured database is safe and changes nothing, so you can also use it to top up a database that is missing something.

Each section of the file is ordered by dependency and has a header explaining what it does, so you can follow along if you need to run the statements one at a time.

> The older per-feature scripts still live in `scripts/legacy/` for reference. You do not need them — `scripts/setup.sql` replaces all of them.

Optional follow-ups after the setup has run:

```sql
-- Schedule the group-chat cleanup (requires pg_cron)
select cron.schedule(
  'delete_old_group_messages_cron',
  '0 * * * *',
  'select public.delete_old_group_messages()'
);

-- If you are migrating an existing database, backfill the normalised
-- post_id columns once post_metadata has been seeded:
select public.backfill_post_ids();
```

To remove database objects that are no longer used, see `scripts/remove-unused-tables.sql`. It is separate from the setup script on purpose — run it only when you intend to delete data.

3. **Environment Variables**: Add these to your `.env` (local) and Vercel environment variables:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```
*Note: Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.*

---

## 16. Moving the Data

`tools/db-toolkit/` is a standalone project that copies a database out and
seeds a new one with the same data. It works with any Postgres or
Supabase project, not just this one — see `tools/db-toolkit/README.md`.

```bash
# Copy the whole database into ./db-export
npm run db:export

# Turn that into ONE sql file you can paste into the Supabase SQL Editor
npm run db:seed

# Load it into another database
npm run db:import -- --url=postgresql://user:pass@host:5432/postgres --truncate
```

The export contains every table, including the ones that are closed to the
browser, because it reads with the service-role key.

The generated `seed.sql` is a plain SQL file: tables are written in
dependency order, foreign keys are deferred for the whole load, and the
entire load is one transaction — so either every row lands or none does.

To check that the seed file really holds the data it was generated from:

```bash
node tools/db-toolkit/src/cli.mjs verify --in=./db-export
```

# chotikahini
