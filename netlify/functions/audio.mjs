import { getStore } from "@netlify/blobs";

// Serves one prayer's recording. Recordings never change, so the CDN keeps them.
export const config = { path: "/api/audio/:id" };

export default async (req, context) => {
  const id = context.params && context.params.id;
  if (!id || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) return new Response("Not found", { status: 404 });

  const entry = await getStore({ name: "prayer-tree" }).getWithMetadata(`audio/${id}`, { type: "arrayBuffer" });
  if (!entry || !entry.data) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const type = (entry.metadata && entry.metadata.type) || "application/octet-stream";
  return new Response(entry.data, {
    headers: {
      "content-type": type,
      "content-length": String(entry.data.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, durable, max-age=31536000, immutable",
      "netlify-cache-tag": `prayer-${id}`,
    },
  });
};
