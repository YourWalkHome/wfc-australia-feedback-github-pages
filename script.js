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
const summaryReview = document.querySelector("#summary-review");
const managedSummaryCard = document.querySelector("#managed-summary-card");
const managedSummary = document.querySelector("#managed-summary");
const copyManagedSummary = document.querySelector("#copy-managed-summary");
const continueToHandover = document.querySelector("#continue-to-handover");
const summaryStatus = document.querySelector("#summary-status");
const handoverPanel = document.querySelector("#handover-panel");
const handoverForm = document.querySelector("#handover-form");
const emailHandover = document.querySelector("#email-handover");
const bookBen = document.querySelector("#book-ben");

const compassSteps = [
  {
    key: "prompted",
    question: "What prompted you to reach out today?",
    placeholder: "A few plain-language sentences is enough.",
    acknowledgement:
      "Thank you. I am hearing there is something worth slowing down around before you speak with Ben.",
  },
  {
    key: "challenge",
    question: "What feels most important or challenging right now?",
    placeholder: "This might be a decision, pressure point, uncertainty, team issue, system problem, or something else.",
    acknowledgement:
      "That helps name where the pressure is sitting.",
  },
  {
    key: "impact",
    question: "How is this affecting you, your team, or the business?",
    placeholder: "You can include practical impacts, people impacts, financial pressure, decision fatigue, or anything else that matters.",
    acknowledgement:
      "That context will help Ben understand what this is carrying in real terms.",
  },
  {
    key: "success",
    question: "If things improved over the next few months, what would you hope to see?",
    placeholder: "Think in practical terms: decisions made, pressure reduced, roles clearer, systems improved, or a better way forward.",
    acknowledgement:
      "That gives the conversation a useful direction without forcing an answer too early.",
  },
  {
    key: "understand",
    question: "What would you like Ben to understand before your conversation?",
    placeholder: "This can be context, a concern, something sensitive, or simply what you want handled carefully.",
    acknowledgement:
      "Thank you. I will turn this into a clear handover summary for you to review before anything is shared.",
  },
];

let currentStep = 0;
let compassResponses = {};

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

function addMessage(role, text) {
  if (!conversationLog) return;

  const message = document.createElement("article");
  message.className = `message ${role}`;
  const speaker = role === "visitor" ? "You" : "Compass";
  const body = escapeHtml(text)
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
}

function askCurrentQuestion() {
  if (!visitorResponse || !questionLabel || !conversationStatus) return;

  const step = compassSteps[currentStep];
  if (!step) return;

  addMessage("compass", step.question);
  questionLabel.textContent = `Your response to: ${step.question}`;
  visitorResponse.value = "";
  visitorResponse.placeholder = step.placeholder;
  conversationStatus.textContent = `Question ${currentStep + 1} of ${compassSteps.length}.`;
  visitorResponse.focus({ preventScroll: true });
}

function startCompassConversation() {
  currentStep = 0;
  compassResponses = {};

  if (conversationLog) conversationLog.innerHTML = "";
  if (summaryReview) summaryReview.hidden = true;
  if (handoverPanel) handoverPanel.hidden = true;
  if (conversationForm) conversationForm.hidden = false;

  addMessage(
    "compass",
    "Hello, I am Compass.\n\nBefore your conversation with Ben, I will help you organise what is happening and create a clear starting point.\n\nYou do not need to have every answer. We will simply begin with where things are right now."
  );
  addMessage(
    "compass",
    "This is not advice or diagnosis. Ben Ryan will personally review the summary before your conversation, and you control what is shared."
  );
  askCurrentQuestion();
}

function summarySection(title, text) {
  return `
    <article class="summary-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text || "Not provided yet.")}</p>
    </article>
  `;
}

function detectThemes(responses) {
  const combined = Object.values(responses).join(" ").toLowerCase();
  const rules = [
    {
      label: "Competing priorities and decision pressure",
      terms: ["decision", "priority", "priorities", "urgent", "pressure", "overwhelmed", "stuck"],
    },
    {
      label: "People, team, or leadership impacts",
      terms: ["team", "staff", "people", "culture", "leadership", "owner", "family"],
    },
    {
      label: "Systems, process, or operational friction",
      terms: ["system", "process", "operation", "workflow", "admin", "accountability", "role"],
    },
    {
      label: "Financial, cash flow, or sustainability concerns",
      terms: ["cash", "finance", "financial", "cost", "margin", "debt", "profit"],
    },
    {
      label: "Change, AI, or future readiness",
      terms: ["change", "ai", "automation", "technology", "future", "tool", "digital"],
    },
  ];

  const themes = rules
    .filter((rule) => rule.terms.some((term) => combined.includes(term)))
    .map((rule) => rule.label);

  if (themes.length === 0) {
    themes.push(
      "Clarifying what matters most",
      "Understanding the practical next step",
      "Preparing for a calm and useful conversation"
    );
  }

  return themes.slice(0, 4);
}

function buildQuestionsForBen(responses) {
  const questions = [
    "What needs to be understood before any action is considered?",
    "What feels most important to address first, and what can wait?",
    "What would make the next step practical, responsible, and respectful of the people involved?",
  ];

  if (responses.success) {
    questions.push("What would help move the business closer to the improvement the owner described?");
  }

  return questions;
}

