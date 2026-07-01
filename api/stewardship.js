const { jsonResponse, readJson } = require("../lib/compass-agent");
const { getConversation, listConversations, saveReview } = require("../lib/stewardship-store");

function headerValue(req, name) {
  return req.headers?.[name] || req.headers?.[name.toLowerCase()] || "";
}

function requestKey(req, body = {}) {
  const headerKey = headerValue(req, "x-stewardship-key");
  const auth = headerValue(req, "authorization");
  if (headerKey) return String(headerKey);
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "");
  return body.adminKey || "";
}

function checkAccess(req, body = {}) {
  const configured = process.env.STEWARDSHIP_ADMIN_KEY;
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Stewardship access is not configured yet. Add STEWARDSHIP_ADMIN_KEY in Vercel.",
    };
  }

  if (requestKey(req, body) !== configured) {
    return { ok: false, status: 401, error: "Stewardship access key is required." };
  }

  return { ok: true };
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

module.exports = async function handler(req, res) {
  noStore(res);

  try {
    if (req.method === "GET") {
      const access = checkAccess(req);
      if (!access.ok) {
        jsonResponse(res, access.status, { error: access.error });
        return;
      }

      const url = new URL(req.url, "https://www.wfcaust.com.au");
      const action = url.searchParams.get("action") || "list";

      if (action === "get") {
        const conversation = await getConversation(url.searchParams.get("id"));
        if (!conversation) {
          jsonResponse(res, 404, { error: "Conversation not found." });
          return;
        }
        jsonResponse(res, 200, { conversation });
        return;
      }

      const conversations = await listConversations({ limit: Number(url.searchParams.get("limit") || 100) });
      jsonResponse(res, 200, { conversations });
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const access = checkAccess(req, body);
      if (!access.ok) {
        jsonResponse(res, access.status, { error: access.error });
        return;
      }

      if (body.action === "review") {
        const conversation = await saveReview({
          id: body.id,
          decision: body.decision,
          learningNote: body.learningNote,
        });
        jsonResponse(res, 200, { conversation });
        return;
      }

      jsonResponse(res, 400, { error: "Unknown stewardship action." });
      return;
    }

    jsonResponse(res, 405, { error: "Use GET or POST for Stewardship Library requests." });
  } catch (error) {
    console.error("Stewardship API error:", error);
    jsonResponse(res, 500, {
      error: "The Stewardship Library could not complete that request.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
