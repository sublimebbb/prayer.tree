import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { randomInt, randomBytes, timingSafeEqual } from "node:crypto";

// One shared index of every prayer on the tree, plus one audio entry per prayer.
const STORE = "prayer-tree";
const INDEX = "index.json";
const MAX_SECONDS = 30;
const MAX_BYTES = 2.5 * 1024 * 1024;
const MIN_BYTES = 800;
const NOTE_MAX = 15;

const EXT = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "video/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
};
const CANONICAL = { "video/webm": "audio/webm", "video/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4" };

export const config = { path: "/api/prayers" };

const store = () => getStore({ name: STORE });

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function readIndex(strong) {
  const r = await store().getWithMetadata(INDEX, { type: "json", consistency: strong ? "strong" : "eventual" });
  if (!r) return { prayers: [], etag: null, exists: false };
  const prayers = r.data && Array.isArray(r.data.prayers) ? r.data.prayers : [];
  return { prayers, etag: r.etag || null, exists: true };
}

// Read-modify-write guarded by the entry's ETag, so two people hanging prayers
// at the same moment never overwrite each other.
async function updateIndex(mutate) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { prayers, etag, exists } = await readIndex(true);
    const next = mutate(prayers.slice());
    const body = { v: 1, prayers: next };
    // The ETag guard is the normal path; a plain write is only a fallback if a
    // read ever comes back without one.
    const guard = etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true };
    if (exists && !etag) console.warn("index read had no ETag; writing without a guard");
    const res = await store().setJSON(INDEX, body, guard);
    if (res.modified) return next;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 160 * (attempt + 1)));
  }
  throw new Error("index-busy");
}

function looksLikeAudio(b, ext) {
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  switch (ext) {
    case "webm": return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case "m4a": return ascii(4, "ftyp");
    case "ogg": return ascii(0, "OggS");
    case "mp3": return ascii(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case "aac": return b[0] === 0xff && (b[1] & 0xf6) === 0xf0;
    default: return false;
  }
}

// Optional name or note, sent percent-encoded. Plain text, one line, 15 characters.
function readNote(raw) {
  if (!raw) return "";
  let s;
  try { s = decodeURIComponent(raw); } catch { return ""; }
  s = s.replace(/\s+/g, " ").replace(/[\p{Cc}\u200B\u200E\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/gu, "").trim();
  return [...s].slice(0, NOTE_MAX).join("").trim();
}

// Light per-instance limits so one visitor can't flood the tree. Each device
// gets its own allowance, since a whole workshop on one Wi-Fi shares an IP;
// the looser per-IP limit is a backstop for anyone faking device ids.
const PER_DEVICE = 6;
const PER_IP = 150;
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map();
function limited(key, max) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= max) { recent.set(key, list); return true; }
  list.push(now);
  recent.set(key, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

// Tag on the cached list, so a removal can clear it from the CDN at once.
const LIST_TAG = "prayer-list";

async function list() {
  try {
    // strong read, so a refetch right after a removal never gets the old list
    const [{ prayers }, stats] = await Promise.all([
      readIndex(true),
      store().get("stats.json", { type: "json" }).catch(() => null),
    ]);
    const visitors = (stats && Number(stats.visitors)) || 0;
    return json({ prayers, visitors }, 200, {
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, s-maxage=10, stale-while-revalidate=50",
      "netlify-cache-tag": LIST_TAG,
    });
  } catch (err) {
    console.error("read failed", err);
    return json({ prayers: [], error: "The prayers couldn't load. Refresh the page to try again." }, 500);
  }
}

async function add(req, context) {
  const ip = (context && context.ip) || (req.headers.get("x-nf-client-connection-ip") || "unknown");
  const device = req.headers.get("x-device") || "";
  const deviceKey = /^[A-Za-z0-9_-]{8,64}$/.test(device) ? `device:${device}` : `ip:${ip}`;
  if (limited(deviceKey, PER_DEVICE) || limited(`net:${ip}`, PER_IP)) {
    return json({ error: "You've left several prayers in a short time. Wait a few minutes, then try again." }, 429);
  }

  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) {
    return json({ error: "That recording format isn't supported. Try again in Chrome, Safari, or Firefox." }, 415);
  }

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) return json({ error: "That recording is too long. Prayers can be up to 30 seconds." }, 413);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json({ error: "That recording is too long. Prayers can be up to 30 seconds." }, 413);
  if (bytes.length < MIN_BYTES) return json({ error: "That recording is empty. Record again and speak for at least a second." }, 400);
  if (!looksLikeAudio(bytes, ext)) {
    return json({ error: "That file doesn't look like a voice recording. Record your prayer again." }, 415);
  }

  let dur = Number(req.headers.get("x-duration"));
  if (!Number.isFinite(dur) || dur <= 0) dur = 0;
  dur = Math.min(MAX_SECONDS, Math.round(dur * 10) / 10);

  const note = readNote(req.headers.get("x-note"));

  const id = randomBytes(9).toString("base64url");
  const contentType = CANONICAL[type] || type;
  try {
    await store().set(`audio/${id}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      metadata: { type: contentType },
      onlyIfNew: true,
    });
  } catch (err) {
    console.error("audio save failed", err);
    return json({ error: "Your prayer couldn't be saved. Try hanging it again." }, 502);
  }

  const prayer = { id, url: `/api/audio/${id}`, slot: randomInt(0, 2 ** 31 - 1), dur, t: Date.now() };
  if (note) prayer.note = note;
  try {
    await updateIndex((all) => { all.push(prayer); return all; });
  } catch (err) {
    console.error("index update failed", err);
    await store().delete(`audio/${id}`).catch(() => {});
    return json({ error: "The tree is busy right now. Try hanging your prayer again." }, 503);
  }
  return json({ prayer }, 201);
}

function keyMatches(given) {
  const key = (globalThis.Netlify && Netlify.env.get("ADMIN_KEY")) || process.env.ADMIN_KEY || "";
  if (!key || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function remove(req) {
  if (!keyMatches(req.headers.get("x-admin-key"))) return json({ error: "That admin key isn't valid." }, 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Say which prayer to remove." }, 400);

  let removed = null;
  try {
    await updateIndex((all) => {
      removed = all.find((p) => p.id === id) || null;
      return all.filter((p) => p.id !== id);
    });
  } catch (err) {
    console.error("remove failed", err);
    return json({ error: "The prayer couldn't be removed. Try again." }, 503);
  }
  // drop the cached list and recording from the CDN too, not just from the tree;
  // also when it was already gone, since a stale cached list is what showed it
  const purge = purgeCache({ tags: [LIST_TAG, `prayer-${id}`] }).catch((err) => console.warn("cache purge failed", err));
  if (!removed) { await purge; return json({ error: "That prayer is no longer on the tree." }, 404); }
  await store().delete(`audio/${id}`).catch(() => {});
  await purge;
  return json({ ok: true });
}

export default async (req, context) => {
  switch (req.method) {
    case "GET": return list();
    case "POST": return add(req, context);
    case "DELETE": return remove(req);
    default: return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, DELETE" });
  }
};
