const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl;
if (!apiBaseUrl) {
  throw new Error("APP_CONFIG.apiBaseUrl is required. Configure FRONTEND_API_BASE_URL in .env.");
}

const menuJobs = document.getElementById("menu-jobs");
const menuDataEntry = document.getElementById("menu-data-entry");
const menuMetrics = document.getElementById("menu-metrics");
const refreshJobsBtn = document.getElementById("refresh-jobs");
const jobsTbody = document.getElementById("jobs-tbody");
const jobsView = document.getElementById("jobs-view");
const dataEntryView = document.getElementById("data-entry-view");
const metricsView = document.getElementById("metrics-view");
const volumesTbody = document.getElementById("volumes-tbody");
const volumeUploadInput = document.getElementById("volume-upload-input");
const metricsHistoryTbody = document.getElementById("metrics-history-tbody");
const metricApiStatus = document.getElementById("metric-api-status");
const metricJobsCount = document.getElementById("metric-jobs-count");
const metricVolumesCount = document.getElementById("metric-volumes-count");
const metricUploadRate = document.getElementById("metric-upload-rate");
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
const volumeUploadStatusByKey = {};
let activeParamJobId = null;
let selectedVolumeForUpload = null;
let volumesCache = [];
let activeView = "jobs";

function statusMeta(status) {
  if (status === "success") return { icon: "✅", cls: "status-success", label: "Trigger succeeded" };
  if (status === "error") return { icon: "❌", cls: "status-error", label: "Trigger failed" };
  if (status === "running") return { icon: "⏳", cls: "status-running", label: "Triggering" };
  return { icon: "•", cls: "status-idle", label: "Not triggered" };
}

function uploadStatusMeta(status) {
  if (status === "success") return { icon: "✅", cls: "status-success", label: "Upload concluido" };
  if (status === "error") return { icon: "❌", cls: "status-error", label: "Upload com erro" };
  if (status === "running") return { icon: "⏳", cls: "status-running", label: "Enviando" };
  return { icon: "•", cls: "status-idle", label: "Nao enviado" };
}

function metricsStatusMeta(status, eventType) {
  const normalizedEventType = String(eventType || "upload").toLowerCase();
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedEventType === "job") {
    if (normalizedStatus === "success") return { icon: "✅", cls: "status-success", label: "Job executado" };
    if (normalizedStatus === "error") return { icon: "❌", cls: "status-error", label: "Erro na execucao do job" };
    if (normalizedStatus === "running") return { icon: "⏳", cls: "status-running", label: "Job em execucao" };
    return { icon: "•", cls: "status-idle", label: "Job sem execucao" };
  }

  return uploadStatusMeta(normalizedStatus);
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

async function httpUpload(path, formData) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    body: formData,
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

function volumeKey(volume) {
  return `${volume.catalog_name}.${volume.schema_name}.${volume.volume_name}`;
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    hour12: false,
  });
}

