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

async function loadLogs() {
  setStatus("Loading logs...");
  tableBody.innerHTML = "";
  rawOutput.textContent = "Select a row after loading logs.";

  try {
    let qaToken = sessionStorage.getItem("qaToken");
    if (!qaToken) {
      qaToken = prompt("Enter QA Password to view logs:");
      if (qaToken) sessionStorage.setItem("qaToken", qaToken);
    }

    const response = await fetch("/api/logs", {
      headers: { "Authorization": qaToken || "" }
    });
    const payload = await response.json();

    if (response.status === 401) {
      sessionStorage.removeItem("qaToken"); // clear bad token
    }

    if (!response.ok) {
      throw new Error(payload.error || "Could not load logs.");
    }

    const rows = payload.logs || [];

    if (!rows.length) {
      setStatus(payload.message || "No logs found yet.", "warn");
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.appendChild(createCell(row.created_at || "-"));
      tr.appendChild(createCell(row.input?.deviceName || "-"));
      tr.appendChild(createCell(row.parse_status || "-"));
      tr.appendChild(createCell(row.latency_ms ? `${row.latency_ms} ms` : "-"));
      tr.appendChild(createCell(row.estimated_cost !== null && row.estimated_cost !== undefined ? `$${row.estimated_cost}` : "-"));
      tr.appendChild(createCell(row.parsed_result?.verdict || "-"));
      tr.addEventListener("click", () => {
        rawOutput.textContent = row.raw_model_response || "No raw response stored.";
      });
      tableBody.appendChild(tr);
    });

    setStatus(`Loaded ${rows.length} logs.`, "good");
  } catch (error) {
    setStatus(error.message || "Could not load logs.", "bad");
  }
}

refreshButton.addEventListener("click", loadLogs);
loadLogs();
