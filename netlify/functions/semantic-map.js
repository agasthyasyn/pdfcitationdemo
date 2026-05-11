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
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
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

    const testText =
      payload.testText ||
      "PORT INFORMATION REPORT. Vessel Name: CS Calla. Port Name: Buenaventura. Country: Colombia. Cargo: Discharged Fertilizers.";

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
              "You are a controlled semantic mapper for a document formatting tool. Return JSON only."
          },
          {
            role: "user",
            content: `Extract a simple document formatting JSON from this text:\n\n${testText}\n\nReturn only JSON with title, summaryRows, sections, and warnings.`
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        raw: data,
        outputText: data.output_text || ""
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
