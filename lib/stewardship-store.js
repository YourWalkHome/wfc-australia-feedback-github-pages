const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const PREFIX = "wfc:stewardship";
const INDEX_KEY = `${PREFIX}:conversations`;
const SESSION_KEY_PREFIX = `${PREFIX}:session`;
const CONVERSATION_KEY_PREFIX = `${PREFIX}:conversation`;
const LOCAL_STORE_PATH =
  process.env.STEWARDSHIP_LOCAL_STORE_PATH || path.join(process.cwd(), ".stewardship-store.json");

const DECISIONS = new Set(["keep_human_only", "future_toolkit", "refer_out"]);

function clean(value, limit = 3000) {
  return String(value || "").trim().slice(0, limit);
}

function nowIso() {
  return new Date().toISOString();
}

function currentYear() {
  return new Date().getFullYear();
}

function redisRestConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

function hasRedisRestConfig() {
  const { url, token } = redisRestConfig();
  return Boolean(url && token);
}

function hasRedisUrlConfig() {
  return Boolean(process.env.REDIS_URL);
}

function requireStorage() {
  if (hasRedisRestConfig() || hasRedisUrlConfig()) return "redis";
  if (process.env.NODE_ENV !== "production") return "local";
  throw new Error("Stewardship storage is not configured. Add REDIS_URL, Vercel KV, or Upstash REST environment variables.");
}

async function redisRestCommand(...command) {
  const { url, token } = redisRestConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stewardship storage request failed: ${response.status} ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data?.error) throw new Error(`Stewardship storage error: ${data.error}`);
  return data?.result;
}

function encodeRedisCommand(command) {
  return `*${command.length}\r\n${command
    .map((part) => {
      const value = Buffer.from(String(part));
      return `$${value.length}\r\n${value.toString()}\r\n`;
    })
    .join("")}`;
}

function parseRedisLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end === -1) return null;
  return {
    line: buffer.toString("utf8", offset, end),
    offset: end + 2,
  };
}

function parseRedisValue(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const next = offset + 1;

  if (type === "+" || type === "-" || type === ":") {
    const parsed = parseRedisLine(buffer, next);
    if (!parsed) return null;
    if (type === "-") throw new Error(`Stewardship Redis error: ${parsed.line}`);
    return {
      value: type === ":" ? Number(parsed.line) : parsed.line,
      offset: parsed.offset,
    };
  }

  if (type === "$") {
    const parsed = parseRedisLine(buffer, next);
    if (!parsed) return null;
    const length = Number(parsed.line);
    if (length === -1) return { value: null, offset: parsed.offset };
    const end = parsed.offset + length;
    if (buffer.length < end + 2) return null;
    return {
      value: buffer.toString("utf8", parsed.offset, end),
      offset: end + 2,
    };
  }

  if (type === "*") {
    const parsed = parseRedisLine(buffer, next);
    if (!parsed) return null;
    const count = Number(parsed.line);
    if (count === -1) return { value: null, offset: parsed.offset };
    const values = [];
    let current = parsed.offset;
    for (let index = 0; index < count; index += 1) {
      const item = parseRedisValue(buffer, current);
      if (!item) return null;
      values.push(item.value);
      current = item.offset;
    }
    return { value: values, offset: current };
  }

  throw new Error(`Unexpected Redis response type: ${type}`);
}

function redisUrlDetails() {
  const parsed = new URL(process.env.REDIS_URL);
  const secure = parsed.protocol === "rediss:";
  const database = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/^\//, "") : "";

  return {
    host: parsed.hostname,
    port: Number(parsed.port || (secure ? 6379 : 6379)),
    secure,
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database,
  };
}

function connectRedisSocket(details) {
  return new Promise((resolve, reject) => {
    const options = {
      host: details.host,
      port: details.port,
      servername: details.host,
    };
    const socket = details.secure ? tls.connect(options) : net.connect(options);
    const readyEvent = details.secure ? "secureConnect" : "connect";
    const timeout = setTimeout(() => {
      socket.destroy(new Error("Stewardship Redis connection timed out."));
    }, 8000);

    socket.once(readyEvent, () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function createRedisResponder(socket) {
  let buffer = Buffer.alloc(0);
  const waiters = [];

  function pump() {
    while (waiters.length) {
      let parsed;
      try {
        parsed = parseRedisValue(buffer);
      } catch (error) {
        waiters.shift().reject(error);
        continue;
      }
      if (!parsed) return;
      buffer = buffer.subarray(parsed.offset);
      waiters.shift().resolve(parsed.value);
    }
  }

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });

  socket.on("error", (error) => {
    while (waiters.length) waiters.shift().reject(error);
  });

  return function send(command) {
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      socket.write(encodeRedisCommand(command), "utf8", (error) => {
        if (error) reject(error);
      });
      pump();
    });
  };
}

