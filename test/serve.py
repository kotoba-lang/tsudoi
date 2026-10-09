# Static dev server for web/ that disables caching. Run: python3 test/serve.py
import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory="web")).serve_forever()
