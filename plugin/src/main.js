const PLUGIN_ID = 'com.cris.termux-fs';
const API_BASE = 'http://127.0.0.1:8765';
const TOKEN = 'dev-token';

const IGNORED = [
  'node_modules',
  '__pycache__',
  '.git',
  '.cache',
  '.npm',
  '.termux',
  'dist',
  '.venv',
  'venv',
  '.env',
];

let registeredCommands = [];
let sideBarApps = null;
let currentRoot = '';

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

function openFileInEditor(path, data) {
  const filename = path.split('/').pop();

  acode.newEditorFile(filename, {
    text: data.content,
    editable: true,
    render: true,
  });

  const file = editorManager.activeFile;
  let lastMtime = data.mtime;

  file.save = async () => {
    try {
      const content = file.session.getValue();
      await apiRequest('/fs/write', {
        method: 'POST',
        body: JSON.stringify({ path, content, mtime: lastMtime }),
      });
      const fresh = await apiRequest(
        `/fs/read?path=${encodeURIComponent(path)}`
      );
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
   SIDEBAR FILE TREE
======================== */

const CSS = `
  .tfs-tree {
    font-family: monospace;
    font-size: 13px;
    color: var(--popup-text-color, #ccc);
  }
  .tfs-header {
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border-color, #333);
  }
  .tfs-header button {
    background: none;
    border: none;
    color: var(--popup-text-color, #ccc);
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
  }
  .tfs-path {
    font-size: 11px;
    color: var(--secondary-text-color, #888);
    padding: 4px 8px;
    border-bottom: 1px solid var(--border-color, #333);
    word-break: break-all;
  }
  .tfs-item {
    padding: 7px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tfs-item:active {
    background: var(--button-active-color, #333);
  }
  .tfs-size {
    opacity: 0.4;
    font-size: 11px;
    margin-left: auto;
  }
  .tfs-empty {
    padding: 16px;
    text-align: center;
    color: var(--secondary-text-color, #888);
  }
  .tfs-choose {
    padding: 16px;
    text-align: center;
  }
  .tfs-choose button {
    padding: 8px 16px;
    background: var(--button-background-color, #444);
    color: var(--popup-text-color, #ccc);
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
  }
`;

async function renderSidebar(container, dirPath) {
  container.innerHTML = '<div class="tfs-tree">Cargando...</div>';

  try {
    const entries = await apiRequest(
      `/fs/list?path=${encodeURIComponent(dirPath)}`
    );

    const filtered = entries
      .filter((e) => !e.name.startsWith('.') && !IGNORED.includes(e.name))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const dirName = dirPath.split('/').pop() || '~';

    let html = `<style>${CSS}</style><div class="tfs-tree">`;

    html += `<div class="tfs-header">
      <span>📂 ${dirName}</span>
      <span>
        ${dirPath ? '<button data-action="up" title="Subir">⬆️</button>' : ''}
        <button data-action="refresh" title="Refrescar">🔄</button>
        <button data-action="choose" title="Cambiar directorio">📁</button>
      </span>
    </div>`;

    html += `<div class="tfs-path">${dirPath || '~'}</div>`;

    if (filtered.length === 0) {
      html += '<div class="tfs-empty">Directorio vacío</div>';
    }

    for (const entry of filtered) {
      const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;

      if (entry.type === 'dir') {
        html += `<div class="tfs-item" data-action="dir" data-path="${fullPath}">📁 ${entry.name}</div>`;
      } else {
        const size =
          entry.size > 1024
            ? `${(entry.size / 1024).toFixed(1)}K`
            : `${entry.size}B`;
        html += `<div class="tfs-item" data-action="file" data-path="${fullPath}">📄 ${entry.name}<span class="tfs-size">${size}</span></div>`;
      }
    }

    html += '</div>';
    container.innerHTML = html;

    container.onclick = async (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;

      const action = item.dataset.action;

      if (action === 'up') {
        const parent = dirPath.split('/').slice(0, -1).join('/');
        currentRoot = parent;
        renderSidebar(container, parent);
      } else if (action === 'dir') {
        currentRoot = item.dataset.path;
        renderSidebar(container, item.dataset.path);
      } else if (action === 'file') {
        try {
          const data = await apiRequest(
            `/fs/read?path=${encodeURIComponent(item.dataset.path)}`
          );
          openFileInEditor(item.dataset.path, data);
        } catch (err) {
          acode.alert('Error', err.message);
        }
      } else if (action === 'refresh') {
        renderSidebar(container, dirPath);
      } else if (action === 'choose') {
        browseAndOpen(container);
      }
    };
  } catch (err) {
    container.innerHTML = `<style>${CSS}</style>
      <div class="tfs-tree">
        <div class="tfs-empty">Error: ${err.message}</div>
        <div class="tfs-choose">
          <button data-action="retry">Reintentar</button>
        </div>
      </div>`;
    container.onclick = () => renderSidebar(container, dirPath);
  }
}

function showChooseScreen(container) {
  container.innerHTML = `<style>${CSS}</style>
    <div class="tfs-tree">
      <div class="tfs-empty">Selecciona un directorio para abrir</div>
      <div class="tfs-choose">
        <button data-action="browse">📂 Explorar Termux</button>
      </div>
    </div>`;
  container.onclick = () => browseAndOpen(container);
}

async function browseAndOpen(container) {
  async function showDir(dirPath) {
    try {
      const entries = await apiRequest(
        `/fs/list?path=${encodeURIComponent(dirPath)}`
      );

      const dirs = entries
        .filter((e) => e.type === 'dir' && !e.name.startsWith('.') && !IGNORED.includes(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      const options = dirs.map((e) => `📁 ${e.name}`);
      options.unshift('✅ Abrir este directorio');

      if (dirPath) {
        options.unshift('⬆️ ..');
      }

      const selected = await acode.select(
        `Termux: /${dirPath || '~'}`,
        options
      );

      if (selected === undefined || selected === null) return;

      let label = selected;
      if (typeof selected === 'number') {
        label = options[selected];
      }

      if (!label) return;

      if (label === '⬆️ ..') {
        return showDir(dirPath.split('/').slice(0, -1).join('/'));
      }

      if (label === '✅ Abrir este directorio') {
        currentRoot = dirPath;
        renderSidebar(container, dirPath);
        return;
      }

      const name = label.replace(/^📁 /, '');
      const fullPath = dirPath ? `${dirPath}/${name}` : name;
      return showDir(fullPath);
    } catch (err) {
      acode.alert('Error', err.message);
    }
  }

  showDir(currentRoot);
}

/* ========================
   REGISTRO
======================== */

acode.setPluginInit(PLUGIN_ID, (baseUrl, $page, cache) => {
  sideBarApps = acode.require('sideBarApps');

  sideBarApps.add(
    'icon_terminal',
    'termux-fs',
    'Termux FS',
    (container) => {
      showChooseScreen(container);
    },
    false,
    (container) => {
      if (currentRoot) {
        renderSidebar(container, currentRoot);
      }
    }
  );

  const { commands } = editorManager.editor;

  commands.addCommand({
    name: 'termux-browse',
    description: 'Explorar archivos en Termux',
    exec: () => {
      const container = sideBarApps.get('termux-fs');
      if (container) browseAndOpen(container);
    },
  });
  registeredCommands.push('termux-browse');

  window.toast('Termux FS cargado', 3000);
});

acode.setPluginUnmount(PLUGIN_ID, () => {
  const { commands } = editorManager.editor;
  registeredCommands.forEach((name) => commands.removeCommand(name));
  registeredCommands = [];

  if (sideBarApps) {
    sideBarApps.remove('termux-fs');
  }
});