function renderMetricsRows(items) {
  if (!metricsHistoryTbody) return;

  if (!items.length) {
    metricsHistoryTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Sem eventos recentes.</td></tr>';
    return;
  }

  metricsHistoryTbody.innerHTML = items
    .map((item) => {
      const status = String(item?.status || "").toLowerCase();
      const eventType = String(item?.event_type || "upload").toLowerCase();
      const meta = metricsStatusMeta(status, eventType);
      let source = "-";
      let action = "-";
      let detail = item?.error_detail || item?.verification_method || "-";

      if (eventType === "job") {
        source = `Job ${item?.job_id || "-"}`;
        action = item?.run_id ? `Run ${item.run_id}` : "Run";
        if (item?.run_url) {
          action = `Run ${item.run_id || "-"}`;
          detail = item?.error_detail || item?.run_url || "-";
        }
      } else {
        source = `${item?.catalog_name || "-"}.${item?.schema_name || "-"}.${item?.volume_name || "-"}`;
        action = `${item?.catalog_name || "-"}.${item?.schema_name || "-"}.${item?.volume_name || "-"}/${item?.file_name || "-"}`;
      }

      return `
        <tr>
          <td>${escapeHtml(formatTimestamp(item?.created_at))}</td>
          <td>${escapeHtml(source)}</td>
          <td>${escapeHtml(action)}</td>
          <td class="status-cell"><span class="status-icon ${meta.cls}" title="${meta.label}">${meta.icon}</span></td>
          <td>${escapeHtml(detail)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMetricValue(element, value) {
  if (!element) return;
  element.textContent = value;
}

function computeUploadRate(items) {
  if (!items.length) return "-";
  const success = items.filter((item) => String(item?.status || "").toLowerCase() === "success").length;
  const rate = Math.round((success / items.length) * 100);
  return `${rate}% (${success}/${items.length})`;
}

function renderVolumesRows(items) {
  if (!volumesTbody) return;

  volumesTbody.innerHTML = items
    .map((item) => {
      const key = volumeKey(item);
      const meta = uploadStatusMeta(volumeUploadStatusByKey[key]);
      return `
          <tr>
            <td class="job-name">${escapeHtml(volumeLabel(item))}</td>
            <td>Volume</td>
            <td>${escapeHtml(item.volume_path || "-")}</td>
            <td class="status-cell">
              <span class="status-icon ${meta.cls}" title="${meta.label}">${meta.icon}</span>
            </td>
            <td class="actions-col">
              <button
                class="params-open-btn"
                type="button"
                data-action="upload-volume"
                data-catalog-name="${escapeHtml(item.catalog_name || "") }"
                data-schema-name="${escapeHtml(item.schema_name || "") }"
                data-volume-name="${escapeHtml(item.volume_name || "") }"
                data-volume-label="${escapeHtml(volumeLabel(item))}"
                title="Upload para este volume"
              >+</button>
            </td>
          </tr>
        `;
    })
    .join("");
}

function showView(viewName) {
  if (!jobsView || !dataEntryView || !metricsView || !menuJobs || !menuDataEntry || !menuMetrics) return;

  activeView = viewName;
  const jobsActive = viewName === "jobs";
  const dataEntryActive = viewName === "data-entry";
  const metricsActive = viewName === "metrics";

  jobsView.classList.toggle("is-active", jobsActive);
  dataEntryView.classList.toggle("is-active", dataEntryActive);
  metricsView.classList.toggle("is-active", metricsActive);
  menuJobs.classList.toggle("active", jobsActive);
  menuDataEntry.classList.toggle("active", dataEntryActive);
  menuMetrics.classList.toggle("active", metricsActive);
}

async function uploadRawFile(file, volume) {
  const formData = new FormData();
  formData.append("file", file);

  return httpUpload(
    `/data-ingestion/volumes/${encodeURIComponent(volume.catalog_name)}/${encodeURIComponent(volume.schema_name)}/${encodeURIComponent(volume.volume_name)}/files`,
    formData
  );
}

function volumeLabel(item) {
  return item?.full_name || `${item?.catalog_name || ""}.${item?.schema_name || ""}.${item?.volume_name || ""}`;
}

async function loadVolumes() {
  if (!volumesTbody) return;

  volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Carregando volumes...</td></tr>';

  try {
    const data = await http("/data-ingestion/volumes");
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Nenhum volume encontrado.</td></tr>';
      return;
    }

    volumesCache = items;
    renderVolumesRows(items);
  } catch {
    volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Erro ao carregar volumes.</td></tr>';
  }
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

async function loadMetrics() {
  if (metricsHistoryTbody) {
    metricsHistoryTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Carregando metricas...</td></tr>';
  }

  const healthPromise = http("/health");
  const jobsPromise = http("/databricks/jobs?limit=25&offset=0&expand_tasks=true");
  const volumesPromise = http("/data-ingestion/volumes");
  const uploadHistoryPromise = http("/data-ingestion/upload-history?limit=50");
  const runHistoryPromise = http("/databricks/run-history?limit=50");

  const [healthResult, jobsResult, volumesResult, uploadHistoryResult, runHistoryResult] = await Promise.allSettled([
    healthPromise,
    jobsPromise,
    volumesPromise,
    uploadHistoryPromise,
    runHistoryPromise,
  ]);

  const apiOnline = healthResult.status === "fulfilled" && String(healthResult.value?.status || "").toLowerCase() === "ok";
  renderMetricValue(metricApiStatus, apiOnline ? "Online" : "Offline");

  const jobsCount = jobsResult.status === "fulfilled" ? (Array.isArray(jobsResult.value?.items) ? jobsResult.value.items.length : 0) : "-";
  renderMetricValue(metricJobsCount, String(jobsCount));

  const volumesCount = volumesResult.status === "fulfilled" ? (Array.isArray(volumesResult.value?.items) ? volumesResult.value.items.length : 0) : "-";
  renderMetricValue(metricVolumesCount, String(volumesCount));

  const uploadItems = uploadHistoryResult.status === "fulfilled" && Array.isArray(uploadHistoryResult.value?.items)
    ? uploadHistoryResult.value.items.map((item) => ({ ...item, event_type: "upload" }))
    : [];
  const runItems = runHistoryResult.status === "fulfilled" && Array.isArray(runHistoryResult.value?.items)
    ? runHistoryResult.value.items.map((item) => ({ ...item, event_type: "job" }))
    : [];
  const mergedHistory = [...runItems, ...uploadItems].sort((a, b) => {
    const aTs = new Date(a?.created_at || 0).getTime();
    const bTs = new Date(b?.created_at || 0).getTime();
    return bTs - aTs;
  });

  renderMetricValue(metricUploadRate, computeUploadRate(uploadItems));
  renderMetricsRows(mergedHistory.slice(0, 50));
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
  showView("jobs");
  await loadJobs();
});

if (menuDataEntry) {
  menuDataEntry.addEventListener("click", async () => {
    showView("data-entry");
    await loadVolumes();
  });
}

if (menuMetrics) {
  menuMetrics.addEventListener("click", async () => {
    showView("metrics");
    await loadMetrics();
  });
}

refreshJobsBtn.addEventListener("click", async () => {
  if (activeView === "jobs") {
    await loadJobs();
    return;
  }

  if (activeView === "data-entry") {
    await loadVolumes();
    return;
  }

  await loadMetrics();
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

if (volumesTbody) {
  volumesTbody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='upload-volume']");
    if (!button || !volumeUploadInput) return;

    selectedVolumeForUpload = {
      catalog_name: button.getAttribute("data-catalog-name") || "",
      schema_name: button.getAttribute("data-schema-name") || "",
      volume_name: button.getAttribute("data-volume-name") || "",
      label: button.getAttribute("data-volume-label") || "volume",
    };

    volumeUploadInput.value = "";
    volumeUploadInput.click();
  });
}

if (volumeUploadInput) {
  volumeUploadInput.addEventListener("change", async () => {
    if (!selectedVolumeForUpload) return;

    if (!volumeUploadInput.files || volumeUploadInput.files.length === 0) {
      return;
    }

    const [file] = volumeUploadInput.files;
    const key = `${selectedVolumeForUpload.catalog_name}.${selectedVolumeForUpload.schema_name}.${selectedVolumeForUpload.volume_name}`;
    volumeUploadStatusByKey[key] = "running";
    renderVolumesRows(volumesCache);

    try {
      await uploadRawFile(file, selectedVolumeForUpload);
      volumeUploadStatusByKey[key] = "success";
    } catch {
      volumeUploadStatusByKey[key] = "error";
    }

    renderVolumesRows(volumesCache);
  });
}

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
