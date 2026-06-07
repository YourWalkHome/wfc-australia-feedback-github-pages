const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const conversationForm = document.querySelector("#conversation-form");
const formStatus = document.querySelector("#form-status");

if (conversationForm && formStatus) {
  conversationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    formStatus.textContent =
      "Thanks. This local preview is ready to connect to WFC Australia's preferred inbox or booking flow.";
  });
}

const compassForm = document.querySelector("#compass-form");
const reflectionOutput = document.querySelector("#reflection-output");
const summaryCard = document.querySelector("#summary-card");
const summaryCopy = document.querySelector("#summary-copy");
const copySummary = document.querySelector("#copy-summary");
const emailSummary = document.querySelector("#email-summary");

function formValue(form, name) {
  return new FormData(form).get(name)?.toString().trim() || "";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function summarySection(title, text) {
  return `
    <article class="summary-section">
      <h3>${title}</h3>
      <p>${escapeHtml(text || "Not provided yet.")}</p>
    </article>
  `;
}

if (compassForm && reflectionOutput && summaryCard && summaryCopy && emailSummary) {
  compassForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const details = {
      name: formValue(compassForm, "name"),
      email: formValue(compassForm, "email"),
      business: formValue(compassForm, "business"),
      focus: formValue(compassForm, "focus"),
      challenge: formValue(compassForm, "challenge"),
      success: formValue(compassForm, "success"),
      understand: formValue(compassForm, "understand"),
    };

    const plainSummary = [
      "Compass Reflection Summary",
      "",
      `Name: ${details.name || "Not provided"}`,
      `Email: ${details.email || "Not provided"}`,
      `Business or organisation: ${details.business || "Not provided"}`,
      "",
      "Current Focus Areas",
      details.focus || "Not provided yet.",
      "",
      "Key Pressures",
      details.challenge || "Not provided yet.",
      "",
      "Desired Outcomes",
      details.success || "Not provided yet.",
      "",
      "Additional Notes For Ben",
      details.understand || "Not provided yet.",
      "",
      "Note: This summary is a preparation reflection, not advice, analysis, or diagnosis.",
    ].join("\n");

    summaryCard.innerHTML = [
      summarySection("Current Focus Areas", details.focus),
      summarySection("Key Pressures", details.challenge),
      summarySection("Desired Outcomes", details.success),
      summarySection("Additional Notes For Ben", details.understand),
    ].join("");

    summaryCopy.value = plainSummary;
    emailSummary.href = `mailto:ben@wfcaust.com.au?subject=${encodeURIComponent(
      `Compass reflection${details.business ? ` - ${details.business}` : ""}`
    )}&body=${encodeURIComponent(plainSummary)}`;

    reflectionOutput.hidden = false;
    reflectionOutput.scrollIntoView({ behavior: "smooth", block: "start" });

    if (formStatus) {
      formStatus.textContent =
        "Compass has prepared a reflection summary from your own words. Nothing has been sent yet.";
    }
  });

  compassForm.addEventListener("reset", () => {
    if (reflectionOutput) reflectionOutput.hidden = true;
    if (formStatus) formStatus.textContent = "";
  });
}

if (copySummary && summaryCopy) {
  copySummary.addEventListener("click", async () => {
    summaryCopy.select();
    try {
      await navigator.clipboard.writeText(summaryCopy.value);
      copySummary.textContent = "Copied";
      window.setTimeout(() => {
        copySummary.textContent = "Copy Summary";
      }, 1800);
    } catch {
      document.execCommand("copy");
    }
  });
}
