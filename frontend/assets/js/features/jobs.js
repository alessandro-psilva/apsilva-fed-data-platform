import { dom } from "../core/dom.js";
import { state } from "../core/state.js";
import { http } from "../core/api.js";

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
  const info = state.runInfoByJobId[jobId];
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
  if (state.jobParameterDraftByJobId[jobId] !== undefined) {
    return state.jobParameterDraftByJobId[jobId];
  }

  const draft = JSON.stringify(defaults, null, 2);
  state.jobParameterDraftByJobId[jobId] = draft;
  return draft;
}

function parseParameterDraft(jobId) {
  const draft = (state.jobParameterDraftByJobId[jobId] || "").trim();
  const defaults = state.jobParameterDefaultsByJobId[jobId] || {};
  const source = draft || JSON.stringify(defaults);
  return JSON.parse(source);
}

function setParameterState(jobId, status, message) {
  state.jobParameterStateByJobId[jobId] = { status, message };
}

function setModalHint(status, message) {
  if (!dom.paramsModalHint) return;
  dom.paramsModalHint.className = "params-modal-hint";
  if (status === "ok") dom.paramsModalHint.classList.add("ok");
  if (status === "error") dom.paramsModalHint.classList.add("error");
  dom.paramsModalHint.textContent = message || "";
}

function openParamsModal(jobId) {
  if (!dom.paramsModal || !dom.paramsModalInput) return;

  const defaults = state.jobParameterDefaultsByJobId[jobId] || {};
  const draft = jsonDraftForJob(jobId, defaults);
  state.activeParamJobId = jobId;
  dom.paramsModalInput.value = draft;

  if (dom.paramsModalTitle) {
    const jobName = state.jobNameByJobId[jobId] || `Job ${jobId}`;
    dom.paramsModalTitle.textContent = `${jobName} Parameters`;
  }

  const stateForJob = state.jobParameterStateByJobId[jobId] || { status: "idle", message: "" };
  setModalHint(stateForJob.status, stateForJob.message);
  dom.paramsModal.classList.add("is-open");
  dom.paramsModal.setAttribute("aria-hidden", "false");
  dom.paramsModalInput.focus();
}

function closeParamsModal() {
  if (!dom.paramsModal) return;
  state.activeParamJobId = null;
  dom.paramsModal.classList.remove("is-open");
  dom.paramsModal.setAttribute("aria-hidden", "true");
}

