import { dom } from "../core/dom.js";
import { http } from "../core/api.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", {
    hour12: false,
  });
}

function renderMetricsRows(items) {
  if (!dom.metricsHistoryTbody) return;

  if (!items.length) {
    dom.metricsHistoryTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Sem eventos recentes.</td></tr>';
    return;
  }

  dom.metricsHistoryTbody.innerHTML = items
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

export async function loadMetrics() {
  if (dom.metricsHistoryTbody) {
    dom.metricsHistoryTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Carregando metricas...</td></tr>';
  }

  const [healthResult, jobsResult, volumesResult, uploadHistoryResult, runHistoryResult] = await Promise.allSettled([
    http("/health"),
    http("/databricks/jobs?limit=25&offset=0&expand_tasks=true"),
    http("/data-ingestion/volumes"),
    http("/data-ingestion/upload-history?limit=50"),
    http("/databricks/run-history?limit=50"),
  ]);

  const apiOnline = healthResult.status === "fulfilled" && String(healthResult.value?.status || "").toLowerCase() === "ok";
  renderMetricValue(dom.metricApiStatus, apiOnline ? "Online" : "Offline");

  const jobsCount = jobsResult.status === "fulfilled" ? (Array.isArray(jobsResult.value?.items) ? jobsResult.value.items.length : 0) : "-";
  renderMetricValue(dom.metricJobsCount, String(jobsCount));

  const volumesCount = volumesResult.status === "fulfilled" ? (Array.isArray(volumesResult.value?.items) ? volumesResult.value.items.length : 0) : "-";
  renderMetricValue(dom.metricVolumesCount, String(volumesCount));

  const uploadItems =
    uploadHistoryResult.status === "fulfilled" && Array.isArray(uploadHistoryResult.value?.items)
      ? uploadHistoryResult.value.items.map((item) => ({ ...item, event_type: "upload" }))
      : [];
  const runItems =
    runHistoryResult.status === "fulfilled" && Array.isArray(runHistoryResult.value?.items)
      ? runHistoryResult.value.items.map((item) => ({ ...item, event_type: "job" }))
      : [];

  const mergedHistory = [...runItems, ...uploadItems].sort((a, b) => {
    const aTs = new Date(a?.created_at || 0).getTime();
    const bTs = new Date(b?.created_at || 0).getTime();
    return bTs - aTs;
  });

  renderMetricValue(dom.metricUploadRate, computeUploadRate(uploadItems));
  renderMetricsRows(mergedHistory.slice(0, 50));
}
