const mailTokenInput = document.querySelector("#mail-token");
const mailConnect = document.querySelector("#mail-connect");
const mailStatus = document.querySelector("#mail-status");
const mailWorkspace = document.querySelector("#mail-workspace");
const mailboxSelect = document.querySelector("#mailbox-select");
const mailRefresh = document.querySelector("#mail-refresh");
const unreadOnly = document.querySelector("#unread-only");
const messageList = document.querySelector("#message-list");
const messageDetail = document.querySelector("#message-detail");
const moveSelect = document.querySelector("#move-select");
const moveButton = document.querySelector("#move-message");
const markReadButton = document.querySelector("#mark-read");
const flagButton = document.querySelector("#flag-message");
const draftReplyButton = document.querySelector("#draft-reply");
const archiveButton = document.querySelector("#archive-message");
const trashButton = document.querySelector("#trash-message");
const draftForm = document.querySelector("#draft-form");
const draftStatus = document.querySelector("#draft-status");

const MAIL_TOKEN_KEY = "wfc-compass-mail-token";
const MAIL_API_BASE = window.COMPASS_API_BASE || (window.location.protocol === "file:" ? "http://localhost:3000" : "");

let mailState = {
  token: sessionStorage.getItem(MAIL_TOKEN_KEY) || "",
  mailboxes: [],
  mailbox: "INBOX",
  messages: [],
  selected: null,
};

function setMailStatus(message, tone = "neutral") {
  if (!mailStatus) return;
  mailStatus.textContent = message;
  mailStatus.dataset.tone = tone;
}

function setDraftStatus(message, tone = "neutral") {
  if (!draftStatus) return;
  draftStatus.textContent = message;
  draftStatus.dataset.tone = tone;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || "";
}

async function mailRequest(action, payload = {}) {
  const response = await fetch(`${MAIL_API_BASE}/api/mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Compass-Mail-Token": mailState.token,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Compass Mail could not complete that request.");
  }
  return data;
}

function renderMailboxOptions() {
  const options = mailState.mailboxes
    .map((mailbox) => {
      const label = mailbox.path === mailbox.name ? mailbox.name : `${mailbox.name} (${mailbox.path})`;
      return `<option value="${escapeHtml(mailbox.path)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  if (mailboxSelect) {
    mailboxSelect.innerHTML = options;
    mailboxSelect.value = mailState.mailbox;
  }

  if (moveSelect) {
    moveSelect.innerHTML = `<option value="">Move to...</option>${options}`;
  }
}

function renderMessageList() {
  if (!messageList) return;

  if (!mailState.messages.length) {
    messageList.innerHTML = `<p class="mail-empty">No messages found.</p>`;
    return;
  }

  messageList.innerHTML = mailState.messages
    .map((message) => {
      const active = mailState.selected?.uid === message.uid ? " active" : "";
      const unread = message.flags?.seen ? "" : " unread";
      const flagged = message.flags?.flagged ? " flagged" : "";
      return `
        <button class="mail-item${active}${unread}${flagged}" type="button" data-uid="${message.uid}">
          <span class="mail-item-top">
            <strong>${escapeHtml(message.from || "Unknown sender")}</strong>
            <small>${escapeHtml(formatDate(message.date))}</small>
          </span>
          <span class="mail-subject">${escapeHtml(message.subject)}</span>
        </button>
      `;
    })
    .join("");
}

function renderMessageDetail() {
  if (!messageDetail) return;

  if (!mailState.selected) {
    messageDetail.innerHTML = `
      <div class="mail-placeholder">
        <p class="eyebrow">Mailbox</p>
        <h2>Select a message.</h2>
      </div>
    `;
    [markReadButton, flagButton, draftReplyButton, archiveButton, trashButton, moveButton].forEach((button) => {
      if (button) button.disabled = true;
    });
    return;
  }

  const message = mailState.selected;
  messageDetail.innerHTML = `
    <article class="mail-message">
      <p class="eyebrow">${escapeHtml(mailState.mailbox)}</p>
      <h2>${escapeHtml(message.subject)}</h2>
      <dl>
        <div><dt>From</dt><dd>${escapeHtml(message.from || "Unknown")}</dd></div>
        <div><dt>To</dt><dd>${escapeHtml(message.to || "Not shown")}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(formatDate(message.date))}</dd></div>
      </dl>
      <pre>${escapeHtml(message.text || "No plain text body was available for this message.")}</pre>
    </article>
  `;

  if (markReadButton) {
    markReadButton.disabled = false;
    markReadButton.textContent = message.flags?.seen ? "Mark Unread" : "Mark Read";
  }
  if (flagButton) {
    flagButton.disabled = false;
    flagButton.textContent = message.flags?.flagged ? "Clear Flag" : "Flag";
  }
  [draftReplyButton, archiveButton, trashButton, moveButton].forEach((button) => {
    if (button) button.disabled = false;
  });
}

function setDraftField(name, value) {
  const field = draftForm?.elements.namedItem(name);
  if (field) field.value = value;
}

function prefixedReplySubject(subject) {
  const clean = String(subject || "").trim();
  return /^re:/i.test(clean) ? clean : `Re: ${clean || "(No subject)"}`;
}

