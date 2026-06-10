const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const COMPASS_SYSTEM_PROMPT = `
You are Compass, the WFC Australia agent.

Compass is WFC Australia's AI conversation guide, helping prepare a better conversation with Ben Ryan.
Compass helps business owners organise thoughts, feel heard, notice practical themes, and prepare a handover summary before speaking with Ben.

Compass is not a consultant, advisor, diagnostician, therapist, legal adviser, financial adviser, or turnaround authority.
Compass must not prescribe solutions, diagnose causes, make decisions, promise outcomes, or tell the visitor what they should do.

Compass may:
- ask calm, thoughtful follow-up questions
- reflect what it is hearing
- notice themes carefully
- help the visitor prepare for a better conversation with Ben
- generate a structured handover summary

Compass must:
- use plain Australian English
- be calm, respectful, practical, commercially grounded, and people-aware
- protect visitor agency
- make clear that Ben personally leads the direct conversation
- keep responses concise
- avoid hype, sales pressure, AI hype, consulting jargon, and certainty
- use language like "It sounds like...", "I am hearing...", and "This may be worth exploring with Ben..."
- avoid language like "The problem is...", "You should...", "The solution is...", and "I recommend..."

If the visitor asks for advice, diagnosis, legal advice, financial advice, insolvency advice, or a decision, gently redirect to preparation for Ben and say Compass can help organise the context for the conversation.
`;

const CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "stage"],
  properties: {
    reply: {
      type: "string",
      description: "Compass reply shown to the visitor.",
    },
    stage: {
      type: "string",
      enum: ["continue", "ready_for_summary"],
      description: "Whether the conversation should continue or can move to summary.",
    },
  },
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "businessOwnerCarrying",
    "unclearHeavyOrUrgent",
    "themes",
    "questionsForBen",
    "whatBenShouldUnderstand",
    "originalResponses",
    "summaryText",
  ],
  properties: {
    businessOwnerCarrying: { type: "string" },
    unclearHeavyOrUrgent: { type: "string" },
    themes: {
      type: "array",
      items: { type: "string" },
    },
    questionsForBen: {
      type: "array",
      items: { type: "string" },
    },
    whatBenShouldUnderstand: { type: "string" },
    originalResponses: { type: "string" },
    summaryText: { type: "string" },
  },
};

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 160000) {
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function safeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "compass" ? "Compass" : "Visitor",
      content: message.content.slice(0, 3000),
    }))
    .slice(-30);
}

function transcriptFrom(messages) {
  const safe = safeMessages(messages);
  if (!safe.length) return "No visitor responses yet.";
  return safe.map((message) => `${message.role}: ${message.content}`).join("\n\n");
}

function latestVisitorMessage(messages) {
  return [...safeMessages(messages)].reverse().find((message) => message.role === "Visitor")?.content || "";
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;

  const pieces = [];
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }

  return pieces.join("\n").trim();
}

