const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const dataFile = path.join(__dirname, "data", "notes.json");
const NOTE_COLORS = ["default", "yellow", "green", "blue", "pink", "purple"];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${new Date().toLocaleTimeString()}  ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
    );
  });
  next();
});

function readNotes() {
  try {
    const data = fs.readFileSync(dataFile, "utf8");
    const parsed = JSON.parse(data || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parseTags(tags) {
  let list = [];
  if (Array.isArray(tags)) list = tags;
  else if (typeof tags === "string") list = tags.split(",");
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

function normalizeColor(color) {
  return NOTE_COLORS.includes(color) ? color : "default";
}

function noteFieldsFromBody(body = {}) {
  const fields = {};
  if (body.title !== undefined) fields.title = String(body.title).trim();
  if (body.content !== undefined) fields.content = String(body.content).trim();
  if (body.tags !== undefined) fields.tags = parseTags(body.tags);
  if (body.color !== undefined) fields.color = normalizeColor(body.color);
  if (body.pinned !== undefined) fields.pinned = !!body.pinned;
  return fields;
}

// GET all notes — optional ?q= (search), ?tag=, ?sort=createdAt|updatedAt|title, ?order=asc|desc
// Pinned notes always come first.
app.get("/api/notes", (req, res) => {
  let notes = readNotes();
  const { q, tag, sort, order } = req.query;

  if (q) {
    const keyword = String(q).toLowerCase();
    notes = notes.filter(
      n => n.title.toLowerCase().includes(keyword) || n.content.toLowerCase().includes(keyword)
    );
  }
  if (tag) {
    const t = String(tag).toLowerCase();
    notes = notes.filter(n => (n.tags || []).some(x => x.toLowerCase() === t));
  }

  const factor = order === "asc" ? 1 : -1;
  if (sort === "title") {
    notes.sort((a, b) => a.title.localeCompare(b.title) * factor);
  } else if (sort === "createdAt") {
    notes.sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) * factor);
  } else {
    notes.sort((a, b) => (new Date(a.updatedAt) - new Date(b.updatedAt)) * factor);
  }
  notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  res.json(notes);
});

// GET one note
app.get("/api/notes/:id", (req, res) => {
  const notes = readNotes();
  const note = notes.find(n => n.id === req.params.id);
  if (!note) {
    return res.status(404).json({ message: "Note not found" });
  }
  res.json(note);
});

// CREATE note
app.post("/api/notes", (req, res) => {
  const body = req.body || {};
  const title = String(body.title ?? "").trim();
  const content = String(body.content ?? "").trim();
  if (!title || !content) {
    return res.status(400).json({ message: "Title and content are required" });
  }
  const notes = readNotes();
  const newNote = {
    id: newId(),
    title,
    content,
    tags: parseTags(body.tags),
    color: normalizeColor(body.color),
    pinned: !!body.pinned,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  notes.push(newNote);
  saveNotes(notes);
  res.status(201).json(newNote);
});

// UPDATE note (partial — omitted fields keep their old values)
app.put("/api/notes/:id", (req, res) => {
  const notes = readNotes();
  const index = notes.findIndex(n => n.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: "Note not found" });
  }
  const updates = noteFieldsFromBody(req.body);
  if (updates.title !== undefined && !updates.title) {
    return res.status(400).json({ message: "Title cannot be empty" });
  }
  if (updates.content !== undefined && !updates.content) {
    return res.status(400).json({ message: "Content cannot be empty" });
  }
  notes[index] = {
    ...notes[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  saveNotes(notes);
  res.json(notes[index]);
});

// PATCH pin toggle
app.patch("/api/notes/:id/pin", (req, res) => {
  const notes = readNotes();
  const note = notes.find(n => n.id === req.params.id);
  if (!note) {
    return res.status(404).json({ message: "Note not found" });
  }
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  saveNotes(notes);
  res.json(note);
});

// DELETE note
app.delete("/api/notes/:id", (req, res) => {
  const notes = readNotes();
  const filteredNotes = notes.filter(n => n.id !== req.params.id);
  if (filteredNotes.length === notes.length) {
    return res.status(404).json({ message: "Note not found" });
  }
  saveNotes(filteredNotes);
  res.json({ message: "Note deleted successfully" });
});

// GET stats
app.get("/api/stats", (req, res) => {
  const notes = readNotes();
  const tagCounts = {};
  notes.forEach(n => (n.tags || []).forEach(t => {
    tagCounts[t] = (tagCounts[t] || 0) + 1;
  }));
  res.json({
    total: notes.length,
    pinned: notes.filter(n => n.pinned).length,
    tags: Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    lastUpdated: notes.length
      ? notes.reduce((max, n) => (n.updatedAt > max ? n.updatedAt : max), notes[0].updatedAt)
      : null
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ message: "API route not found" });
});

app.use((req, res) => {
  res.redirect("/");
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body" });
  }
  console.error(err);
  res.status(err.status || 500).json({ message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
