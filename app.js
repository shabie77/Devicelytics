const form = document.getElementById("analysis-form");
const statusNode = document.getElementById("status");
const resultWrap = document.getElementById("result-wrap");
const placeholderText = document.getElementById("placeholder-text");

function setStatus(message, tone = "info") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function getRiskClass(level) {
  const norm = (level || "").toLowerCase();
  if (norm.includes("high")) return "risk-high";
  if (norm.includes("medium")) return "risk-medium";
  return "risk-low";
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
  if (!files || !files.length) return [];
  const picked = Array.from(files).slice(0, 3);
  const rawSizeLimit = 10 * 1024 * 1024;
  const encodedPayloadLimit = 3.2 * 1024 * 1024;

  for (const file of picked) {
    if (file.size > rawSizeLimit) {
      throw new Error(`${file.name} is larger than the 10MB limit.`);
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
  placeholderText.classList.add("hidden");
  resultWrap.classList.remove("hidden");

  const data = payload.result || {};
  const missingData = Array.isArray(data.missingData) ? data.missingData : [];

  document.getElementById("verdict-text").textContent = data.verdict || "Analysis Result";
  const riskPill = document.getElementById("risk-pill");
  riskPill.textContent = (data.riskLevel || "unknown").toUpperCase();
  riskPill.className = `risk-label ${getRiskClass(data.riskLevel)}`;

  document.getElementById("reason-text").textContent = data.reason || "No detailed reasoning provided.";
  document.getElementById("action-text").textContent = data.nextAction || "No specific recommendation provided.";

  const messageWrap = document.getElementById("message-wrap");
  if (data.suggestedMessage) {
    messageWrap.classList.remove("hidden");
    document.getElementById("suggested-message").textContent = data.suggestedMessage;
  } else {
    messageWrap.classList.add("hidden");
  }

  const missingWrap = document.getElementById("missing-wrap");
  const missingList = document.getElementById("missing-list");
  missingList.innerHTML = "";
  if (missingData.length) {
    missingWrap.classList.remove("hidden");
    missingData.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      missingList.appendChild(li);
    });
  } else {
    missingWrap.classList.add("hidden");
  }

  document.getElementById("latency-val").textContent = payload.latencyMs ? `${payload.latencyMs} ms` : "-";
  document.getElementById("cost-val").textContent = payload.estimatedCost !== null && payload.estimatedCost !== undefined
    ? `$${Number(payload.estimatedCost).toFixed(6)}`
    : "-";
  
  // Smooth scroll to result on mobile
  if (window.innerWidth < 800) {
    resultWrap.scrollIntoView({ behavior: 'smooth' });
  }
}

let isSubmitting = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;

  try {
    isSubmitting = true;
    document.body.classList.add("is-analyzing");
    const submitBtn = document.getElementById("submit-btn");
    submitBtn.disabled = true;
    setStatus("Scanning device context...");

    const images = await collectImages(document.getElementById("image-upload").files);
    
    const payload = {
      deviceName: document.getElementById("device-name").value.trim(),
      askingPrice: Number(document.getElementById("asking-price").value),
      description: document.getElementById("description").value.trim(),
      batteryHealth: document.getElementById("battery-health").value.trim() || null,
      imeiStatus: document.getElementById("imei-status").value || null,
      languageHint: document.getElementById("language-hint").value || null,
      images
    };

    setStatus("Appraising via Digital Bodyguard...");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Analysis failed");

    renderResult(data);
    setStatus("Analysis captured successfully.", "good");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "An unexpected error occurred.", "bad");
  } finally {
    isSubmitting = false;
    document.body.classList.remove("is-analyzing");
    const submitBtn = document.getElementById("submit-btn");
    if (submitBtn) submitBtn.disabled = false;
  }
});
