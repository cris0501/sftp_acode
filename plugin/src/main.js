const PLUGIN_ID = 'com.cris.termux-fs';
const API_BASE = 'http://127.0.0.1:8765';
const TOKEN = 'dev-token';
let openFiles = new Map(); // path → file reference

const IGNORED = [
  'node_modules', '__pycache__', '.git', '.cache', '.npm',
  '.termux', '.venv', 'venv', '.env', '.mypy_cache',
  '.pytest_cache', 'build', '.gradle',
];

const EXT_COLORS = {
  js: '#f1e05a', mjs: '#f1e05a', jsx: '#61dafb',
  ts: '#3178c6', tsx: '#3178c6',
  py: '#3572a5', pyw: '#3572a5',
  html: '#e34c26', htm: '#e34c26',
  css: '#563d7c', scss: '#c6538c', less: '#1d365d',
  json: '#a3a3a3', yaml: '#cb171e', yml: '#cb171e', toml: '#9c4221',
  md: '#519aba', txt: '#888888',
  sh: '#89e051', bash: '#89e051', zsh: '#89e051',
  java: '#b07219', kt: '#A97BFF', dart: '#00B4AB',
  c: '#555555', cpp: '#f34b7d', h: '#555555',
  rs: '#dea584', go: '#00ADD8',
  rb: '#701516', php: '#4F5D95',
  sql: '#e38c00', db: '#e38c00',
  xml: '#0060ac', svg: '#ffb13b',
  png: '#a074c4', jpg: '#a074c4', jpeg: '#a074c4',
  gif: '#a074c4', webp: '#a074c4', ico: '#a074c4',
  zip: '#e6b800', tar: '#e6b800', gz: '#e6b800',
  pdf: '#ec2025',
  log: '#666666', env: '#ecd53f',
  gitignore: '#f54d27', dockerignore: '#2496ed',
  dockerfile: '#2496ed', makefile: '#427819',
};

const FOLDER_COLOR = 'var(--link-text-color, #6494e4)';

let registeredCommands = [];
let sideBarApps = null;
let openFolders = [];
let mainContainer = null;

/* ========================
   API
======================== */

