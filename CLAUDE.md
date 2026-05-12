# Portpass — project context for Claude Code

## What this is
A PWA password manager forked from gopwsafe (../gopwsafe). Mobile-first UI built from scratch on top of the same Go/WebAssembly backend. Reads/writes the Password Safe v3 (.psafe3) format.

## Stack
- **Backend**: Go compiled to WASM (`cmd/wasm/main.go`, `pwsafe/` package)
- **Frontend**: Svelte 5 + Vite PWA (`pwa/`)
- **Design system**: CSS variables for two themes (light/dark) × four accents (amber, sage, slate, burgundy) in `pwa/src/lib/theme.css` and `pwa/src/lib/components.css`
- **Tests**: Playwright in `pwa/tests/`

## Key commands
```
make wasm         # compile Go → pwa/public/portpass.wasm.gz
make wasm_exec    # copy wasm_exec.js from Go installation
make dev          # build WASM + start Vite dev server (localhost:5173/portpass/)
make build        # full production build
go test ./pwsafe/...   # Go unit tests
cd pwa && npx playwright test --timeout=20000   # E2E tests
```

## Dev workflow
- Test before committing — Dan runs the app manually before asking to commit
- Don't run shell commands without being asked; provide them as text instead
- Commit messages use Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
- Don't push unless asked; don't create tags unless asked

## CI
- Every push to main: Go unit tests only
- Tagged releases: build WASM, Playwright E2E tests, deploy to GitHub Pages
- Deploy URL: https://dbro.github.io/portpass/

## Frontend structure
```
pwa/src/
  App.svelte          — root: theme/accent state, WASM loading, desktop detection, dynamic favicon/theme-color
  store.js            — selectedFile, dbItems, toast stores
  wasm.js             — JS wrappers for all WASM functions
  lib/
    biometric.js      — WebAuthn PRF fast unlock (UNTESTED on real hardware)
    passwordgen.js    — shared password generation logic (persisted to localStorage)
    theme.css         — design tokens
    components.css    — all component styles
    Icon.svelte       — inline SVG icons
    StartPage.svelte  — unlock/open/create vault flow + fast unlock offer
    Dashboard.svelte  — main orchestrator: record CRUD, save, clipboard, toast
    RecordList.svelte — collapsible groups, search highlighting, context menu, quick-copy
    RecordRead.svelte — read view: copyable fields, password history, reveal toggle
    RecordEdit.svelte — edit form with ghost autocomplete on Group/Username
    PasswordGenerator.svelte — symbol picker, character set chips, options screen
    VaultSheet.svelte — bottom sheet: vault info edit, theme/accent, fast unlock toggle
    Toast.svelte      — auto-dismissing notification
```

## Known issues / next session
- UX polish pass: helpful default focus per screen (e.g. search bar on dashboard load)
- Fast unlock (WebAuthn PRF) untested on iOS/Mac Touch ID — Android Chrome routes through Google Password Manager requiring a PIN setup
- Design is still work-in-progress (Claude Design collaboration ongoing)
- `design-wip/` folder is gitignored (React/JSX prototypes from Claude Design)
