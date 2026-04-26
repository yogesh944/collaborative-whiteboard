# collaborative-whiteboard

Real-time collaborative whiteboard with Express + Socket.IO.

## Database

The app now uses SQLite for persistence.

- Default DB path: `data/collabboard.db`
- Override with env var: `DB_PATH`

Persisted data:

- Users
- Sessions
- Rooms
- Invites
- Whiteboard elements per room

## Run locally

```bash
npm install
npm start
```

App runs on `http://localhost:3000`.

## Deploy (Render)

This repo includes `render.yaml`, so Render can auto-detect settings.

1. Push this repo to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Connect your GitHub repo.
4. Render reads `render.yaml` and creates the web service.
5. Deploy.

Production commands used:

- Build: `npm ci`
- Start: `npm start`

## Deploy (Any Docker host)

This repo includes a production `Dockerfile`.

Build image:

```bash
docker build -t collaborative-whiteboard .
```

Run container:

```bash
docker run -p 3000:3000 collaborative-whiteboard
```

## Important note

Current app data is in-memory (users, sessions, rooms, invites, whiteboard elements).
On restart/redeploy, data resets. For persistent production usage, add a database.
