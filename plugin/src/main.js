const PLUGIN_ID = 'com.cris.termux-fs';
const API_BASE = 'http://127.0.0.1:8765';
const TOKEN = 'dev-token';

let registeredCommands = [];

async function apiRequest(endpoint, options = {}) {
  const res = await fetch(API_BASE + endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
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

async function openRemoteFile() {
  const path = await acode.prompt(
    'Ruta relativa',
    '',
    'text',
    { placeholder: 'projects/test/file.js' }
  );
  if (!path) return;

  try {
    const data = await apiRequest(`/fs/read?path=${encodeURIComponent(path)}`);
    const filename = path.split('/').pop() || path;

    // Crear pestaña en el editor
    acode.newEditorFile(filename, {
      text: data.content,
      editable: true,
      render: true,
    });

    const file = editorManager.activeFile;

    // Guardar mtime para detección de conflictos
    let lastMtime = data.mtime;

    // Interceptar el guardado
    file.save = async () => {
      try {
        const content = file.session.getValue();
        const result = await apiRequest('/fs/write', {
          method: 'POST',
          body: JSON.stringify({
            path,
            content,
            mtime: lastMtime,
          }),
        });

        if (result.ok) {
          const fresh = await apiRequest(`/fs/read?path=${encodeURIComponent(path)}`);
          lastMtime = fresh.mtime;
          file.isUnsaved = false;
          window.toast('Guardado en Termux', 3000);
        }
      } catch (err) {
        if (err.message.includes('409')) {
          acode.alert('Conflicto', 'El archivo cambió en el servidor. Vuelve a abrirlo.');
        } else {
          acode.alert('Error al guardar', err.message);
        }
      }
    };

    window.toast(`Abierto: ${path}`, 3000);
  } catch (err) {
    acode.alert('Error', `${err.message}\n${err.stack}`);
  }
}

async function browseRemoteDir() {
  async function showDir(dirPath) {
    try {
      const entries = await apiRequest(`/fs/list?path=${encodeURIComponent(dirPath)}`);

      // Filtrar ocultos y ordenar
      const filtered = entries
        .filter(e => !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      const options = filtered.map(e =>
        e.type === 'dir' ? `📁 ${e.name}` : `📄 ${e.name}`
      );

      if (dirPath) {
        options.unshift('⬆️ ..');
      }

      const selected = await acode.select(
        `Termux: /${dirPath || '~'}`,
        options
      );

      if (selected === undefined || selected === null) return;

      // acode.select puede retornar string o índice
      let label = selected;
      if (typeof selected === 'number') {
        label = options[selected];
      }

      if (!label) return;

      if (label === '⬆️ ..') {
        const parent = dirPath.split('/').slice(0, -1).join('/');
        return showDir(parent);
      }

      // Extraer nombre quitando el emoji
      const name = label.replace(/^📁 |^📄 /, '');
      const entry = filtered.find(e => e.name === name);

      if (!entry) return;

      const fullPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;

      if (entry.type === 'dir') {
        return showDir(fullPath);
      }

      // Abrir archivo
      const data = await apiRequest(`/fs/read?path=${encodeURIComponent(fullPath)}`);

      acode.newEditorFile(entry.name, {
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
            body: JSON.stringify({
              path: fullPath,
              content,
              mtime: lastMtime,
            }),
          });
          const fresh = await apiRequest(`/fs/read?path=${encodeURIComponent(fullPath)}`);
          lastMtime = fresh.mtime;
          file.isUnsaved = false;
          window.toast('Guardado en Termux', 3000);
        } catch (err) {
          acode.alert('Error al guardar', err.message);
        }
      };

      window.toast(`Abierto: ${fullPath}`, 3000);
    } catch (err) {
      acode.alert('Error', `No se pudo listar: ${err.message}`);
    }
  }

  showDir('');
}

// ===== REGISTRO DEL PLUGIN =====

acode.setPluginInit(PLUGIN_ID, (baseUrl, $page, cache) => {
  const { commands } = editorManager.editor;

  commands.addCommand({
    name: 'termux-open-file',
    description: 'Abrir archivo remoto (Termux)',
    exec: openRemoteFile,
  });
  registeredCommands.push('termux-open-file');

  commands.addCommand({
    name: 'termux-browse',
    description: 'Explorar archivos en Termux',
    exec: browseRemoteDir,
  });
  registeredCommands.push('termux-browse');

  window.toast('Termux FS cargado', 3000);
});

acode.setPluginUnmount(PLUGIN_ID, () => {
  const { commands } = editorManager.editor;
  registeredCommands.forEach(name => commands.removeCommand(name));
  registeredCommands = [];
});
