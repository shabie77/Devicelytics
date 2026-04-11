const form = document.getElementById("analysis-form");
const statusNode = document.getElementById("status");
const resultWrap = document.getElementById("result-wrap");
const placeholderText = document.getElementById("placeholder-text");
const submitButton = document.getElementById("submit-btn");
const resetButton = document.getElementById("reset-btn");

function setStatus(message, tone = "info") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function formatTitle(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRiskClass(level) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "high") return "risk-high";
  if (normalized === "low") return "risk-low";
  return "risk-medium";
}

function getActionClass(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized.includes("walk") || normalized.includes("pass")) return "action-chip bad";
  if (normalized.includes("buy")) return "action-chip good";
  return "action-chip warn";
}

function resetList(node, items, emptyMessageNode) {
  node.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!values.length) {
    if (emptyMessageNode) {
      emptyMessageNode.classList.remove("hidden");
    }
    return;
  }

  if (emptyMessageNode) {
    emptyMessageNode.classList.add("hidden");
  }

  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    node.appendChild(li);
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function readFileAsInlinePart(file) {
  const validMimes = ["image/jpeg", "image/png", "image/webp"];
  if (!validMimes.includes(file.type)) {
    throw new Error(`${file.name} is not a supported format. Please use JPEG, PNG, or WEBP.`);
  }

  const dataUrl = await readFile(file);
  const image = await loadImage(dataUrl);
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image compression is not supported in this browser.");
  }

  context.drawImage(image, 0, 0, width, height);
  const compressed = canvas.toDataURL("image/jpeg", 0.55);
  const [, base64] = compressed.split(",");

  return {
    name: `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
    mimeType: "image/jpeg",
    data: base64 || ""
  };
}

async function collectImages(files) {
  const picked = Array.from(files || []).slice(0, 3);
  const rawSizeLimit = 10 * 1024 * 1024;
  const encodedPayloadLimit = 3.2 * 1024 * 1024;

  for (const file of picked) {
    if (file.size > rawSizeLimit) {
      throw new Error(`${file.name} is larger than the 10MB upload limit.`);
    }
  }

  const images = await Promise.all(picked.map(readFileAsInlinePart));
  const encodedSize = images.reduce((total, image) => total + (image.data?.length || 0), 0);

  if (encodedSize > encodedPayloadLimit) {
    throw new Error("Compressed images are still too large. Retry with fewer or smaller photos.");
  }

  return images;
}

function renderResult(payload) {
  const result = payload.result || {};
  const riskDimensions = result.riskDimensions || {};
  const analysisStatus = result.analysisStatus || "ready";

  placeholderText.classList.add("hidden");
  resultWrap.classList.remove("hidden");

  document.getElementById("verdict-text").textContent = result.verdict || "Analysis result";
  document.getElementById("summary-text").textContent =
    analysisStatus === "unavailable"
      ? "The AI appraisal did not complete reliably. Use the manual verification guidance below."
      : result.nextAction || "Review the supporting evidence and decide on the next move.";

  const recommendedAction = document.getElementById("recommended-action");
  recommendedAction.textContent = result.recommendedAction || "Verify";
  recommendedAction.className = getActionClass(result.recommendedAction || "Verify");

  const riskPill = document.getElementById("risk-pill");
  riskPill.textContent = formatTitle(result.riskLevel || "medium");
  riskPill.className = `risk-label ${getRiskClass(result.riskLevel)}`;

  document.getElementById("risk-score").textContent = `${Number(result.riskScore || 0)} / 100`;
  document.getElementById("confidence-score").textContent = `${Number(result.confidence || 0)}%`;
  document.getElementById("price-fairness").textContent = formatTitle(riskDimensions.priceFairness || "unknown");
  document.getElementById("fraud-risk").textContent = formatTitle(riskDimensions.fraudRisk || "unknown");
  document.getElementById("condition-risk").textContent = formatTitle(riskDimensions.conditionRisk || "unknown");
  document.getElementById("analysis-status").textContent = formatTitle(analysisStatus);

  document.getElementById("reason-text").textContent = result.reason || "No detailed reasoning provided.";
  resetList(document.getElementById("why-list"), result.whyThisVerdict);
  resetList(document.getElementById("missing-list"), result.missingEvidence, document.getElementById("missing-empty"));
  resetList(document.getElementById("verify-list"), result.whatToVerify);
  resetList(document.getElementById("seller-questions"), result.sellerQuestions);

  document.getElementById("suggested-message").textContent =
    result.suggestedMessage || "Ask for the missing proof points before sending money.";

  document.getElementById("parse-status").textContent = formatTitle(payload.parseStatus || "unknown");
  document.getElementById("latency-val").textContent = payload.latencyMs ? `${payload.latencyMs} ms` : "-";
  document.getElementById("cost-val").textContent =
    payload.estimatedCost !== null && payload.estimatedCost !== undefined
      ? `$${Number(payload.estimatedCost).toFixed(6)}`
      : "-";
  document.getElementById("log-status").textContent = payload.logSaved ? "Saved" : (payload.logMessage || "Not saved");
  document.getElementById("raw-response").textContent = payload.rawModelResponse || "No raw response stored.";

  const failureReasonNode = document.getElementById("failure-reason");
  if (payload.failureReason) {
    failureReasonNode.textContent = `Failure reason: ${payload.failureReason}`;
    failureReasonNode.classList.remove("hidden");
  } else {
    failureReasonNode.textContent = "";
    failureReasonNode.classList.add("hidden");
  }

  if (window.innerWidth < 900) {
    resultWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function buildPayload() {
  const images = await collectImages(document.getElementById("image-upload").files);
  return {
    deviceName: document.getElementById("device-name").value.trim(),
    askingPrice: Number(document.getElementById("asking-price").value),
    description: document.getElementById("description").value.trim(),
    batteryHealth: document.getElementById("battery-health").value.trim() || null,
    imeiStatus: document.getElementById("imei-status").value || null,
    languageHint: document.getElementById("language-hint").value || null,
    images
  };
}

let isSubmitting = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;

  try {
    isSubmitting = true;
    document.body.classList.add("is-analyzing");
    submitButton.disabled = true;
    setStatus("Preparing your appraisal payload...");

    const payload = await buildPayload();
    setStatus("Running DeviceGuard trust checks...");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Analysis failed.");
    }

    renderResult(data);
    setStatus(
      data.result?.analysisStatus === "unavailable"
        ? "Analysis engine was unavailable. Manual verification guidance is shown below."
        : "Appraisal complete.",
      data.result?.analysisStatus === "unavailable" ? "warn" : "good"
    );
  } catch (error) {
    setStatus(error.message || "Something went wrong.", "bad");
  } finally {
    isSubmitting = false;
    document.body.classList.remove("is-analyzing");
    submitButton.disabled = false;
  }
});

resetButton.addEventListener("click", () => {
  placeholderText.classList.remove("hidden");
  resultWrap.classList.add("hidden");
  setStatus("");
});
