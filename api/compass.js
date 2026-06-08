const {
  createCompassReply,
  createCompassSummary,
  jsonResponse,
  readJson,
} = require("../lib/compass-agent");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST for Compass conversations." });
    return;
  }

  try {
    const body = await readJson(req);
    const action = body.action === "summary" ? "summary" : body.action === "start" ? "start" : "chat";
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (action === "summary") {
      const summary = await createCompassSummary({ messages });
      jsonResponse(res, 200, { type: "summary", summary });
      return;
    }

    const reply = await createCompassReply({ action, messages });
    jsonResponse(res, 200, { type: "reply", ...reply });
  } catch (error) {
    console.error("Compass API error:", error);
    jsonResponse(res, 500, {
      error: "Compass could not respond just now.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
