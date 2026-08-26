# Contributing to LeekBox

Thanks for considering a contribution! LeekBox is intentionally dependency-free:
the browser bundle is plain React (`createElement`) injected via the DSH module
loader, and the host half is plain ESM on top of Node's built-in fetch.

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
         name: '@leekbox/dsh-leekbox'
   ```

4. Refresh the DSH web page — the 🥬 entry appears in the sidebar.

## Making changes

- `lib/client.js` (browser) — picked up on a page refresh.
- `lib/index.js` / `lib/screener.js` (host) — require a DSH restart:

  ```sh
  curl -X POST http://127.0.0.1:<gui-port>/dsh-market/restart
  ```

- Keep everything dependency-free. No build step, no bundler.
- Follow the existing tab/region structure and CSS string block.
- A-share color convention: red = up, green = down.

## Before opening a PR

```sh
node --check lib/index.js && node --check lib/client.js && node --check lib/fetch-utils.js && node --check lib/screener.js
```

CI runs exactly this syntax gate. Data sources used must stay public and free
endpoints; never commit credentials or personal watchlist data.
