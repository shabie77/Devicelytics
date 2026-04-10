const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_LOG_TABLE = process.env.SUPABASE_LOG_TABLE || "analysis_logs";
const VALID_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_BASE64_LIMIT = Math.floor(2.5 * 1024 * 1024);

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function normalizeRiskLevel(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizePriceFairness(value) {
  const normalized = String(value || "").toLowerCase();
  if (["fair", "overpriced", "suspiciously_low", "unknown"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function actionForVerdict(verdict) {
  switch (String(verdict || "")) {
    case "High Risk":
      return "Walk Away";
    case "Not Worth It":
      return "Pass Unless Price Drops Hard";
    case "Need More Details":
      return "Verify Before Offer";
    case "Worth It":
      return "Buy If Final Checks Pass";
    default:
      return "Negotiate";
  }
}

function isActionCompatible(verdict, action) {
  const normalizedVerdict = String(verdict || "");
  const normalizedAction = String(action || "");

  if (!normalizedAction) return false;
  if (normalizedVerdict === "High Risk") return normalizedAction === "Walk Away";
  if (normalizedVerdict === "Not Worth It") return normalizedAction === "Pass Unless Price Drops Hard";
  if (normalizedVerdict === "Need More Details") return normalizedAction === "Verify Before Offer";
  if (normalizedVerdict === "Worth It") return normalizedAction === "Buy If Final Checks Pass" || normalizedAction === "Negotiate";
  return normalizedAction === "Negotiate";
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseBatteryHealth(raw) {
  const match = String(raw || "").match(/(\d{2,3})\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return clamp(value, 0, 100);
}

function deviceLooksTooNew(deviceName) {
  const text = String(deviceName || "").toLowerCase();
  return /(iphone\s*1[6-9]|iphone\s*2\d|galaxy\s*s2[5-9]|pixel\s*1[0-9])/.test(text);
}

function detectSuspiciousPhrases(description) {
  const text = String(description || "").toLowerCase();
  const patterns = [
    { regex: /\burgent sale\b|\bneed money\b|\bfast sale\b/, reason: "seller is pushing for a rushed sale" },
    { regex: /\bimei issue\b|\bnetwork issue\b|\bcan be fixed later\b/, reason: "seller admits a serious trust issue" },
    { regex: /\bno bill\b|\bbill missing\b|\bbox only\b|\bwithout charger\b/, reason: "ownership proof or standard accessories are missing" },
    { regex: /\bserious buyers only\b|\bfinal price\b|\bno questions\b/, reason: "seller language discourages normal verification" },
    { regex: /\bbrand new\b|\blike new\b/, reason: "listing claims premium condition that needs evidence" }
  ];

  return patterns
    .filter((pattern) => pattern.regex.test(text))
    .map((pattern) => pattern.reason);
}

function deriveSignals(input) {
  const suspiciousReasons = detectSuspiciousPhrases(input.description);
  const missingEvidence = [];
  const verification = [];
  const sellerQuestions = [];

  if (!input.images?.length) {
    missingEvidence.push("No device photos were provided.");
    verification.push("Ask for bright front, back, frame, and About-screen photos before paying.");
    sellerQuestions.push("Can you send 4 clear photos: screen on, back panel, frame edges, and About screen?");
  }

  if (!input.batteryHealth) {
    missingEvidence.push("Battery health is missing.");
    verification.push("Ask for battery health or a battery backup screenshot.");
    sellerQuestions.push("What is the current battery health or backup after a full charge?");
  }

  if (!input.imeiStatus || String(input.imeiStatus).toLowerCase() === "not checked") {
    missingEvidence.push("IMEI verification has not been completed.");
    verification.push("Confirm IMEI status before sending any money.");
    sellerQuestions.push("Can you share the IMEI status check result or a screenshot from the device?");
  }

  const batteryHealth = parseBatteryHealth(input.batteryHealth);
  const hasLowBattery = batteryHealth !== null && batteryHealth < 80;
  const hasWeakBattery = batteryHealth !== null && batteryHealth < 85;
  const tooNew = deviceLooksTooNew(input.deviceName);
  const imeiBlacklisted = String(input.imeiStatus || "").toLowerCase() === "blacklisted";
  const imeiUnavailable = ["missing", "unverifiable"].includes(String(input.imeiStatus || "").toLowerCase());

  let fraudRiskScore = 18;
  let conditionRiskScore = 18;
  let priceFairness = "fair";
  const reasonBullets = [];

  if (suspiciousReasons.length) {
    fraudRiskScore += suspiciousReasons.length * 12;
    suspiciousReasons.forEach((reason) => reasonBullets.push(`Fraud signal: ${reason}.`));
    verification.push("Do not rely on chat claims alone; verify ownership and working status live.");
  }

  if (tooNew) {
    fraudRiskScore += 18;
    priceFairness = "suspiciously_low";
    reasonBullets.push("Model naming looks unusually new for the Indian resale market, so legitimacy needs extra scrutiny.");
    sellerQuestions.push("Can you share the original invoice date and the exact model number from Settings?");
  }

  if (imeiBlacklisted) {
    fraudRiskScore += 45;
    reasonBullets.push("A blacklisted IMEI is a major stop signal because the device can lose network access or indicate ownership issues.");
    verification.push("Do not buy a device with a blacklisted IMEI.");
  } else if (imeiUnavailable) {
    fraudRiskScore += 14;
    reasonBullets.push("IMEI status is unclear, which keeps theft, financing, or network-lock risk open.");
  }

  if (!input.images?.length) {
    conditionRiskScore += 16;
    fraudRiskScore += 10;
    reasonBullets.push("Without photos, there is no visual proof of display, body, or camera condition.");
  }

  if (hasLowBattery) {
    conditionRiskScore += 20;
    priceFairness = priceFairness === "suspiciously_low" ? "suspiciously_low" : "overpriced";
    reasonBullets.push(`Battery health is around ${batteryHealth}%, which points to a likely battery replacement cost soon.`);
    verification.push("Budget for a battery replacement if the rest of the deal still makes sense.");
  } else if (hasWeakBattery) {
    conditionRiskScore += 10;
    reasonBullets.push(`Battery health is about ${batteryHealth}%, so negotiate with battery wear in mind.`);
  }

  const descriptionText = String(input.description || "").toLowerCase();
  if (/\bchanged\b|\brepair\b|\breplaced\b|\bpanel\b|\bdisplay\b|\bbattery drains\b|\bgreen line\b/.test(descriptionText)) {
    conditionRiskScore += 18;
    priceFairness = priceFairness === "suspiciously_low" ? "suspiciously_low" : "overpriced";
    reasonBullets.push("The seller description mentions repair or wear signals that usually justify a more cautious price.");
    sellerQuestions.push("Which parts were replaced or repaired, and do you have proof of the work?");
  }

  if (/condition good|light used|like new|no issues/.test(descriptionText) && missingEvidence.length >= 2) {
    fraudRiskScore += 8;
    reasonBullets.push("The listing claims good condition but provides limited proof, so confidence should stay moderate.");
  }

  const askingPrice = Number(input.askingPrice || 0);
  if (tooNew && askingPrice > 0 && askingPrice < 80000) {
    fraudRiskScore += 16;
    priceFairness = "suspiciously_low";
    reasonBullets.push("The asking price is unusually low for a very recent flagship, which can indicate bait pricing or a fake listing.");
  } else if (!tooNew && askingPrice >= 45000) {
    priceFairness = priceFairness === "suspiciously_low" ? "suspiciously_low" : "overpriced";
    reasonBullets.push("The asking price sits in a premium range, so the device needs strong proof of condition and ownership.");
  }

  const fraudRisk = fraudRiskScore >= 65 ? "high" : fraudRiskScore >= 35 ? "medium" : "low";
  const conditionRisk = conditionRiskScore >= 60 ? "high" : conditionRiskScore >= 35 ? "medium" : "low";
  const riskScore = clamp(Math.round(fraudRiskScore * 0.6 + conditionRiskScore * 0.4), 5, 95);
  const confidence = clamp(88 - missingEvidence.length * 14 - (fraudRisk === "high" ? 10 : fraudRisk === "medium" ? 4 : 0), 18, 92);

  let verdict;
  let riskLevel;
  let recommendedAction;

  if (imeiBlacklisted || fraudRisk === "high") {
    verdict = "High Risk";
    riskLevel = "high";
    recommendedAction = "Walk Away";
  } else if (conditionRisk === "high" || priceFairness === "overpriced") {
    verdict = "Not Worth It";
    riskLevel = "high";
    recommendedAction = "Pass Unless Price Drops Hard";
  } else if (missingEvidence.length >= 2) {
    verdict = "Need More Details";
    riskLevel = "medium";
    recommendedAction = "Verify Before Offer";
  } else if (riskScore <= 32 && priceFairness === "fair") {
    verdict = "Worth It";
    riskLevel = "low";
    recommendedAction = "Buy If Final Checks Pass";
  } else {
    verdict = "Average Deal";
    riskLevel = "medium";
    recommendedAction = "Negotiate";
  }

  if (!reasonBullets.length) {
    reasonBullets.push("The available details look broadly plausible, but the final decision still depends on proof of condition and ownership.");
  }

  return {
    riskDimensions: {
      fraudRisk,
      conditionRisk,
      priceFairness
    },
    confidence,
    riskScore,
    verdict,
    riskLevel,
    recommendedAction,
    missingEvidence: uniqueStrings(missingEvidence),
    whatToVerify: uniqueStrings(verification),
    sellerQuestions: uniqueStrings(sellerQuestions),
    whyThisVerdict: uniqueStrings(reasonBullets)
  };
}

function buildFallbackResult(input, failureReason) {
  const signals = deriveSignals(input);
  return {
    analysisStatus: "unavailable",
    verdict: "Analysis Unavailable",
    reason: "The appraisal engine could not return a trustworthy structured result for this request.",
    nextAction: "Retry in a moment, then verify the seller manually before paying.",
    recommendedAction: "Hold",
    suggestedMessage: "The analysis tool is temporarily unavailable. Can you meanwhile share battery health, IMEI proof, and clearer photos?",
    riskLevel: "medium",
    riskScore: Math.max(signals.riskScore, 45),
    confidence: 0,
    riskDimensions: signals.riskDimensions,
    whyThisVerdict: [
      "The system could not complete a reliable AI appraisal.",
      "Buyer guidance below is based only on the listing details already entered."
    ],
    missingEvidence: signals.missingEvidence,
    whatToVerify: signals.whatToVerify,
    sellerQuestions: signals.sellerQuestions,
    failureReason: failureReason || "Unknown model failure."
  };
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

  return {
    verdict: candidate.verdict,
    reason: candidate.reason,
    nextAction: candidate.nextAction,
    recommendedAction: candidate.recommendedAction ? String(candidate.recommendedAction) : null,
    suggestedMessage: candidate.suggestedMessage || null,
    riskLevel: normalizeRiskLevel(candidate.riskLevel),
    confidence: Number.isFinite(Number(candidate.confidence)) ? clamp(Math.round(Number(candidate.confidence)), 0, 100) : null,
    riskScore: Number.isFinite(Number(candidate.riskScore)) ? clamp(Math.round(Number(candidate.riskScore)), 0, 100) : null,
    riskDimensions: candidate.riskDimensions && typeof candidate.riskDimensions === "object"
      ? {
          fraudRisk: normalizeRiskLevel(candidate.riskDimensions.fraudRisk),
          conditionRisk: normalizeRiskLevel(candidate.riskDimensions.conditionRisk),
          priceFairness: normalizePriceFairness(candidate.riskDimensions.priceFairness)
        }
      : null,
    whyThisVerdict: uniqueStrings(candidate.whyThisVerdict),
    missingEvidence: uniqueStrings(candidate.missingEvidence || candidate.missingData),
    whatToVerify: uniqueStrings(candidate.whatToVerify),
    sellerQuestions: uniqueStrings(candidate.sellerQuestions)
  };
}

function normalizeResult(candidate, input) {
  const signals = deriveSignals(input);
  const parsed = validateResultShape(candidate);
  const riskDimensions = parsed.riskDimensions || signals.riskDimensions;
  const confidence = parsed.confidence === null ? signals.confidence : parsed.confidence;
  const riskScore = parsed.riskScore === null ? signals.riskScore : parsed.riskScore;

  let verdict = parsed.verdict;
  let riskLevel = normalizeRiskLevel(parsed.riskLevel);

  if (riskDimensions.fraudRisk === "high") {
    verdict = "High Risk";
    riskLevel = "high";
  } else if (riskDimensions.conditionRisk === "high" || riskDimensions.priceFairness === "overpriced") {
    verdict = verdict === "Need More Details" ? verdict : "Not Worth It";
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  } else if ((parsed.missingEvidence.length || signals.missingEvidence.length) >= 2 && verdict === "Worth It") {
    verdict = "Need More Details";
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
  }

  const recommendedAction = isActionCompatible(verdict, parsed.recommendedAction)
    ? parsed.recommendedAction
    : actionForVerdict(verdict);

  return {
    analysisStatus: "ready",
    verdict,
    reason: parsed.reason,
    nextAction: parsed.nextAction,
    recommendedAction,
    suggestedMessage: parsed.suggestedMessage,
    riskLevel,
    riskScore,
    confidence,
    riskDimensions,
    whyThisVerdict: uniqueStrings([...signals.whyThisVerdict, ...parsed.whyThisVerdict]).slice(0, 6),
    missingEvidence: uniqueStrings([...signals.missingEvidence, ...parsed.missingEvidence]),
    whatToVerify: uniqueStrings([...signals.whatToVerify, ...parsed.whatToVerify]).slice(0, 6),
    sellerQuestions: uniqueStrings([...signals.sellerQuestions, ...parsed.sellerQuestions]).slice(0, 6),
    failureReason: null
  };
}

function buildPrompt(input) {
  return [
    `Device: ${input.deviceName}`,
    `Asking price INR: ${input.askingPrice}`,
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
          "You are DeviceGuard, a skeptical used-device appraisal engine for real buyers.",
          "Protect the buyer from scams, hidden damage, and weak deals.",
          "Return JSON only with these keys:",
          "verdict, reason, nextAction, recommendedAction, suggestedMessage, riskLevel, confidence, riskScore, riskDimensions, whyThisVerdict, missingEvidence, whatToVerify, sellerQuestions.",
          "riskDimensions must include fraudRisk, conditionRisk, and priceFairness.",
          "Allowed verdicts: Worth It, Average Deal, Not Worth It, High Risk, Need More Details.",
          "Allowed risk levels: low, medium, high.",
          "Allowed priceFairness values: fair, overpriced, suspiciously_low, unknown.",
          "Use short concrete bullet-style sentences inside arrays.",
          "Do not invent proof. If details are missing, say so clearly."
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
      recommendedAction: { type: "STRING" },
      suggestedMessage: { type: "STRING" },
      riskLevel: { type: "STRING" },
      confidence: { type: "NUMBER" },
      riskScore: { type: "NUMBER" },
      riskDimensions: {
        type: "OBJECT",
        properties: {
          fraudRisk: { type: "STRING" },
          conditionRisk: { type: "STRING" },
          priceFairness: { type: "STRING" }
        }
      },
      whyThisVerdict: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      missingEvidence: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      whatToVerify: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      sellerQuestions: {
        type: "ARRAY",
        items: { type: "STRING" }
      }
    },
    required: ["verdict", "reason", "nextAction", "riskLevel", "riskDimensions"]
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
  const signals = deriveSignals(input);
  const result = {
    verdict: signals.verdict,
    reason: [
      `Fraud risk is ${signals.riskDimensions.fraudRisk}, condition risk is ${signals.riskDimensions.conditionRisk}, and price fairness looks ${toTitleCase(signals.riskDimensions.priceFairness)}.`,
      "This mock result follows DeviceGuard's standardized buyer-first decision rules for offline QA."
    ].join("\n\n"),
    nextAction:
      signals.recommendedAction === "Walk Away"
        ? "Walk away and avoid advance payment."
        : signals.recommendedAction === "Negotiate"
          ? "Negotiate only after checking IMEI, battery, and cosmetic condition."
          : "Verify the missing evidence before you commit.",
    recommendedAction: signals.recommendedAction,
    suggestedMessage: signals.sellerQuestions[0] || "Can you share a few more proof points before I decide?",
    riskLevel: signals.riskLevel,
    confidence: signals.confidence,
    riskScore: signals.riskScore,
    riskDimensions: signals.riskDimensions,
    whyThisVerdict: signals.whyThisVerdict,
    missingEvidence: signals.missingEvidence,
    whatToVerify: signals.whatToVerify,
    sellerQuestions: signals.sellerQuestions
  };

  return {
    raw: JSON.stringify(result, null, 2),
    usageMetadata: {
      promptTokenCount: 900,
      candidatesTokenCount: 260
    },
    source: "mock"
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
          temperature: 0.25,
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
    usageMetadata: payload.usageMetadata || null,
    source: "gemini"
  };
}

function sanitizeInput(input) {
  return {
    deviceName: String(input.deviceName).trim(),
    askingPrice: Number(input.askingPrice),
    description: String(input.description).trim(),
    batteryHealth: input.batteryHealth ? String(input.batteryHealth).trim() : null,
    imeiStatus: input.imeiStatus ? String(input.imeiStatus).trim() : null,
    languageHint: input.languageHint ? String(input.languageHint).trim() : null,
    images: Array.isArray(input.images) ? input.images : []
  };
}

function validateImages(images, res) {
  if (!Array.isArray(images)) {
    return true;
  }

  if (images.length > 3) {
    badRequest(res, "Only up to 3 images are supported.");
    return false;
  }

  for (const image of images) {
    if (!image || typeof image !== "object" || typeof image.data !== "string" || typeof image.mimeType !== "string") {
      badRequest(res, "Invalid image payload structure.");
      return false;
    }

    if (!VALID_IMAGE_MIMES.includes(image.mimeType)) {
      badRequest(res, `Unsupported image type: ${image.mimeType}. Only JPG, PNG, and WEBP allowed.`);
      return false;
    }

    if (!/^[a-zA-Z0-9+/=]+$/.test(image.data)) {
      badRequest(res, "Image payload is not valid base64.");
      return false;
    }

    if (image.data.length > IMAGE_BASE64_LIMIT) {
      badRequest(res, "Image payload too large. Server-side guard exceeded.");
      return false;
    }
  }

  return true;
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

  if (!validateImages(input.images, res)) {
    return;
  }

  const normalizedInput = sanitizeInput(input);
  const runSource = input.qaMode === true || String(input.runSource || "").toLowerCase() === "fixture"
    ? "fixture"
    : "live";
  const startedAt = Date.now();
  let rawModelResponse = "";
  let result;
  let parseStatus = "pass";
  let failureReason = null;
  let usageMetadata = null;
  let source = "unknown";

  try {
    const modelOutput = await callGemini(normalizedInput);
    rawModelResponse = modelOutput.raw || "";
    usageMetadata = modelOutput.usageMetadata;
    source = modelOutput.source || "unknown";

    const jsonBlock = extractJsonBlock(rawModelResponse);
    if (!jsonBlock) {
      throw new Error("No JSON block found in model response.");
    }

    result = normalizeResult(JSON.parse(jsonBlock), normalizedInput);
  } catch (error) {
    parseStatus = "model_unavailable";
    failureReason = String(error.message || "Unknown analysis error");
    rawModelResponse = rawModelResponse || failureReason;
    result = buildFallbackResult(normalizedInput, failureReason);
  }

  const latencyMs = Date.now() - startedAt;
  const estimatedCost = estimateCost(usageMetadata);

  const qaSummary = {
    verdict: result.verdict,
    confidence: result.confidence,
    riskLevel: result.riskLevel,
    riskScore: result.riskScore,
    fraudRisk: result.riskDimensions?.fraudRisk || null,
    conditionRisk: result.riskDimensions?.conditionRisk || null,
    priceFairness: result.riskDimensions?.priceFairness || null,
    analysisStatus: result.analysisStatus,
    parseStatus
  };

  const logRecord = {
    input: normalizedInput,
    raw_model_response: rawModelResponse,
    parsed_result: {
      ...result,
      failure_reason: failureReason,
      qa_summary: qaSummary,
      model_source: source,
      run_source: runSource
    },
    parse_status: parseStatus,
    model_version: DEFAULT_MODEL,
    latency_ms: latencyMs,
    estimated_cost: estimatedCost
  };

  let logSaved = false;
  let logMessage = null;
  if (runSource === "fixture") {
    logSaved = false;
    logMessage = "Skipped log persistence for fixture run.";
  } else {
    try {
      const logResult = await saveLog(logRecord);
      logSaved = logResult.saved;
      logMessage = logResult.reason || null;
    } catch (logError) {
      logSaved = false;
      logMessage = `Logging error: ${logError.message || "Unknown log failure"}`;
    }
  }

  return jsonResponse(res, 200, {
    result,
    parseStatus,
    rawModelResponse,
    modelVersion: DEFAULT_MODEL,
    latencyMs,
    estimatedCost,
    logSaved,
    logMessage,
    failureReason,
    qaSummary,
    runSource
  });
};
