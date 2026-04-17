/**
 * Project sidebar module.
 * Collapsible sidebar showing project list with layout save/restore.
 */
import { invoke } from './transport.js';

let sidebarVisible = false;
let projects = [];
let onProjectSwitch = null;

export function setOnProjectSwitch(cb) { onProjectSwitch = cb; }

export function initSidebar() {
  const toggle = document.getElementById('btn-projects');
  if (toggle) {
    toggle.addEventListener('click', () => toggleSidebar());
  }
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  const sidebar = document.getElementById('project-sidebar');
  if (!sidebar) return;

  if (sidebarVisible) {
    sidebar.style.display = 'flex';
    loadProjects();
  } else {
    sidebar.style.display = 'none';
  }
}

async function loadProjects() {
  try {
    projects = await invoke('db_list_projects');
  } catch {
    projects = [];
  }
  renderProjects();
}

function renderProjects() {
  const list = document.getElementById('project-list');
  if (!list) return;
  list.innerHTML = '';

  for (const proj of projects) {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.innerHTML = `
      <span class="project-name">${proj.name}</span>
      <button class="project-delete" title="Delete">x</button>
    `;
    item.querySelector('.project-name').addEventListener('click', () => {
      if (onProjectSwitch) onProjectSwitch(proj);
    });
    item.querySelector('.project-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (proj.id) {
        await invoke('db_delete_project', { id: proj.id });
        await loadProjects();
      }
    });
    list.appendChild(item);
  }
}

// --- Layout save/restore ---

export async function saveCurrentLayout(name, projectId) {
  try {
    const layout = await invoke('get_layout', { width: 200, height: 50 });
    const treeJson = JSON.stringify(layout);
    const sessionMapping = '[]'; // placeholder for now
    await invoke('db_save_layout', {
      layout: {
        id: null,
        project_id: projectId || null,
        name,
        split_tree_json: treeJson,
        session_mapping: sessionMapping,
      }
    });
  } catch (e) {
    console.error('Failed to save layout:', e);
  }
}

export async function getLayouts(projectId) {
  try {
    return await invoke('db_get_layouts', { projectId: projectId || null });
  } catch {
    return [];
  }
}

export async function addProject(name, path) {
  try {
    const id = await invoke('db_upsert_project', { name, path });
    await loadProjects();
    return id;
  } catch (e) {
    console.error('Failed to add project:', e);
    return null;
  }
}
