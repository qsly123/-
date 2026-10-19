# Repository Guidelines

## Project Positioning
- This project is a portrait-first H5 cultivation game with realtime map movement, realtime boss/combat scenes, and future large-scale PvP.
- Gameplay pages are mobile-first while still needing clean PC adaptation.
- Do not treat gameplay pages like generic admin dashboards or wide desktop apps. The core playfield always has the highest layout priority.

## Project Structure & Module Organization
- `src/app`: Next.js App Router entrypoints; keep route/page files thin and path-oriented (`src/app/api/**/route.ts`).
- `src/modules`: domain-first codebase (`admin/`, `auth/`, `character/`, `chat/`, `combat/`, `map/`, `quest/`, `social/`, `system/`, `shared/`), with `api/`, `services/`, `ui/` sublayers. `plugin/` is legacy and should not receive new gameplay.
- `src/db`: Drizzle schema, seed data, and maintenance scripts.
- `public/`: static and PWA assets (`manifest.webmanifest`, `sw.js`).
- `docs/`: focused docs such as PWA checks and worldpack content.
- `drizzle/`: generated migration files; keep this aligned with schema changes.

## Build, Test, and Development Commands
Use Bun for local workflows:
- `bun run dev`: start local development server (Turbopack enabled).
- `bun run build`: build production artifacts (Next standalone output).
- `bun run start`: run the built app in production mode locally.
- `bun run lint`: run ESLint with Next.js + TypeScript rules.
- `bun run db:setup`: generate migrations, run migrations, and seed data.
- `bun run db:init:worldpack`: initialize storyline/worldpack seed content.
- `bun run db:studio`: inspect database tables with Drizzle Studio.

## Coding Style & Naming Conventions
- TypeScript is strict (`strict: true`); keep types explicit at module boundaries.
- Follow existing formatting: 2-space indentation, semicolons, double quotes.
- Use `@/*` import alias for `src` paths instead of deep relative imports.
- Naming: `camelCase` for variables/functions, `PascalCase` for React components.
- Route folders under `src/app` should stay path-oriented and readable (e.g. `game/map`, `admin/realm-config`).
- Prefer domain service extraction over page-local business logic when the feature will be reused by map/combat/boss flows.

## Realtime / Sync Rules
- Map, combat, boss, and future PvP are server-authoritative. Client only sends input, renders prediction/interpolation, and reconciles to authoritative state.
- Any realtime movement/action request must carry the proper client metadata when the flow supports it, such as `clientSequence`, `clientSceneTick`, `actionId`, and `clientSentAt`.
- Server responses for authoritative movement/action endpoints should return sync metadata such as accepted sequence, ack, server tick, and authoritative state required for client correction.
- Never implement gameplay-critical state only in client memory. Movement legality, damage, hit confirm, cooldown validity, death, rewards, resource changes, and combat results must be server-decided.
- Rejected realtime requests must still consider whether sequence acknowledgement is needed so the client does not get poisoned by stale local progression.
- Keep realtime transport behind shared abstraction layers. Do not bind gameplay pages directly to raw `WebSocket` or `EventSource`; use shared realtime channel wrappers.
- Prefer snapshot/event driven scene models under `src/modules/**/services/*scene*` instead of ad hoc page-local sync stitching.

## Canvas / Scene Architecture Rules
- Realtime entities, movement, interpolation, hit windows, floating text anchors, and combat/map effects should live in scene-layer code, not scattered DOM overlays.
- When upgrading a gameplay surface, first extend the scene state model and renderer contract, then wire the API and transport updates.
- DOM should mainly handle page shell, modals, panels, and non-core controls. Core entity rendering should remain in Canvas once migrated.
- Do not move already-scene-managed entity logic back into page-local DOM rendering unless there is a strong reason.
- Effects and labels must anchor to scene entities. Avoid detached effects, drifting overlays, or large decorative highlights that obscure gameplay.

## Gameplay UI / Layout Rules
- The game is portrait-first. Mobile and PC should both preserve a vertical gameplay composition.
- Do not compress the main battle/map scene into the left side just to fit cards or metadata panels.
- Core playfield readability is higher priority than decorative cards, logs, announcements, or stat panels.
- Mobile interaction must prioritize thumb reach. Avoid requiring users to scroll to access movement, skills, or core battle actions.
- For mobile realtime movement, prefer tap-to-move or joystick-like interaction patterns that do not consume excessive vertical space.
- Battle reports/logs should be collapsible or minimizable on mobile and must not cover the player entity or core combat area.
- HP bars, names, avatars, and effects must stay visually aligned to their entity. Do not place labels in ways that block the playfield unnecessarily.
- PC adaptation should feel like an optimized portrait game layout, not a horizontally stretched dashboard.

