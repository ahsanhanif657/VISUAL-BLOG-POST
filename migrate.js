import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databasePath = path.join(projectRoot, 'data', 'blog.db');
if (!fs.existsSync(databasePath)) {
  console.error('Database not found:', databasePath);
  console.error('Migration stopped to avoid creating an empty database.');
  process.exit(1);
}

const db = new DatabaseSync(databasePath);
try {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const required = ['users', 'sessions', 'posts'];
  const found = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of required) {
    if (!found.has(name)) throw new Error(`Missing existing table: ${name}. Check database path.`);
  }

  const before = Object.fromEntries(required.map(name => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count]));
  console.log('Before migration:', before);

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existingColumns = new Set(db.prepare('PRAGMA table_info(posts)').all().map(col => col.name));
    const additions = {
      cover_image: 'TEXT',
      category: "TEXT NOT NULL DEFAULT 'General'",
      status: "TEXT NOT NULL DEFAULT 'published'",
      slug: 'TEXT',
      published_at: 'TEXT',
    };
    for (const [column, definition] of Object.entries(additions)) {
      if (!existingColumns.has(column)) {
        db.exec(`ALTER TABLE posts ADD COLUMN ${column} ${definition};`);
        console.log('Added posts column:', column);
      }
    }

    db.exec(`
      UPDATE posts SET status='published' WHERE status IS NULL OR status='';
      UPDATE posts SET category='General' WHERE category IS NULL OR category='';
      UPDATE posts SET published_at=created_at WHERE status='published' AND published_at IS NULL;

      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS post_likes (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (post_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (post_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (follower_id,following_id),
        CHECK (follower_id <> following_id)
      );
      CREATE TABLE IF NOT EXISTS post_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_views_post ON post_views(post_id,viewed_at);
      CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status,published_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug_unique ON posts(slug) WHERE slug IS NOT NULL;
    `);
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const after = Object.fromEntries(required.map(name => [name, db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count]));
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  console.log('After migration:', after);
  console.log('Database integrity:', integrity);
  console.log('Foreign key violations:', foreignKeys.length);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Existing row counts changed unexpectedly!');
  if (integrity !== 'ok' || foreignKeys.length) throw new Error('Database validation failed!');
  console.log('SUCCESS: The Journal 2.0 database migration complete.');
} catch (error) {
  console.error('MIGRATION FAILED:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
