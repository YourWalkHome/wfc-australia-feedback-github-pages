const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const conversationLog = document.querySelector("#conversation-log");
const conversationForm = document.querySelector("#compass-conversation-form");
const visitorResponse = document.querySelector("#visitor-response");
const questionLabel = document.querySelector("#question-label");
const conversationStatus = document.querySelector("#conversation-status");
const restartConversation = document.querySelector("#restart-conversation");
const prepareSummary = document.querySelector("#prepare-summary");
const summaryReview = document.querySelector("#summary-review");
const managedSummaryCard = document.querySelector("#managed-summary-card");
const managedSummary = document.querySelector("#managed-summary");
const copyManagedSummary = document.querySelector("#copy-managed-summary");
const continueToHandover = document.querySelector("#continue-to-handover");
const summaryStatus = document.querySelector("#summary-status");
const handoverPanel = document.querySelector("#handover-panel");
const handoverForm = document.querySelector("#handover-form");
const sendHandover = document.querySelector("#send-handover");
const bookBen = document.querySelector("#book-ben");
const handoverStatus = document.querySelector("#handover-status");

const API_BASE = window.COMPASS_API_BASE || (window.location.protocol === "file:" ? "http://localhost:3000" : "");
const CALENDLY_BOOKING_URL = "https://calendly.com/ben-bennyland/30min";
const SESSION_KEY = "wfc-compass-session";

let compassSession = loadSession();

function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (saved && Array.isArray(saved.messages)) return saved;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
  }

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    conversationId: null,
    messages: [],
    summary: null,
  };
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(compassSession));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || "";
}

function addMessage(role, content, { save = true, loading = false } = {}) {
  if (!conversationLog) return null;

  const message = document.createElement("article");
  message.className = `message ${role}${loading ? " loading" : ""}`;
  const speaker = role === "visitor" ? "You" : "Compass";
  const body = escapeHtml(content)
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join("");

  message.innerHTML = `
    <span class="speaker">${speaker}</span>
    <div>${body}</div>
  `;
  conversationLog.append(message);
  message.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (save && !loading) {
    compassSession.messages.push({
      role,
      content,
      createdAt: new Date().toISOString(),
    });
    saveSession();
  }

  return message;
}

function renderMessages() {
  if (!conversationLog) return;
  conversationLog.innerHTML = "";
  compassSession.messages.forEach((message) => {
    addMessage(message.role, message.content, { save: false });
  });
}

function setBusy(isBusy, label = "Compass is preparing a response...") {
  if (conversationForm) conversationForm.classList.toggle("is-busy", isBusy);
  if (visitorResponse) visitorResponse.disabled = isBusy;
  if (conversationForm?.querySelector("button[type='submit']")) {
    conversationForm.querySelector("button[type='submit']").disabled = isBusy;
  }
  if (prepareSummary) prepareSummary.disabled = isBusy || compassSession.messages.length < 2;
  if (conversationStatus) conversationStatus.textContent = isBusy ? label : "";
}

