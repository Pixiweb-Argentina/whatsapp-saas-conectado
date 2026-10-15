import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const PATH = "/api/webhooks/ycloud";
const MAX_BYTES = 128 * 1024;
const PILOT = "ff50ed19-6330-43c1-a69d-32252c9ca756";
function respond(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) throw new Error("BODY_LIMIT");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function healthy(target, fetchImpl) {
  const response = await fetchImpl(target, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const result = await response.json();
  if (result.workspaceId !== new URL(target).searchParams.get("wsid")) return null;
  const modes = [["verify", "verificationOnly"], ["inbox", "inboxOnly"], ["pipeline", "pipeline"]];
  const active = modes.filter(([, key]) => result[key] === true);
  return active.length === 1 ? active[0][0] : null;
}

/** Local-only bridge. Exposes one POST destination, never the SaaS UI or other APIs. */
export function createPilotRelay(workspaceId, fetchImpl = fetch) {
  z.uuid().parse(workspaceId);
  const target = `http://127.0.0.1:3100${PATH}?wsid=${workspaceId}`;
  const stats = { matched: 0, unmatched: 0, rejected: 0, unavailable: 0 };
  let windowAt = Date.now(), requests = 0;
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, "http://relay.invalid");
      if (req.method !== "POST" || url.pathname !== PATH || url.searchParams.get("wsid") !== workspaceId
        || [...url.searchParams].length !== 1) return respond(res, 404, { error: "Not found" });
      if (Date.now() - windowAt >= 60000) { windowAt = Date.now(); requests = 0; }
      if (++requests > 30) return respond(res, 429, { error: "Pilot rate limit" });
      const signature = req.headers["ycloud-signature"];
      if (typeof signature !== "string" || signature.length > 512) {
        stats.rejected++; return respond(res, 401, { error: "Unauthorized" });
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) return respond(res, 415, { error: "JSON required" });
      if (Number(req.headers["content-length"]) > MAX_BYTES) return respond(res, 413, { error: "Body too large" });
      // Recheck before EVERY delivery: removing the verification flag cannot
      // accidentally route public requests into the normal legacy workflow.
      const mode = await healthy(target, fetchImpl);
      if (!mode) {
        stats.unavailable++; return respond(res, 503, { error: "Verification mode unavailable" });
      }
      const body = await readBody(req);
      const response = await fetchImpl(target, { method: "POST", redirect: "error", body,
        headers: { "content-type": "application/json", "YCloud-Signature": signature,
          "X-YCloud-Reception-Mode": mode }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) { stats.rejected++; return respond(res, response.status === 401 ? 401 : 503, { error: "Delivery rejected" }); }
      const result = await response.json();
      const modeKeys = { verify: "verificationOnly", inbox: "inboxOnly", pipeline: "pipeline" };
      if (result[modeKeys[mode]] !== true || Object.entries(modeKeys).some(([other, key]) => other !== mode && result[key] === true)
        || (mode !== "verify" && typeof result.recorded !== "boolean") || typeof result.accountMatched !== "boolean") {
        stats.unavailable++; return respond(res, 503, { error: "Verification mode unavailable" });
      }
      stats[result.accountMatched ? "matched" : "unmatched"]++;
      console.log(JSON.stringify({ receptionMode: mode, ...stats }));
      return respond(res, 200, mode === "verify" ? { received: true, verificationOnly: true, accountMatched: result.accountMatched }
        : { received: true, [modeKeys[mode]]: true, accountMatched: result.accountMatched, recorded: result.recorded,
          ...(mode === "pipeline" && typeof result.aiBuffered === "boolean" ? { aiBuffered: result.aiBuffered } : {}),
          ...(typeof result.receiptRecorded === "boolean" ? { receiptRecorded: result.receiptRecorded } : {}) });
    } catch (error) {
      stats.unavailable++;
      if (!res.headersSent) respond(res, error instanceof Error && error.message === "BODY_LIMIT" ? 413 : 503,
        { error: "Verification delivery unavailable" });
    }
  };
  return { handler, stats, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== PILOT) throw new Error("Explicit dedicated YCloud pilot required");
  const relay = createPilotRelay(PILOT);
  if (!await healthy(relay.target, fetch)) throw new Error("Start Next in verification-only mode first");
  const server = createServer(relay.handler);
  server.headersTimeout = 10000; server.requestTimeout = 15000;
  server.listen(3104, "127.0.0.1", () => console.log("YCloud verification relay ready on 127.0.0.1:3104"));
}