async function redisUrlCommand(...command) {
  const details = redisUrlDetails();
  const socket = await connectRedisSocket(details);
  const send = createRedisResponder(socket);

  try {
    if (details.password) {
      if (details.username) {
        await send(["AUTH", details.username, details.password]);
      } else {
        await send(["AUTH", details.password]);
      }
    }

    if (details.database && details.database !== "0") {
      await send(["SELECT", details.database]);
    }

    return await send(command);
  } finally {
    socket.end();
  }
}

async function redisCommand(...command) {
  if (hasRedisRestConfig()) return redisRestCommand(...command);
  return redisUrlCommand(...command);
}

async function readLocalStore() {
  try {
    return JSON.parse(await fs.readFile(LOCAL_STORE_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { sequence: {}, sessions: {}, conversations: {} };
  }
}

async function writeLocalStore(store) {
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(store, null, 2));
}

function conversationKey(id) {
  return `${CONVERSATION_KEY_PREFIX}:${id}`;
}

function sessionKey(sessionId) {
  return `${SESSION_KEY_PREFIX}:${clean(sessionId, 120)}`;
}

function sequenceKey(year = currentYear()) {
  return `${PREFIX}:sequence:${year}`;
}

function formatConversationId(year, number) {
  return `CON-${year}-${String(number).padStart(6, "0")}`;
}

function safeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "compass" ? "compass" : "visitor",
      content: clean(message.content, 3000),
      createdAt: clean(message.createdAt, 80) || nowIso(),
    }))
    .filter((message) => message.content)
    .slice(-40);
}

function latestByRole(messages, role) {
  return [...messages].reverse().find((message) => message.role === role)?.content || "";
}

function firstByRole(messages, role) {
  return messages.find((message) => message.role === role)?.content || "";
}

function preview(value, limit = 140) {
  const text = clean(value, 800).replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function normaliseDecision(decision) {
  return DECISIONS.has(decision) ? decision : "";
}

function publicRecord(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    firstVisitorMessage: record.firstVisitorMessage,
    visitorPreview: preview(record.firstVisitorMessage || record.latestVisitorMessage),
    status: record.reviewStatus || "unreviewed",
    benNeeded: Boolean(record.benNeeded),
    decision: record.stewardshipDecision || "",
    learningNote: record.learningNote || "",
    hasSummary: Boolean(record.handoverSummary || record.handoverSummaryText),
  };
}

async function getRawConversation(id) {
  const mode = requireStorage();
  if (mode === "redis") {
    const value = await redisCommand("GET", conversationKey(id));
    return value ? JSON.parse(value) : null;
  }

  const store = await readLocalStore();
  return store.conversations[id] || null;
}

async function setRawConversation(record, { isNew = false } = {}) {
  const mode = requireStorage();
  const payload = JSON.stringify(record);

  if (mode === "redis") {
    await redisCommand("SET", conversationKey(record.id), payload);
    await redisCommand("SET", sessionKey(record.sessionId), record.id);
    if (isNew) {
      await redisCommand("ZADD", INDEX_KEY, Date.parse(record.createdAt) || Date.now(), record.id);
    }
    return record;
  }

  const store = await readLocalStore();
  store.conversations[record.id] = record;
  store.sessions[record.sessionId] = record.id;
  await writeLocalStore(store);
  return record;
}

async function nextConversationId() {
  const year = currentYear();
  const mode = requireStorage();

  if (mode === "redis") {
    const number = await redisCommand("INCR", sequenceKey(year));
    return formatConversationId(year, Number(number || 1));
  }

  const store = await readLocalStore();
  store.sequence[year] = Number(store.sequence[year] || 0) + 1;
  await writeLocalStore(store);
  return formatConversationId(year, store.sequence[year]);
}

async function conversationIdForSession(sessionId) {
  const safeSessionId = clean(sessionId, 120);
  if (!safeSessionId) return "";

  const mode = requireStorage();
  if (mode === "redis") {
    return clean(await redisCommand("GET", sessionKey(safeSessionId)), 80);
  }

  const store = await readLocalStore();
  return clean(store.sessions[safeSessionId], 80);
}

