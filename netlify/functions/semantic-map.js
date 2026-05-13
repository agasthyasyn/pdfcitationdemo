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
  if (mode === "vision_page") return 4500;
  if (mode === "reconstruct_document") return 12000;
  return 7000;
}

function buildPrompt(payload) {
  const mode = payload.mode || "reconstruct_document";
  const fileName = String(payload.fileName || "").trim();

  const page =
    payload.page && typeof payload.page === "object"
      ? payload.page
      : {};

  const sourceContext =
    payload.sourceContext && typeof payload.sourceContext === "object"
      ? payload.sourceContext
      : {};

  const roughSourceImport =
    payload.roughSourceImport && typeof payload.roughSourceImport === "object"
      ? payload.roughSourceImport
      : {};

  const templateStyleProfile =
    payload.templateStyleProfile && typeof payload.templateStyleProfile === "object"
      ? payload.templateStyleProfile
      : {};

  if (mode === "vision_page") {
    const pageNumber = page.pageNumber || null;
    const extractedText = clipText(page.extractedText || "", 5000);

    return `
You are the vision extraction brain for a flexible document formatting tool.

Task:
Read the full page image and the available PDF text extraction. Recover visible text, headings, lists, tables, layout meaning, screenshots, charts, photos, diagrams, and any word-based information that may be missing or corrupted in normal PDF text extraction.

Return valid JSON only. No markdown. No code fences.

Required JSON:
{
  "pageNumber": null,
  "pageRole": "",
  "textBlocks": [
    {
      "type": "heading",
      "text": "",
      "position": "top",
      "importance": "high"
    }
  ],
  "lists": [
    {
      "heading": "",
      "items": [],
      "position": "middle",
      "importance": "medium"
    }
  ],
  "tables": [
    {
      "heading": "",
      "headers": [],
      "rows": [],
      "position": "middle",
      "importance": "high"
    }
  ],
  "visualBlocks": [
    {
      "kind": "photo|chart|map|diagram|screenshot|table_image|other",
      "description": "",
      "caption": "",
      "position": "middle",
      "importance": "medium"
    }
  ],
  "warnings": []
}

Source context:
${JSON.stringify(sourceContext, null, 2)}

Rules:
- Use the image as the primary source when PDF text extraction is broken.
- Use extracted PDF text only as support.
- Do not assume this is a port document.
- Do not use country lists, vessel lists, port lists, or domain-specific assumptions.
- Recover visible headings, labels, values, table rows, list items, contact details, dates, amounts, quantities, restrictions, instructions, and notes when readable.
- Preserve table structure where visible.
- Preserve list structure where visible.
- Identify meaningful photos, charts, screenshots, maps, diagrams, and scanned text areas as visualBlocks.
- If a screenshot contains word-based information, describe the readable information clearly.
- Do not invent hidden text.
- Do not over-read unreadable blurry text.
- If a value is unreadable, add it to warnings, not as a fact.
- Page position must be one of: top, upper, middle, lower, bottom, full_page.
- Keep output compact.

File name:
${fileName}

Page number:
${pageNumber}

PDF extracted text for this page:
${extractedText}
`;
  }

  if (mode === "reconstruct_document") {
    return `
You are the semantic reconstruction brain for a flexible document formatting tool.

You are given:
1. A rough source import created by JavaScript.
2. A template style profile extracted from a sample document.

Important:
- The rough source import is the factual source.
- The template is only a style/reference guide.
- Do not force the source into the exact same fields or sections as the template.
- Do not copy facts from the template.
- Do not invent missing values.
- Do not assume this is a port document.
- Do not use country lists, vessel lists, port lists, or any domain-specific fixed schema.
- Preserve source information strongly, but keep the JSON valid and structured.
- Organize the main document content cleanly. Do not create an oversized malformed JSON response.
- Important details must be represented clearly; any remaining raw details will be checked by the source preservation guard after reconstruction.- Do not compress operational, contact, financial, legal, technical, tabular, visual, or instruction-based information into vague summaries.
- If the source has contact names, phone numbers, email addresses, locations, quantities, dates, rates, declaration fields, remarks, warnings, or conditions, preserve them explicitly.
- If the source contains screenshot-based text visible through vision notes, convert that text into normal document content.
- If the source has more information than the template style can comfortably hold, create additional sections rather than omitting details.
- You may reorganize and clean the source, but you must not reduce the factual coverage.

Return valid JSON only. No markdown. No code fences.

Required JSON:
{
  "title": "",
  "documentProfile": {
    "documentType": "",
    "primaryTitle": "",
    "likelySubject": "",
    "importantEntities": [
      {
        "label": "",
        "value": "",
        "role": "",
        "confidence": 0,
        "evidence": "",
        "sourcePage": null
      }
    ],
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
  "sections": [
    {
      "heading": "",
      "blocks": [
        {
          "type": "text",
          "paragraphs": [],
          "sourcePage": null
        },
        {
          "type": "list",
          "items": [],
          "sourcePage": null
        },
        {
          "type": "table",
          "headers": [],
          "rows": [],
          "sourcePage": null
        },
        {
          "type": "image",
          "imageAssetId": "",
          "sourcePage": null,
          "caption": ""
        }
      ]
    }
  ],
  "coverageAudit": {
    "possibleOmissions": [],
    "sourceCoverageMode": "flexible_rough_import_reconstruction"
  },
  "warnings": []
}

Template style profile:
${JSON.stringify(templateStyleProfile, null, 2)}

Rough source import:
${JSON.stringify(roughSourceImport, null, 2)}

File name:
${fileName}
`;
  }

  throw new Error(`Unsupported prompt mode: ${mode}`);
}

function buildOpenAIInput(payload, prompt) {
  const mode = payload.mode || "reconstruct_document";

  if (mode === "vision_page") {
    const imageDataUrl = payload?.page?.imageDataUrl || "";

    return [
      {
        role: "system",
        content:
          "You are a controlled JSON document-brain service. Return valid JSON only. Do not return markdown or code fences."
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          {
            type: "input_image",
            image_url: imageDataUrl
          }
        ]
      }
    ];
  }

  return [
    {
      role: "system",
      content:
        "You are a controlled JSON document-brain service. Return valid JSON only. Do not return markdown or code fences."
    },
    {
      role: "user",
      content: prompt
    }
  ];
}

function getStructuredTextFormat(mode) {
  if (mode === "vision_page") {
    return {
      format: {
        type: "json_schema",
        name: "vision_page_result",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: true
        }
      }
    };
  }

  if (mode === "reconstruct_document") {
    return {
      format: {
        type: "json_schema",
        name: "reconstruct_document_result",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: true
        }
      }
    };
  }

  return {
    format: {
      type: "json_schema",
      name: "generic_json_result",
      strict: false,
      schema: {
        type: "object",
        additionalProperties: true
      }
    }
  };
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
      modes: ["vision_page", "reconstruct_document"]
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
    const mode = payload.mode || "reconstruct_document";

    if (!["vision_page", "reconstruct_document"].includes(mode)) {
      return jsonResponse(400, headers, {
        ok: false,
        error: `Unsupported semantic-map mode: ${mode}`
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
  text: getStructuredTextFormat(mode),
  input: buildOpenAIInput(payload, prompt)
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
