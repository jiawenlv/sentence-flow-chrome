"""Loopback-only receiver for the extension's sanitized diagnostic metadata."""
import json
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

LOG_DIR = Path.home() / '.ljwsoftware' / 'sentence-flow'
FIELDS = {'time', 'event', 'tabId', 'phase', 'total', 'translated', 'provider', 'serviceOrigin', 'status', 'durationMs', 'stage', 'scriptVersion', 'extensionVersion', 'count', 'error'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def allowed(self):
        return bool(re.fullmatch(r'chrome-extension://[a-p]{32}', self.headers.get('Origin', '')))

    def respond(self, status):
        self.send_response(status)
        if self.allowed():
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.end_headers()

    def do_OPTIONS(self):
        self.respond(204 if self.allowed() else 403)

    def do_GET(self):
        if self.path != '/health':
            self.respond(404)
            return
        self.respond(200)
        self.wfile.write(b'{"ok":true,"service":"sentence-flow-diagnostics"}')

    def do_POST(self):
        if not self.allowed():
            self.respond(403)
            return
        if self.path != '/events':
            self.respond(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 16384:
                self.respond(413)
                return
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or not isinstance(data.get('event'), str):
                raise ValueError('Invalid event')
            entry = {key: value for key, value in data.items() if key in FIELDS and isinstance(value, (str, int, float))}
            LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = LOG_DIR / 'diagnostics.jsonl'
            if path.exists() and path.stat().st_size >= 5 * 1024 * 1024:
                path.replace(LOG_DIR / 'diagnostics.previous.jsonl')
            with path.open('a', encoding='utf-8') as stream:
                path.chmod(0o600)
                stream.write(json.dumps(entry, ensure_ascii=False) + '\n')
            self.respond(204)
        except (ValueError, OSError):
            self.respond(400)

if __name__ == '__main__':
    LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    server = HTTPServer(('127.0.0.1', 18766), Handler)
    with (LOG_DIR / 'diagnostics.jsonl').open('a', encoding='utf-8') as stream:
        (LOG_DIR / 'diagnostics.jsonl').chmod(0o600)
        stream.write(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'event': 'diagnostics.server.start'}) + '\n')
    server.serve_forever()
