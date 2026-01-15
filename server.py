#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
from urllib.request import urlopen
from urllib.parse import urlparse, parse_qs, quote
import json

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
        
        parsed = urlparse(self.path)
        
        if parsed.path == '/lyrics':
            query = parse_qs(parsed.query)
            name = query.get('name', [''])[0]
            try:
                url = f"https://lyricsapi.vercel.app/api/lyrics?name={quote(name)}"
                with urlopen(url, timeout=10) as resp:
                    data = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            with open('index.html', 'rb') as f:
                self.wfile.write(f.read())
    
    def log_message(self, format, *args):
        pass  # Handled in do_GET

HTTPServer(('', 8000), Handler).serve_forever()
