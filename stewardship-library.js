const accessPanel = document.querySelector("#stewardship-access");
const accessForm = document.querySelector("#stewardship-access-form");
const accessKeyInput = document.querySelector("#stewardship-key");
const accessStatus = document.querySelector("#stewardship-access-status");
const appPanel = document.querySelector("#stewardship-app");
const listPanel = document.querySelector("#stewardship-list");
const detailPanel = document.querySelector("#stewardship-detail");
const refreshButton = document.querySelector("#stewardship-refresh");
const lockButton = document.querySelector("#stewardship-lock");

const API_BASE = window.COMPASS_API_BASE || (window.location.protocol === "file:" ? "http://localhost:3000" : "");
const ACCESS_KEY = "wfc-stewardship-access-key";

const decisionLabels = {
  keep_human_only: "Keep Human Only",
  future_toolkit: "Future Toolkit",
  refer_out: "Refer Out",
};

let stewardshipKey = sessionStorage.getItem(ACCESS_KEY) || "";
let conversations = [];
let selectedId = "";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function showStatus(message) {
  if (accessStatus) accessStatus.textContent = message || "";
}

async function stewardshipFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-stewardship-key": stewardshipKey,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "The Stewardship Library could not complete that request.");
  }
  return data;
}

function renderList() {
  if (!listPanel) return;

  if (!conversations.length) {
    listPanel.innerHTML = `<p class="muted-note">No Compass conversations have been stored yet.</p>`;
    return;
  }

  listPanel.innerHTML = conversations
    .map(
      (item) => `
        <button class="stewardship-list-item${item.id === selectedId ? " active" : ""}" type="button" data-id="${escapeHtml(item.id)}">
          <span class="stewardship-id">${escapeHtml(item.id)}</span>
          <span>${escapeHtml(formatDate(item.createdAt))}</span>
          <strong>${escapeHtml(item.visitorPreview || "No visitor message recorded")}</strong>
          <span>${item.benNeeded ? "Ben needed" : "No handoff yet"} · ${escapeHtml(decisionLabels[item.decision] || item.status || "Unreviewed")}</span>
        </button>
      `
    )
    .join("");

  listPanel.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => loadConversation(button.dataset.id));
  });
}

function messageHtml(messages = []) {
  if (!messages.length) return `<p class="muted-note">No transcript recorded.</p>`;
  return messages
    .map(
      (message) => `
        <article class="stewardship-message ${message.role === "compass" ? "compass" : "visitor"}">
          <strong>${message.role === "compass" ? "Compass" : "Visitor"}</strong>
          <p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>
        </article>
      `
    )
    .join("");
}

function summaryText(conversation) {
  return (
    conversation.handoverSummaryText ||
    conversation.handoverSummary?.summaryText ||
    conversation.handoverSummary?.whatBenShouldUnderstand ||
    "No handover summary has been prepared yet."
  );
}

function renderDetail(conversation) {
  if (!detailPanel) return;

  detailPanel.innerHTML = `
    <article class="stewardship-record">
      <div class="stewardship-record-header">
        <div>
          <p class="eyebrow">${escapeHtml(conversation.id)}</p>
          <h2>Conversation review.</h2>
        </div>
        <span class="stewardship-pill">${conversation.benNeeded ? "Ben needed" : "No handoff yet"}</span>
      </div>

      <dl class="stewardship-meta">
        <div><dt>Created</dt><dd>${escapeHtml(formatDate(conversation.createdAt))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHtml(formatDate(conversation.updatedAt))}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(conversation.reviewStatus || "unreviewed")}</dd></div>
      </dl>

      <section>
        <h3>Conversation</h3>
        <div class="stewardship-transcript">${messageHtml(conversation.messages)}</div>
      </section>

      <section>
        <h3>Handover Summary</h3>
        <div class="stewardship-summary">${escapeHtml(summaryText(conversation)).replace(/\n/g, "<br>")}</div>
      </section>

      <form class="stewardship-review-form" id="stewardship-review-form">
        <div class="field-group">
          <label for="stewardship-decision">Stewardship decision</label>
          <select id="stewardship-decision" name="stewardship-decision" required>
            <option value="">Choose one</option>
            <option value="keep_human_only">Keep Human Only</option>
            <option value="future_toolkit">Future Toolkit</option>
            <option value="refer_out">Refer Out</option>
          </select>
        </div>
        <div class="field-group">
          <label for="stewardship-learning-note">Learning note</label>
          <textarea id="stewardship-learning-note" name="stewardship-learning-note" rows="7" placeholder="What did we learn? What should remain human judgement? Should this become future toolkit content?"></textarea>
        </div>
        <div class="button-row">
          <button class="button primary" type="submit">Save Review</button>
        </div>
        <p class="form-status" id="stewardship-save-status" role="status" aria-live="polite"></p>
      </form>
    </article>
  `;

  const decision = detailPanel.querySelector("#stewardship-decision");
  const note = detailPanel.querySelector("#stewardship-learning-note");
  const form = detailPanel.querySelector("#stewardship-review-form");
  const status = detailPanel.querySelector("#stewardship-save-status");

  decision.value = conversation.stewardshipDecision || "";
  note.value = conversation.learningNote || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Saving review...";

    try {
      const data = await stewardshipFetch("/api/stewardship", {
        method: "POST",
        body: JSON.stringify({
          action: "review",
          id: conversation.id,
          decision: decision.value,
          learningNote: note.value,
        }),
      });
      status.textContent = "Review saved.";
      await loadList(data.conversation?.id || conversation.id);
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

async function loadConversation(id) {
  selectedId = id;
  renderList();
  if (detailPanel) detailPanel.innerHTML = `<p class="muted-note">Loading conversation...</p>`;

  try {
    const data = await stewardshipFetch(`/api/stewardship?action=get&id=${encodeURIComponent(id)}`);
    renderDetail(data.conversation);
  } catch (error) {
    if (detailPanel) detailPanel.innerHTML = `<p class="muted-note">${escapeHtml(error.message)}</p>`;
  }
}

async function loadList(preferredId = selectedId) {
  showStatus("Loading Stewardship Library...");
  const data = await stewardshipFetch("/api/stewardship?action=list");
  conversations = data.conversations || [];
  selectedId = preferredId || conversations[0]?.id || "";
  renderList();
  showStatus("");
  if (selectedId) {
    await loadConversation(selectedId);
  } else if (detailPanel) {
    detailPanel.innerHTML = `<p class="muted-note">No conversations are ready for review yet.</p>`;
  }
}

function unlock() {
  if (accessPanel) accessPanel.hidden = true;
  if (appPanel) appPanel.hidden = false;
  loadList().catch((error) => {
    if (accessPanel) accessPanel.hidden = false;
    if (appPanel) appPanel.hidden = true;
    showStatus(error.message);
  });
}

if (accessForm) {
  accessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    stewardshipKey = accessKeyInput.value.trim();
    sessionStorage.setItem(ACCESS_KEY, stewardshipKey);
    unlock();
  });
}

if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    loadList().catch((error) => {
      if (detailPanel) detailPanel.innerHTML = `<p class="muted-note">${escapeHtml(error.message)}</p>`;
    });
  });
}

if (lockButton) {
  lockButton.addEventListener("click", () => {
    sessionStorage.removeItem(ACCESS_KEY);
    stewardshipKey = "";
    if (accessPanel) accessPanel.hidden = false;
    if (appPanel) appPanel.hidden = true;
    if (accessKeyInput) accessKeyInput.value = "";
  });
}

if (stewardshipKey) {
  unlock();
}
