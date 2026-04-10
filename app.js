const form = document.getElementById("analysis-form");
const statusNode = document.getElementById("status");
const resultPanel = document.getElementById("result-panel");
const emptyState = document.getElementById("empty-state");

function setStatus(message, tone = "info") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function verdictClass(verdict) {
  const normalized = (verdict || "").toLowerCase();
  if (normalized.includes("need more details")) {
    return "warn";
  }
  if (normalized.includes("high risk") || normalized.includes("not worth it")) {
    return "bad";
  }
  if (normalized.includes("worth")) {
    return "good";
  }
  if (normalized.includes("average")) {
    return "warn";
  }
  return "info";
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
  const maxDimension = 1024;
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
  const compressed = canvas.toDataURL("image/jpeg", 0.65);
  const [, base64] = compressed.split(",");

  return {
    name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
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
      throw new Error(`${file.name} is larger than the 10MB prototype limit.`);
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
  emptyState.classList.add("hidden");
  resultPanel.classList.remove("hidden");

  const result = payload.result || {};
  const missingData = Array.isArray(result.missingData) ? result.missingData : [];

  document.getElementById("verdict").textContent = result.verdict || "Need more details";
  document.getElementById("verdict").className = `verdict ${verdictClass(result.verdict)}`;
  document.getElementById("reason").textContent = result.reason || "The response did not meet the expected format.";
  document.getElementById("nextAction").textContent = result.nextAction || "Retry with clearer details and at least one photo.";
  document.getElementById("suggestedMessage").textContent = result.suggestedMessage || "Share more details or ask the seller for clearer proof.";
  document.getElementById("riskLevel").textContent = result.riskLevel || "unknown";
  document.getElementById("parseStatus").textContent = payload.parseStatus || "unknown";
  document.getElementById("latency").textContent = payload.latencyMs ? `Latency: ${payload.latencyMs} ms` : "Latency not available";
  document.getElementById("cost").textContent = payload.estimatedCost !== null && payload.estimatedCost !== undefined
    ? `Estimated cost: $${Number(payload.estimatedCost).toFixed(6)}`
    : "Estimated cost unavailable";
  document.getElementById("rawResponse").textContent = payload.rawModelResponse || "No raw model response stored.";

  const missingWrap = document.getElementById("missing-wrap");
  const missingList = document.getElementById("missingData");
  missingList.innerHTML = "";

  if (missingData.length) {
    missingWrap.classList.remove("hidden");
    missingData.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      missingList.appendChild(li);
    });
  } else {
    missingWrap.classList.add("hidden");
  }
}

let isSubmitting = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  
  if (isSubmitting) return;
  isSubmitting = true;

  setStatus("Preparing request...");
  
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const formData = new FormData(form);
    const images = await collectImages(document.getElementById("images").files);

    const payload = {
      deviceName: String(formData.get("deviceName") || "").trim(),
      askingPrice: Number(formData.get("askingPrice") || 0),
      description: String(formData.get("description") || "").trim(),
      batteryHealth: String(formData.get("batteryHealth") || "").trim() || null,
      imeiStatus: String(formData.get("imeiStatus") || "").trim() || null,
      languageHint: String(formData.get("languageHint") || "").trim() || null,
      images
    };

    setStatus("Running analysis...");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Analysis failed");
    }

    renderResult(data);
    setStatus("Analysis complete.", "good");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", "bad");
  } finally {
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;
    isSubmitting = false;
  }
});
