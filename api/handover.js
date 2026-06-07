const { jsonResponse, readJson, safeMessages } = require("../lib/compass-agent");

function clean(value, limit = 3000) {
  return String(value || "").trim().slice(0, limit);
}

function buildEmailBody({ contact, summaryText, messages }) {
  const details = contact || {};
  const transcript = safeMessages(messages)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  return [
    "Compass Handover",
    "",
    "Contact details",
    `Name: ${clean(details.name, 200) || "Not provided"}`,
    `Email: ${clean(details.email, 200) || "Not provided"}`,
    `Business or organisation: ${clean(details.business, 200) || "Not provided"}`,
    `Preferred contact number: ${clean(details.phone, 100) || "Not provided"}`,
    `Preferred conversation timing: ${clean(details.time, 200) || "Not provided"}`,
    "",
    "Editable Compass summary",
    clean(summaryText, 12000) || "Not provided",
    "",
    "Conversation transcript",
    transcript || "Not provided",
    "",
    "Note: This summary is preparation only. It is not advice, diagnosis, analysis, or a decision.",
  ].join("\n");
}

async function sendWithResend({ to, from, subject, body, replyTo }) {
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
      text: body,
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
    const contact = body.contact || {};
    const summaryText = clean(body.summaryText, 12000);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const emailBody = buildEmailBody({ contact, summaryText, messages });
    const subjectSuffix = clean(contact.business || contact.name, 140);
    const subject = `Compass handover${subjectSuffix ? ` - ${subjectSuffix}` : ""}`;
    const benEmail = process.env.BEN_EMAIL || "ben@wfcaust.com.au";

    if (process.env.RESEND_API_KEY && process.env.HANDOVER_FROM_EMAIL) {
      await sendWithResend({
        to: benEmail,
        from: process.env.HANDOVER_FROM_EMAIL,
        subject,
        body: emailBody,
        replyTo: clean(contact.email, 200) || undefined,
      });

      if (clean(contact.email, 200)) {
        await sendWithResend({
          to: clean(contact.email, 200),
          from: process.env.HANDOVER_FROM_EMAIL,
          subject: "Your Compass summary for Ben Ryan",
          body: [
            "Thanks for preparing this with Compass.",
            "",
            "A copy has been sent to Ben Ryan so your conversation can begin from a clearer place.",
            "",
            summaryText,
            "",
            "No further preparation is required before speaking with Ben.",
          ].join("\n"),
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
    jsonResponse(res, 500, {
      error: "Compass could not send the handover just now.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
};
