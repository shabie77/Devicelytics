const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_LOG_TABLE = process.env.SUPABASE_LOG_TABLE || "analysis_logs";

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function jsonResponse(res, code, payload) {
  res.status(code).setHeader("Content-Type", "application/json");
  return res.send(JSON.stringify(payload));
}

function extractCandidateText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function extractJsonBlock(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function validateResultShape(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Parsed response is not an object.");
  }

  const requiredFields = ["verdict", "reason", "nextAction", "riskLevel"];
  for (const field of requiredFields) {
    if (!candidate[field] || typeof candidate[field] !== "string") {
      throw new Error(`Missing or invalid field: ${field}`);
    }
  }

  if (candidate.suggestedMessage && typeof candidate.suggestedMessage !== "string") {
    throw new Error("suggestedMessage must be a string when provided.");
  }

  if (candidate.missingData && !Array.isArray(candidate.missingData)) {
    throw new Error("missingData must be an array when provided.");
  }

  return {
    verdict: candidate.verdict,
    reason: candidate.reason,
    nextAction: candidate.nextAction,
    suggestedMessage: candidate.suggestedMessage || null,
    missingData: Array.isArray(candidate.missingData) ? candidate.missingData.filter(Boolean) : [],
    riskLevel: candidate.riskLevel
  };
}

function buildFallbackResult(input) {
  const missingData = [];
  if (!input.description) missingData.push("Clear seller description");
  if (!input.batteryHealth) missingData.push("Battery health or battery backup estimate");
  if (!input.imeiStatus) missingData.push("IMEI status");
  if (!input.images?.length) missingData.push("At least one device photo");

  return {
    verdict: "Need More Details",
    reason: "The analysis response was incomplete or malformed, so DeviceGuard switched to a safe fallback.",
    nextAction: "Ask the seller for clearer details and retry with at least one photo if possible.",
    suggestedMessage: "Can you share battery health, IMEI status, and a few clearer photos before I decide?",
    missingData,
    riskLevel: "medium"
  };
}

function buildPrompt(input) {
  return [
    `Device: ${input.deviceName}`,
    `Asking price: ${input.askingPrice}`,
    `Description: ${input.description}`,
    `Battery health: ${input.batteryHealth || "unknown"}`,
    `IMEI status: ${input.imeiStatus || "unknown"}`,
    `Language hint: ${input.languageHint || "auto"}`,
    `Image count: ${input.images?.length || 0}`
  ].join("\n");
}

function buildSystemInstruction() {
  return {
    parts: [
      {
        text: [
          "You are 'The Digital Bodyguard,' a veteran technical appraiser specializing in detecting fraud and hidden defects in used consumer electronics (especially Apple and high-end Android devices).",
          "Objective: Protect the user from making a bad purchase. Be detailed, skeptical, and focused on verifying condition and price logic.",
          "Market Logic: Evaluate the 'Asking price' against a typical 15-30% yearly depreciation for flagships. If a price is too low, treat it as a potential scam (bait-and-switch or stolen device). If a model is very new (like iPhone 16/17 series), assume it is a flagship flagship release and focus on assessing the seller's legitimacy and 'too good to be true' pricing.",
          "Image Analysis: If images are provided, look for cracks, mismatched buttons, or inconsistent colors. If no images are provided, explicitly mention the high risk of mystery defects.",
          "Return JSON only. No markdown formatting. Keys: verdict, reason (multi-paragraph detail), nextAction, suggestedMessage, missingData, riskLevel.",
          "Verdict styles: Worth It, Average Deal, Not Worth It, High Risk, Need More Details.",
          "Risk levels: low, medium, high."
        ].join("\n")
      }
    ]
  };
}

function buildResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      verdict: { type: "STRING" },
      reason: { type: "STRING" },
      nextAction: { type: "STRING" },
      suggestedMessage: { type: "STRING" },
      missingData: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      riskLevel: { type: "STRING" }
    },
    required: ["verdict", "reason", "nextAction", "riskLevel"]
  };
}

function buildGeminiParts(input) {
  const parts = [{ text: buildPrompt(input) }];

  for (const image of input.images || []) {
    if (image?.data && image?.mimeType) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }
  }

  return parts;
}

function buildMockGeminiResponse(input) {
  const price = Number(input.askingPrice || 0);
  const risky = String(input.imeiStatus || "").toLowerCase() === "blacklisted" || !input.images?.length;
  const result = {
    verdict: risky ? "High Risk" : price < 30000 ? "Worth It" : "Average Deal",
    reason: risky
      ? "Key trust signals are missing or risky, so this needs more verification before buying."
      : "The price and available details look reasonably aligned for a private-beta prototype decision.",
    nextAction: risky ? "Verify IMEI and condition before making an offer." : "Negotiate slightly and confirm battery and condition details.",
    suggestedMessage: risky
      ? "Please share IMEI status, battery health, and clear photos before I decide."
      : "If the condition is clean, I can do a slightly lower offer today.",
    missingData: [
      !input.batteryHealth ? "Battery health" : null,
      !input.imeiStatus ? "IMEI status" : null,
      !input.images?.length ? "Device photos" : null
    ].filter(Boolean),
    riskLevel: risky ? "high" : "medium"
  };

  return {
    raw: JSON.stringify(result, null, 2),
    usageMetadata: {
      promptTokenCount: 900,
      candidatesTokenCount: 180
    }
  };
}