async function apiRequest(endpoint, options = {}) {
  const res = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiCreate(path, type, content) {
  return apiRequest('/fs/create', {
    method: 'POST',
    body: JSON.stringify({ path, type, content: content || '' }),
  });
}

async function apiDelete(path) {
  return apiRequest('/fs/delete', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
}

/* ========================
   EDITOR
======================== */

function openFileInEditor(path, data) {
  // Si ya está abierto, activarlo
  if (openFiles.has(path)) {
    const existing = openFiles.get(path);
    try {
      existing.makeActive();
      return;
    } catch (e) {
      // El archivo fue cerrado manualmente, limpiar
      openFiles.delete(path);
    }
  }

  const filename = path.split('/').pop();
  acode.newEditorFile(filename, {
    text: data.content,
    editable: true,
    render: true,
  });
  const file = editorManager.activeFile;
  let lastMtime = data.mtime;

  // Trackear
  openFiles.set(path, file);

  // Limpiar al cerrar
  file.on('close', () => {
    openFiles.delete(path);
  });

  file.save = async () => {
    try {
      const content = file.session.getValue();
      await apiRequest('/fs/write', {
        method: 'PATCH',
        body: JSON.stringify({ path, content, mtime: lastMtime }),
      });
      const fresh = await apiRequest(`/fs/read?path=${encodeURIComponent(path)}`);
      lastMtime = fresh.mtime;
      file.isUnsaved = false;
      window.toast('Guardado en Termux', 3000);
    } catch (err) {
      if (err.message.includes('409')) {
        acode.alert('Conflicto', 'El archivo cambió en el servidor.');
      } else {
        acode.alert('Error al guardar', err.message);
      }
    }
  };
}

/* ========================
   ICONS
======================== */

function getFileColor(name) {
  const lower = name.toLowerCase();
  const fullNameMap = {
    'dockerfile': '#2496ed', 'makefile': '#427819',
    '.gitignore': '#f54d27', '.env': '#ecd53f',
    'license': '#d4a928', 'readme.md': '#519aba',
  };
  if (fullNameMap[lower]) return fullNameMap[lower];
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return EXT_COLORS[ext] || '#888888';
}

/* ========================
   STYLES
======================== */

const CSS = `
  .tfs {
    font-family: system-ui, sans-serif;
    font-size: 13px;
    color: var(--popup-text-color, #ccc);
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tfs-toolbar {
    display: flex;
    align-items: center;
    padding: 6px 8px;
    gap: 4px;
    border-bottom: 1px solid var(--border-color, #333);
    flex-shrink: 0;
  }
  .tfs-toolbar button, .tfs-root-actions button {
    background: none;
    border: none;
    color: var(--secondary-text-color, #aaa);
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .tfs-toolbar button:active, .tfs-root-actions button:active {
    background: var(--button-active-color, #333);
  }
  .tfs-toolbar .spacer { flex: 1; }
  .tfs-toolbar .title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--secondary-text-color, #aaa);
    font-weight: 600;
  }
  .tfs-content {
    flex: 1;
    overflow-y: auto;
  }
  .tfs-root {
    border-bottom: 1px solid var(--border-color, #222);
  }
  .tfs-root-header {
    display: flex;
    align-items: center;
    padding: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--popup-text-color, #ccc);
    gap: 4px;
  }
  .tfs-root-header:active {
    background: var(--button-active-color, #333);
  }
  .tfs-root-header .arrow {
    font-size: 10px;
    width: 16px;
    text-align: center;
    transition: transform 0.15s;
    color: var(--secondary-text-color, #aaa);
  }
  .tfs-root-header .arrow.open { transform: rotate(90deg); }
  .tfs-root-actions {
    margin-left: auto;
    display: flex;
    gap: 0;
  }
  .tfs-root-actions button { font-size: 14px; padding: 2px 5px; }
  .tfs-entries { display: none; }
  .tfs-entries.open { display: block; }
  .tfs-item {
    display: flex;
    align-items: center;
    padding: 3px 0;
    padding-right: 8px;
    cursor: pointer;
    gap: 6px;
    min-height: 26px;
    position: relative;
  }
  .tfs-item:active {
    background: var(--button-active-color, #333);
  }
  .tfs-icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 15px;
  }
  .tfs-dir-arrow {
    width: 16px;
    font-size: 9px;
    text-align: center;
    color: var(--secondary-text-color, #888);
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .tfs-dir-arrow.open { transform: rotate(90deg); }
  .tfs-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .tfs-children { display: none; }
  .tfs-children.open { display: block; }
  .tfs-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    gap: 12px;
    color: var(--secondary-text-color, #888);
    text-align: center;
  }
  .tfs-empty-state button {
    padding: 8px 16px;
    background: var(--button-background-color, #444);
    color: var(--popup-text-color, #ccc);
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
  .tfs-loading {
    padding: 8px;
    padding-left: 32px;
    color: var(--secondary-text-color, #888);
    font-size: 12px;
    font-style: italic;
  }
`;

/* ========================
   CREATE & DELETE
======================== */

async function promptCreate(dirPath, type) {
  const label = type === 'dir' ? 'carpeta' : 'archivo';
  const name = await acode.prompt(
    `Nombre del ${label}`,
    '',
    'text',
    { placeholder: type === 'dir' ? 'nueva-carpeta' : 'archivo.js' }
  );
  if (!name) return;

  const fullPath = dirPath ? `${dirPath}/${name}` : name;

  try {
    await apiCreate(fullPath, type);
    window.toast(`${label} creado`, 2000);

    // Si es archivo, abrirlo
    if (type === 'file') {
      const data = await apiRequest(`/fs/read?path=${encodeURIComponent(fullPath)}`);
      openFileInEditor(fullPath, data);
    }

    // Refrescar el sidebar
    renderAll();
  } catch (err) {
    if (err.message.includes('409')) {
      acode.alert('Error', `Ya existe: ${name}`);
    } else {
      acode.alert('Error', err.message);
    }
  }
}

async function confirmDelete(path, isDir) {
  const name = path.split('/').pop();
  const type = isDir ? 'la carpeta' : 'el archivo';

  const options = [`🗑️ Eliminar ${type}`, '❌ Cancelar'];
  const selected = await acode.select(`${name}`, options);

  let label = typeof selected === 'number' ? options[selected] : selected;
  if (!label || label.startsWith('❌')) return;

  try {
    await apiDelete(path);
    window.toast('Eliminado', 2000);
    renderAll();
  } catch (err) {
    acode.alert('Error', err.message);
  }
}

async function showContextMenu(path, isDir) {
  const name = path.split('/').pop();
  const options = [];

  if (isDir) {
    options.push('📄 Nuevo archivo aquí');
    options.push('📁 Nueva carpeta aquí');
  }
  options.push('🗑️ Eliminar');
  options.push('❌ Cancelar');

  const selected = await acode.select(name, options);
  let label = typeof selected === 'number' ? options[selected] : selected;
  if (!label || label.startsWith('❌')) return;

  if (label.startsWith('📄')) {
    await promptCreate(path, 'file');
  } else if (label.startsWith('📁')) {
    await promptCreate(path, 'dir');
  } else if (label.startsWith('🗑️')) {
    await confirmDelete(path, isDir);
  }
}

/* ========================
   RENDER
======================== */

function renderAll() {
  if (!mainContainer) return;

  if (openFolders.length === 0) {
    mainContainer.innerHTML = `<style>${CSS}</style>
      <div class="tfs">
        <div class="tfs-empty-state">
          <div style="font-size:32px">📂</div>
          <div>No hay carpetas abiertas</div>
          <button data-global="add">Abrir carpeta</button>
        </div>
      </div>`;
    mainContainer.onclick = (e) => {
      if (e.target.closest('[data-global="add"]')) browseAndAdd();
    };
    return;
  }

  let html = `<style>${CSS}</style><div class="tfs">
    <div class="tfs-toolbar">
      <span class="title">Termux FS</span>
      <span class="spacer"></span>
      <button data-global="add" title="Abrir carpeta">+</button>
      <button data-global="refresh" title="Refrescar todo">↻</button>
    </div>
    <div class="tfs-content scroll">`;

  openFolders.forEach((folder, idx) => {
    const name = folder.name || folder.path.split('/').pop() || '~';
    const isOpen = !folder.collapsed;
    html += `<div class="tfs-root" data-root-idx="${idx}">
      <div class="tfs-root-header" data-action="toggle-root" data-idx="${idx}">
        <span class="arrow ${isOpen ? 'open' : ''}">▶</span>
        <span>📂 ${name}</span>
        <span class="tfs-root-actions">
          <button data-action="new-file" data-idx="${idx}" title="Nuevo archivo">📄+</button>
          <button data-action="new-dir" data-idx="${idx}" title="Nueva carpeta">📁+</button>
          <button data-action="close-root" data-idx="${idx}" title="Cerrar">✕</button>
        </span>
      </div>
      <div class="tfs-entries ${isOpen ? 'open' : ''}" id="tfs-root-${idx}">
        <div class="tfs-loading">Cargando...</div>
      </div>
    </div>`;
  });

  html += '</div></div>';
  mainContainer.innerHTML = html;

  openFolders.forEach((folder, idx) => {
    if (!folder.collapsed) {
      loadDir(idx, folder.path, document.getElementById(`tfs-root-${idx}`), 1);
    }
  });

  mainContainer.onclick = (e) => {
    const target = e.target.closest('[data-action], [data-global]');
    if (!target) return;

    const globalAction = target.dataset.global;
    if (globalAction === 'add') { browseAndAdd(); return; }
    if (globalAction === 'refresh') { renderAll(); return; }

    const action = target.dataset.action;
    const idx = parseInt(target.dataset.idx);

    if (action === 'toggle-root') {
      // No toggle si se tocó un botón de acción
      if (e.target.closest('.tfs-root-actions')) return;
      openFolders[idx].collapsed = !openFolders[idx].collapsed;
      renderAll();
    } else if (action === 'close-root') {
      e.stopPropagation();
      openFolders.splice(idx, 1);
      renderAll();
    } else if (action === 'new-file') {
      e.stopPropagation();
      promptCreate(openFolders[idx].path, 'file');
    } else if (action === 'new-dir') {
      e.stopPropagation();
      promptCreate(openFolders[idx].path, 'dir');
    }
  };
}

async function loadDir(rootIdx, dirPath, container, depth) {
  try {
    const entries = await apiRequest(`/fs/list?path=${encodeURIComponent(dirPath)}`);
    const filtered = entries
      .filter(e => !e.name.startsWith('.') && !IGNORED.includes(e.name))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="tfs-loading">Vacío</div>`;
      return;
    }

    const paddingLeft = depth * 16;
    let html = '';

    for (const entry of filtered) {
      const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      const color = entry.type === 'dir' ? FOLDER_COLOR : getFileColor(entry.name);

      if (entry.type === 'dir') {
        const childId = `tfs-dir-${fullPath.replace(/[^a-zA-Z0-9]/g, '-')}`;
        html += `<div>
          <div class="tfs-item" style="padding-left:${paddingLeft}px"
               data-dir-toggle="${childId}" data-dir-path="${fullPath}"
               data-root="${rootIdx}" data-depth="${depth + 1}"
               data-ctx-path="${fullPath}" data-ctx-dir="true">
            <span class="tfs-dir-arrow">▶</span>
            <span class="tfs-icon" style="color:${color}">📁</span>
            <span class="tfs-name">${entry.name}</span>
          </div>
          <div class="tfs-children" id="${childId}"></div>
        </div>`;
      } else {
        html += `<div class="tfs-item" style="padding-left:${paddingLeft + 16}px"
                     data-file-open="${fullPath}"
                     data-ctx-path="${fullPath}" data-ctx-dir="false">
          <span class="tfs-icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="${color}">
              <path d="M3 1h6.5L13 4.5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm6 0v4h4"/>
            </svg>
          </span>
          <span class="tfs-name">${entry.name}</span>
        </div>`;
      }
    }

    container.innerHTML = html;

    // Long press timer
    let longPressTimer = null;

    container.addEventListener('touchstart', (e) => {
      const item = e.target.closest('[data-ctx-path]');
      if (!item) return;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        showContextMenu(item.dataset.ctxPath, item.dataset.ctxDir === 'true');
      }, 500);
    }, { passive: true });

    container.addEventListener('touchend', () => {
      if (longPressTimer) clearTimeout(longPressTimer);
    }, { passive: true });

    container.addEventListener('touchmove', () => {
      if (longPressTimer) clearTimeout(longPressTimer);
    }, { passive: true });

    // Click handler
    container.onclick = async (e) => {
      e.stopPropagation();

      const dirItem = e.target.closest('[data-dir-toggle]');
      if (dirItem) {
        const childId = dirItem.dataset.dirToggle;
        const childContainer = document.getElementById(childId);
        const arrow = dirItem.querySelector('.tfs-dir-arrow');

        if (childContainer.classList.contains('open')) {
          childContainer.classList.remove('open');
          arrow.classList.remove('open');
        } else {
          childContainer.classList.add('open');
          arrow.classList.add('open');
          if (!childContainer.dataset.loaded) {
            childContainer.innerHTML = '<div class="tfs-loading">Cargando...</div>';
            await loadDir(
              parseInt(dirItem.dataset.root),
              dirItem.dataset.dirPath,
              childContainer,
              parseInt(dirItem.dataset.depth)
            );
            childContainer.dataset.loaded = 'true';
          }
        }
        return;
      }

      const fileItem = e.target.closest('[data-file-open]');
      if (fileItem) {
        try {
          const data = await apiRequest(
            `/fs/read?path=${encodeURIComponent(fileItem.dataset.fileOpen)}`
          );
          openFileInEditor(fileItem.dataset.fileOpen, data);
        } catch (err) {
          acode.alert('Error', err.message);
        }
      }
    };
  } catch (err) {
    container.innerHTML = `<div class="tfs-loading">Error: ${err.message}</div>`;
  }
}

/* ========================
   BROWSE & ADD FOLDER
======================== */

async function browseAndAdd() {
  async function showDir(dirPath) {
    try {
      const entries = await apiRequest(`/fs/list?path=${encodeURIComponent(dirPath)}`);
      const dirs = entries
        .filter(e => e.type === 'dir' && !e.name.startsWith('.') && !IGNORED.includes(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      const options = dirs.map(e => `📁 ${e.name}`);
      options.unshift('✅ Abrir este directorio');
      if (dirPath) options.unshift('⬆️ ..');

      const selected = await acode.select(`Termux: /${dirPath || '~'}`, options);
      if (selected === undefined || selected === null) return;

      let label = typeof selected === 'number' ? options[selected] : selected;
      if (!label) return;

      if (label === '⬆️ ..') return showDir(dirPath.split('/').slice(0, -1).join('/'));

      if (label === '✅ Abrir este directorio') {
        if (openFolders.some(f => f.path === dirPath)) {
          window.toast('Ya está abierto', 2000);
          return;
        }
        openFolders.push({
          path: dirPath,
          name: dirPath.split('/').pop() || 'Home',
          collapsed: false,
        });
        renderAll();
        return;
      }

      const name = label.replace(/^📁 /, '');
      const fullPath = dirPath ? `${dirPath}/${name}` : name;
      return showDir(fullPath);
    } catch (err) {
      acode.alert('Error', err.message);
    }
  }

  showDir('');
}

/* ========================
   REGISTRO
======================== */

acode.setPluginInit(PLUGIN_ID, (baseUrl, $page, cache) => {
  sideBarApps = acode.require('sideBarApps');
  
  const style = document.createElement('style');
  style.textContent = `
    .icon_termux_fs {
      display: inline-block !important;
      width: 18px !important;
      height: 18px !important;
      background-image: url('${baseUrl}icon.png') !important;
      background-size: contain !important;
      background-repeat: no-repeat !important;
      background-position: center !important;
    }
  `;
  document.head.appendChild(style);

  sideBarApps.add(
    'icon_termux_fs',
    'termux-fs',
    'Termux FS',
    (container) => {
      mainContainer = container;
      container.style.height = '100%';
      renderAll();
    },
    false,
    (container) => {
      mainContainer = container;
      renderAll();
    }
  );

  const { commands } = editorManager.editor;

  commands.addCommand({
    name: 'termux-add-folder',
    description: 'Termux: Abrir carpeta',
    exec: browseAndAdd,
  });
  registeredCommands.push('termux-add-folder');

  window.toast('Termux FS cargado', 3000);
});

acode.setPluginUnmount(PLUGIN_ID, () => {
  const { commands } = editorManager.editor;
  registeredCommands.forEach(name => commands.removeCommand(name));
  registeredCommands = [];
  if (sideBarApps) sideBarApps.remove('termux-fs');
  style.remove();
  mainContainer = null;
  openFolders = [];
  openFiles = new Map();
});



