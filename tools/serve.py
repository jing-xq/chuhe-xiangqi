# -*- coding: utf-8 -*-
"""本地教学软件服务器：带 COOP/COEP 头（引擎 SharedArrayBuffer 需要）与 wasm MIME。
用法：python tools/serve.py [端口]"""
import http.server
import mimetypes
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # 大文件（引擎 wasm/NNUE 网络）允许缓存，避免每次刷新重复下载
        if ".nnue" in self.path or ".wasm" in self.path:
            self.send_header("Cache-Control", "max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as srv:
        print("教学软件已启动：http://127.0.0.1:%d" % PORT)
        srv.serve_forever()
