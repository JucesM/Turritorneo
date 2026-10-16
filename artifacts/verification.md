# Verification

Implemented the redesign and API fixes directly in the project.

Changed source files:
- `src/styles/global.css`: system typography, spacious hero/cards, frosted sticky navigation, brand palette, intentional light/dark themes, mobile standings cards, internal bracket scrolling, 44px controls, reduced motion and focus contrast.
- `src/layouts/Base.astro`: shared navigation, skip link, footer; removed external font requests.
- `src/pages/index.astro`: read-only hero and bracket, non-overlapping polling, visibility/page lifecycle handling.
- `src/pages/admin.astro`: matching design, mutation lock and disabled controls, focus preservation, idle polling.
- `src/lib/api.js`: request timeout, uncached state, response validation and readable errors.
- `src/lib/bracket.js`: shared seeding/result logic and accessible button state.
- `src/lib/tournament.js` (new): shared bracket computation and downstream pick pruning.
- `server/index.js`: serialized atomic transactions, rollback on disk failure, strict routes/methods/body validation, safe numeric bounds, actual-match winner validation, roster reset, static traversal/symlink guard, HEAD support, security headers and correct error statuses.
- `astro.config.mjs`: retained default `/api` proxy to port 3001, optional proxy target and opt-in restricted-Windows compatibility.
- `tests/verify.mjs` (new): repeatable API/browser verification using its own scratch database.

`src/lib/rank.js` remains the standings renderer. User-provided names remain text, never interpreted as HTML. The existing trophy uses trusted SVG markup only.

Passed:
- `npm.cmd run build` (Astro production build).
- Parallel creation and 20 simultaneous point increments; persisted JSON matches memory.
- Failed atomic rename returns 500 without publishing uncommitted data; subsequent writes recover.
- Malformed/oversized JSON, unsupported content type, missing contestants, unsupported methods, unsafe scores, nonexistent matches and unavailable winners rejected.
- Clearing an earlier winner invalidates downstream results; roster changes clear picks.
- Static traversal rejection, malformed paths, production `/` and `/admin`, HEAD.
- Local Chrome via `playwright-core`: both routes at 1440, 768 and 390 pixels in light and dark themes. Twelve PNG screenshots in this directory; no console errors or horizontal page overflow.
- Browser add/point update/delete, double-submit prevention, literal HTML-like contestant names, public polling and reduced-motion behavior.
- Astro dev proxy on port 4322 forwarded `/api/state` to the scratch API on port 3101.
- Real `data/db.json` verified unchanged byte-for-byte. Started servers terminated. Port 3001 was not used.

Reproduce in this restricted Windows environment:

```powershell
$env:NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main'
$env:PRESERVE_SYMLINKS='1'
npm.cmd run build
node tests/verify.mjs
```

The compatibility settings avoid parent-directory resolution denied by the execution sandbox. Normal development keeps the existing default proxy; tests override it with `API_PROXY_TARGET`.

Authentication remains absent, as requested. Admin/API writes are accessible to anyone who can reach the server. Persistence serialization covers one Node process; run one writer per database. The frontend uses same-origin requests through the dev proxy or production server, so permissive CORS headers are unnecessary; cross-site browser mutations are rejected.