async function callCompass(action, extra = {}) {
  const response = await fetch(`${API_BASE}/api/compass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: compassSession.id,
      action,
      messages: compassSession.messages,
      ...extra,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Compass could not respond just now.");
  }

  return response.json();
}

function rememberConversationId(data) {
  if (data?.conversationId) {
    compassSession.conversationId = data.conversationId;
    saveSession();
  }
}

async function markBenConnection(reason) {
  try {
    const data = await callCompass("connect", { reason });
    rememberConversationId(data);
  } catch (error) {
    console.warn("Compass stewardship connection marker could not be saved.", error);
  }
}

async function startCompass() {
  if (!conversationLog || !conversationForm) return;

  renderMessages();

  if (compassSession.summary) {
    renderSummary(compassSession.summary);
  }

  if (compassSession.messages.length) {
    if (questionLabel) questionLabel.textContent = "Message Compass";
    if (visitorResponse) {
      visitorResponse.placeholder = "Add anything else you would like Compass to understand.";
    }
    if (prepareSummary) prepareSummary.disabled = false;
    return;
  }

  setBusy(true, "Compass is opening the conversation...");
  const loading = addMessage("compass", "Opening the conversation...", { save: false, loading: true });

  try {
    const data = await callCompass("start");
    loading?.remove();
    addMessage("compass", data.reply);
    if (questionLabel) questionLabel.textContent = "Message Compass";
    if (visitorResponse) {
      visitorResponse.placeholder = "Start with what prompted you to reach out today.";
      visitorResponse.focus({ preventScroll: true });
    }
  } catch (error) {
    loading?.remove();
    addMessage(
      "compass",
      "Compass could not connect to the secure backend just now. Please try again in a moment, or use the booking step below to contact Ben directly.",
      { save: false }
    );
    if (conversationStatus) conversationStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function sendVisitorMessage(message) {
  addMessage("visitor", message);
  if (prepareSummary) prepareSummary.disabled = false;
  setBusy(true);
  const loading = addMessage("compass", "Listening carefully...", { save: false, loading: true });

  try {
    const data = await callCompass("chat");
    rememberConversationId(data);
    loading?.remove();
    addMessage("compass", data.reply);
    if (prepareSummary) {
      prepareSummary.hidden = false;
      prepareSummary.disabled = false;
    }
    if (data.stage === "ready_for_summary" && conversationStatus) {
      conversationStatus.textContent = "Compass has enough context to prepare a handover summary when you are ready.";
    }
  } catch (error) {
    loading?.remove();
    addMessage(
      "compass",
      "Compass could not respond from the secure backend just now. Your message is still here in this browser session.",
      { save: false }
    );
    if (conversationStatus) conversationStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function summarySection(title, text) {
  return `
    <article class="summary-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text || "Not provided yet.")}</p>
    </article>
  `;
}

function renderSummary(summary) {
  if (!summaryReview || !managedSummary || !managedSummaryCard) return;

  const themes = Array.isArray(summary.themes) ? summary.themes.map((theme) => `- ${theme}`).join("\n") : "";
  const questions = Array.isArray(summary.questionsForBen)
    ? summary.questionsForBen.map((question) => `- ${question}`).join("\n")
    : "";

  managedSummaryCard.innerHTML = [
    summarySection("What the business owner is carrying", summary.businessOwnerCarrying),
    summarySection("What seems unclear, heavy, or urgent", summary.unclearHeavyOrUrgent),
    summarySection("Themes that emerged", themes),
    summarySection("Questions worth exploring with Ben", questions),
    summarySection("What Ben should understand", summary.whatBenShouldUnderstand),
  ].join("");

  managedSummary.value = summary.summaryText || "";
  summaryReview.hidden = false;
  updateBookingLink();
  summaryReview.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function prepareHandoverSummary() {
  if (compassSession.messages.length < 2) {
    if (conversationStatus) {
      conversationStatus.textContent = "Share a little with Compass first, then prepare the handover summary.";
    }
    return;
  }

  setBusy(true, "Compass is preparing your handover summary...");

  try {
    const data = await callCompass("summary");
    rememberConversationId(data);
    compassSession.summary = data.summary;
    saveSession();
    renderSummary(data.summary);
    if (summaryStatus) {
      summaryStatus.textContent = "Summary prepared. Nothing has been sent.";
    }
  } catch (error) {
    if (conversationStatus) conversationStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function getHandoverDetails() {
  if (!handoverForm) {
    return { name: "", email: "", business: "", phone: "", time: "" };
  }

  return {
    name: formValue(handoverForm, "handover-name"),
    email: formValue(handoverForm, "handover-email"),
    business: formValue(handoverForm, "handover-business"),
    phone: formValue(handoverForm, "handover-phone"),
    includeTranscript: new FormData(handoverForm).get("handover-include-transcript") === "on",
  };
}

function updateBookingLink() {
  if (!bookBen) return;
  bookBen.href = CALENDLY_BOOKING_URL;
  bookBen.target = "_blank";
  bookBen.rel = "noopener noreferrer";
}

async function submitHandover() {
  if (!managedSummary?.value.trim()) {
    if (handoverStatus) handoverStatus.textContent = "Prepare or edit the summary before sending.";
    return;
  }

  if (sendHandover) {
    sendHandover.disabled = true;
    sendHandover.textContent = "Sending...";
  }
  if (handoverStatus) {
    handoverStatus.textContent = "Preparing the handover for Ben. Nothing leaves your browser until this step.";
  }

  try {
    const handoverDetails = getHandoverDetails();
    const response = await fetch(`${API_BASE}/api/handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: compassSession.id,
        contact: handoverDetails,
        summary: compassSession.summary,
        summaryText: managedSummary.value,
        includeTranscript: handoverDetails.includeTranscript,
        messages: compassSession.messages,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Compass could not send the handover just now.");
    }

    const data = await response.json();
    rememberConversationId(data);

    if (data.sent) {
      if (handoverStatus) {
        handoverStatus.textContent =
          "Summary sent to Ben. A copy has been sent to the visitor email if one was provided.";
      }
      return;
    }

    if (data.mailto) {
      window.location.href = data.mailto;
      if (handoverStatus) {
        handoverStatus.textContent = "Your email app has opened the handover so you can review it before sending.";
      }
    }
  } catch (error) {
    if (handoverStatus) handoverStatus.textContent = error.message;
  } finally {
    if (sendHandover) {
      sendHandover.disabled = false;
      sendHandover.textContent = "Send Summary To Ben";
    }
  }
}

if (conversationForm && visitorResponse) {
  conversationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = visitorResponse.value.trim();

    if (!message) {
      if (conversationStatus) conversationStatus.textContent = "A short message is enough before we continue.";
      return;
    }

    visitorResponse.value = "";
    sendVisitorMessage(message);
  });
}

if (restartConversation) {
  restartConversation.addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    compassSession = loadSession();
    if (summaryReview) summaryReview.hidden = true;
    if (handoverPanel) handoverPanel.hidden = true;
    startCompass();
  });
}

if (prepareSummary) {
  prepareSummary.addEventListener("click", prepareHandoverSummary);
}

if (copyManagedSummary && managedSummary) {
  copyManagedSummary.addEventListener("click", async () => {
    managedSummary.select();
    try {
      await navigator.clipboard.writeText(managedSummary.value);
      copyManagedSummary.textContent = "Copied";
      if (summaryStatus) {
        summaryStatus.textContent = "Summary copied. Nothing has been sent.";
      }
      window.setTimeout(() => {
        copyManagedSummary.textContent = "Copy Summary";
      }, 1800);
    } catch {
      document.execCommand("copy");
    }
  });
}

if (continueToHandover && handoverPanel) {
  continueToHandover.addEventListener("click", () => {
    handoverPanel.hidden = false;
    updateBookingLink();
    markBenConnection("continue_to_booking");
    handoverPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (bookBen) {
  bookBen.addEventListener("click", () => {
    markBenConnection("book_with_ben");
  });
}

if (managedSummary) {
  managedSummary.addEventListener("input", () => {
    if (compassSession.summary) {
      compassSession.summary.summaryText = managedSummary.value;
      saveSession();
    }
    updateBookingLink();
  });
}

if (handoverForm) {
  handoverForm.addEventListener("input", updateBookingLink);
}

if (sendHandover) {
  sendHandover.addEventListener("click", submitHandover);
}

if (conversationLog && conversationForm) {
  startCompass();
}