function prefillReplyDraft() {
  if (!mailState.selected || !draftForm) return;
  const message = mailState.selected;
  const to = message.replyTo || message.from || "";
  const quoted = String(message.text || "")
    .split("\n")
    .slice(0, 80)
    .map((line) => `> ${line}`)
    .join("\n");

  setDraftField("draft-to", to);
  setDraftField("draft-subject", prefixedReplySubject(message.subject));
  setDraftField(
    "draft-body",
    `Hi,\n\n\n\nRegards,\nBen\n\n--- Original message ---\nFrom: ${message.from || "Unknown"}\nDate: ${formatDate(message.date)}\nSubject: ${message.subject || "(No subject)"}\n\n${quoted}`
  );
  setDraftStatus("Reply draft prepared locally. Review it before creating the Outlook draft.", "success");
  draftForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadMailboxes() {
  const data = await mailRequest("mailboxes");
  mailState.mailboxes = data.mailboxes || [];
  if (!mailState.mailboxes.some((mailbox) => mailbox.path === mailState.mailbox)) {
    mailState.mailbox = mailState.mailboxes.find((mailbox) => mailbox.path === "INBOX")?.path || mailState.mailboxes[0]?.path || "INBOX";
  }
  renderMailboxOptions();
}

async function loadMessages() {
  setMailStatus("Loading mailbox...");
  const data = await mailRequest("list", {
    mailbox: mailState.mailbox,
    limit: 40,
    unreadOnly: Boolean(unreadOnly?.checked),
  });
  mailState.messages = data.messages || [];
  mailState.selected = null;
  renderMessageList();
  renderMessageDetail();
  setMailStatus(`${mailState.messages.length} messages loaded from ${data.mailbox}.`, "success");
}

async function connectMail() {
  mailState.token = mailTokenInput?.value.trim() || "";
  if (!mailState.token) {
    setMailStatus("Enter the owner access token first.", "error");
    return;
  }

  sessionStorage.setItem(MAIL_TOKEN_KEY, mailState.token);
  setMailStatus("Connecting to Compass Mail...");

  const status = await mailRequest("status");
  await loadMailboxes();
  await loadMessages();
  if (mailWorkspace) mailWorkspace.hidden = false;
  setMailStatus(`Connected to ${status.address}. Draft creation only; sending is disabled.`, "success");
}

async function selectMessage(uid) {
  setMailStatus("Opening message...");
  const message = await mailRequest("read", { mailbox: mailState.mailbox, uid });
  mailState.selected = message;
  renderMessageList();
  renderMessageDetail();
  setMailStatus("Message opened.", "success");
}

async function refreshAfterAction(message) {
  const selectedUid = mailState.selected?.uid;
  await loadMessages();
  if (selectedUid && mailState.messages.some((item) => item.uid === selectedUid)) {
    await selectMessage(selectedUid);
  }
  setMailStatus(message, "success");
}

if (mailTokenInput && mailState.token) {
  mailTokenInput.value = mailState.token;
}

if (mailConnect) {
  mailConnect.addEventListener("click", async () => {
    try {
      await connectMail();
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (mailboxSelect) {
  mailboxSelect.addEventListener("change", async () => {
    mailState.mailbox = mailboxSelect.value || "INBOX";
    try {
      await loadMessages();
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (mailRefresh) {
  mailRefresh.addEventListener("click", async () => {
    try {
      await loadMessages();
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (unreadOnly) {
  unreadOnly.addEventListener("change", async () => {
    try {
      await loadMessages();
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (messageList) {
  messageList.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-uid]");
    if (!item) return;
    try {
      await selectMessage(item.dataset.uid);
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (markReadButton) {
  markReadButton.addEventListener("click", async () => {
    if (!mailState.selected) return;
    try {
      await mailRequest("mark", {
        mailbox: mailState.mailbox,
        uid: mailState.selected.uid,
        seen: !mailState.selected.flags?.seen,
      });
      await refreshAfterAction("Read state updated.");
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (flagButton) {
  flagButton.addEventListener("click", async () => {
    if (!mailState.selected) return;
    try {
      await mailRequest("mark", {
        mailbox: mailState.mailbox,
        uid: mailState.selected.uid,
        flagged: !mailState.selected.flags?.flagged,
      });
      await refreshAfterAction("Flag updated.");
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (draftReplyButton) {
  draftReplyButton.addEventListener("click", prefillReplyDraft);
}

if (archiveButton) {
  archiveButton.addEventListener("click", async () => {
    if (!mailState.selected) return;
    try {
      await mailRequest("archive", { mailbox: mailState.mailbox, uid: mailState.selected.uid });
      await refreshAfterAction("Message moved to Archive.");
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (trashButton) {
  trashButton.addEventListener("click", async () => {
    if (!mailState.selected) return;
    try {
      await mailRequest("trash", { mailbox: mailState.mailbox, uid: mailState.selected.uid });
      await refreshAfterAction("Message moved to Deleted Items.");
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (moveButton) {
  moveButton.addEventListener("click", async () => {
    if (!mailState.selected || !moveSelect?.value) return;
    try {
      await mailRequest("move", {
        mailbox: mailState.mailbox,
        uid: mailState.selected.uid,
        destination: moveSelect.value,
      });
      await refreshAfterAction(`Message moved to ${moveSelect.value}.`);
    } catch (error) {
      setMailStatus(error.message, "error");
    }
  });
}

if (draftForm) {
  draftForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      setDraftStatus("Creating Outlook draft...");
      const data = await mailRequest("createDraft", {
        to: formValue(draftForm, "draft-to"),
        cc: formValue(draftForm, "draft-cc"),
        bcc: formValue(draftForm, "draft-bcc"),
        subject: formValue(draftForm, "draft-subject"),
        body: formValue(draftForm, "draft-body"),
      });
      draftForm.reset();
      setDraftStatus(data.message || "Draft created in Outlook.", "success");
    } catch (error) {
      setDraftStatus(error.message, "error");
    }
  });
}
