# The Journal 2.0 — Hybrid Publishing Platform

Node.js + Express + built-in SQLite. Requires Node.js 22.13+ (Node 24 recommended).

## Start

```powershell
npm install
npm start
```
Open http://localhost:3001.

## Preserve your existing users and posts

1. Stop the old server.
2. Copy your existing `data/blog.db` into this project’s `data/` folder BEFORE first start.
3. If your old DB uses WAL, stop the server and copy any `blog.db-wal` and `blog.db-shm` alongside it.
4. The new server upgrades schema non-destructively on startup.
5. Keep an independent backup. Never overwrite your original DB with an empty DB.

The ZIP deliberately contains **no user database**. Your local accounts and posts live in your own `data/blog.db`.

## Features

Editorial homepage, article reader, cover URL, categories, drafts/publish, writer studio, author profiles, likes, bookmarks, comments, follows, views and dashboard. Existing login/signup, legacy post CRUD and sessions preserved. No external PostgreSQL service needed.

## Security / limitations

This is a local development application, not a fully hardened production service. Deploying publicly requires HTTPS, persistent storage, rate limiting, security headers, moderation and backup strategy. Article body is rendered as plain text to avoid unsafe HTML injection. Cover URLs must use http(s).

## Verification

Test signup, login, create draft, publish, edit, delete, like, bookmark, comment, follow and server restart. See `TESTING.md`.


## Visual upgrade (2.1)
- Larger readable text, clearer article cards, improved writing dialog.
- Cover image: paste a **direct image file URL** (not a Google Images/Pinterest/page link) and check the live preview.
- Or choose **Upload from computer** in Writer Studio. JPG, PNG, WebP and GIF up to 5 MB.
- Images are stored on this machine in `data/uploads/`. **Keep this folder together with `data/blog.db`** when moving or backing up the project.
- Upload requires login. `/api/uploads/cover` is the new API endpoint.
- Uploading an image does not automatically delete old unused images. Manage storage as needed.
- Production deployment needs persistent disk/object storage; ephemeral hosting will lose local images and SQLite data.