function buildPlainSummary(responses) {
  const themes = detectThemes(responses);
  const questions = buildQuestionsForBen(responses);

  return [
    "Compass Handover Summary",
    "",
    "Prepared for conversation with Ben Ryan",
    "",
    "What the business owner is carrying",
    "It sounds like this is what prompted the reach-out:",
    responses.prompted || "Not provided yet.",
    "",
    "What seems unclear, heavy, or urgent",
    "I am hearing this as an important pressure point:",
    responses.challenge || "Not provided yet.",
    "",
    "How it is affecting the owner, team, or business",
    responses.impact || "Not provided yet.",
    "",
    "Desired direction over the next few months",
    responses.success || "Not provided yet.",
    "",
    "Themes that emerged",
    ...themes.map((theme) => `- ${theme}`),
    "",
    "Questions worth exploring with Ben",
    ...questions.map((question) => `- ${question}`),
    "",
    "Anything the business owner wants Ben to understand",
    responses.understand || "Not provided yet.",
    "",
    "Original responses",
    `1. What prompted you to reach out today?\n${responses.prompted || "Not provided yet."}`,
    "",
    `2. What feels most important or challenging right now?\n${responses.challenge || "Not provided yet."}`,
    "",
    `3. How is this affecting you, your team, or the business?\n${responses.impact || "Not provided yet."}`,
    "",
    `4. If things improved over the next few months, what would you hope to see?\n${responses.success || "Not provided yet."}`,
    "",
    `5. What would you like Ben to understand before your conversation?\n${responses.understand || "Not provided yet."}`,
    "",
    "Note: This summary is preparation only. It is not advice, diagnosis, analysis, or a decision.",
  ].join("\n");
}

function createSummary() {
  if (!managedSummaryCard || !managedSummary || !summaryReview || !conversationForm) return;

  const themes = detectThemes(compassResponses).map((theme) => `- ${theme}`).join("\n");
  const questions = buildQuestionsForBen(compassResponses).map((question) => `- ${question}`).join("\n");

  managedSummaryCard.innerHTML = [
    summarySection(
      "What the business owner is carrying",
      `It sounds like this is what prompted the reach-out:\n${compassResponses.prompted || "Not provided yet."}`
    ),
    summarySection(
      "What seems unclear, heavy, or urgent",
      `I am hearing this as an important pressure point:\n${compassResponses.challenge || "Not provided yet."}`
    ),
    summarySection("Themes that emerged", themes),
    summarySection("Questions worth exploring with Ben", questions),
    summarySection("What Ben should understand", compassResponses.understand),
  ].join("");

  managedSummary.value = buildPlainSummary(compassResponses);
  conversationForm.hidden = true;
  summaryReview.hidden = false;
  updateMailLinks();
  summaryReview.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getHandoverDetails() {
  if (!handoverForm) {
    return {
      name: "",
      email: "",
      business: "",
      phone: "",
      time: "",
    };
  }

  return {
    name: formValue(handoverForm, "handover-name"),
    email: formValue(handoverForm, "handover-email"),
    business: formValue(handoverForm, "handover-business"),
    phone: formValue(handoverForm, "handover-phone"),
    time: formValue(handoverForm, "handover-time"),
  };
}

function buildEmailBody() {
  const details = getHandoverDetails();
  const detailLines = [
    "Conversation Details",
    "",
    `Name: ${details.name || "Not provided"}`,
    `Email: ${details.email || "Not provided"}`,
    `Business or organisation: ${details.business || "Not provided"}`,
    `Preferred contact number: ${details.phone || "Not provided"}`,
    `Preferred conversation timing: ${details.time || "Not provided"}`,
    "",
  ].join("\n");

  return `${detailLines}${managedSummary?.value || ""}`;
}

function updateMailLinks() {
  if (!emailHandover || !bookBen) return;

  const details = getHandoverDetails();
  const subjectSuffix = details.business || details.name ? ` - ${details.business || details.name}` : "";
  const body = buildEmailBody();

  emailHandover.href = `mailto:ben@wfcaust.com.au?subject=${encodeURIComponent(
    `Compass handover${subjectSuffix}`
  )}&body=${encodeURIComponent(body)}`;

  bookBen.href = `mailto:ben@wfcaust.com.au?subject=${encodeURIComponent(
    `Book a conversation with Ben Ryan${subjectSuffix}`
  )}&body=${encodeURIComponent(body)}`;
}

if (conversationForm && visitorResponse) {
  conversationForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const step = compassSteps[currentStep];
    const response = visitorResponse.value.trim();

    if (!step || !response) {
      if (conversationStatus) {
        conversationStatus.textContent = "A short response is enough before we continue.";
      }
      return;
    }

    compassResponses[step.key] = response;
    addMessage("visitor", response);
    addMessage("compass", step.acknowledgement);

    currentStep += 1;

    if (currentStep < compassSteps.length) {
      window.setTimeout(askCurrentQuestion, 350);
    } else {
      if (conversationStatus) {
        conversationStatus.textContent = "Compass is preparing your handover summary.";
      }
      window.setTimeout(createSummary, 450);
    }
  });
}

if (restartConversation) {
  restartConversation.addEventListener("click", startCompassConversation);
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
    updateMailLinks();
    handoverPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (managedSummary) {
  managedSummary.addEventListener("input", updateMailLinks);
}

if (handoverForm) {
  handoverForm.addEventListener("input", updateMailLinks);
}

if (conversationLog && conversationForm) {
  startCompassConversation();
}
