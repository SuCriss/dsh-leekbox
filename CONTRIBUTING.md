# Contributing to LeekBox

Thanks for considering a contribution! LeekBox keeps runtime dependencies at
zero: the browser bundle is plain React (`createElement`) injected via the DSH
module loader, and the host half is plain ESM on top of Node's built-in fetch.
The only dev-only tool is esbuild, which bundles `src/client/*` into the
committed `lib/client.js` artifact.

## Development setup

1. Clone this repo.
2. Link it into your DSH web profile (pick either):

   ```sh
   # junction (Windows)
   mklink /J "$DSH_HOME\profiles\web\node_modules\@leekbox\dsh-leekbox" "<repo path>"

   # or pnpm
   pnpm add file:<repo path>
   ```

3. Register the plugin row in `$DSH_HOME/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: leekbox
         name: 'dsh-leekbox'
   ```

4. Refresh the DSH web page — the 🥬 entry appears in the sidebar.

## Making changes

- Browser code lives in `src/client/` (one file per panel/tab concern). Never
  hand-edit `lib/client.js` — it is the generated bundle:

  ```sh
  npm install     # once (dev-only esbuild, pinned by package-lock.json)
  npm run dev     # watch: rebuild on every save
  # or
  npm run build   # one-shot rebuild
  ```

  Commit the rebuilt `lib/client.js` together with your source changes — CI
  rebuilds it and fails the PR if the committed artifact is stale. A page
  refresh picks up the new bundle.
- `lib/index.js` / `lib/screener.js` (host) — require a DSH restart:

  ```sh
  curl -X POST http://127.0.0.1:<gui-port>/dsh-market/restart
  ```

- Keep runtime dependencies at zero — esbuild is a dev-only tool; React stays
  external (injected by the host's module loader) and must never be bundled.
- Follow the existing tab/region structure and CSS string block.
- A-share color convention: red = up, green = down.

## Before opening a PR

```sh
npm run check   # syntax gate over lib/*, build.mjs and src/client/*
npm test        # stubbed regression suite (no network)
```

CI runs this syntax gate plus the full test suite. Data sources used must stay
public and free endpoints; never commit credentials or personal watchlist data.
