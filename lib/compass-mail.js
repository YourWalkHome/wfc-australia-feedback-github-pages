const DEFAULT_MAILBOX_ADDRESS = "ben@wfcaust.com.au";
const OUTLOOK_IMAP_HOST = "outlook.office365.com";

function cleanText(value, limit = 4000) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, limit);
}

function cleanMailbox(value, fallback = "INBOX") {
  const text = cleanText(value, 200);
  return text || fallback;
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function parsePort(value, fallback) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function loadMailDependencies() {
  try {
    const { ImapFlow } = require("imapflow");
    const { simpleParser } = require("mailparser");
    const MailComposer = require("nodemailer/lib/mail-composer");
    return { ImapFlow, simpleParser, MailComposer };
  } catch (error) {
    throw new Error(
      "Compass Mail dependencies are not installed. Run npm install before using the IMAP mailbox tools."
    );
  }
}

function getMailConfig() {
  const configuredAddress = cleanText(process.env.COMPASS_MAIL_ADDRESS || DEFAULT_MAILBOX_ADDRESS, 300).toLowerCase();
  if (configuredAddress !== DEFAULT_MAILBOX_ADDRESS) {
    throw new Error(`Compass Mail is restricted to ${DEFAULT_MAILBOX_ADDRESS}.`);
  }

  const address = DEFAULT_MAILBOX_ADDRESS;
  const user = cleanText(process.env.COMPASS_MAIL_USER || process.env.MAIL_USER || process.env.IMAP_USER || address, 300);
  const password = process.env.COMPASS_MAIL_PASSWORD || process.env.MAIL_PASSWORD || process.env.IMAP_PASSWORD;
  const accessToken = process.env.COMPASS_MAIL_ACCESS_TOKEN || process.env.MAIL_ACCESS_TOKEN;

  if (user.toLowerCase() !== address) {
    throw new Error(`Compass Mail is locked to ${address}. Check COMPASS_MAIL_USER before connecting.`);
  }

  if (!password && !accessToken) {
    throw new Error("Compass Mail needs COMPASS_MAIL_PASSWORD or COMPASS_MAIL_ACCESS_TOKEN.");
  }

  return {
    address,
    user,
    host: cleanText(process.env.COMPASS_MAIL_IMAP_HOST || process.env.MAIL_IMAP_HOST || OUTLOOK_IMAP_HOST, 300),
    port: parsePort(process.env.COMPASS_MAIL_IMAP_PORT || process.env.MAIL_IMAP_PORT, 993),
    secure: parseBoolean(process.env.COMPASS_MAIL_IMAP_SECURE || process.env.MAIL_IMAP_SECURE, true),
    auth: accessToken ? { user, accessToken } : { user, pass: password },
    draftsMailbox: cleanMailbox(process.env.COMPASS_MAIL_DRAFTS_MAILBOX, "Drafts"),
    archiveMailbox: cleanMailbox(process.env.COMPASS_MAIL_ARCHIVE_MAILBOX, "Archive"),
    trashMailbox: cleanMailbox(process.env.COMPASS_MAIL_TRASH_MAILBOX, "Deleted Items"),
  };
}

async function withMailClient(work) {
  const { ImapFlow } = loadMailDependencies();
  const config = getMailConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
  });

  await client.connect();
  try {
    return await work(client, config);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

function addressToText(address) {
  if (!address) return "";
  const email = cleanText(address.address, 300);
  const name = cleanText(address.name, 300);
  return name && email ? `${name} <${email}>` : email || name;
}

function addressListToText(addresses) {
  if (!Array.isArray(addresses)) return "";
  return addresses.map(addressToText).filter(Boolean).join(", ");
}

function flagsToState(flags) {
  const list = Array.from(flags || []);
  return {
    list,
    seen: list.includes("\\Seen"),
    flagged: list.includes("\\Flagged"),
    draft: list.includes("\\Draft"),
    answered: list.includes("\\Answered"),
  };
}

function messageSummary(message) {
  const envelope = message.envelope || {};
  const flags = flagsToState(message.flags);
  const rawDate = envelope.date || message.internalDate || new Date();
  const date = rawDate instanceof Date ? rawDate : new Date(rawDate);

  return {
    uid: message.uid,
    subject: cleanText(envelope.subject || "(No subject)", 500),
    from: addressListToText(envelope.from),
    to: addressListToText(envelope.to),
    date: Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString(),
    size: message.size || 0,
    flags,
  };
}

function clampLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isInteger(limit)) return 25;
  return Math.min(Math.max(limit, 1), 100);
}

async function listMailboxes() {
  return withMailClient(async (client, config) => {
    const mailboxes = await client.list();
    return {
      address: config.address,
      mailboxes: mailboxes.map((mailbox) => ({
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter,
        specialUse: mailbox.specialUse || "",
        flags: Array.from(mailbox.flags || []),
        listed: Boolean(mailbox.listed),
        subscribed: Boolean(mailbox.subscribed),
      })),
    };
  });
}

