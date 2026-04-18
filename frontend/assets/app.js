const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl;
if (!apiBaseUrl) {
  throw new Error("APP_CONFIG.apiBaseUrl is required. Configure FRONTEND_API_BASE_URL in .env.");
}

const menuJobs = document.getElementById("menu-jobs");
const refreshJobsBtn = document.getElementById("refresh-jobs");
const jobsTbody = document.getElementById("jobs-tbody");
const paramsModal = document.getElementById("params-modal");
const paramsModalTitle = document.getElementById("params-modal-title");
const paramsModalInput = document.getElementById("params-modal-input");
const paramsModalHint = document.getElementById("params-modal-hint");
const paramsModalCheck = document.getElementById("params-modal-check");
const paramsModalFormat = document.getElementById("params-modal-format");
const paramsModalSave = document.getElementById("params-modal-save");
const paramsModalClose = document.getElementById("params-modal-close");
const executionStatusByJobId = {};
const runInfoByJobId = {};
const jobParameterDefaultsByJobId = {};
const jobParameterDraftByJobId = {};
const jobParameterStateByJobId = {};
const jobNameByJobId = {};
let activeParamJobId = null;

function statusMeta(status) {
  if (status === "success") return { icon: "✅", cls: "status-success", label: "Trigger succeeded" };
  if (status === "error") return { icon: "❌", cls: "status-error", label: "Trigger failed" };
  if (status === "running") return { icon: "⏳", cls: "status-running", label: "Triggering" };
  return { icon: "•", cls: "status-idle", label: "Not triggered" };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nameText(item) {
  return item?.settings?.name || `job_${item.job_id}`;
}

function runLinkHtml(jobId) {
  const info = runInfoByJobId[jobId];
  if (!info || !info.runId || !info.runUrl) {
    return "-";
  }

  const runIdLabel = escapeHtml(String(info.runId));
  const runUrl = escapeHtml(String(info.runUrl));
  return `<a class="run-link" href="${runUrl}" target="_blank" rel="noopener noreferrer">${runIdLabel}</a>`;
}

function collectJobParameters(item) {
  const paramNames = new Set();
  const defaults = {};
  const settingsParams = item?.settings?.parameters;

  if (Array.isArray(settingsParams)) {
    for (const param of settingsParams) {
      if (typeof param?.name === "string" && param.name.trim()) {
        const key = param.name.trim();
        paramNames.add(key);
        if (param?.default !== undefined && param.default !== null) {
          defaults[key] = String(param.default);
        }
      }
    }
  }

  const tasks = Array.isArray(item?.settings?.tasks) ? item.settings.tasks : [];
  for (const task of tasks) {
    const notebookBase = task?.notebook_task?.base_parameters;
    if (notebookBase && typeof notebookBase === "object") {
      for (const [key, value] of Object.entries(notebookBase)) {
        const cleanKey = key.trim();
        if (!cleanKey) continue;
        paramNames.add(cleanKey);
        defaults[cleanKey] = value === undefined || value === null ? "" : String(value);
      }
    }

    const namedWheel = task?.python_wheel_task?.named_parameters;
    if (namedWheel && typeof namedWheel === "object") {
      for (const [key, value] of Object.entries(namedWheel)) {
        const cleanKey = key.trim();
        if (!cleanKey) continue;
        paramNames.add(cleanKey);
        defaults[cleanKey] = value === undefined || value === null ? "" : String(value);
      }
    }
  }

  return {
    names: Array.from(paramNames).sort(),
    defaults,
  };
}

function jsonDraftForJob(jobId, defaults) {
  if (jobParameterDraftByJobId[jobId] !== undefined) {
    return jobParameterDraftByJobId[jobId];
  }

  const draft = JSON.stringify(defaults, null, 2);
  jobParameterDraftByJobId[jobId] = draft;
  return draft;
}

function parseParameterDraft(jobId) {
  const draft = (jobParameterDraftByJobId[jobId] || "").trim();
  const defaults = jobParameterDefaultsByJobId[jobId] || {};
  const source = draft || JSON.stringify(defaults);
  return JSON.parse(source);
}

function setParameterState(jobId, status, message) {
  jobParameterStateByJobId[jobId] = { status, message };
}

function setModalHint(status, message) {
  if (!paramsModalHint) return;
  paramsModalHint.className = "params-modal-hint";
  if (status === "ok") paramsModalHint.classList.add("ok");
  if (status === "error") paramsModalHint.classList.add("error");
  paramsModalHint.textContent = message || "";
}

function openParamsModal(jobId) {
  if (!paramsModal || !paramsModalInput) return;

  const defaults = jobParameterDefaultsByJobId[jobId] || {};
  const draft = jsonDraftForJob(jobId, defaults);
  activeParamJobId = jobId;
  paramsModalInput.value = draft;

  if (paramsModalTitle) {
    const jobName = jobNameByJobId[jobId] || `Job ${jobId}`;
    paramsModalTitle.textContent = `${jobName} Parameters`;
  }

  const state = jobParameterStateByJobId[jobId] || { status: "idle", message: "" };
  setModalHint(state.status, state.message);
  paramsModal.classList.add("is-open");
  paramsModal.setAttribute("aria-hidden", "false");
  paramsModalInput.focus();
}

function closeParamsModal() {
  if (!paramsModal) return;
  activeParamJobId = null;
  paramsModal.classList.remove("is-open");
  paramsModal.setAttribute("aria-hidden", "true");
}

function jobParamsHtml(item) {
  const jobId = item.job_id;
  const { names, defaults } = collectJobParameters(item);
  jobParameterDefaultsByJobId[jobId] = defaults;

  if (names.length === 0) {
    return '<span class="params-none">-</span>';
  }

  jsonDraftForJob(jobId, defaults);
  const state = jobParameterStateByJobId[jobId] || { status: "idle" };
  const statusBadgeClass = state.status === "error" ? "params-status error" : state.status === "ok" ? "params-status ok" : "params-status";
  const statusText = state.status === "error" ? "invalid" : state.status === "ok" ? "valid" : "ready";
  return `
    <div class="params-inline" data-job-id="${jobId}">
      <button class="params-open-btn" type="button" data-action="open-params" data-job-id="${jobId}" title="Edit JSON parameters">+</button>
      <span class="${statusBadgeClass}">${statusText}</span>
    </div>
  `;
}

function normalizeRunParameters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Job parameters must be a JSON object.");
  }

  const normalized = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    const key = String(rawKey).trim();
    if (!key) {
      throw new Error("Parameter names cannot be empty.");
    }

    if (entry !== null && typeof entry === "object") {
      throw new Error(`Parameter '${key}' must be string, number, boolean, or null.`);
    }

    normalized[key] = entry === undefined || entry === null ? "" : String(entry);
  }

  return normalized;
}

