const refreshButton = document.getElementById("refresh");
const statusNode = document.getElementById("status");
const tableBody = document.getElementById("log-table-body");
const rawOutput = document.getElementById("raw-output");

function setStatus(message, tone = "info") {
  statusNode.textContent = message;
  statusNode.className = `status ${tone}`;
}

function createCell(content) {
  const td = document.createElement("td");
  td.textContent = content;
  return td;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderMetrics(rows) {
  const total = rows.length;
  const highRisk = rows.filter((row) => row.parsed_result?.riskLevel === "high").length;
  const unavailable = rows.filter((row) => row.parsed_result?.analysisStatus === "unavailable").length;
  const confidenceValues = rows
    .map((row) => Number(row.parsed_result?.confidence))
    .filter((value) => Number.isFinite(value));
  const avgConfidence = confidenceValues.length
    ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
    : 0;

  document.getElementById("metric-total").textContent = String(total);
  document.getElementById("metric-high").textContent = String(highRisk);
  document.getElementById("metric-unavailable").textContent = String(unavailable);
  document.getElementById("metric-confidence").textContent = `${avgConfidence}%`;
}

function renderDetail(row) {
  const result = row.parsed_result || {};
  document.getElementById("detail-title").textContent = row.input?.deviceName || "Selected run";
  document.getElementById("detail-summary").textContent =
    `${result.verdict || "Unknown verdict"} | Risk ${formatValue(result.riskLevel)} | ` +
    `Fraud ${formatValue(result.riskDimensions?.fraudRisk)} | ` +
    `Condition ${formatValue(result.riskDimensions?.conditionRisk)}`;
  document.getElementById("detail-action").textContent = result.nextAction || "No guidance captured.";

  const missingList = document.getElementById("detail-missing");
  missingList.innerHTML = "";
  (result.missingEvidence || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    missingList.appendChild(li);
  });
  if (!missingList.childElementCount) {
    const li = document.createElement("li");
    li.textContent = "No major missing evidence recorded in this run.";
    missingList.appendChild(li);
  }

  rawOutput.textContent = row.raw_model_response || "No raw response stored.";
}

async function loadLogs() {
  setStatus("Loading logs...");
  tableBody.innerHTML = "";
  rawOutput.textContent = "Select a row after loading logs.";

  try {
    let qaToken = sessionStorage.getItem("qaToken");
    if (!qaToken) {
      qaToken = prompt("Enter QA password to view logs:");
      if (qaToken) sessionStorage.setItem("qaToken", qaToken);
    }

    const response = await fetch("/api/logs", {
      headers: {
        "X-QA-Token": (qaToken || "").trim()
      }
    });
    const payload = await response.json();

    if (response.status === 401) {
      sessionStorage.removeItem("qaToken");
    }

    if (!response.ok) {
      const diag = payload.received ? ` (Got: ${payload.received})` : "";
      throw new Error((payload.error || "Could not load logs.") + diag);
    }

    const rows = payload.logs || [];
    renderMetrics(rows);

    if (!rows.length) {
      setStatus(payload.message || "No logs found yet.", "warn");
      return;
    }

    rows.forEach((row) => {
      const result = row.parsed_result || {};
      const tr = document.createElement("tr");
      tr.appendChild(createCell(row.created_at || "-"));
      tr.appendChild(createCell(row.input?.deviceName || "-"));
      tr.appendChild(createCell(result.verdict || "-"));
      tr.appendChild(createCell(formatValue(result.riskDimensions?.fraudRisk)));
      tr.appendChild(createCell(formatValue(result.riskDimensions?.conditionRisk)));
      tr.appendChild(createCell(result.confidence !== null && result.confidence !== undefined ? `${result.confidence}%` : "-"));
      tr.appendChild(createCell(row.parse_status || "-"));
      tr.addEventListener("click", () => renderDetail(row));
      tableBody.appendChild(tr);
    });

    renderDetail(rows[0]);
    setStatus(`Loaded ${rows.length} runs.`, "good");
  } catch (error) {
    setStatus(error.message || "Could not load logs.", "bad");
  }
}

refreshButton.addEventListener("click", loadLogs);
loadLogs();
