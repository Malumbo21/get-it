/**
 * Preload — exposes a small, typed bridge so the renderer can ask the
 * main process whether Codex is healthy and ask it to re-run the setup
 * wizard. Nothing else crosses the boundary.
 */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("getit", {
  platform: process.platform,
  getCodexStatus: () => ipcRenderer.invoke("codex:status"),
  runCodexSetup: () => ipcRenderer.invoke("codex:setup"),
  onCodexStatus: (cb) => {
    const wrapped = (_e, status) => {
      try {
        cb(status);
      } catch {
        /* ignore */
      }
    };
    ipcRenderer.on("codex-status", wrapped);
    return () => ipcRenderer.removeListener("codex-status", wrapped);
  },
});

// Tag the <html> element with the host platform so platform-specific
// CSS (custom title-bar padding for the traffic-light / overlay
// regions) can target it. Set as early as possible — on
// `DOMContentLoaded` the document.documentElement is already there
// and styles haven't painted yet.
window.addEventListener("DOMContentLoaded", () => {
  try {
    document.documentElement.setAttribute("data-platform", process.platform);
  } catch {
    /* sandboxed renderer can't reach this, very unlikely */
  }
});
