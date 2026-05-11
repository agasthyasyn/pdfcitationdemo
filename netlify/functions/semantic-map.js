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
Extract a simple document-formatting JSON from the text below.

Required JSON shape:
{
  "title": "",
  "summaryRows": [
    {
      "label": "",
      "value": "",
      "confidence": 0,
      "evidence": ""
    }
  ],
  "sections": [
    {
      "heading": "",
      "blocks": [
        {
          "type": "text",
          "content": ""
        }
      ]
    }
  ],
  "warnings": []
}

Rules:
- Use only the supplied text.
- Do not invent missing values.
- If a value is missing, use "Not Available".
- Keep the output compact.
- Return JSON only.

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