function buildRunPayload(jobId) {
  const defaults = jobParameterDefaultsByJobId[jobId] || {};
  const draft = (jobParameterDraftByJobId[jobId] || "").trim();
  const hasDefaults = Object.keys(defaults).length > 0;

  if (!hasDefaults && !draft) {
    return null;
  }

  let parsed;
  try {
    parsed = parseParameterDraft(jobId);
  } catch {
    throw new Error("Invalid JSON in Job Parameters.");
  }

  return {
    parameters: normalizeRunParameters(parsed),
  };
}

async function http(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(typeof payload === "object" ? JSON.stringify(payload) : String(payload));
  }

  return payload;
}

async function loadJobs() {
  jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Carregando jobs...</td></tr>';

  try {
    const data = await http("/databricks/jobs?limit=25&offset=0&expand_tasks=true");
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Nenhum job encontrado.</td></tr>';
      return;
    }

    jobsTbody.innerHTML = items
      .map((item) => {
        const jobId = item.job_id;
        jobNameByJobId[jobId] = nameText(item);
        const meta = statusMeta(executionStatusByJobId[jobId]);
        const paramsHtml = jobParamsHtml(item);
        return `
          <tr>
            <td class="job-name">${escapeHtml(nameText(item))}</td>
            <td>Job</td>
            <td>${runLinkHtml(jobId)}</td>
            <td class="params-cell">${paramsHtml}</td>
            <td class="status-cell">
              <span class="status-icon ${meta.cls}" title="${meta.label}">${meta.icon}</span>
            </td>
            <td class="actions-col">
              <button class="play-btn" type="button" data-job-id="${jobId}" title="Executar job">▶</button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Erro ao carregar jobs.</td></tr>';
  }
}

async function runJob(jobId) {
  let runPayload = null;
  try {
    runPayload = buildRunPayload(jobId);
    setParameterState(jobId, "ok", "JSON valid");
  } catch (error) {
    executionStatusByJobId[jobId] = "error";
    setParameterState(jobId, "error", error.message);
    await loadJobs();
    alert(error.message);
    return;
  }

  executionStatusByJobId[jobId] = "running";
  await loadJobs();

  try {
    const payload = await http(`/databricks/jobs/${jobId}/run`, {
      method: "POST",
      ...(runPayload ? { body: JSON.stringify(runPayload) } : {}),
    });
    const runId = payload?.run_id || payload?.number_in_job || payload?.response?.run_id || payload?.response?.number_in_job;
    const runUrl = payload?.run_url || payload?.response?.run_url;

    if (runId && runUrl) {
      runInfoByJobId[jobId] = { runId, runUrl };
    }

    executionStatusByJobId[jobId] = "success";
  } catch (error) {
    executionStatusByJobId[jobId] = "error";
  }

  await loadJobs();
}

menuJobs.addEventListener("click", async () => {
  await loadJobs();
});

refreshJobsBtn.addEventListener("click", async () => {
  await loadJobs();
});

jobsTbody.addEventListener("click", async (event) => {
  const openParams = event.target.closest("button[data-action='open-params']");
  if (openParams) {
    const jobId = openParams.getAttribute("data-job-id");
    if (jobId) {
      openParamsModal(jobId);
    }
    return;
  }

  const button = event.target.closest("button.play-btn");
  if (!button) return;

  const jobId = button.getAttribute("data-job-id");
  if (!jobId) return;

  await runJob(jobId);
});

if (paramsModalInput) {
  paramsModalInput.addEventListener("input", () => {
    if (!activeParamJobId) return;
    jobParameterDraftByJobId[activeParamJobId] = paramsModalInput.value;
    setModalHint("idle", "");
    if (jobParameterStateByJobId[activeParamJobId]) {
      setParameterState(activeParamJobId, "idle", "");
    }
  });
}

if (paramsModalCheck) {
  paramsModalCheck.addEventListener("click", () => {
    if (!activeParamJobId || !paramsModalInput) return;

    jobParameterDraftByJobId[activeParamJobId] = paramsModalInput.value;
    try {
      const parsed = parseParameterDraft(activeParamJobId);
      normalizeRunParameters(parsed);
      setParameterState(activeParamJobId, "ok", "JSON valid");
      setModalHint("ok", "JSON valid");
    } catch {
      setParameterState(activeParamJobId, "error", "Invalid JSON object");
      setModalHint("error", "Invalid JSON object");
    }
  });
}

if (paramsModalFormat) {
  paramsModalFormat.addEventListener("click", () => {
    if (!activeParamJobId || !paramsModalInput) return;

    jobParameterDraftByJobId[activeParamJobId] = paramsModalInput.value;
    try {
      const parsed = parseParameterDraft(activeParamJobId);
      const normalized = normalizeRunParameters(parsed);
      const formatted = JSON.stringify(normalized, null, 2);
      jobParameterDraftByJobId[activeParamJobId] = formatted;
      paramsModalInput.value = formatted;
      setParameterState(activeParamJobId, "ok", "JSON formatted");
      setModalHint("ok", "JSON formatted");
    } catch {
      setParameterState(activeParamJobId, "error", "Invalid JSON object");
      setModalHint("error", "Invalid JSON object");
    }
  });
}

if (paramsModalSave) {
  paramsModalSave.addEventListener("click", async () => {
    if (!activeParamJobId || !paramsModalInput) return;

    jobParameterDraftByJobId[activeParamJobId] = paramsModalInput.value;
    try {
      const parsed = parseParameterDraft(activeParamJobId);
      const normalized = normalizeRunParameters(parsed);
      jobParameterDraftByJobId[activeParamJobId] = JSON.stringify(normalized, null, 2);
      setParameterState(activeParamJobId, "ok", "JSON saved");
      closeParamsModal();
      await loadJobs();
    } catch {
      setParameterState(activeParamJobId, "error", "Invalid JSON object");
      setModalHint("error", "Invalid JSON object");
    }
  });
}

if (paramsModalClose) {
  paramsModalClose.addEventListener("click", async () => {
    closeParamsModal();
    await loadJobs();
  });
}

if (paramsModal) {
  paramsModal.addEventListener("click", async (event) => {
    if (event.target === paramsModal) {
      closeParamsModal();
      await loadJobs();
    }
  });
}

loadJobs();
