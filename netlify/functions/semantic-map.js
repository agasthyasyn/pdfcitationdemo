function extractOpenAIText(data) {
  if (!data) return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const chunks = [];

    for (const item of data.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") chunks.push(content.text);
          if (typeof content?.content === "string") chunks.push(content.content);
          if (typeof content?.value === "string") chunks.push(content.value);
        }
      }

      if (typeof item?.text === "string") {
        chunks.push(item.text);
      }
    }

    return chunks.join("\n").trim();
  }

  return "";
}

function jsonResponse(statusCode, headers, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

function clipText(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function getTemplatePayload(template) {
  const safeTemplate = template && typeof template === "object" ? template : {};

  const headerFields = Array.isArray(safeTemplate.headerFields)
    ? safeTemplate.headerFields
        .filter((field) => field && field.key && field.label)
        .map((field) => ({
          key: String(field.key || "").trim(),
          label: String(field.label || "").trim()
        }))
    : [];

  const sections = Array.isArray(safeTemplate.sections)
    ? safeTemplate.sections
        .filter((section) => section && section.heading)
        .map((section) => ({
          id: String(section.id || "").trim(),
          heading: String(section.heading || "").trim(),
          order: Number(section.order || 0)
        }))
    : [];

  return {
    title: String(safeTemplate.title || "").trim(),
    headerFields,
    sections
  };
}

function buildPagesText(pages) {
  if (!Array.isArray(pages)) return "";

  return pages
    .map((page) => {
      const pageNumber = page?.pageNumber || "";
      const text = clipText(page?.text || "", 4500);
      return `PAGE ${pageNumber}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function getMaxOutputTokens(mode) {
  if (mode === "identity_summary") return 2500;
  if (mode === "coverage_chunk") return 3500;
  if (mode === "final_format") return 6000;
  return 4000;
}

function buildPrompt(payload) {
  const mode = payload.mode || "final_format";
  const fileName = String(payload.fileName || "").trim();
  const template = getTemplatePayload(payload.template);
  const sourceIdentity = payload.sourceIdentity || {};
  const summaryRows = Array.isArray(payload.summaryRows) ? payload.summaryRows : [];
  const coverageItems = Array.isArray(payload.coverageItems) ? payload.coverageItems : [];

  if (mode === "identity_summary") {
    const firstPagesText = clipText(payload.firstPagesText || payload.sourceText || "", 16000);

    return `
You are the first brain of a document formatting tool.

Task:
Identify the source document and fill only the summary/header fields from the source.

Return valid JSON only. No markdown. No code fences.

Required JSON:
{
  "title": "",
  "sourceIdentity": {
    "documentType": "",
    "primarySubject": "",
    "vesselName": "",
    "portName": "",
    "country": "",
    "dateOrPeriod": "",
    "confidence": 0
  },
  "summaryRows": [
    {
      "key": "",
      "label": "",
      "value": "",
      "confidence": 0,
      "evidence": "",
      "sourcePage": null
    }
  ],
  "warnings": []
}

Template title:
${template.title}

Template header fields:
${JSON.stringify(template.headerFields, null, 2)}

Rules:
- The source document is the factual authority.
- The template fields are targets for allocation, not facts.
- Return exactly one summaryRows item for every template header field.
- Use exact key and exact label from the template field.
- Map by meaning, not only keyword matching.
- Do not place body sentences, warnings, phone fragments, unrelated numbers, or operational paragraphs into summary fields.
- If a field is genuinely missing, use "Not Available".
- Evidence must come from the supplied source text.
- Keep this response compact.

File name:
${fileName}

Source text:
${firstPagesText}
`;
  }

  if (mode === "coverage_chunk") {
    const pagesText = buildPagesText(payload.pages);
    const chunkId = String(payload.chunkId || "").trim();

    return `
You are the second brain of a document formatting tool.

Task:
Read this source chunk and extract reader-critical details that must not be lost during formatting.

Return valid JSON only. No markdown. No code fences.

Required JSON:
{
  "chunkId": "",
  "pageNumbers": [],
  "coverageItems": [
    {
      "theme": "",
      "detail": "",
      "importance": "high",
      "sourcePage": null,
      "evidence": ""
    }
  ],
  "warnings": []
}

Source identity:
${JSON.stringify(sourceIdentity, null, 2)}

Rules:
- Extract operationally important details, not decorative text.
- Preserve instructions, warnings, restrictions, dates, contacts, limits, rates, quantities, operational steps, exceptions, services, responsibilities, safety/security notes, and compliance notes.
- Keep each coverage item as one clear detail.
- Do not rewrite into long paragraphs.
- Do not invent missing details.
- If a table is present but broken, extract the important facts visible in the text.
- If the chunk has visual/chart/photo context mentioned in text, capture the useful context as a coverage item.
- Maximum 25 coverageItems for this chunk.
- Avoid duplicates inside this chunk.

File name:
${fileName}

Chunk ID:
${chunkId}

Source chunk:
${pagesText}
`;
  }

  const limitedCoverageItems = coverageItems.slice(0, 120);

  return `
You are the final formatting brain for a document formatting tool.

Task:
Create a clean, clear, professional document model using:
1. the template as a reader-friendly reference,
2. the source identity and summary rows as factual anchors,
3. the coverage items as mandatory details that must not be lost.

Return valid JSON only. No markdown. No code fences.

Required JSON:
{
  "title": "",
  "summaryRows": [
    {
      "key": "",
      "label": "",
      "value": "",
      "confidence": 0,
      "evidence": "",
      "sourcePage": null
    }
  ],
  "sections": [
    {
      "heading": "",
      "blocks": [
        {
          "type": "text",
          "paragraphs": [],
          "content": "",
          "sourcePage": null
        }
      ]
    }
  ],
  "coverageAudit": {
    "sourceCoverageMode": "coverage_first",
    "importantSourceThemesCovered": [],
    "additionalOperationalNotes": [],
    "unmappedImportantDetails": [],
    "possibleOmissions": [],
    "coverageConfidence": 0
  },
  "warnings": []
}

Template title:
${template.title}

Template header fields:
${JSON.stringify(template.headerFields, null, 2)}

Template sections:
${JSON.stringify(template.sections, null, 2)}

Source identity:
${JSON.stringify(sourceIdentity, null, 2)}

Pre-extracted summary rows:
${JSON.stringify(summaryRows, null, 2)}

Mandatory coverage items:
${JSON.stringify(limitedCoverageItems, null, 2)}

Rules:
- The template is only a reference for structure and readability.
- The source identity, summary rows, and coverage items are the factual authority.
- Do not copy sample/template-specific facts unless they are present in the source identity or coverage items.
- Return exactly one summaryRows item for every template header field.
- Prefer the pre-extracted summaryRows when they are valid.
- Build clean body sections from the mandatory coverage items.
- Do not drop high-importance coverage items.
- If a coverage item does not fit neatly into the main sections, preserve it under coverageAudit.additionalOperationalNotes.
- Use paragraph arrays for every text block.
- Each paragraph must be readable, complete, and focused.
- Do not create one long wall of text.
- Do not over-compress operational restrictions or instructions.
- Avoid exact duplication.
- Maximum 10 sections.
- Maximum 5 paragraphs per section.
- Keep the final model useful, not bloated.

File name:
${fileName}
`;
}

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, headers, { ok: true });
  }

  if (event.httpMethod === "GET") {
    return jsonResponse(200, headers, {
      ok: true,
      message: "semantic-map function is live",
      checkedAt: new Date().toISOString(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      modes: ["identity_summary", "coverage_chunk", "final_format"]
    });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, headers, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return jsonResponse(500, headers, {
        ok: false,
        error: "OPENAI_API_KEY is missing in Netlify environment variables."
      });
    }

    const payload = JSON.parse(event.body || "{}");
    const mode = payload.mode || "final_format";
    const template = getTemplatePayload(payload.template);

    if (!["identity_summary", "coverage_chunk", "final_format"].includes(mode)) {
      return jsonResponse(400, headers, {
        ok: false,
        error: `Unsupported semantic-map mode: ${mode}`
      });
    }

    if ((mode === "identity_summary" || mode === "final_format") && !template.headerFields.length) {
      return jsonResponse(400, headers, {
        ok: false,
        error: "template.headerFields is required."
      });
    }

    const prompt = buildPrompt(payload);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        store: false,
        max_output_tokens: getMaxOutputTokens(mode),
        input: [
          {
            role: "system",
            content:
              "You are a controlled JSON document-brain service. Return valid JSON only. Do not return markdown or code fences."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return jsonResponse(response.status, headers, {
        ok: false,
        mode,
        error: data
      });
    }

    const outputText = extractOpenAIText(data);
    const parsedJson = parseJsonObject(outputText);

    if (!parsedJson || typeof parsedJson !== "object") {
      return jsonResponse(502, headers, {
        ok: false,
        mode,
        error: "OpenAI returned output that could not be parsed as JSON.",
        outputPreview: outputText.slice(0, 1000)
      });
    }

    return jsonResponse(200, headers, {
      ok: true,
      mode,
      parsedJson,
      outputText
    });
  } catch (error) {
    return jsonResponse(500, headers, {
      ok: false,
      error: error.message
    });
  }
};
