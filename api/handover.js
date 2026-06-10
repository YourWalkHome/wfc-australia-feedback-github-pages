const { jsonResponse, readJson, safeMessages } = require("../lib/compass-agent");

const TIME_ZONE = "Australia/Brisbane";
const BRAND = {
  ink: "#24312b",
  inkSoft: "#52645b",
  paper: "#fbfaf6",
  surface: "#ffffff",
  mist: "#eef2ec",
  sage: "#415745",
  clay: "#b76f45",
  line: "#d8dfd5",
};
const DEFAULT_SITE_URL = "https://wfc-australia-feedback-github-pages.vercel.app";

function clean(value, limit = 3000) {
  return String(value || "").trim().slice(0, limit);
}

function escapeHtml(value) {
  return clean(value, 16000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function publicAssetUrl(assetPath) {
  const base = clean(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || DEFAULT_SITE_URL, 300).replace(/\/$/, "");
  return `${base}/${assetPath.replace(/^\//, "")}`;
}

function cleanList(values, limit = 8) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => clean(value, 600)).filter(Boolean).slice(0, limit);
}

function formatBullets(values) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- Not provided";
}

function htmlParagraphs(value) {
  const text = clean(value, 16000) || "Not provided";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px;color:${BRAND.inkSoft};line-height:1.6;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlList(values) {
  const items = values.length ? values : ["Not provided"];
  return `
    <ul style="margin:0;padding:0;list-style:none;">
      ${items
        .map(
          (item) => `
            <li style="margin:0 0 10px;padding-left:20px;color:${BRAND.inkSoft};line-height:1.55;">
              <span style="color:${BRAND.clay};font-weight:700;margin-left:-20px;display:inline-block;width:20px;">&bull;</span>${escapeHtml(item)}
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function stripGeneratedSections(summaryText) {
  let text = clean(summaryText, 12000);
  text = text.replace(/^Compass Handover Summary\s*/i, "");
  text = text.replace(/^Compass Reflection Summary\s*/i, "");
  text = text.split(/\nConversation Transcript\b/i)[0];
  text = text.split(/\nCompass Note\b/i)[0];
  return clean(text, 10000);
}

function formatDateParts(date) {
  return {
    date: new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeZone: TIME_ZONE,
    }).format(date),
    time: new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: TIME_ZONE,
    }).format(date),
  };
}

function buildReference(sessionId, date) {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TIME_ZONE,
  })
    .format(date)
    .replaceAll("-", "");
  const shortId = clean(sessionId, 80).replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "SESSION";
  return `WFC-${stamp}-${shortId}`;
}

function transcriptFrom(messages) {
  return safeMessages(messages)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");
}

function buildHandoverData({ sessionId, contact, summary, summaryText, messages, includeTranscript }) {
  const submittedAt = new Date();
  const dateParts = formatDateParts(submittedAt);
  const safeSummary = summary && typeof summary === "object" ? summary : {};
  const details = contact || {};
  const approvedSummary = stripGeneratedSections(summaryText) || stripGeneratedSections(safeSummary.summaryText) || clean(summaryText, 12000);
  const themes = cleanList(safeSummary.themes);
  const questions = cleanList(safeSummary.questionsForBen);
  const contextParts = [
    clean(safeSummary.businessOwnerCarrying, 1200),
    clean(safeSummary.unclearHeavyOrUrgent, 1200),
    clean(safeSummary.whatBenShouldUnderstand, 1200),
  ].filter(Boolean);

  return {
    title: "New Compass Conversation Request",
    reference: buildReference(sessionId, submittedAt),
    date: dateParts.date,
    submissionTime: dateParts.time,
    contact: {
      name: clean(details.name, 200) || "Not provided",
      business: clean(details.business, 200) || "Not provided",
      email: clean(details.email, 200) || "Not provided",
      phone: clean(details.phone, 100) || "Not provided",
    },
    replyTo: clean(details.email, 200),
    approvedSummary: approvedSummary || "Not provided",
    themes,
    questions,
    context: contextParts.length ? contextParts.join("\n\n") : "No additional context was provided beyond the approved summary.",
    includeTranscript: Boolean(includeTranscript),
    transcript: includeTranscript ? transcriptFrom(messages) || "Not provided" : "",
  };
}

