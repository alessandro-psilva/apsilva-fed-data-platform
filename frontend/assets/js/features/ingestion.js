import { dom } from "../core/dom.js";
import { state } from "../core/state.js";
import { http, httpUpload } from "../core/api.js";

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

function volumeKey(volume) {
  return `${volume.catalog_name}.${volume.schema_name}.${volume.volume_name}`;
}

function volumeLabel(item) {
  return item?.full_name || `${item?.catalog_name || ""}.${item?.schema_name || ""}.${item?.volume_name || ""}`;
}

function renderVolumesRows(items) {
  if (!dom.volumesTbody) return;

  dom.volumesTbody.innerHTML = items
    .map((item) => {
      const key = volumeKey(item);
      const meta = uploadStatusMeta(state.volumeUploadStatusByKey[key]);
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

async function uploadRawFile(file, volume) {
  const formData = new FormData();
  formData.append("file", file);

  return httpUpload(
    `/data-ingestion/volumes/${encodeURIComponent(volume.catalog_name)}/${encodeURIComponent(volume.schema_name)}/${encodeURIComponent(volume.volume_name)}/files`,
    formData
  );
}

export async function loadVolumes() {
  if (!dom.volumesTbody) return;

  dom.volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Carregando volumes...</td></tr>';

  try {
    const data = await http("/data-ingestion/volumes");
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      dom.volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Nenhum volume encontrado.</td></tr>';
      return;
    }

    state.volumesCache = items;
    renderVolumesRows(items);
  } catch {
    dom.volumesTbody.innerHTML = '<tr><td colspan="5" class="loading-row">Erro ao carregar volumes.</td></tr>';
  }
}

export function bindIngestionEvents() {
  if (dom.volumesTbody) {
    dom.volumesTbody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action='upload-volume']");
      if (!button || !dom.volumeUploadInput) return;

      state.selectedVolumeForUpload = {
        catalog_name: button.getAttribute("data-catalog-name") || "",
        schema_name: button.getAttribute("data-schema-name") || "",
        volume_name: button.getAttribute("data-volume-name") || "",
        label: button.getAttribute("data-volume-label") || "volume",
      };

      dom.volumeUploadInput.value = "";
      dom.volumeUploadInput.click();
    });
  }

  if (dom.volumeUploadInput) {
    dom.volumeUploadInput.addEventListener("change", async () => {
      if (!state.selectedVolumeForUpload) return;

      if (!dom.volumeUploadInput.files || dom.volumeUploadInput.files.length === 0) {
        return;
      }

      const [file] = dom.volumeUploadInput.files;
      const key = `${state.selectedVolumeForUpload.catalog_name}.${state.selectedVolumeForUpload.schema_name}.${state.selectedVolumeForUpload.volume_name}`;
      state.volumeUploadStatusByKey[key] = "running";
      renderVolumesRows(state.volumesCache);

      try {
        await uploadRawFile(file, state.selectedVolumeForUpload);
        state.volumeUploadStatusByKey[key] = "success";
      } catch {
        state.volumeUploadStatusByKey[key] = "error";
      }

      renderVolumesRows(state.volumesCache);
    });
  }
}
