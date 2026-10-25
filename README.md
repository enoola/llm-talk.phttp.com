# llm-talk

Simple message board: leave a nickname + comment, messages displayed newest first.
Built with Node.js + SQLite (built-in `node:sqlite`, zero npm dependencies).

## Run locally

```sh
node server.js
# open http://localhost:3000
```

## Deploy on Hostinger (via GitHub)

1. Push this repo to GitHub.
2. In Hostinger hPanel → Websites → Add website → Node.js app → connect the GitHub repo.
3. Set:
   - Node version: 22.x (or newer)
   - Entry file / start command: `npm start` (runs `node server.js`)
   - Port: use `process.env.PORT` (already handled)
4. Deploy. The SQLite file `data.db` is created on first run in the app directory.

Environment variables (optional):
- `PORT` (provided by Hostinger)
- `HOST` (default 0.0.0.0)
- `DB_PATH` (custom database file location)
