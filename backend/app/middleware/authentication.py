from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

PASSWORD_FORM_BODY_LIMIT_BYTES = 64 * 1024
PASSWORD_TOKEN_PATH = "/api/auth/token"


class PasswordFormBodyLimitMiddleware:
    """Reject oversized password forms before Starlette parses their content."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != PASSWORD_TOKEN_PATH:
            await self.app(scope, receive, send)
            return

        content_length = _content_length(scope)
        if content_length is not None and content_length > PASSWORD_FORM_BODY_LIMIT_BYTES:
            await _reject_oversized_request(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > PASSWORD_FORM_BODY_LIMIT_BYTES:
                await _reject_oversized_request(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        replay = _replay_body(bytes(body))
        await self.app(scope, replay, send)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope["headers"]:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _replay_body(body: bytes) -> Receive:
    delivered = False

    async def receive() -> Message:
        nonlocal delivered
        if delivered:
            return {"type": "http.request", "body": b"", "more_body": False}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


async def _reject_oversized_request(scope: Scope, receive: Receive, send: Send) -> None:
    del receive
    response = JSONResponse(status_code=413, content={"detail": "Request body too large"})
    await response(scope, _empty_receive, send)


async def _empty_receive() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}
