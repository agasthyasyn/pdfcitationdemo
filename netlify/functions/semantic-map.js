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
You are a smart document analyst and formatter for a PDF formatting tool.

Your job is to understand the sample/template as a reference for reader-friendly structure, not as a source of facts.

Create a clean, clear, robust, professional document model by understanding the source document and arranging its content into the most suitable summary fields and body sections.

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

Template header fields:
${JSON.stringify(headerFields, null, 2)}

Template sections:
${JSON.stringify(templateSections, null, 2)}

Core interpretation rules:
- The sample/template is a reference for structure, layout logic, and reader experience.
- The sample/template is not the factual source.
- The source document is the only factual authority.
- Do not copy sample-specific names, ports, countries, companies, vessels, locations, or headings unless they are also present in the source document.
- Do not strictly mimic the sample wording.
- Use the sample to understand what kind of information belongs where.
- Use the source to decide what the actual values and body content should be.

Coverage-first rules:
- The template must not decide which source details are removed.
- The source document controls content coverage.
- Before formatting, identify all reader-critical details from the source.
- Reader-critical details include instructions, warnings, restrictions, dates, contacts, limits, rates, quantities, operational steps, exceptions, services, responsibilities, and safety/security notes.
- Preserve reader-critical details even when they do not fit neatly into the sample/template sections.
- If important source details do not fit cleanly into the main sections, place them under "Additional Operational Notes".
- Do not compress multiple important instructions into one vague sentence.
- Do not omit a source detail only because it appears minor or does not match a template heading.
- Do not convert the document into only a brief summary unless the source itself is brief.

Smart field allocation rules:
- Read each template header field as a meaning-based target, not just a keyword.
- Use your understanding to decide what value belongs in each field.
- A country field should contain a country-like value.
- A port, city, or location field should contain a place/location-like value.
- A vessel, customer, vendor, project, or event name field should contain the appropriate name-like value.
- A date or stay field should contain a date or date range.
- A contact field should contain a person, company, phone, email, or contact details.
- A communication field should contain communication details such as channels, radio, phone, email, or equivalent source context.
- A depth, draft, quantity, rate, estimate, amount, or measurement field should preserve numbers and units accurately.
- If the source wording differs from the template label, map by meaning.
- If a value is genuinely missing, use "Not Available".

Summary table rules:
- If the template contains summary/header rows, return exactly one summaryRows item for every Template header field.
- Use the exact key from the Template header field.
- Use the exact label from the Template header field.
- Do not rename labels.
- Do not create extra summary labels.
- Do not leave a field as Not Available if a clear equivalent exists in the source.
- Do not place body sentences, warnings, phone fragments, unrelated numbers, or operational remarks into summary fields.
- Evidence must support the extracted value and must come from the supplied source text.

Body section rules:
- Use the template sections as a reference for how a reader expects the document to be organized.
- Do not blindly reproduce template section names if they do not fit the source.
- Create clean section headings that are appropriate for the source document.
- Place each source detail under the most suitable section.
- Remove exact duplication, but do not remove distinct operational details.
- Avoid creating too many tiny sections, but do not merge unrelated critical details into one vague paragraph.
- If a detail is important but does not fit the main sections, preserve it under "Additional Operational Notes".
- Do not include system notes, template references, original source notes, generated output notes, or audit notes.

Paragraph formatting rules:
- Every body block must be cleanly paragraph-based.
- Use the "paragraphs" array for paragraph-level content.
- Each paragraph must be a complete, readable paragraph.
- Do not create one long wall of text.
- Do not put unrelated topics into the same paragraph.
- Fix broken PDF line breaks.
- Restore basic punctuation where the extracted text is clearly broken.
- Keep operational meaning unchanged.
- Preserve names, dates, coordinates, quantities, contact details, rates, measurements, and units accurately.
- Prefer clear reader-friendly paragraphs over raw extracted lines.
- The "content" field may contain the same paragraphs joined with double line breaks.

Table and visual awareness rules:
- If the source appears to contain a table but the text extraction is too broken, summarize the table carefully without inventing missing cells.
- If the content is clearly a visual/chart/photo reference, do not force it into random body text.
- Mention useful visual context only when it helps the reader understand the document.

Quality rules:
- Be accurate before being polished.
- Be clear before being short.
- Do not hallucinate.
- Do not over-polish warnings or restrictions in a way that changes meaning.
- If unsure, use "Not Available" or add a warning.

Coverage audit rules:
- Fill coverageAudit.importantSourceThemesCovered with the main source themes you preserved.
- Fill coverageAudit.additionalOperationalNotes with important source details that do not fit neatly into the main sections.
- Fill coverageAudit.unmappedImportantDetails with important details that were hard to place.
- Fill coverageAudit.possibleOmissions only if the supplied text appears incomplete, too noisy, or unclear.
- coverageAudit.coverageConfidence must be between 0 and 1.
- If the source contains vessel-facing, operational, safety, restriction, documentation, contact, rate, quantity, or timing details, do not silently drop them.

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
