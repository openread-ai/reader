# Playwright e2e tests — openread-app

App-level e2e tests — auth, opening a book, user flows. Runs against a
real Supabase test account and a local Next.js dev server.

---

## Architecture

```
e2e/
├── fixtures/        real-Supabase auth fixture (authenticatedPage)
│   ├── auth.ts      injects session into BOTH custom keys + sb-<ref>-auth-token
│   ├── test-users.ts loads TEST_USER_* from .env.test.local
│   └── index.ts     barrel re-exporting { test, expect }
├── pages/           Page Object Model — actions + queries only, no assertions
│   ├── BasePage.ts
│   ├── LibraryPage.ts
│   └── ReaderPage.ts
├── utils/
│   └── navigate-to-reader.ts   solves the /library → /reader sync race
├── data/            factories (future — empty at Phase 1)
└── tests/
    ├── api/         HTTP-only specs (future)
    ├── ui/          browser specs (auth.spec.ts, open-book.spec.ts)
    └── e2e/         mixed API-setup + UI-assert specs (future)
```

Specs read like a story:

```ts
test('user opens a book and reader renders', async ({ authenticatedPage }) => {
  const library = new LibraryPage(authenticatedPage);
  const reader = new ReaderPage(authenticatedPage);
  await library.goto();
  await library.expectLoaded();
  await library.clickFirstBook();
  await reader.waitForReaderUrl();
  await expect(reader.inlineQuestionBar()).toBeVisible();
});
```

---

## Platform matrix

Playwright covers all 5 supported platforms (web · macOS · Windows ·
iOS · Android) at the **web layer** via viewport + UA emulation. Same
specs run across every project.

| Project name      | Covers platform             | Notes                                                                         |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `chromium`        | web · mac-web · windows-web | Desktop Chrome baseline                                                       |
| `webkit`          | mac (Tauri WKWebView proxy) | Desktop Safari — the engine Tauri macOS uses                                  |
| `msedge`          | windows-web                 | Uses installed Edge channel                                                   |
| `mobile-chromium` | android (web layer)         | Playwright Pixel 7 viewport+UA — **not** a real Android device                |
| `mobile-webkit`   | ios · ipad (web layer)      | iPhone 15 Pro viewport+UA — **not** a real iPhone                             |
| `ui-regression`   | visual baselines            | Pinned 1440×900 viewport, baselines in `~/.openread-dev/artifacts/baselines/` |

**What is NOT covered here** (by design):

- Real iOS device UI — Playwright can't drive a real iPhone; needs `ios-deploy` + Appium/XCUITest
- Real Android emulator/device — Playwright doesn't cover this lane; use the V3 Android native scripts with `Openread_Pixel_8_API_35` + ADB. Readiness can warm the emulator with `pnpm activity:android-smoke -- --warm-only --lock-wait-ms 300000` from `apps/openread-app/`.
- Native fixture expansion — Playwright fixtures do not auto-translate to native devices; use `pnpm activity:native-fixtures -- --native-targets ios-simulator,android-device` to generate the native fixture manifest/commands from the shared capture plan. Implemented native fixture adapters cover route/deep-link, onboarding skip, anonymous auth, and guarded book/auth readiness; future theme/locale/permissions/network/subscription adapters are reserved and block until implemented. iOS simulator readiness can warm with `pnpm activity:stage4-native -- --native-targets ios-simulator --warm-only --lock-wait-ms 300000`.
- macOS / Windows Tauri native shell — Playwright drives browsers, not Tauri windows; needs `tauri-driver`
- Linux — not a supported product platform

---

## Running locally

### 1. Create `.env.test.local`

Copy the example and fill in credentials:

```sh
cp .env.test.local.example .env.test.local
# edit .env.test.local with TEST_USER_* + NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 2. Install browsers (one-time)

```sh
pnpm exec playwright install chromium    # minimum for quick iteration

# For full matrix (chromium + webkit + mobile variants):
pnpm exec playwright install

# msedge uses the system Microsoft Edge install and requires sudo to fetch:
sudo pnpm exec playwright install msedge
```

If msedge isn't installed, that one project fails with
`Chromium distribution 'msedge' is not found`. The other 4 projects
(chromium, webkit, mobile-chromium, mobile-webkit) run unaffected.

### 3. Run specs

Readiness health smoke:

```sh
pnpm activity:platform-health --activity sandbox-health --attempt health-1 --platforms web,ios,android
```

This runs Openread load + login/logout health on selected Playwright web-layer lanes and launches Openread on selected native targets. Add `--require-native-auth true` when native login/logout must be a hard readiness gate; true native login/logout requires a secure native auth fixture/session and is not faked through deep-link secrets.

```sh
# Fast feedback — one spec on chromium:
pnpm exec playwright test e2e/tests/ui/auth.spec.ts --project=chromium

# All app-level specs on one browser:
pnpm exec playwright test e2e/tests/ --project=chromium

# Full platform matrix (all 5 projects):
pnpm exec playwright test e2e/tests/

# Show the last HTML report:
pnpm exec playwright show-report
```

The config auto-starts `pnpm dev-web` on :3000 and auto-loads
`.env.test.local` into the test runner process — no wrapper script
needed.

---

## Auth behavior

The `authenticatedPage` fixture makes a real Supabase
`signInWithPassword` call, caches the session for the test run, and
injects it into the browser context via `localStorage` **before** the
first navigation. Two writes are required (both present in `auth.ts`):

1. Custom keys — `token`, `refresh_token`, `user` — read by
   `AuthContext` on mount (`src/context/AuthContext.tsx:26-38`).
2. `sb-<projectRef>-auth-token` — read by `@supabase/supabase-js` when
   `refreshSession()` fires. Without it, refresh fails and the custom
   keys get wiped before first render.

R2 downloads are proxied through `fetch` to sidestep CORS blocking the
headless browser.

---

## Phase 2 — deferred

| Item                                                   | Blocker                                                   |
| ------------------------------------------------------ | --------------------------------------------------------- |
| macOS Tauri smoke via `tauri-driver`                   | `tauri-driver` uses WebDriver, not the Playwright browser |
| Windows Tauri smoke via `tauri-driver`                 | Same — plus no Windows CI runner today                    |
| iOS physical device via `ios-deploy` + Appium/XCUITest | Playwright can't drive a real device                      |
| Android device automation via Appium + ADB             | Playwright can't drive a real device                      |
