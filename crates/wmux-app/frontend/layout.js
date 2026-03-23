import * as tm from './terminal-manager.js';

const { invoke } = window.__TAURI__.core;

let resizeTimeout = null;
let refreshInFlight = null;
let refreshQueued = false;
let refreshGeneration = 0;

async function runRefresh(generation) {
  const paneArea = document.getElementById('pane-area');
  const rect = paneArea.getBoundingClientRect();

  if (!rect.width || !rect.height) {
    return;
  }

  // Get cell dimensions to convert pixels to cells
  const { cellWidth, cellHeight } = tm.getCellDimensions();
  const widthCells = Math.floor(rect.width / cellWidth) || 80;
  const heightCells = Math.floor(rect.height / cellHeight) || 24;

  const layout = await invoke('get_layout', { width: widthCells, height: heightCells });
  if (generation !== refreshGeneration) {
    return;
  }

  await tm.applyLayout(layout.panes, widthCells, heightCells, layout.surface_ids);
  if (generation !== refreshGeneration) {
    return;
  }

  // Resize PTYs to match fitted terminal dimensions
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
  if (generation !== refreshGeneration) {
    return;
  }

  // Update status bar
  const tabInfo = await invoke('get_tab_info');
  if (generation !== refreshGeneration) {
    return;
  }
  const statusShell = document.getElementById('status-shell');
  const statusWorkspace = document.getElementById('status-workspace');
  const statusPane = document.getElementById('status-pane');

  statusShell.textContent = layout.shell;
  if (tabInfo.tabs[tabInfo.active_index]) {
    statusWorkspace.textContent = tabInfo.tabs[tabInfo.active_index].name;
  } else {
    statusWorkspace.textContent = '';
  }
  const paneIdx = layout.panes.findIndex(p => p.is_focused);
  statusPane.textContent = layout.panes.length
    ? `pane ${Math.max(paneIdx, 0) + 1}/${layout.panes.length}`
    : 'pane 0/0';
}

export function refreshLayout() {
  refreshGeneration += 1;
  const generation = refreshGeneration;

  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  refreshInFlight = runRefresh(generation)
    .catch((error) => {
      console.error('Failed to refresh layout', error);
    })
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
