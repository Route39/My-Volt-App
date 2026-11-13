import json
from urllib.parse import parse_qsl, urlencode
SKIP = ("password", "otp", "token", "secret")
def _clean(v, key=""):
    if isinstance(v, str):
        return v if any(s in key.lower() for s in SKIP) else v.strip()
    if isinstance(v, list):
        return [_clean(i, key) for i in v]
    if isinstance(v, dict):
        return {k: _clean(x, k) for k, x in v.items()}
    return v
class TrimMiddleware:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        qs = scope.get("query_string", b"")
        if qs:
            pairs = parse_qsl(qs.decode(), keep_blank_values=True)
            scope = dict(scope, query_string=urlencode([(k, _clean(v, k)) for k, v in pairs]).encode())
        if b"application/json" not in dict(scope.get("headers") or []).get(b"content-type", b""):
            return await self.app(scope, receive, send)
        body, more = b"", True
        while more:
            m = await receive(); body += m.get("body", b""); more = m.get("more_body", False)
        try: body = json.dumps(_clean(json.loads(body))).encode()
        except Exception: pass
        scope = dict(scope, headers=[(k, v) for k, v in scope["headers"] if k != b"content-length"] + [(b"content-length", str(len(body)).encode())])
        done = False
        async def rcv():
            nonlocal done
            if not done:
                done = True; return {"type": "http.request", "body": body, "more_body": False}
            return await receive()
        await self.app(scope, rcv, send)
