#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime

# Allowed static files for PWA support
STATIC_FILES = {
    '/logo.svg': ('logo.svg', 'image/svg+xml'),
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Log request with headers
        with open('server.log', 'a') as f:
            xff = self.headers.get('X-Forwarded-For')
            if xff:
                unique_ips = list(dict.fromkeys(ip.strip() for ip in xff.split(',')))
                client_ip = ', '.join(unique_ips)
            else:
                client_ip = self.address_string()
            f.write(f"{datetime.now().isoformat()} {client_ip} {self.requestline}\n")
        
        # Serve allowed static files
        if self.path in STATIC_FILES:
            filename, content_type = STATIC_FILES[self.path]
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.end_headers()
            with open(filename, 'rb') as f:
                self.wfile.write(f.read())
            return
        
        # Default: serve index.html
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        with open('index.html', 'rb') as f:
            self.wfile.write(f.read())
    
    def log_message(self, format, *args):
        pass  # Handled in do_GET

HTTPServer(('', 8000), Handler).serve_forever()