## Combat / Map Feature Rules
- Ordinary combat, boss combat, and map realtime systems should share patterns where possible: authoritative server state, reusable scene models, unified transport abstraction, and consistent anti-abuse metadata.
- If a feature will later participate in realtime combat, design the state shape now for position, velocity, interpolation, server frame/tick, and reconciliation.
- Enemy entities should eventually follow the same authoritative scene model as players; avoid hardcoding enemies as permanently fixed decorative targets.
- Position should matter. When implementing new combat logic, prefer designs that can evolve toward collision, hit windows, and stance/spacing impact.

## Data / DB Safety Rules
- Any long-term growth numeric field such as cultivation, damage totals, hourly yield, ranking score, or large combat aggregates must be designed with bigint-safe storage and API handling.
- Do not assume Postgres `integer` is sufficient for cultivation-like values, cumulative rewards, or high progression systems.
- For Postgres time comparisons, ensure both sides use compatible timestamp/date types. Do not compare `timestamp with time zone` directly to plain text.
- Schema changes should be idempotent where possible and should avoid repeated noisy startup notices when a column/table/index already exists.
- When changing Drizzle schema for numeric or time fields, verify schema, route handlers, serialization, and client parsing together.

## Text, Encoding, and File Safety
- Involving deletes means moving files into `.bak/<YYYY-MM-DD>/` under the same directory first; do not perform true deletion unless explicitly requested.
- Respect BOM differences when touching files that already contain BOM-sensitive content.
- Perform string巡检 when necessary and avoid writing garbled text back into the repo.
- Maintain UTF-8 Chinese text correctly, unify Simplified Chinese copy where applicable, and avoid accidental mojibake reintroduction.

## Plugin Retirement Rules
- The plugin system is legacy and entering retirement. Do not add new plugin packages, plugin hooks, plugin-hosted pages, or plugin admin entities.
- New gameplay must live in fixed core modules with schema, services, pages, admin entries when needed, and updated MD documentation.
- Existing plugin gameplay that remains valuable must be migrated into core modules before plugin routes, hooks, or data are removed.
- If legacy plugin files must be touched before retirement, verify build impact and keep the change narrowly scoped.

## Testing Guidelines
- No automated test framework is configured in this repository yet.
- Minimum quality gate for each change: `bun run lint` and manual verification of affected flows.
- Manual checks should cover relevant pages and APIs (auth, character flow, `/game/*`, and admin pages).
- If introducing tests, place `*.test.ts` or `*.test.tsx` near target modules and prioritize `src/modules/**` plus API route adapter logic.

## Realtime Feature Verification
For any change affecting map/combat/boss/realtime systems, minimum verification includes:
- `bun run build`
- `bun run lint`
- Manual verification on both mobile and PC layouts
- Manual verification of `/game/map`, `/game/combat/[id]`, and `/game/boss/[id]` when related
- Verify reconnect/reload behavior for realtime channels
- Verify authoritative correction after rejected movement or action requests
- Verify transport compatibility if SSE/WebSocket code changed
- Verify that core scene area is not occluded by logs/cards/panels on mobile or PC

## Commit & Pull Request Guidelines
- Follow existing commit history style: `feat:`, `fix:`, `refactor:` with concise summaries (Chinese or English).
- Keep each commit and PR focused on one problem.
- PRs should include: what changed, affected paths, migration impact, manual verification steps, and screenshots for UI/admin changes.

## Security & Configuration Tips
- Store local secrets only in `.env.local` (at minimum `DATABASE_URL`).
- Do not commit credentials or production connection strings.
- Validate OAuth/system-config values before enabling production login paths.
- When changing realtime transport, proxy, or deployment behavior, consider container runtime, reverse proxy headers, and WebSocket upgrade compatibility together.

## Collaboration Expectations For Future Work
- Preserve the new architectural direction: server-authoritative sync, core-module gameplay, and the staged migration toward a Colyseus + Phaser realtime foundation.
- Avoid short-term UI patches that fight the long-term realtime scene architecture.
- When a bug report comes with mobile console logs or container logs, prefer log-driven precise fixes instead of speculative rewrites.
- For gameplay pages, quality means not only “works” but also “scene readable, controls reachable, sync stable, mobile usable”.
