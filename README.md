# My Notes — Notes API

A full-stack notes management application built with Node.js, Express, HTML, CSS and vanilla JavaScript. Data is stored in a local JSON file.

## Requirements
Node.js 18 or newer and npm.

## Setup
```bash
npm install
npm start
```
Open http://localhost:3000. For development, use `npm run dev`.

## Features
Create, view, edit and delete notes; search and sort; filter by tags; pin/unpin; color labels; light/dark theme; statistics.

## API
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/notes` | List notes (`q`, `tag`, `sort`, `order` supported) |
| GET | `/api/notes/:id` | Get one note |
| POST | `/api/notes` | Create note |
| PUT | `/api/notes/:id` | Update note |
| PATCH | `/api/notes/:id/pin` | Toggle pinned state |
| DELETE | `/api/notes/:id` | Delete note |
| GET | `/api/stats` | Summary statistics |

## Structure
- `server.js`: Express server and REST API
- `public/`: frontend pages, CSS and JavaScript
- `data/notes.json`: existing notes
- `package.json`: scripts and dependency manifest

**Deployment note:** JSON-file persistence requires a writable persistent filesystem. Serverless/ephemeral hosting may lose saved notes; use a database for production deployments.
