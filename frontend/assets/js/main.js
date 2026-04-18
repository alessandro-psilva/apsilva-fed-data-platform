import { dom } from "./core/dom.js";
import { state } from "./core/state.js";
import { loadJobs, bindJobsEvents, bindParamsModalEvents } from "./features/jobs.js";
import { loadVolumes, bindIngestionEvents } from "./features/ingestion.js";
import { loadMetrics } from "./features/metrics.js";

function showView(viewName) {
  if (!dom.jobsView || !dom.dataEntryView || !dom.metricsView || !dom.menuJobs || !dom.menuDataEntry || !dom.menuMetrics) return;

  state.activeView = viewName;
  const jobsActive = viewName === "jobs";
  const dataEntryActive = viewName === "data-entry";
  const metricsActive = viewName === "metrics";

  dom.jobsView.classList.toggle("is-active", jobsActive);
  dom.dataEntryView.classList.toggle("is-active", dataEntryActive);
  dom.metricsView.classList.toggle("is-active", metricsActive);
  dom.menuJobs.classList.toggle("active", jobsActive);
  dom.menuDataEntry.classList.toggle("active", dataEntryActive);
  dom.menuMetrics.classList.toggle("active", metricsActive);
}

function bindNavigationEvents() {
  if (dom.menuJobs) {
    dom.menuJobs.addEventListener("click", async () => {
      showView("jobs");
      await loadJobs();
    });
  }

  if (dom.menuDataEntry) {
    dom.menuDataEntry.addEventListener("click", async () => {
      showView("data-entry");
      await loadVolumes();
    });
  }

  if (dom.menuMetrics) {
    dom.menuMetrics.addEventListener("click", async () => {
      showView("metrics");
      await loadMetrics();
    });
  }

  if (dom.refreshJobsBtn) {
    dom.refreshJobsBtn.addEventListener("click", async () => {
      if (state.activeView === "jobs") {
        await loadJobs();
        return;
      }

      if (state.activeView === "data-entry") {
        await loadVolumes();
        return;
      }

      await loadMetrics();
    });
  }
}

function bootstrap() {
  bindNavigationEvents();
  bindJobsEvents();
  bindParamsModalEvents();
  bindIngestionEvents();
  loadJobs();
}

bootstrap();
