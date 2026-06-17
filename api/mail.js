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