function estimateCost(usageMetadata) {
  if (!usageMetadata) return null;

  const inputCostPerMillion = Number(process.env.PROMPT_INPUT_COST_PER_MILLION || 0.25);
  const outputCostPerMillion = Number(process.env.PROMPT_OUTPUT_COST_PER_MILLION || 1.5);

  const promptTokens = Number(usageMetadata.promptTokenCount || 0);
  const outputTokens = Number(usageMetadata.candidatesTokenCount || 0);

  const cost =
    (promptTokens / 1000000) * inputCostPerMillion +
    (outputTokens / 1000000) * outputCostPerMillion;

  return Number(cost.toFixed(6));
}

async function saveLog(record) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { saved: false, reason: "Supabase env vars not set." };

  const response = await fetch(`${url}/rest/v1/${DEFAULT_LOG_TABLE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal"
    },
    body: JSON.stringify(record)
  });

  if (!response.ok) {
    const text = await response.text();
    return { saved: false, reason: text };
  }

  return { saved: true };
}

async function callGemini(input) {
  const isMock = String(process.env.USE_MOCK_GEMINI || "false").toLowerCase() === "true";
  const hasKey = !!process.env.GEMINI_API_KEY;

  if (isMock) {
    return buildMockGeminiResponse(input);
  }

  if (!hasKey) {
    throw new Error("Gemini API key is not configured. Real analysis is currently disabled.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: buildSystemInstruction(),
        contents: [
          {
            role: "user",
            parts: buildGeminiParts(input)
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: buildResponseSchema()
        }
      })
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Gemini request failed.");
  }

  return {
    raw: extractCandidateText(payload),
    usageMetadata: payload.usageMetadata || null
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed." });
  }

  let input;
  try {
    input = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch (error) {
    return badRequest(res, "Invalid JSON body.");
  }

  if (!input.deviceName || input.askingPrice === undefined || input.askingPrice === null || !input.description) {
    return badRequest(res, "deviceName, askingPrice, and description are required.");
  }

  const parsedPrice = Number(input.askingPrice);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return badRequest(res, "askingPrice must be a valid positive number.");
  }

  if (Array.isArray(input.images)) {
    if (input.images.length > 3) {
      return badRequest(res, "Only up to 3 images are supported.");
    }
    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    for (const img of input.images) {
      if (!img.data || typeof img.data !== "string" || !img.mimeType) {
        return badRequest(res, "Invalid image payload structure.");
      }
      if (!validMimes.includes(img.mimeType)) {
        return badRequest(res, `Unsupported image type: ${img.mimeType}. Only JPG, PNG, and WEBP allowed.`);
      }
      if (img.data.length > 2.5 * 1024 * 1024) { // ~2.5MB base64 cap
        return badRequest(res, "Image payload too large. Server-side guard exceeded.");
      }
    }
  }

  const normalizedInput = {
    deviceName: String(input.deviceName).trim(),
    askingPrice: parsedPrice,
    description: String(input.description).trim(),
    batteryHealth: input.batteryHealth ? String(input.batteryHealth).trim() : null,
    imeiStatus: input.imeiStatus ? String(input.imeiStatus).trim() : null,
    languageHint: input.languageHint ? String(input.languageHint).trim() : null,
    images: Array.isArray(input.images) ? input.images : []
  };

  const startedAt = Date.now();
  let rawModelResponse = "";
  let result;
  let parseStatus = "pass";
  let usageMetadata = null;

  try {
    const modelOutput = await callGemini(normalizedInput);
    rawModelResponse = modelOutput.raw || "";
    usageMetadata = modelOutput.usageMetadata;

    const jsonBlock = extractJsonBlock(rawModelResponse);
    if (!jsonBlock) {
      throw new Error("No JSON block found in model response.");
    }

    result = validateResultShape(JSON.parse(jsonBlock));
  } catch (error) {
    parseStatus = "fallback";
    rawModelResponse = rawModelResponse || String(error.message || "Unknown analysis error");
    result = buildFallbackResult(normalizedInput);
  }

  const latencyMs = Date.now() - startedAt;
  const estimatedCost = estimateCost(usageMetadata);

  const logRecord = {
    input: normalizedInput,
    raw_model_response: rawModelResponse,
    parsed_result: result,
    parse_status: parseStatus,
    model_version: DEFAULT_MODEL,
    latency_ms: latencyMs,
    estimated_cost: estimatedCost
  };

  let logSaved = false;
  let logMessage = null;
  try {
    const logResult = await saveLog(logRecord);
    logSaved = logResult.saved;
    logMessage = logResult.reason;
  } catch (logErr) {
    logSaved = false;
    logMessage = "Logging error: " + (logErr.message || "Unknown log failure");
  }

  return jsonResponse(res, 200, {
    result,
    parseStatus,
    rawModelResponse,
    modelVersion: DEFAULT_MODEL,
    latencyMs,
    estimatedCost,
    logSaved,
    logMessage
  });
};
