// Operator-only boundary. The caller persists counters before any external POST.
function denied() { throw new Error("AI_PILOT_NETWORK_DENIED"); }
export function createAiPilotFetch({ phase, projectOrigin, model, expectedSend, ledger, persist, fetchImpl = fetch }) {
  if (!["generate", "send"].includes(phase) || !/^https:\/\/[a-z]+\.supabase\.co$/.test(projectOrigin)) denied();
  return async (input, init) => {
    const request = new Request(new Request(input, init), { redirect: "error" }), url = new URL(request.url);
    if (url.origin === projectOrigin) return fetchImpl(request);
    if (url.origin === "https://openrouter.ai" && url.pathname === "/api/v1/chat/completions"
      && request.method === "POST" && phase === "generate") {
      const body = await request.clone().json();
      if (ledger.modelRequests !== 0 || body.model !== model || body.tools?.length || body.stream
        || body.models || body.route || !Array.isArray(body.messages) || !body.messages.length
        || body.messages.some((m) => !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string")
        || body.messages.reduce((n, m) => n + m.content.length, 0) > 16000) denied();
      body.max_tokens = 128;
      if ("max_completion_tokens" in body) body.max_completion_tokens = 128;
      ledger.modelRequests = 1; await persist();
      return fetchImpl(new Request(request, { body: JSON.stringify(body) }));
    }
    if (url.origin === "https://api.ycloud.com" && url.pathname === "/v2/whatsapp/messages"
      && request.method === "POST" && phase === "send" && expectedSend) {
      const body = await request.clone().json();
      if (ledger.providerPosts !== 0 || body.from !== expectedSend.from || body.to !== expectedSend.to
        || body.externalId !== `channel:${expectedSend.operationId}` || body.type !== "text"
        || body.text?.body !== expectedSend.body || Object.keys(body).some((k) =>
          !["from", "to", "externalId", "type", "text"].includes(k))) denied();
      ledger.providerPosts = 1; await persist();
      return fetchImpl(request);
    }
    denied();
  };
}