async function ensureConversation({ sessionId, messages }) {
  const safeSessionId = clean(sessionId, 120);
  if (!safeSessionId) throw new Error("A session ID is required for stewardship storage.");

  const existingId = await conversationIdForSession(safeSessionId);
  if (existingId) {
    const existing = await getRawConversation(existingId);
    if (existing) return { record: existing, isNew: false };
  }

  const id = await nextConversationId();
  const createdAt = nowIso();
  const safe = safeMessages(messages);
  const record = {
    id,
    sessionId: safeSessionId,
    createdAt,
    updatedAt: createdAt,
    messages: safe,
    firstVisitorMessage: firstByRole(safe, "visitor"),
    latestVisitorMessage: latestByRole(safe, "visitor"),
    latestCompassResponse: latestByRole(safe, "compass"),
    handoverSummary: null,
    handoverSummaryText: "",
    contact: {},
    benNeeded: false,
    reviewStatus: "unreviewed",
    stewardshipDecision: "",
    learningNote: "",
    reviewedAt: "",
  };

  await setRawConversation(record, { isNew: true });
  return { record, isNew: true };
}

async function upsertConversation({ sessionId, messages, compassReply, benNeeded = false }) {
  const { record, isNew } = await ensureConversation({ sessionId, messages });
  const safe = safeMessages(messages);
  const reply = clean(compassReply, 3000);
  const withReply = reply
    ? [
        ...safe,
        {
          role: "compass",
          content: reply,
          createdAt: nowIso(),
        },
      ]
    : safe;

  const updated = {
    ...record,
    updatedAt: nowIso(),
    messages: withReply,
    firstVisitorMessage: record.firstVisitorMessage || firstByRole(withReply, "visitor"),
    latestVisitorMessage: latestByRole(withReply, "visitor"),
    latestCompassResponse: reply || latestByRole(withReply, "compass"),
    benNeeded: Boolean(record.benNeeded || benNeeded),
  };

  return setRawConversation(updated, { isNew });
}

async function attachSummary({ sessionId, messages, summary }) {
  const record = await upsertConversation({ sessionId, messages, benNeeded: true });
  const updated = {
    ...record,
    updatedAt: nowIso(),
    benNeeded: true,
    handoverSummary: summary && typeof summary === "object" ? summary : null,
    handoverSummaryText: clean(summary?.summaryText, 12000),
  };
  return setRawConversation(updated);
}

async function markBenNeeded({ sessionId, messages, reason = "visitor_connect" }) {
  const record = await upsertConversation({ sessionId, messages, benNeeded: true });
  const updated = {
    ...record,
    updatedAt: nowIso(),
    benNeeded: true,
    benNeededReason: clean(reason, 120),
  };
  return setRawConversation(updated);
}

async function attachHandover({ sessionId, messages, contact, summary, summaryText }) {
  const record = await upsertConversation({ sessionId, messages, benNeeded: true });
  const updated = {
    ...record,
    updatedAt: nowIso(),
    benNeeded: true,
    benNeededReason: "handover_sent",
    contact: contact && typeof contact === "object" ? contact : {},
    handoverSummary: summary && typeof summary === "object" ? summary : record.handoverSummary,
    handoverSummaryText: clean(summaryText, 12000) || record.handoverSummaryText,
  };
  return setRawConversation(updated);
}

async function listConversations({ limit = 100 } = {}) {
  const mode = requireStorage();
  const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  if (mode === "redis") {
    const ids = (await redisCommand("ZREVRANGE", INDEX_KEY, 0, cappedLimit - 1)) || [];
    if (!ids.length) return [];
    const values = await redisCommand("MGET", ...ids.map((id) => conversationKey(id)));
    return (values || [])
      .filter(Boolean)
      .map((value) => publicRecord(JSON.parse(value)));
  }

  const store = await readLocalStore();
  return Object.values(store.conversations)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, cappedLimit)
    .map(publicRecord);
}

async function getConversation(id) {
  const record = await getRawConversation(clean(id, 80));
  if (!record) return null;
  return record;
}

async function saveReview({ id, decision, learningNote }) {
  const record = await getConversation(id);
  if (!record) throw new Error("Conversation not found.");

  const normalised = normaliseDecision(decision);
  if (!normalised) throw new Error("Choose a stewardship decision before saving.");

  const updated = {
    ...record,
    updatedAt: nowIso(),
    reviewedAt: nowIso(),
    reviewStatus: "reviewed",
    stewardshipDecision: normalised,
    learningNote: clean(learningNote, 5000),
  };

  return setRawConversation(updated);
}

module.exports = {
  attachHandover,
  attachSummary,
  getConversation,
  listConversations,
  markBenNeeded,
  publicRecord,
  saveReview,
  upsertConversation,
};
