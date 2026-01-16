#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from urllib.request import urlopen
from urllib.parse import urlparse
from urllib.error import HTTPError

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/lyrics':
            url = f"https://lyricsapi.vercel.app/api/lyrics?{parsed.query}"
            try:
                with urlopen(url, timeout=10) as resp:
                    self.send_response(resp.status)
                    self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                    self.end_headers()
                    self.wfile.write(resp.read())
            except HTTPError as e:
                self.send_response(e.code)
                self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(e.read())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            with open('index.html', 'rb') as f:
                self.wfile.write(f.read())
    
    def log_message(self, format, *args):
        pass  # Handled in do_GET

HTTPServer(('', 8000), Handler).serve_forever()
