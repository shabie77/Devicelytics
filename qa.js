const fixtureBody = document.getElementById("fixture-body");
const qaStatus = document.getElementById("qa-status");
const runButton = document.getElementById("run-fixtures");

function setStatus(message, tone = "info") {
  qaStatus.textContent = message;
  qaStatus.className = `status ${tone}`;
}

function matchesExpectation(actual, expectedValues) {
  return Array.isArray(expectedValues) && expectedValues.includes(actual);
}

function renderSummary(results) {
  const total = results.length;
  const passed = results.filter((result) => result.pass).length;
  const failed = total - passed;

  document.getElementById("fixture-total").textContent = String(total);
  document.getElementById("fixture-pass").textContent = String(passed);
  document.getElementById("fixture-fail").textContent = String(failed);
}

function renderDetail(result) {
  document.getElementById("fixture-detail-title").textContent = result.fixture.name;
  document.getElementById("fixture-detail-summary").textContent =
    `${result.payload.result?.verdict || "No verdict"} | ` +
    `risk ${result.payload.result?.riskLevel || "-"} | ` +
    `action ${result.payload.result?.recommendedAction || "-"}`;
  document.getElementById("fixture-raw").textContent = result.payload.rawModelResponse || "No raw model response.";
}

async function loadFixtures() {
  const response = await fetch("/fixtures/canonical-cases.json");
  if (!response.ok) {
    throw new Error("Could not load canonical fixtures.");
  }
  return response.json();
}

async function runFixture(fixture) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...fixture.input,
      images: fixture.input.images || [],
      qaMode: true,
      runSource: "fixture"
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Fixture failed: ${fixture.name}`);
  }

  const verdictPass = matchesExpectation(payload.result?.verdict, fixture.expectedVerdict);
  const riskPass = matchesExpectation(payload.result?.riskLevel, fixture.expectedRiskLevel);
  const actionPass = matchesExpectation(payload.result?.recommendedAction, fixture.expectedAction);

  return {
    fixture,
    payload,
    pass: verdictPass && riskPass && actionPass,
    verdictPass,
    riskPass,
    actionPass
  };
}

function renderResults(results) {
  fixtureBody.innerHTML = "";

  results.forEach((result, index) => {
    const tr = document.createElement("tr");
    tr.className = result.pass ? "fixture-row pass" : "fixture-row fail";
    tr.innerHTML = `
      <td>${result.fixture.name}</td>
      <td>${result.fixture.expectedVerdict.join(", ")}</td>
      <td>${result.payload.result?.verdict || "-"}</td>
      <td>${result.payload.result?.riskLevel || "-"}</td>
      <td>${result.payload.result?.recommendedAction || "-"}</td>
    `;
    tr.addEventListener("click", () => renderDetail(result));
    fixtureBody.appendChild(tr);

    if (index === 0) {
      renderDetail(result);
    }
  });
}

async function runFixtures() {
  try {
    runButton.disabled = true;
    setStatus("Loading fixtures...");
    const fixtures = await loadFixtures();
    fixtureBody.innerHTML = "";

    const results = [];
    for (const fixture of fixtures) {
      setStatus(`Running ${fixture.name}...`);
      const result = await runFixture(fixture);
      results.push(result);
    }

    renderResults(results);
    renderSummary(results);
    const failures = results.filter((result) => !result.pass).length;
    setStatus(
      failures ? `${failures} fixture(s) need review.` : "All fixtures passed their expected ranges.",
      failures ? "warn" : "good"
    );
  } catch (error) {
    setStatus(error.message || "Fixture run failed.", "bad");
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", runFixtures);
