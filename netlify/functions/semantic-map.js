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
          if (typeof content?.text === "string") {
            chunks.push(content.text);
          }

          if (typeof content?.content === "string") {
            chunks.push(content.content);
          }

          if (typeof content?.value === "string") {
            chunks.push(content.value);
          }
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

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  }

  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        message: "semantic-map function is live",
        checkedAt: new Date().toISOString(),
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        visibleOpenAIKeyNames: Object.keys(process.env).filter((key) =>
          key.toLowerCase().includes("openai")
        )
      })
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Method not allowed"
      })
    };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "OPENAI_API_KEY is missing in Netlify environment variables."
        })
      };
    }

const payload = JSON.parse(event.body || "{}");

const sourceText = String(payload.sourceText || "").trim();
const template = payload.template && typeof payload.template === "object" ? payload.template : {};

const headerFields = Array.isArray(template.headerFields)
  ? template.headerFields
      .filter((field) => field && field.key && field.label)
      .map((field) => ({
        key: String(field.key || "").trim(),
        label: String(field.label || "").trim()
      }))
  : [];

const templateSections = Array.isArray(template.sections)
  ? template.sections
      .filter((section) => section && section.heading)
      .map((section) => ({
        id: String(section.id || "").trim(),
        heading: String(section.heading || "").trim(),
        order: Number(section.order || 0)
      }))
  : [];

if (!sourceText) {
  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({
      ok: false,
      error: "sourceText is required. No fallback sample text is allowed."
    })
  };
}

if (!headerFields.length) {
  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({
      ok: false,
      error: "template.headerFields is required for semantic mapping."
    })
  };
}

const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        store: false,
        input: [
          {
            role: "system",
            content:
              "You are a controlled semantic mapper for a document formatting tool. Return valid JSON only. Do not return markdown. Do not wrap JSON in code fences."
          },
          {
            role: "user",
            content: `
You are the document brain for a PDF formatting tool.

Your job is to create a clean, robust, professional document model by adapting the messy source document into the detected sample/template structure.

Return valid JSON only. Do not return markdown. Do not wrap JSON in code fences.

Required JSON shape:
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
          "content": "",
          "sourcePage": null
        }
      ]
    }
  ],
  "warnings": []
}

Template header fields:
${JSON.stringify(headerFields, null, 2)}

Template sections:
${JSON.stringify(templateSections, null, 2)}

Core authority rule:
- The sample/template structure is the formatting authority.
- The source document is the factual authority.
- Never invent facts outside the supplied source text.
- Never ignore the template structure when template fields are provided.

Template adaptation rule:
- If the sample/template contains summary rows, the source document must adapt into those summary rows.
- Return exactly one summaryRows item for every Template header field.
- Use the exact key from the Template header field.
- Use the exact label from the Template header field.
- Do not rename labels.
- Do not create extra summary labels.
- Do not replace the template summary structure with your own summary structure.
- Do not skip a template summary row just because the source wording is different.
- Search flexibly across the source text for equivalent meanings.
- If a value is genuinely missing after checking the source text, use "Not Available".

Flexible extraction guidance:
- Vessel Name may appear near "CS", "MV", "M/V", "Vessel", or in a line like "CS Jenna : Dated ...".
- Port Name and Country may appear in a title like "PORT INFORMATION : ABIDJAN/IVORY COAST".
- Cargo may appear in brackets such as "[DISCHARGING SUGAR IN BAGS]" or inside cargo operation notes.
- Latitude / Longitude / Position may appear under "PORT POSITION".
- Time Zone may appear as "Time Zone", "GMT", "UTC", or local time.
- VHF / Communication may appear under "Radio communications", "Channel", or "VHF".
- Berth / Pier / Terminal may appear under "Berths and cargo", "BERTH No.", "Terminal", "Pier", or "Jetty".
- Density may appear as "Water density", "Dock density", or "Density".
- Cargo Operations / Rate should include method and rate when available, not just cargo type.

Robust formatting and readability rules:
- Create a clean, robust, professional formatted document model.
- Correct broken line breaks from PDF extraction.
- Restore basic punctuation where the source text is clearly broken.
- Group related facts into clear paragraphs.
- Avoid one long paragraph when the content contains multiple topics.
- Keep each paragraph focused on one operational idea.
- Use concise maritime/business wording.
- Preserve numbers, dates, coordinates, VHF channels, drafts, rates, cargo quantities, and units accurately.
- Do not over-polish warnings or operational restrictions in a way that changes their meaning.

Section rules:
- Use the Template sections as guidance.
- Include only sections that have meaningful source content.
- Put content into the most suitable section based on meaning, not only exact keyword matching.
- Do not include system notes.
- Do not mention original source, template used, formatted document, or generated output.
- Do not omit useful source information just to keep the output short.

Evidence rules:
- Evidence must be copied from the supplied source text.
- Evidence should support the extracted value.
- If page number is unknown, use null.
- Confidence must be between 0 and 1.

Source text:
${sourceText}
`
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          ok: false,
          error: data
        })
      };
    }

    const outputText = extractOpenAIText(data);

    let parsedJson = null;
    try {
      parsedJson = JSON.parse(outputText);
    } catch {
      parsedJson = null;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        outputText,
        parsedJson,
        raw: data
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: error.message
      })
    };
  }
};
