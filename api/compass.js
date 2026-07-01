const {
  createCompassReply,
  createCompassSummary,
  jsonResponse,
  readJson,
} = require("../lib/compass-agent");
const { attachSummary, markBenNeeded, upsertConversation } = require("../lib/stewardship-store");

async function safelyStore(operation) {
  try {
    return await operation();
  } catch (error) {
    console.error("Stewardship storage warning:", error);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST for Compass conversations." });
    return;
  }

  try {
    const body = await readJson(req);
    const action =
      body.action === "summary"
        ? "summary"
        : body.action === "start"
          ? "start"
          : body.action === "connect"
            ? "connect"
            : "chat";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const sessionId = body.sessionId;

    if (action === "summary") {
      const summary = await createCompassSummary({ messages });
      const record = await safelyStore(() => attachSummary({ sessionId, messages, summary }));
      jsonResponse(res, 200, {
        type: "summary",
        summary,
        conversationId: record?.id,
        stewardshipStored: Boolean(record),
      });
      return;
    }

    if (action === "connect") {
      const record = await safelyStore(() =>
        markBenNeeded({ sessionId, messages, reason: body.reason || "visitor_connect" })
      );
      jsonResponse(res, 200, {
        type: "stewardship",
        conversationId: record?.id,
        stewardshipStored: Boolean(record),
      });
      return;
    }

    if (action === "chat") {
      await safelyStore(() => upsertConversation({ sessionId, messages }));
    }

    const reply = await createCompassReply({ action, messages });
    const record =
      action === "chat"
        ? await safelyStore(() => upsertConversation({ sessionId, messages, compassReply: reply.reply }))
        : null;
    jsonResponse(res, 200, {
      type: "reply",
      ...reply,
      conversationId: record?.id,
      stewardshipStored: Boolean(record),
    });
  } catch (error) {
    console.error("Compass API error:", error);
    jsonResponse(res, 500, {
      error: "Compass could not respond just now.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
