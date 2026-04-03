import * as tm from './terminal-manager.js';

const { invoke } = window.__TAURI__.core;

let resizeTimeout = null;
let refreshInFlight = null;
let refreshQueued = false;
let refreshGeneration = 0;

async function runRefresh(generation) {
  const paneArea = document.getElementById('pane-area');
  const rect = paneArea.getBoundingClientRect();

  if (!rect.width || !rect.height) return;

  const { cellWidth, cellHeight } = tm.getCellDimensions();
  const widthCells = Math.floor(rect.width / cellWidth) || 80;
  const heightCells = Math.floor(rect.height / cellHeight) || 24;

  const layout = await invoke('get_layout', { width: widthCells, height: heightCells });
  if (generation !== refreshGeneration) return;

  await tm.applyLayout(layout.panes, widthCells, heightCells, layout.surface_ids);
  if (generation !== refreshGeneration) return;

  // Defer PTY resize
  setTimeout(async () => {
    if (generation !== refreshGeneration) return;
    await Promise.all(layout.panes.map((pane) => {
      const entry = tm.getTerminal(pane.surface_id);
      if (entry) {
        return invoke('resize_terminal', {
          surfaceId: pane.surface_id,
          cols: entry.term.cols,
          rows: entry.term.rows,
        });
      }
      return Promise.resolve();
    }));
  }, 210);
}

export function refreshLayout() {
  refreshGeneration += 1;
  const generation = refreshGeneration;

  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  refreshInFlight = runRefresh(generation)
    .catch(console.error)
    .finally(() => {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        refreshLayout();
      }
    });

  return refreshInFlight;
}

export function setupResizeHandler() {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => refreshLayout(), 100);
  });
}