async function listMessages({ mailbox = "INBOX", limit = 25, unreadOnly = false } = {}) {
  return withMailClient(async (client) => {
    const mailboxPath = cleanMailbox(mailbox);
    const lock = await client.getMailboxLock(mailboxPath);

    try {
      const total = client.mailbox.exists || 0;
      if (!total) {
        return { mailbox: mailboxPath, total: 0, messages: [] };
      }

      const safeLimit = clampLimit(limit);
      const fetchCount = Math.min(total, Math.max(safeLimit * 3, safeLimit));
      const start = Math.max(1, total - fetchCount + 1);
      const messages = [];

      for await (const message of client.fetch(`${start}:*`, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
      })) {
        const summary = messageSummary(message);
        if (!unreadOnly || !summary.flags.seen) {
          messages.push(summary);
        }
      }

      messages.sort((a, b) => b.uid - a.uid);
      return {
        mailbox: mailboxPath,
        total,
        messages: messages.slice(0, safeLimit),
      };
    } finally {
      lock.release();
    }
  });
}

async function readMessage({ mailbox = "INBOX", uid }) {
  const messageUid = Number.parseInt(uid, 10);
  if (!Number.isInteger(messageUid) || messageUid <= 0) {
    throw new Error("A valid message uid is required.");
  }

  return withMailClient(async (client) => {
    const { simpleParser } = loadMailDependencies();
    const mailboxPath = cleanMailbox(mailbox);
    const lock = await client.getMailboxLock(mailboxPath);

    try {
      let rawMessage = null;
      for await (const message of client.fetch(
        String(messageUid),
        {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          source: true,
        },
        { uid: true }
      )) {
        rawMessage = message;
        break;
      }

      if (!rawMessage) {
        throw new Error("Message not found.");
      }

      const parsed = await simpleParser(rawMessage.source);
      const summary = messageSummary(rawMessage);
      return {
        ...summary,
        mailbox: mailboxPath,
        cc: parsed.cc?.text || "",
        bcc: parsed.bcc?.text || "",
        replyTo: parsed.replyTo?.text || "",
        text: cleanText(parsed.text || "", 30000),
        attachments: (parsed.attachments || []).map((attachment) => ({
          filename: cleanText(attachment.filename || "attachment", 300),
          contentType: cleanText(attachment.contentType || "application/octet-stream", 200),
          size: attachment.size || 0,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

function cleanHeader(value, fallback = "") {
  return cleanText(value, 800).replace(/[\r\n]+/g, " ") || fallback;
}

function cleanAddressHeader(value) {
  return cleanText(value, 2000).replace(/[\r\n]+/g, " ");
}

function textToHtml(value) {
  const safe = cleanText(value, 50000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return safe
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

async function createDraft({ to = "", cc = "", bcc = "", subject = "", body = "" }) {
  const safeBody = cleanText(body, 50000);
  if (!safeBody) {
    throw new Error("Draft body is required.");
  }

  return withMailClient(async (client, config) => {
    const { MailComposer } = loadMailDependencies();
    const composer = new MailComposer({
      from: config.address,
      to: cleanAddressHeader(to),
      cc: cleanAddressHeader(cc) || undefined,
      bcc: cleanAddressHeader(bcc) || undefined,
      subject: cleanHeader(subject, "(No subject)"),
      text: safeBody,
      html: textToHtml(safeBody),
      date: new Date(),
      headers: {
        "X-Compass-Mail-Draft": "prepared-only",
        "X-Compass-Mail-Send-Policy": "human-review-required",
      },
    });
    const raw = await composer.compile().build();
    const result = await client.append(config.draftsMailbox, raw, ["\\Draft"], new Date());

    return {
      mailbox: config.draftsMailbox,
      uid: result.uid || null,
      uidValidity: result.uidValidity || null,
      message: "Draft created in Outlook. Review it there before sending.",
    };
  });
}

async function updateFlags({ mailbox = "INBOX", uid, seen, flagged }) {
  const messageUid = Number.parseInt(uid, 10);
  if (!Number.isInteger(messageUid) || messageUid <= 0) {
    throw new Error("A valid message uid is required.");
  }

  return withMailClient(async (client) => {
    const mailboxPath = cleanMailbox(mailbox);
    const lock = await client.getMailboxLock(mailboxPath);
    const range = String(messageUid);

    try {
      if (typeof seen === "boolean") {
        if (seen) await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
        else await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
      }

      if (typeof flagged === "boolean") {
        if (flagged) await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
        else await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
      }

      return { mailbox: mailboxPath, uid: messageUid, updated: true };
    } finally {
      lock.release();
    }
  });
}

async function moveMessage({ mailbox = "INBOX", uid, destination }) {
  const messageUid = Number.parseInt(uid, 10);
  const target = cleanMailbox(destination, "");
  if (!Number.isInteger(messageUid) || messageUid <= 0) {
    throw new Error("A valid message uid is required.");
  }
  if (!target) {
    throw new Error("A destination mailbox is required.");
  }

  return withMailClient(async (client) => {
    const mailboxPath = cleanMailbox(mailbox);
    const lock = await client.getMailboxLock(mailboxPath);

    try {
      const result = await client.messageMove(String(messageUid), target, { uid: true });
      return {
        from: mailboxPath,
        to: target,
        uid: messageUid,
        moved: true,
        destinationUid: result?.uidMap?.get?.(messageUid) || null,
      };
    } finally {
      lock.release();
    }
  });
}

async function archiveMessage({ mailbox = "INBOX", uid }) {
  const config = getMailConfig();
  return moveMessage({ mailbox, uid, destination: config.archiveMailbox });
}

async function trashMessage({ mailbox = "INBOX", uid }) {
  const config = getMailConfig();
  return moveMessage({ mailbox, uid, destination: config.trashMailbox });
}

module.exports = {
  archiveMessage,
  createDraft,
  getMailConfig,
  listMailboxes,
  listMessages,
  moveMessage,
  readMessage,
  trashMessage,
  updateFlags,
};
