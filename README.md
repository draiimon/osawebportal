# OSA Transaction Guide Portal

OSA portal with a live Node/Express API, PostgreSQL integration, and an in-progress React migration workspace.

## Performance (static site)

This project is **plain HTML/CSS/JS** (not React/Next.js). That keeps payloads small and avoids framework runtime cost on mobile. Comparable polish comes from:

- **Deferred chat load** — `osa-chat-loader.js` loads the full chat widget after `requestIdleCallback` or first user interaction, so initial parse/execute stays lighter.
- **CSS preloading** — `rel="preload" as="style"` for critical stylesheets.
- **Lazy images** — `loading="lazy"` / `decoding="async"` where appropriate; Lost & Found preconnects to Unsplash.
- **Optional minification** — `npm run minify` emits `*.min.css` / `*.min.js` next to sources; use `*.min.js` loaders and bump links in HTML for production, or wire your host’s build step.
- **CDN / caching** — Put `public/` behind any CDN (Cloudflare, Netlify, Vercel static, S3+CloudFront). Example Netlify cache hints live in `public/_headers`.

A React + Tailwind + shadcn-compatible workspace now exists in `frontend/` and can run side-by-side with the existing portal UI.

## Run locally

### Legacy portal (current UI)

```powershell
cd public
python -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

### API server

```powershell
cd "path\to\OSA Transaction Guide Portal"
npm install
npm run api:start
```

API base is `http://localhost:8787/api/v1`.

### React migration workspace

```powershell
cd "path\to\OSA Transaction Guide Portal\frontend"
npm install
npm run dev
```

Runs on `http://localhost:5173`.

## Structure

```
public/
├── index.html                     # redirects to preview.html
├── preview.html                   # main portal (hero, services, manual, chat widget)
├── css/
│   ├── osa-design.css             # global design system (navbar, footer, layout)
│   ├── osa-ai.css                 # chat widget
│   └── *.min.css                  # optional: `npm run minify`
├── assets/images/                 # EAC emblem, photos, manual cover
├── announcements       # /announcements
├── lost-and-found      # /lost-and-found
├── appointments        # /appointments
└── about-portal        # /about-portal
```

## Optional: minified assets (production)

```powershell
cd "path\to\OSA Transaction Guide Portal"
npm install
npm run minify
```

This writes `public/css/*.min.css` and `public/assets/js/*.min.js`. Point your HTML at those files (or swap filenames in your deploy pipeline) for smaller downloads. The chat loader auto-loads `osa-chat-widget.min.js` when the loader script URL contains `.min.js`.

## Notes

- Legacy pages still work and keep existing CSS/visual behavior.
- New API auth endpoints: `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/me`.
- New realtime namespace: `/ws/chat` (Socket.io).
- Prisma schema for thesis tables is in `prisma/schema.prisma` (PostgreSQL + pgvector).

## Docs

- `docs/api-requirements.md` — planned API surface for future backend.
- `docs/content-checklist.md` — content coverage checklist.
- `docs/db-digitalocean-postgres-integration.md` — implemented DB integration checklist, schema, and run steps.
