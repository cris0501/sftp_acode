from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
import urllib.parse

HOME = Path("/data/data/com.termux/files/home")
TOKEN = "dev-token"

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def auth(self):
        return self.headers.get("Authorization") == f"Bearer {TOKEN}"

    def resolve(self, rel):
        rel = rel.lstrip("/")
        p = (HOME / rel).resolve()
        if not str(p).startswith(str(HOME)):
            raise ValueError
        return p

    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Connection", "close")

    def send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_empty(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.cors_headers()
        self.end_headers()

    def do_OPTIONS(self):
        self.send_empty(200)

    def do_GET(self):
        if not self.auth():
            self.send_empty(401)
            return

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        path = qs.get("path", [""])[0]

        try:
            p = self.resolve(path)
        except:
            self.send_empty(403)
            return

        if parsed.path == "/fs/list" and p.is_dir():
            out = []
            for e in p.iterdir():
                st = e.stat()
                out.append({
                    "name": e.name,
                    "type": "dir" if e.is_dir() else "file",
                    "size": st.st_size,
                    "mtime": int(st.st_mtime)
                })
            self.send_json(200, out)

        elif parsed.path == "/fs/read" and p.is_file():
            self.send_json(200, {
                "content": p.read_text(),
                "mtime": int(p.stat().st_mtime)
            })

        else:
            self.send_empty(404)

    def do_POST(self):
        if not self.auth():
            self.send_empty(401)
            return

        if self.path != "/fs/write":
            self.send_empty(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
            path = data["path"]
            content = data["content"]
            mtime = data.get("mtime")
        except:
            self.send_empty(400)
            return

        try:
            p = self.resolve(path)
        except:
            self.send_empty(403)
            return

        if p.exists() and mtime:
            current = int(p.stat().st_mtime)
            if current != mtime:
                self.send_json(409, {"error": "File changed"})
                return

        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content + "\n")

        self.send_json(200, {"ok": True})

server = HTTPServer(("127.0.0.1", 8765), Handler)
print("Listening on 127.0.0.1:8765")
server.serve_forever()
