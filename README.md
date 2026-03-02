# Termux FS for Acode

A plugin that bridges [Acode editor](https://acode.app) and [Termux](https://termux.dev) through a local HTTP server, enabling full file management of your Termux home directory directly from Acode's sidebar.

Built for Android developers and tinkerers who use Acode as their daily editor and Termux as their development environment — no root required.

---

## How it works

```
┌─────────────┐   HTTP/1.1    ┌──────────────────┐
│   Acode      │◄────────────►│  Python server    │
│   (WebView)  │  127.0.0.1   │  (Termux)         │
│              │    :8765      │                   │
│  Plugin JS   │              │  ~/home filesystem │
└─────────────┘              └──────────────────┘
```

The Python server runs in Termux and exposes a RESTful API over localhost. The Acode plugin consumes this API to list, read, create, edit, and delete files — all rendered in a custom sidebar panel with a native-like file tree.

---

## Features

- **Sidebar file tree** with lazy-loaded directories, collapsible folders, and file icons colored by extension
- **Multi-folder support** — open multiple project directories simultaneously
- **File editing** with conflict detection via mtime comparison
- **Create files and folders** from the sidebar or via context menu
- **Delete files and folders** with confirmation dialog
- **Duplicate tab prevention** — reopening an already-open file activates its existing tab
- **Filtered view** — hides `node_modules`, `__pycache__`, `.git`, and other common noise by default
- **CORS-ready server** with `Connection: close` for WebView compatibility

---

## Project structure

```
.
├── plugin/
│   ├── acode-plugin-main/
│   │   ├── src/
│   │   │   └── main.js          # Plugin source
│   │   ├── dist/                 # Built output (gitignored)
│   │   ├── plugin.json           # Acode plugin manifest
│   │   ├── esbuild.config.mjs    # Build configuration
│   │   ├── pack-zip.js           # Zip packaging script
│   │   ├── package.json
│   │   ├── icon.png
│   │   ├── readme.md             # Plugin readme (shown in Acode)
│   │   └── changelog.md
│   └── dist/
│       └── plugin.zip            # Pre-built installable package
├── server/
│   └── server.py                 # Termux HTTP server
├── test/
│   └── file.js                   # Test fixture
├── .gitignore
└── README.md
```

---

## Installation

### Prerequisites

- **Termux** with Python 3 installed (`pkg install python`)
- **Acode** editor (v292+ recommended)

### 1. Start the server

Clone the repo or download `server/server.py` to your Termux home:

```bash
git clone https://github.com/cris0501/sftp_acode.git
cd sftp_acode/
python server/server.py
```

You should see:

```
Listening on 127.0.0.1:8765
```

Keep this running in a Termux session (or use `nohup` / `tmux`).

### 2. Install the plugin

Download [`plugin/dist/plugin.zip`](https://github.com/cris0501/sftp_acode/blob/master/plugin/dist/plugin.zip) from this repo to your device.

Then in Acode:

1. Go to **Settings → Plugins → tap the + icon**
2. Select **LOCAL**
3. Navigate to your Downloads folder and select `plugin.zip`

That's it — no build step required.

### 3. Use it

- Open the **sidebar** (swipe or tap the sidebar icon)
- Find the **Termux FS** panel
- Tap **Open folder** to browse your Termux home and select a project
- Tap files to open them — edits save back to Termux automatically
- **Long-press** any file or folder for context menu (create, delete)

---

## Server API

All endpoints require `Authorization: Bearer dev-token` header.

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `GET` | `/fs/list?path=` | — | List directory contents |
| `GET` | `/fs/read?path=` | — | Read file content + mtime |
| `POST` | `/fs/create` | `{path, type, content?}` | Create file or directory |
| `PATCH` | `/fs/write` | `{path, content, mtime?}` | Update existing file |
| `DELETE` | `/fs/delete` | `{path}` | Delete file or directory |

Responses are JSON. The server includes CORS headers for WebView compatibility and uses `Connection: close` to prevent hanging connections.

### Quick test

```bash
# List home directory
curl -H "Authorization: Bearer dev-token" "http://127.0.0.1:8765/fs/list?path="

# Read a file
curl -H "Authorization: Bearer dev-token" "http://127.0.0.1:8765/fs/read?path=test/file.js"

# Create a file
curl -X POST -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"path":"test/new.txt","type":"file","content":"hello"}' \
  http://127.0.0.1:8765/fs/create

# Edit a file
curl -X PATCH -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"path":"test/new.txt","content":"updated"}' \
  http://127.0.0.1:8765/fs/write

# Delete a file
curl -X DELETE -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"path":"test/new.txt"}' \
  http://127.0.0.1:8765/fs/delete
```

---

## Building from source

Only needed if you want to modify the plugin.

```bash
cd plugin
npm install
npm run build
node pack-zip.js
```

The built `plugin.zip` is ready to install in Acode via **Settings → Plugins → + → LOCAL**.

---

## Development workflow

### Iterating on the plugin

```bash
cd plugin

# Edit src/main.js, then:
npm run build && node pack-zip.js
cp plugin.zip ~/storage/shared/Documents/plugin.zip

# In Acode: uninstall old version, install new zip
```

### Tip: use a Secure Folder

Install a copy of Acode in Samsung's Secure Folder (or a work profile). This way, if a broken plugin corrupts the plugin list, you just clear data on the test copy — your daily Acode stays untouched.

---

## Roadmap

### Near-term

- [ ] **Componentize source** — split `main.js` into modules (`api.js`, `config.js`, `editor.js`, `components/sidebar.js`, `components/styles.js`) with ES module imports bundled by esbuild
- [ ] **Rename support** — PATCH endpoint + context menu option
- [ ] **Move / copy** — drag or menu-based file relocation
- [ ] **Configurable settings** — server URL, port, token, and ignored patterns editable from Acode's plugin settings page
- [ ] **Publish to Acode plugin registry** — make it installable directly from Acode's plugin browser

### Mid-term

- [ ] **Server installer script** — one-liner bash setup that installs the server, creates a boot service, and configures the token
- [ ] **Search in files** — grep-like search across the opened project via a new server endpoint
- [ ] **Auto-start server** — Termux:Boot integration to launch the server on device startup

### Long-term

- [ ] **File watcher** — server-side inotify to detect external changes and notify the plugin via polling or SSE
- [ ] **Terminal bridge** — run commands from Acode via the server
- [ ] **Multi-device** — expose the server over the local network with authentication for editing Termux files from a desktop browser

---

## Known limitations

- **No native file explorer integration** — Acode's built-in file browser uses `fsOperation` which only supports local Android paths (`file://`, `content://`). There is no API to register a custom filesystem provider, so the plugin uses a sidebar app instead.
- **WebView CORS** — Acode runs in a Cordova WebView where the origin differs from `127.0.0.1`. The server must include CORS headers on every response, and non-simple requests (those with `Authorization` header or `application/json` content type) trigger a preflight `OPTIONS` request.
- **HTTP/1.1 keep-alive** — the WebView expects `Connection: close` or a proper `Content-Length` on every response, otherwise `fetch()` hangs indefinitely waiting for more data.
- **No binary files** — the server reads/writes files as UTF-8 text. Binary files (images, compiled artifacts) are not supported.

---

## License

MIT

