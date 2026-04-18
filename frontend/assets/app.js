// Legacy bootstrap kept for compatibility with existing HTML references.
// The application logic now lives in modular ES modules under ./js.
(() => {
  import("./js/main.js").catch((error) => {
    // Keep the failure visible in browser without hiding stack traces.
    console.error("Failed to load modular frontend entrypoint", error);
  });
})();
