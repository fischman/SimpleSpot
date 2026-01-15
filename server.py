#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        with open('index.html', 'rb') as f:
            self.wfile.write(f.read())
    
    def log_message(self, format, *args):
        client_ip = self.headers.get('X-Forwarded-For', self.address_string())
        with open('server.log', 'a') as f:
            f.write(f"{datetime.now().isoformat()} {client_ip} {format % args}\n")

HTTPServer(('', 8000), Handler).serve_forever()
