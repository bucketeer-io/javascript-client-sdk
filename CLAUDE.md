# CLAUDE.md

Guidance for working in the Bucketeer **JavaScript/TypeScript client SDK**
(`@bucketeer/js-client-sdk`). A feature-flag SDK that fetches user evaluations from
the Bucketeer backend and serves variations to the app.

## Commands

- Install: `pnpm install` (pnpm workspace; Node version pinned in `.node-version`).
- Build: `pnpm build` (uses `unbuild`, config in `build.config.ts`).
- Unit tests: `pnpm test` (runs browser + node). Single env: `pnpm test:browser` /
  `pnpm test:node`. Tests live in `test/`, mirror `src/` layout, use **Vitest**.
- E2E: `pnpm test:e2e` (browser + node; copies `e2e/module.<env>.ts` → `e2e/module.ts`).
- Typecheck: `pnpm typecheck:lib` (source) / `pnpm typecheck:test` (tests).
- Lint: `pnpm lint` / `pnpm lint:fix`. There is a custom ESLint rule
  (`eslint-rules/no-spread-after-defaults`) — test it via `pnpm test:custom-eslint-rules`.

## Code style

- **No semicolons, single quotes, 2-space indent** (`.prettierrc`). Match existing code.
- Custom lint rule `no-spread-after-defaults`: in `defineBKTConfig`, do **not** spread
  a source object over already-applied defaults (it would re-introduce `undefined`).
  Advanced/optional config keys are assigned conditionally (`if (x !== undefined)`),
  not spread — follow that pattern.

## Platform builds (important)

The SDK ships **three platform entry points**, selected by `package.json` `exports`:

- `src/main.ts` → **Node** (`NodePlatformModule`)
- `src/main.browser.ts` → **Browser** / `default` (`BrowserPlatformModule`)
- `src/main.native.ts` → **React Native** (`BasePlatformModule`, requires injected `idGenerator`)

Platform-specific implementations use the `*.browser.ts` / `*.node.ts` filename
convention (e.g. `IdGenerator.browser.ts` / `IdGenerator.node.ts`,
`PlatformModule.browser.ts` / `PlatformModule.node.ts`). When adding a platform
capability, add it to the `PlatformModule` interface and each variant. Each
`initializeBKTClient` builds a `DefaultComponent` from the platform module +
`DataModule` + `InteractorModule`, then calls `initializeBKTClientInternal`.

## Architecture (DI graph)

Hand-rolled DI; everything hangs off `Component` (`src/internal/di/Component.ts`):

- `Component`: `config()`, `userHolder()`, `evaluationInteractor()`, `eventInteractor()`.
  `DefaultComponent` lazily memoizes interactors.
- `DataModule` (`src/internal/di/DataModule.ts`): owns `InternalConfig`, `UserHolder`,
  `Clock`, `ApiClient`, `EvaluationStorage`, `EventStorage` (all lazy-memoized).
- `InteractorModule`: factory for `EvaluationInteractor` / `EventInteractor`.
- `PlatformModule`: platform abstractions (currently `idGenerator()`).

## Core data flow

1. **Config** — `src/BKTConfig.ts`. `RawBKTConfig` (user-facing, mostly optional) →
   `defineBKTConfig()` applies `??` defaults, then validates (throws
   `IllegalArgumentException`), then returns `InternalConfig` (adds `sourceId`,
   `sdkVersion` via `resolveSourceId`/`resolveSDKVersion`). Key defaults:
   `pollingInterval` 600_000ms (min 60_000), `eventsFlushInterval` 10_000ms,
   `eventsMaxQueueSize` 50, `fetch ?? globalThis.fetch`. `SourceId` enum in
   `src/internal/model/SourceId.ts` (JAVASCRIPT=7, NODE_SERVER=6, REACT_NATIVE=10, …).

2. **Remote** — `src/internal/remote/ApiClient.ts`. `ApiClientImpl.getEvaluations`
   does `POST ${endpoint}/get_evaluations` with headers
   `{ 'Content-Type': 'application/json', Authorization: <apiKey> }` (auth is the
   **Authorization header**, not a query param) and a `GetEvaluationsRequest` body.
   Returns a tagged `GetEvaluationsResult` (`{type:'success'|'failure'}`). `FetchLike`
   (`remote/fetch.ts`) is the injectable fetch abstraction; `post.ts` adds retry on
   499/`ClientClosedRequestException`.

3. **Evaluation** — `src/internal/evaluation/EvaluationInteractor.ts`.
   - `fetch(user)`: sends current `userEvaluationsId` + `evaluatedAt` for incremental
     updates; on success, `forceUpdate ? storage.deleteAllAndInsert(...) :
     storage.update(...)`, then `clearUserAttributesUpdated()`, then notifies all
     `updateListeners` **iff** something changed.
   - `updateListeners` registered via `addUpdateListener` (id from `idGenerator`);
     exposed to apps as `BKTClient.addEvaluationUpdateListener`.
   - `EvaluationStorage` (`EvaluationStorage.ts`) is an in-memory cache (`Mutex`-guarded)
     backed by `BKTStorage`; `update()` returns `boolean` (changed?).
   - Models: `Evaluation`, `UserEvaluations` (`{id, evaluations?, createdAt,
     archivedFeatureIds, forceUpdate}`), `GetEvaluationsResponse` (`{evaluations,
     userEvaluationsId}`).

4. **Scheduling** — `src/internal/scheduler/`. `TaskScheduler` builds
   `[EvaluationTask, EventTask]` and `start()/stop()`s them. `ScheduledTask` interface =
   `isRunning()/start()/stop()`. `EvaluationTask` polls via `setTimeout`
   (`BKTClientImpl.fetchEvaluationsInternal`), with retry (max 5 @ 60s) only when
   `pollingInterval > 60s`. `EventTask` flushes queued events.

5. **Client lifecycle** — `src/BKTClient.ts`. `initializeBKTClientInternal` creates the
   singleton (`internal/instance.ts`), `initializeInternal` → `scheduleTasks()`
   (`new TaskScheduler().start()`) + interactor init + first fetch. `resetTasks()`
   stops the scheduler; `destroyBKTClient()` calls it and clears the instance + page
   lifecycle listeners. Browser build also wires `setupPageLifecycleListeners` for
   flush-on-pagehide when `enableAutoPageLifecycleFlush`.

