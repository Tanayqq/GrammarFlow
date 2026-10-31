"""Local-only two-origin demo. Static runtime origin has no APIs or secrets."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        allowed = (path.startswith('/vendor/') if self.server.server_port == 8781 else
                   path in ('/', '/index.html', '/runner.js', '/worker.mjs', '/recorder.py', '/tests.js'))
        if not allowed or '..' in path or '%' in path:
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        # Apply the same allowlist; HEAD must not expose arbitrary local files.
        path = self.path.split('?')[0]
        allowed = (path.startswith('/vendor/') if self.server.server_port == 8781 else
                   path in ('/', '/index.html', '/runner.js', '/worker.mjs', '/recorder.py', '/tests.js'))
        if not allowed or '..' in path or '%' in path:
            self.send_error(404)
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'public, max-age=86400' if '/vendor/' in self.path else 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    Thread(target=ThreadingHTTPServer(('127.0.0.1', 8781), Handler).serve_forever, daemon=True).start()
    print('Dev Editor foundation demo: http://127.0.0.1:8780', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8780), Handler).serve_forever()