function parseModelJson(text) {
  if (!text) throw new Error("The model returned an empty response.");

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

async function callOpenAI({ prompt, schemaName, schema, maxOutputTokens = 800 }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: COMPASS_SYSTEM_PROMPT,
      input: prompt,
      max_output_tokens: maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText.slice(0, 400)}`);
  }

  return parseModelJson(extractOutputText(await response.json()));
}

function fallbackChat(messages, action) {
  if (action === "start") {
    return {
      reply:
        "Hello, I am Compass.\n\nBefore your conversation with Ben, I can help you organise what is happening and create a clearer starting point.\n\nYou do not need a perfect brief. What prompted you to reach out today?",
      stage: "continue",
      offline: true,
    };
  }

  const count = safeMessages(messages).filter((message) => message.role === "Visitor").length;
  const prompts = [
    "Thank you. I am hearing there is something worth slowing down around. What feels most important or challenging right now?",
    "That helps name where the pressure is sitting. How is this affecting you, your team, or the business?",
    "That context will help Ben understand what this is carrying. If things improved over the next few months, what would you hope to see?",
    "That gives the conversation a useful direction. What would you like Ben to understand before your conversation?",
    "Thank you. That is enough to prepare a first handover summary. You can choose Prepare Handover Summary when you are ready.",
  ];

  return {
    reply: prompts[Math.min(Math.max(count - 1, 0), prompts.length - 1)],
    stage: count >= 5 ? "ready_for_summary" : "continue",
    offline: true,
  };
}

function fallbackSummary(messages) {
  const transcript = transcriptFrom(messages);
  const visitorLines = safeMessages(messages)
    .filter((message) => message.role === "Visitor")
    .map((message) => message.content);

  const summaryText = [
    "Compass Handover Summary",
    "",
    "Compass Reflection Summary",
    "",
    "What the owner is carrying",
    visitorLines[0] || "Not provided yet.",
    "",
    "Key themes",
    "- Clarifying what matters most",
    "- Preparing for a calm and useful conversation",
    "- Understanding the practical next step",
    "",
    "Important context",
    visitorLines[1] || "Not provided yet.",
    "",
    "Questions worth exploring with Ben",
    "- What needs to be understood before any action is considered?",
    "- What feels most important to address first, and what can wait?",
    "- What would make the next step practical, responsible, and respectful of the people involved?",
    "",
    "Anything the business owner wants Ben to understand",
    visitorLines[4] || visitorLines[visitorLines.length - 1] || "Not provided yet.",
    "",
    "Compass Note",
    "This summary is preparation only.",
    "It is not advice, diagnosis, analysis, or a recommendation.",
    "It is intended to help Ben Ryan begin the conversation from a clearer starting point.",
  ].join("\n");

  return {
    businessOwnerCarrying: visitorLines[0] || "Not provided yet.",
    unclearHeavyOrUrgent: visitorLines[1] || "Not provided yet.",
    themes: [
      "Clarifying what matters most",
      "Preparing for a calm and useful conversation",
      "Understanding the practical next step",
    ],
    questionsForBen: [
      "What needs to be understood before any action is considered?",
      "What feels most important to address first, and what can wait?",
      "What would make the next step practical, responsible, and respectful of the people involved?",
    ],
    whatBenShouldUnderstand: visitorLines[4] || visitorLines[visitorLines.length - 1] || "Not provided yet.",
    originalResponses: transcript,
    summaryText,
    offline: true,
  };
}

async function createCompassReply({ action, messages }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackChat(messages, action);
  }

  const transcript = transcriptFrom(messages);
  const latest = latestVisitorMessage(messages);

  const prompt =
    action === "start"
      ? `
Start the Compass experience.

Return a warm opening and one gentle first question. Include these boundaries naturally:
- this prepares a conversation with Ben Ryan
- it is not advice or diagnosis
- the visitor controls what is shared

Do not ask for contact details yet.
`
      : `
Continue this Compass conversation.

Conversation so far:
${transcript}

Latest visitor message:
${latest}

Reply as Compass. Acknowledge what the visitor shared, then ask one thoughtful follow-up question if more context would help.
If there is enough context for a useful handover summary, say so gently and set stage to "ready_for_summary".
Keep the reply short and calm. Do not diagnose, prescribe, or make decisions.
`;

  return callOpenAI({
    prompt,
    schemaName: "compass_chat_response",
    schema: CHAT_SCHEMA,
    maxOutputTokens: 500,
  });
}

async function createCompassSummary({ messages }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackSummary(messages);
  }

  return callOpenAI({
    prompt: `
Generate a Compass handover summary for Ben Ryan from this conversation.

Conversation:
${transcriptFrom(messages)}

The summary must prepare a better conversation with Ben Ryan. It must not diagnose causes, prescribe solutions, make decisions, or overstate certainty.
Use careful language such as "It sounds like..." and "This may be worth exploring with Ben...".
The summaryText field should use this readable structure:
Compass Handover Summary
Compass Reflection Summary
What the owner is carrying
Key themes
Important context
Questions worth exploring with Ben
Anything the business owner wants Ben to understand
Compass Note

Do not include the full conversation transcript in summaryText. The visitor can choose separately whether to include the transcript in the handover email.

Return concise, useful, plain-language JSON only.
`,
    schemaName: "compass_handover_summary",
    schema: SUMMARY_SCHEMA,
    maxOutputTokens: 1200,
  });
}

module.exports = {
  createCompassReply,
  createCompassSummary,
  jsonResponse,
  readJson,
  safeMessages,
};
