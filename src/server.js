import express from 'express';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'blog.db'));
db.exec(`PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 salt TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 author TEXT NOT NULL,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 tags TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);`);


// Non-destructive 2.0 schema upgrade; keeps existing users, sessions and posts.
function upgradeSchema() {
 db.exec('BEGIN IMMEDIATE');
 try {
  const cols=new Set(db.prepare('PRAGMA table_info(posts)').all().map(c=>c.name));
  const additions={cover_image:'TEXT',category:"TEXT NOT NULL DEFAULT 'General'",status:"TEXT NOT NULL DEFAULT 'published'",slug:'TEXT',published_at:'TEXT'};
  for(const [name,definition] of Object.entries(additions)) if(!cols.has(name)) db.exec(`ALTER TABLE posts ADD COLUMN ${name} ${definition}`);
  db.exec(`UPDATE posts SET published_at=created_at WHERE status='published' AND published_at IS NULL;
   CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
   CREATE TABLE IF NOT EXISTS post_likes(post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(post_id,user_id));
   CREATE TABLE IF NOT EXISTS bookmarks(post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(post_id,user_id));
   CREATE TABLE IF NOT EXISTS follows(follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(follower_id,following_id),CHECK(follower_id<>following_id));
   CREATE TABLE IF NOT EXISTS post_views(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,viewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
   CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id,created_at);
   CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status,published_at);`);
  db.exec('COMMIT');
 } catch(e){db.exec('ROLLBACK');throw e;}
}
upgradeSchema();

const uploadsDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
// Local cover uploads: authenticated, size-limited, signature-checked.
// Files persist in data/uploads alongside the SQLite database.
app.post('/api/uploads/cover', express.raw({
 type: ['image/jpeg','image/png','image/webp','image/gif'],
 limit: '5mb'
}), (req,res)=>{
 const user=currentUser(req);
 if(!user) return res.status(401).json({error:'Sign in to upload a cover image.'});
 const b=req.body;
 if(!Buffer.isBuffer(b)||b.length<16) return res.status(400).json({error:'Choose a valid JPG, PNG, WebP or GIF image.'});
 let ext='';
 if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff) ext='jpg';
 else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ext='png';
 else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP') ext='webp';
 else if(['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))) ext='gif';
 if(!ext) return res.status(400).json({error:'File content is not a supported image.'});
 const filename=crypto.randomBytes(16).toString('hex')+'.'+ext;
 fs.writeFileSync(path.join(uploadsDir,filename),b,{flag:'wx'});
 return res.status(201).json({url:'/uploads/'+filename});
});
app.use('/uploads',express.static(uploadsDir,{fallthrough:false,maxAge:'1d',immutable:false}));

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const text = value => typeof value === 'string' ? value.trim() : '';
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const cookie = (req) => (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8) || '';
function currentUser(req) {
 const token = cookie(req);
 if (!/^[a-f0-9]{64}$/.test(token)) return null;
 return db.prepare('SELECT u.id, u.username, u.email FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?').get(token, Date.now()) || null;
}
function setSession(res, userId) {
 const token = crypto.randomBytes(32).toString('hex');
 db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now()+SESSION_MS);
 res.cookie('session', token, { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', path:'/', maxAge:SESSION_MS });
}
function postView(row) { return row ? {...row, tags: JSON.parse(row.tags)} : null; }
function tagsFrom(value) { return Array.isArray(value) ? [...new Set(value.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))].slice(0,12).map(x=>x.slice(0,32)) : []; }
function validPost(req, res) {
 const title = text(req.body?.title), body = text(req.body?.body);
 if (!title || !body || title.length>200 || body.length>50000) { res.status(400).json({error:'Title (max 200) and body (max 50,000) are required.'}); return null; }
 const category=text(req.body?.category).slice(0,48)||'General'; const cover_image=text(req.body?.cover_image).slice(0,800); if(cover_image && !(/^https?:\/\//i.test(cover_image) || /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(cover_image))){res.status(400).json({error:'Cover image must be an http(s) URL.'});return null;} return {title,body,tags:JSON.stringify(tagsFrom(req.body?.tags)),category,cover_image};
}
function idOf(req,res) { const id = Number(req.params.id); if (!Number.isSafeInteger(id)||id<1) {res.status(400).json({error:'Invalid post ID.'});return null;}return id; }

app.post('/api/signup', (req, res) => {
  try {
    const username = text(req.body?.username);
    const email = text(req.body?.email).toLowerCase();
    const password = req.body?.password;

    if (
      !username ||
      username.length > 40 ||
      !validEmail(email) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 256
    ) {
      return res.status(400).json({
        error: 'Enter a valid username, email and password (8–256 characters).'
      });
    }

    const existingUser = db.prepare(
      'SELECT id FROM users WHERE email = ? OR username = ?'
    ).get(email, username);

    if (existingUser) {
      return res.status(409).json({
        error: 'Username or email already registered.'
      });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hash(password, salt);

    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)'
    ).run(username, email, passwordHash, salt);

    const user = {
      id: Number(result.lastInsertRowid),
      username,
      email
    };

    setSession(res, user.id);

    return res.status(201).json({
      message: 'Account created successfully.',
      user
    });

  } catch (error) {
    console.error('Signup error:', error);

    if (
      error.code?.startsWith('ERR_SQLITE_CONSTRAINT') ||
      error.code?.startsWith('SQLITE_CONSTRAINT')
    ) {
      return res.status(409).json({
        error: 'Username or email already registered.'
      });
    }

    return res.status(500).json({
      error: 'Signup failed due to a server error.'
    });
  }
});

app.post('/api/login',(req,res)=>{
 const email=text(req.body?.email).toLowerCase(), password=req.body?.password;
 if (!email || typeof password!=='string') return res.status(400).json({error:'Email and password are required.'});
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if (!user) return res.status(401).json({error:'Incorrect email or password.'});
 const actual=Buffer.from(hash(password,user.salt),'hex'), expected=Buffer.from(user.password_hash,'hex');
 if (actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected)) return res.status(401).json({error:'Incorrect email or password.'});
 setSession(res,user.id);res.json({user:{id:user.id,username:user.username,email:user.email}});
});
app.post('/api/logout',(req,res)=>{
 const token=cookie(req);if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
 res.clearCookie('session',{path:'/',sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.json({ok:true});
});
app.get('/api/me',(req,res)=>res.json({user:currentUser(req)}));
app.get('/api/posts',(req,res)=>{
 const q=text(req.query.q).slice(0,100);
 const rows=q ? db.prepare("SELECT * FROM posts WHERE status='published' AND (title LIKE ? OR body LIKE ? OR author LIKE ?) ORDER BY created_at DESC,id DESC").all(...Array(3).fill(`%${q}%`)) : db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY created_at DESC,id DESC").all();
 res.json(rows.map(postView));
});
app.get('/api/posts/:id',(req,res)=>{const id=idOf(req,res);if(!id)return;const post=postView(db.prepare('SELECT * FROM posts WHERE id=?').get(id)); if(!post)return res.status(404).json({error:'Post not found.'});if(post.status!=='published' && post.user_id!==currentUser(req)?.id)return res.status(404).json({error:'Post not found.'});if(post.status==='published')db.prepare('INSERT INTO post_views(post_id,user_id) VALUES(?,?)').run(id,currentUser(req)?.id??null);return res.json(post);});
app.post('/api/posts',(req,res)=>{
 const user=currentUser(req);if(!user)return res.status(401).json({error:'Sign in to publish.'});
 const data=validPost(req,res);if(!data)return;
 const result=db.prepare('INSERT INTO posts(title,body,author,user_id,tags,category,cover_image,status,published_at) VALUES(?,?,?,?,?,?,?,?,?)').run(data.title,data.body,user.username,user.id,data.tags,data.category,data.cover_image,req.body?.status==='draft'?'draft':'published',req.body?.status==='draft'?null:new Date().toISOString());
 res.status(201).json(postView(db.prepare('SELECT * FROM posts WHERE id=?').get(Number(result.lastInsertRowid))));
});
app.put('/api/posts/:id',(req,res)=>{
 const user=currentUser(req);if(!user)return res.status(401).json({error:'Sign in first.'});
 const id=idOf(req,res);if(!id)return;
 const post=db.prepare('SELECT * FROM posts WHERE id=?').get(id);if(!post)return res.status(404).json({error:'Post not found.'});
 if(post.user_id!==user.id)return res.status(403).json({error:'You can only edit your own posts.'});
 const data=validPost(req,res);if(!data)return;
 db.prepare("UPDATE posts SET title=?,body=?,tags=?,category=?,cover_image=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(data.title,data.body,data.tags,data.category,data.cover_image,id);
 res.json(postView(db.prepare('SELECT * FROM posts WHERE id=?').get(id)));
});
app.delete('/api/posts/:id',(req,res)=>{
 const user=currentUser(req);if(!user)return res.status(401).json({error:'Sign in first.'});
 const id=idOf(req,res);if(!id)return;
 const post=db.prepare('SELECT user_id FROM posts WHERE id=?').get(id);if(!post)return res.status(404).json({error:'Post not found.'});
 if(post.user_id!==user.id)return res.status(403).json({error:'You can only delete your own posts.'});
 db.prepare('DELETE FROM posts WHERE id=?').run(id);res.json({ok:true});
});

// Publishing and community endpoints
const requireUser=(req,res)=>{const u=currentUser(req);if(!u)res.status(401).json({error:'Please sign in first.'});return u;};
const postExists=(id)=>db.prepare('SELECT * FROM posts WHERE id=?').get(id);
app.get('/api/me/posts',(req,res)=>{const u=requireUser(req,res);if(!u)return;res.json(db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC').all(u.id).map(postView));});
app.patch('/api/posts/:id/publish',(req,res)=>{const u=requireUser(req,res);if(!u)return;const id=idOf(req,res);if(!id)return;const p=postExists(id);if(!p)return res.status(404).json({error:'Not found.'});if(p.user_id!==u.id)return res.status(403).json({error:'Not your story.'});db.prepare("UPDATE posts SET status='published',published_at=COALESCE(published_at,?),updated_at=? WHERE id=?").run(new Date().toISOString(),new Date().toISOString(),id);res.json(postView(postExists(id)));});
app.get('/api/posts/:id/comments',(req,res)=>{const id=idOf(req,res);if(!id)return;const p=postExists(id);if(!p||p.status!=='published')return res.status(404).json({error:'Story not found.'});res.json(db.prepare('SELECT c.id,c.body,c.created_at,u.username,c.user_id FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id DESC').all(id));});
app.post('/api/posts/:id/comments',(req,res)=>{const u=requireUser(req,res);if(!u)return;const id=idOf(req,res);if(!id)return;const p=postExists(id);if(!p||p.status!=='published')return res.status(404).json({error:'Story not found.'});const body=text(req.body?.body);if(!body||body.length>2000)return res.status(400).json({error:'Comment must be 1–2000 characters.'});const r=db.prepare('INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)').run(id,u.id,body);res.status(201).json({id:Number(r.lastInsertRowid),body,username:u.username,user_id:u.id});});
app.delete('/api/comments/:id',(req,res)=>{const u=requireUser(req,res);if(!u)return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid comment ID.'});const c=db.prepare('SELECT user_id FROM comments WHERE id=?').get(id);if(!c)return res.status(404).json({error:'Not found.'});if(c.user_id!==u.id)return res.status(403).json({error:'Not your comment.'});db.prepare('DELETE FROM comments WHERE id=?').run(id);res.json({ok:true});});
for(const [route,table] of [['like','post_likes'],['bookmark','bookmarks']]){
 app.post(`/api/posts/:id/${route}`,(req,res)=>{const u=requireUser(req,res);if(!u)return;const id=idOf(req,res);if(!id)return;const p=postExists(id);if(!p||p.status!=='published')return res.status(404).json({error:'Story not found.'});const exists=db.prepare(`SELECT 1 FROM ${table} WHERE post_id=? AND user_id=?`).get(id,u.id);if(exists)db.prepare(`DELETE FROM ${table} WHERE post_id=? AND user_id=?`).run(id,u.id);else db.prepare(`INSERT INTO ${table}(post_id,user_id) VALUES(?,?)`).run(id,u.id);res.json({active:!exists,count:db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE post_id=?`).get(id).n});});
}
app.get('/api/posts/:id/social',(req,res)=>{const id=idOf(req,res);if(!id)return;const p=postExists(id);if(!p||p.status!=='published')return res.status(404).json({error:'Story not found.'});const u=currentUser(req);const count=t=>db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE post_id=?`).get(id).n;res.json({likes:count('post_likes'),bookmarks:count('bookmarks'),views:count('post_views'),comments:count('comments'),liked:!!(u&&db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(id,u.id)),bookmarked:!!(u&&db.prepare('SELECT 1 FROM bookmarks WHERE post_id=? AND user_id=?').get(id,u.id))});});
app.get('/api/me/bookmarks',(req,res)=>{const u=requireUser(req,res);if(!u)return;res.json(db.prepare("SELECT p.* FROM posts p JOIN bookmarks b ON p.id=b.post_id WHERE b.user_id=? AND p.status='published' ORDER BY b.created_at DESC").all(u.id).map(postView));});
app.get('/api/writers',(req,res)=>res.json(db.prepare("SELECT u.id,u.username,COUNT(p.id) AS stories FROM users u LEFT JOIN posts p ON p.user_id=u.id AND p.status='published' GROUP BY u.id ORDER BY stories DESC,u.username LIMIT 50").all()));
app.get('/api/writers/:id',(req,res)=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid writer ID.'});const u=db.prepare('SELECT id,username,created_at FROM users WHERE id=?').get(id);if(!u)return res.status(404).json({error:'Writer not found.'});res.json({...u,followers:db.prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id=?').get(id).n,posts:db.prepare("SELECT * FROM posts WHERE user_id=? AND status='published' ORDER BY created_at DESC").all(id).map(postView)});});
app.post('/api/writers/:id/follow',(req,res)=>{const u=requireUser(req,res);if(!u)return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid writer ID.'});if(id===u.id)return res.status(400).json({error:'Cannot follow yourself.'});if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))return res.status(404).json({error:'Writer not found.'});const exists=db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(u.id,id);if(exists)db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(u.id,id);else db.prepare('INSERT INTO follows(follower_id,following_id) VALUES(?,?)').run(u.id,id);res.json({following:!exists});});
app.get('/api/me/dashboard',(req,res)=>{const u=requireUser(req,res);if(!u)return;const posts=db.prepare('SELECT id,status FROM posts WHERE user_id=?').all(u.id),ids=posts.map(p=>p.id);const sum=t=>ids.reduce((n,id)=>n+db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE post_id=?`).get(id).n,0);res.json({stories:posts.length,published:posts.filter(p=>p.status==='published').length,drafts:posts.filter(p=>p.status==='draft').length,views:sum('post_views'),likes:sum('post_likes'),comments:sum('comments')});});

app.use(express.static(path.join(root,'public')));
app.get('/',(_req,res)=>res.sendFile(path.join(root,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.status===400?'Invalid request.':'Internal server error.'});});
const port=Number(process.env.PORT)||3001;
app.listen(port,()=>console.log(`The Journal running at http://localhost:${port} (SQLite ready)`));
export default app;