# CryptoStore UI

Frontend-only workspace for UI contributions. This repository has its own fresh history and contains no backend source or production data.

## Run locally

Use Node 26.12.1 or newer (`nvm install && nvm use` if you use nvm):

```sh
npm run setup
npm run dev
```

Open http://127.0.0.1:5173. The demo uses synthetic products and an in-memory API. Sign in with username `demo` and any nonempty password to open admin UI, including `/admin/products` and `/admin/theme`. Nothing connects to a live store. Restart the dev server to reset fixtures. `npm run preview` serves a production build with the same fixtures after `npm run build`.

Fixtures cover the storefront, catalog filters, product details, demo sign-in, cart, wishlist, admin product listing, and theme editor. Other screens may show empty/error states until you add a fixture in `ui/demo-api.mjs`. Payments, uploads, realtime chat, and backend operations are unavailable. This is a design workspace, not a deployable store. The ordinary production build excludes the demo middleware.

## Open a PR

1. Branch from `main` and edit the existing files under `client/src/` or `client/public/`.
2. Preserve API URLs, request/response shapes, authentication behavior, and permissions. Describe any proposed contract changes in the PR.
3. Run `npm test` and `npm run build`. Check mobile and desktop layouts.
4. Open a PR with screenshots and a brief description.

`client/` paths match the integration project, so merged UI changes can be imported with a three-way merge. Keep demo scaffolding changes under `ui/`; those are not imported into the application. Avoid large unrelated formatting changes. Dependency changes should update both `client/package.json` and `client/package-lock.json`.

Only frontend-independent tests are included here; backend integration checks run in the integration project. CI checks this test set and the production build for every PR. Do not add credentials, real user/order/catalog data, or production environment files.