function jobParamsHtml(item) {
  const jobId = item.job_id;
  const { names, defaults } = collectJobParameters(item);
  state.jobParameterDefaultsByJobId[jobId] = defaults;

  if (names.length === 0) {
    return '<span class="params-none">-</span>';
  }

  jsonDraftForJob(jobId, defaults);
  const stateForJob = state.jobParameterStateByJobId[jobId] || { status: "idle" };
  const statusBadgeClass =
    stateForJob.status === "error"
      ? "params-status error"
      : stateForJob.status === "ok"
        ? "params-status ok"
        : "params-status";
  const statusText = stateForJob.status === "error" ? "invalid" : stateForJob.status === "ok" ? "valid" : "ready";
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
  const defaults = state.jobParameterDefaultsByJobId[jobId] || {};
  const draft = (state.jobParameterDraftByJobId[jobId] || "").trim();
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

export async function loadJobs() {
  if (!dom.jobsTbody) return;

  dom.jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Carregando jobs...</td></tr>';

  try {
    const data = await http("/databricks/jobs?limit=25&offset=0&expand_tasks=true");
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      dom.jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Nenhum job encontrado.</td></tr>';
      return;
    }

    dom.jobsTbody.innerHTML = items
      .map((item) => {
        const jobId = item.job_id;
        state.jobNameByJobId[jobId] = nameText(item);
        const meta = statusMeta(state.executionStatusByJobId[jobId]);
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
  } catch {
    dom.jobsTbody.innerHTML = '<tr><td colspan="6" class="loading-row">Erro ao carregar jobs.</td></tr>';
  }
}

async function runJob(jobId) {
  let runPayload = null;
  try {
    runPayload = buildRunPayload(jobId);
    setParameterState(jobId, "ok", "JSON valid");
  } catch (error) {
    state.executionStatusByJobId[jobId] = "error";
    setParameterState(jobId, "error", error.message);
    await loadJobs();
    alert(error.message);
    return;
  }

  state.executionStatusByJobId[jobId] = "running";
  await loadJobs();

  try {
    const payload = await http(`/databricks/jobs/${jobId}/run`, {
      method: "POST",
      ...(runPayload ? { body: JSON.stringify(runPayload) } : {}),
    });
    const runId = payload?.run_id || payload?.number_in_job || payload?.response?.run_id || payload?.response?.number_in_job;
    const runUrl = payload?.run_url || payload?.response?.run_url;

    if (runId && runUrl) {
      state.runInfoByJobId[jobId] = { runId, runUrl };
    }

    state.executionStatusByJobId[jobId] = "success";
  } catch {
    state.executionStatusByJobId[jobId] = "error";
  }

  await loadJobs();
}

export function bindJobsEvents() {
  if (!dom.jobsTbody) return;

  dom.jobsTbody.addEventListener("click", async (event) => {
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
}

export function bindParamsModalEvents() {
  if (dom.paramsModalInput) {
    dom.paramsModalInput.addEventListener("input", () => {
      if (!state.activeParamJobId) return;
      state.jobParameterDraftByJobId[state.activeParamJobId] = dom.paramsModalInput.value;
      setModalHint("idle", "");
      if (state.jobParameterStateByJobId[state.activeParamJobId]) {
        setParameterState(state.activeParamJobId, "idle", "");
      }
    });
  }

  if (dom.paramsModalCheck) {
    dom.paramsModalCheck.addEventListener("click", () => {
      if (!state.activeParamJobId || !dom.paramsModalInput) return;

      state.jobParameterDraftByJobId[state.activeParamJobId] = dom.paramsModalInput.value;
      try {
        const parsed = parseParameterDraft(state.activeParamJobId);
        normalizeRunParameters(parsed);
        setParameterState(state.activeParamJobId, "ok", "JSON valid");
        setModalHint("ok", "JSON valid");
      } catch {
        setParameterState(state.activeParamJobId, "error", "Invalid JSON object");
        setModalHint("error", "Invalid JSON object");
      }
    });
  }

  if (dom.paramsModalFormat) {
    dom.paramsModalFormat.addEventListener("click", () => {
      if (!state.activeParamJobId || !dom.paramsModalInput) return;

      state.jobParameterDraftByJobId[state.activeParamJobId] = dom.paramsModalInput.value;
      try {
        const parsed = parseParameterDraft(state.activeParamJobId);
        const normalized = normalizeRunParameters(parsed);
        const formatted = JSON.stringify(normalized, null, 2);
        state.jobParameterDraftByJobId[state.activeParamJobId] = formatted;
        dom.paramsModalInput.value = formatted;
        setParameterState(state.activeParamJobId, "ok", "JSON formatted");
        setModalHint("ok", "JSON formatted");
      } catch {
        setParameterState(state.activeParamJobId, "error", "Invalid JSON object");
        setModalHint("error", "Invalid JSON object");
      }
    });
  }

  if (dom.paramsModalSave) {
    dom.paramsModalSave.addEventListener("click", async () => {
      if (!state.activeParamJobId || !dom.paramsModalInput) return;

      state.jobParameterDraftByJobId[state.activeParamJobId] = dom.paramsModalInput.value;
      try {
        const parsed = parseParameterDraft(state.activeParamJobId);
        const normalized = normalizeRunParameters(parsed);
        state.jobParameterDraftByJobId[state.activeParamJobId] = JSON.stringify(normalized, null, 2);
        setParameterState(state.activeParamJobId, "ok", "JSON saved");
        closeParamsModal();
        await loadJobs();
      } catch {
        setParameterState(state.activeParamJobId, "error", "Invalid JSON object");
        setModalHint("error", "Invalid JSON object");
      }
    });
  }

  if (dom.paramsModalClose) {
    dom.paramsModalClose.addEventListener("click", async () => {
      closeParamsModal();
      await loadJobs();
    });
  }

  if (dom.paramsModal) {
    dom.paramsModal.addEventListener("click", async (event) => {
      if (event.target === dom.paramsModal) {
        closeParamsModal();
        await loadJobs();
      }
    });
  }
}