function sectionHeading(label) {
  return `
    <h2 style="margin:0 0 12px;color:${BRAND.ink};font-size:20px;line-height:1.2;">${escapeHtml(label)}</h2>
  `;
}

function metaRow(label, value) {
  return `
    <tr>
      <td style="padding:7px 10px 7px 0;color:${BRAND.inkSoft};font-size:13px;font-weight:700;width:150px;">${escapeHtml(label)}</td>
      <td style="padding:7px 0;color:${BRAND.ink};font-size:14px;">${escapeHtml(value)}</td>
    </tr>
  `;
}

function card(content, extraStyle = "") {
  return `
    <tr>
      <td style="padding:0 0 18px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${BRAND.line};border-radius:8px;background:${BRAND.surface};${extraStyle}">
          <tr>
            <td style="padding:22px;">
              ${content}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function buildHtmlEmail(data) {
  const logoUrl = publicAssetUrl("assets/wfc-lantern-mark.png");
  const transcriptSection = data.includeTranscript
    ? card(`${sectionHeading("Full Conversation Transcript")}<div style="white-space:pre-wrap;color:${BRAND.inkSoft};font-size:14px;line-height:1.6;">${escapeHtml(data.transcript)}</div>`)
    : "";

  return `<!doctype html>
<html lang="en-AU">
  <body style="margin:0;padding:0;background:${BRAND.paper};font-family:Inter,Segoe UI,Arial,sans-serif;color:${BRAND.ink};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.paper};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;">
            <tr>
              <td style="padding:22px 24px;background:${BRAND.sage};border-radius:10px 10px 0 0;color:#ffffff;">
                <img src="${escapeHtml(logoUrl)}" width="72" alt="WFC Australia" style="display:block;width:72px;height:72px;border-radius:50%;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);padding:4px;margin:0 0 18px;">
                <p style="margin:0 0 4px;color:#e6b187;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;font-weight:800;">WFC Australia</p>
                <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.15;">${escapeHtml(data.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 24px 8px;background:${BRAND.mist};border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${metaRow("Date", data.date)}
                  ${metaRow("Compass Reference", data.reference)}
                  ${metaRow("Submission Time", data.submissionTime)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;background:${BRAND.paper};border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};border-bottom:1px solid ${BRAND.line};border-radius:0 0 10px 10px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${card(`
                    ${sectionHeading("Contact Details")}
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      ${metaRow("Name", data.contact.name)}
                      ${metaRow("Organisation", data.contact.business)}
                      ${metaRow("Email", data.contact.email)}
                      ${metaRow("Phone", data.contact.phone)}
                    </table>
                  `)}

                  ${card(`
                    <p style="margin:0 0 8px;color:${BRAND.clay};font-size:12px;letter-spacing:0.1em;text-transform:uppercase;font-weight:800;">Compass Summary</p>
                    <div style="border-left:4px solid ${BRAND.clay};padding:4px 0 4px 16px;">
                      ${htmlParagraphs(data.approvedSummary)}
                    </div>
                  `, `background:${BRAND.mist};`)}

                  ${card(`
                    ${sectionHeading("Key Themes")}
                    ${htmlList(data.themes)}
                  `)}

                  ${card(`
                    ${sectionHeading("Questions Worth Exploring")}
                    ${htmlList(data.questions)}
                  `)}

                  ${card(`
                    ${sectionHeading("Conversation Context")}
                    ${htmlParagraphs(data.context)}
                  `)}

                  ${card(`
                    ${sectionHeading("Compass Note")}
                    <p style="margin:0;color:${BRAND.inkSoft};line-height:1.6;">
                      This summary was prepared by Compass to help create a clearer starting point for the conversation.
                      Compass does not diagnose, prescribe solutions, or replace professional judgement.
                    </p>
                  `)}

                  ${transcriptSection}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTextEmail(data) {
  return [
    data.title,
    "",
    `Date: ${data.date}`,
    `Compass Reference: ${data.reference}`,
    `Submission Time: ${data.submissionTime}`,
    "",
    "Contact Details",
    `Name: ${data.contact.name}`,
    `Organisation: ${data.contact.business}`,
    `Email: ${data.contact.email}`,
    `Phone: ${data.contact.phone}`,
    "",
    "Compass Summary",
    data.approvedSummary,
    "",
    "Key Themes",
    formatBullets(data.themes),
    "",
    "Questions Worth Exploring",
    formatBullets(data.questions),
    "",
    "Conversation Context",
    data.context,
    "",
    "Compass Note",
    "This summary was prepared by Compass to help create a clearer starting point for the conversation.",
    "Compass does not diagnose, prescribe solutions, or replace professional judgement.",
    ...(data.includeTranscript
      ? ["", "Full Conversation Transcript", data.transcript || "Not provided"]
      : []),
  ].join("\n");
}

function buildVisitorText(data) {
  return [
    "Thanks for preparing this with Compass.",
    "",
    "A copy has been sent to Ben Ryan so your conversation can begin from a clearer place.",
    "",
    "Compass Summary",
    data.approvedSummary,
    "",
    "No further preparation is required before speaking with Ben.",
  ].join("\n");
}

function buildVisitorHtml(data) {
  return buildHtmlEmail({
    ...data,
    title: "Your Compass Summary",
    includeTranscript: false,
    transcript: "",
  });
}

async function sendWithResend({ to, from, subject, text, html, replyTo }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
      reply_to: replyTo || undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend request failed: ${response.status} ${errorText.slice(0, 400)}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Use POST for Compass handovers." });
    return;
  }

  try {
    const body = await readJson(req);
    const handoverData = buildHandoverData({
      sessionId: body.sessionId,
      contact: body.contact || {},
      summary: body.summary || {},
      summaryText: clean(body.summaryText, 12000),
      includeTranscript: Boolean(body.includeTranscript || body.contact?.includeTranscript),
      messages: Array.isArray(body.messages) ? body.messages : [],
    });
    const emailBody = buildTextEmail(handoverData);
    const htmlBody = buildHtmlEmail(handoverData);
    const subjectSuffix = clean(body.contact?.business || body.contact?.name, 140);
    const subject = `New Compass conversation request${subjectSuffix ? ` - ${subjectSuffix}` : ""}`;
    const benEmail = process.env.BEN_EMAIL || "ben@wfcaust.com.au";
    const fromEmail = process.env.HANDOVER_FROM_EMAIL || process.env.FROM_EMAIL;

    if (process.env.RESEND_API_KEY && fromEmail) {
      await sendWithResend({
        to: benEmail,
        from: fromEmail,
        subject,
        text: emailBody,
        html: htmlBody,
        replyTo: handoverData.replyTo || undefined,
      });

      if (handoverData.replyTo) {
        await sendWithResend({
          to: handoverData.replyTo,
          from: fromEmail,
          subject: "Your Compass summary for Ben Ryan",
          text: buildVisitorText(handoverData),
          html: buildVisitorHtml(handoverData),
        });
      }

      jsonResponse(res, 200, { sent: true });
      return;
    }

    jsonResponse(res, 200, {
      sent: false,
      reason: "Email provider is not configured yet.",
      mailto: `mailto:${benEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`,
    });
  } catch (error) {
    console.error("Compass handover error:", error);
    jsonResponse(res, 500, {
      error: "Compass could not send the handover just now.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
