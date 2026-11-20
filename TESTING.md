# Smoke test checklist

- [ ] `npm install` succeeds (Node 22.13+).
- [ ] `npm start` prints local URL.
- [ ] Previously saved accounts and posts still appear after copying the old `data/blog.db`.
- [ ] Sign up and sign in.
- [ ] Write a draft and publish it from My studio.
- [ ] Edit and delete only your own posts.
- [ ] Search by title, author and category.
- [ ] Read article, like and bookmark.
- [ ] Post and delete your own comment.
- [ ] Open author profile and follow a different account.
- [ ] Restart the server; data persists.
- [ ] Check desktop layout at 1280px and tablet layout at 768px; confirm the hero and article grid reflow cleanly.
- [ ] Check phone layouts at 390px and 320px; confirm there is no horizontal overflow and the navigation menu opens/closes.
- [ ] From the phone navigation, verify sign-in, writer studio, sign-out, bookmarks, and color-palette actions are available.
- [ ] Confirm theme and color-palette controls remain usable on mobile and desktop.
