"""A tiny local OpenAI-compatible server for tests: deterministic embeddings and
canned chat replies. No network, no keys, no cost."""
import hashlib
import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIMS = 64


def embed(text: str, dims: int = DIMS) -> list[float]:
    vec = [0.0] * dims
    for i in range(max(1, len(text) - 1)):
        h = int.from_bytes(hashlib.sha256(text[i:i + 2].encode()).digest()[:4], "big")
        vec[h % dims] += 1.0
    n = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / n for v in vec]


class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
        if self.path.endswith("/embeddings"):
            inp = req.get("input")
            items = inp if isinstance(inp, list) else [inp]
            dims = int(req.get("dimensions") or DIMS)
            self._send({"object": "list", "model": req.get("model"), "usage": {"prompt_tokens": 1, "total_tokens": 1},
                        "data": [{"object": "embedding", "index": i, "embedding": embed(str(t), dims)} for i, t in enumerate(items)]})
        else:
            self._send({"id": "x", "object": "chat.completion", "created": 0, "model": req.get("model"),
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": '{"facts": [], "memory": []}'}}]})


def start() -> tuple[str, ThreadingHTTPServer]:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/v1", srv
