import { getStore } from "@netlify/blobs";

// Counts each device once. The page sends its random device id on a first
// visit; a marker per device keeps reloads and return visits from counting twice.
export const config = { path: "/api/visit" };

const STATS = "stats.json";
const PER_IP = 300; // new devices per IP per 10 minutes, so a script can't inflate the count
const WINDOW_MS = 10 * 60 * 1000;

const store = () => getStore({ name: "prayer-tree" });

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const recent = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_IP) { recent.set(ip, list); return true; }
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

// Same ETag-guarded read-modify-write as the prayer index, so two first
// visits at the same moment both count.
async function addVisitor() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await store().getWithMetadata(STATS, { type: "json", consistency: "strong" });
    const visitors = (r && r.data && Number(r.data.visitors)) || 0;
    const guard = r && r.etag ? { onlyIfMatch: r.etag } : r ? {} : { onlyIfNew: true };
    const res = await store().setJSON(STATS, { visitors: visitors + 1 }, guard);
    if (res.modified) return visitors + 1;
    await new Promise((ok) => setTimeout(ok, 40 + Math.random() * 160 * (attempt + 1)));
  }
  throw new Error("stats-busy");
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const device = req.headers.get("x-device") || "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(device)) return json({ error: "Missing device." }, 400);
  const ip = (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "unknown";

  try {
    const marker = await store().set(`visitors/${device}`, "", { onlyIfNew: true });
    if (!marker.modified) return json({ counted: false });
    if (limited(ip)) return json({ counted: false });
    return json({ counted: true, visitors: await addVisitor() });
  } catch (err) {
    console.error("visit count failed", err);
    return json({ error: "The visit couldn't be counted." }, 503);
  }
};
