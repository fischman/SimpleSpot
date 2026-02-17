#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import posixpath
import os

INDEX_ALIASES = { '/index.html', '/login' }
NON_INDEX_FILES = { '/app.js' }

MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' }

class Handler(BaseHTTPRequestHandler):
    def serve_file(self, path):
        self.send_response(200)
        self.send_header('Content-Type', MIME_TYPES[os.path.splitext(path)[1]])
        self.end_headers()
        with open(path, 'rb') as f:
            self.wfile.write(f.read())

    def do_GET(self):
        # Ensure path is absolute and doesn't escape root.
        path = posixpath.normpath(urlparse(self.path).path)
        if not path.startswith('/'):
            path = '/' + path

        if path in INDEX_ALIASES or path == '/':
            return self.serve_file('index.html')
        if path in NON_INDEX_FILES:
            return self.serve_file('.' + path)
        self.send_error(403)

    def log_message(self, format, *args):
        pass

print(f'SimpleSpot is at http://127.0.0.1:8000/')
HTTPServer(('', 8000), Handler).serve_forever()
