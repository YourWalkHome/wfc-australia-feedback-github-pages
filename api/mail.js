const crypto = require("crypto");
const { jsonResponse, readJson } = require("../lib/compass-agent");
const {
  archiveMessage,
  createDraft,
  getMailConfig,
  listMailboxes,
  listMessages,
  moveMessage,
  readMessage,
  trashMessage,
  updateFlags,
} = require("../lib/compass-mail");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const EMAIL_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["to", "subject", "body"],
  properties: {
    to: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
  },
};

function requestToken(req) {
  const headerToken = req.headers["x-compass-mail-token"];
  const authHeader = req.headers.authorization || "";
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
  if (authHeader.toLowerCase().startsWith("bearer ")) return authHeader.slice(7).trim();
  return "";
}

function timingSafeEqualText(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeMailAccess(req) {
  const expected = process.env.COMPASS_MAIL_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "Compass Mail is not enabled yet. Add COMPASS_MAIL_ADMIN_TOKEN first.",
    };
  }

  if (!timingSafeEqualText(requestToken(req), expected)) {
    return { ok: false, status: 401, error: "Compass Mail needs a valid owner access token." };
  }

  return { ok: true };
}

function bool(value) {
  return value === true || value === "true";
}

function clean(value, limit = 5000) {
  return String(value || "").trim().slice(0, limit);
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

  const pieces = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }

  return pieces.join("\n").trim();
}

function parseModelJson(text) {
  if (!text) throw new Error("Compass returned an empty draft.");

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Compass did not return a draft in the expected format.");
    return JSON.parse(match[0]);
  }
}

async function prepareEmailDraft({ instruction, to, subjectHint, context }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const safeInstruction = clean(instruction, 6000);
  if (!safeInstruction) {
    throw new Error("Tell Compass what the draft should say first.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: `
You are Compass Mail for WFC Australia.

You help Ben prepare plain-text email drafts for human review.
You never claim an email has been sent.
You never instruct the system to send, delete, move, or expose credentials.
You write in warm, practical Australian English with clear, natural wording.
Keep the message concise unless the owner asks for more detail.
Return only the requested JSON.
`,
      input: `
Prepare a draft email.

Owner instruction:
${safeInstruction}

Recipient supplied by owner:
${clean(to, 1000) || "Not supplied"}

Subject hint supplied by owner:
${clean(subjectHint, 500) || "Not supplied"}

Optional context from selected mailbox message or owner notes:
${clean(context, 8000) || "No additional context supplied"}

If the recipient is not supplied, leave "to" empty.
If the subject hint is useful, use it or improve it gently.
Do not include placeholders like [Name] unless the owner explicitly asks for a template.
`,
      max_output_tokens: 900,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "compass_mail_draft",
          strict: true,
          schema: EMAIL_DRAFT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Compass draft request failed: ${response.status} ${errorText.slice(0, 300)}`);
  }

  const draft = parseModelJson(extractOutputText(await response.json()));
  return {
    to: clean(draft.to, 1000),
    subject: clean(draft.subject, 500),
    body: clean(draft.body, 20000),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST for Compass Mail." });
    return;
  }

  const access = authorizeMailAccess(req);
  if (!access.ok) {
    jsonResponse(res, access.status, { error: access.error });
    return;
  }

  try {
    const body = await readJson(req);
    const action = body.action || "status";

    if (action === "status") {
      const config = getMailConfig();
      jsonResponse(res, 200, {
        address: config.address,
        host: config.host,
        port: config.port,
        secure: config.secure,
        draftsMailbox: config.draftsMailbox,
        archiveMailbox: config.archiveMailbox,
        trashMailbox: config.trashMailbox,
        sendAllowed: false,
      });
      return;
    }

    if (action === "mailboxes") {
      jsonResponse(res, 200, await listMailboxes());
      return;
    }

    if (action === "list") {
      jsonResponse(
        res,
        200,
        await listMessages({
          mailbox: body.mailbox,
          limit: body.limit,
          unreadOnly: bool(body.unreadOnly),
        })
      );
      return;
    }

    if (action === "read") {
      jsonResponse(res, 200, await readMessage({ mailbox: body.mailbox, uid: body.uid }));
      return;
    }

    if (action === "createDraft") {
      jsonResponse(
        res,
        200,
        await createDraft({
          to: body.to,
          cc: body.cc,
          bcc: body.bcc,
          subject: body.subject,
          body: body.body,
        })
      );
      return;
    }

    if (action === "prepareDraft") {
      jsonResponse(
        res,
        200,
        await prepareEmailDraft({
          instruction: body.instruction,
          to: body.to,
          subjectHint: body.subjectHint,
          context: body.context,
        })
      );
      return;
    }

    if (action === "mark") {
      jsonResponse(
        res,
        200,
        await updateFlags({
          mailbox: body.mailbox,
          uid: body.uid,
          seen: typeof body.seen === "boolean" ? body.seen : undefined,
          flagged: typeof body.flagged === "boolean" ? body.flagged : undefined,
        })
      );
      return;
    }

    if (action === "move") {
      jsonResponse(
        res,
        200,
        await moveMessage({
          mailbox: body.mailbox,
          uid: body.uid,
          destination: body.destination,
        })
      );
      return;
    }

    if (action === "archive") {
      jsonResponse(res, 200, await archiveMessage({ mailbox: body.mailbox, uid: body.uid }));
      return;
    }

    if (action === "trash") {
      jsonResponse(res, 200, await trashMessage({ mailbox: body.mailbox, uid: body.uid }));
      return;
    }

    jsonResponse(res, 400, { error: "Unknown Compass Mail action." });
  } catch (error) {
    console.error("Compass Mail error:", error);
    jsonResponse(res, 500, {
      error: "Compass Mail could not complete that request.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
