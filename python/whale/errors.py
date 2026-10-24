"""统一错误类型。

所有对外暴露的失败都必须是一个 :class:`WhaleError`，带稳定的 ``code``
（供程序判断）和面向用户的中文 ``message``（供界面展示）。这样 CLI、
sidecar、渲染层三处只需要处理一种错误形状。
"""

from __future__ import annotations


class WhaleError(Exception):
    """数据层唯一对外异常。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message}

    def __repr__(self) -> str:  # pragma: no cover - 仅调试用
        return f"WhaleError({self.code!r}, {self.message!r})"


# 约定好的错误码（写在这里便于查阅，代码里直接用字符串字面量，便于 grep）：
#   NO_COOKIE / COOKIE_INVALID / ENCRYPT_FAILED / NETWORK / NO_CACHE
#   NO_DB / NO_SESSION / NO_TURN_END / BAD_JSON / BAD_COMMAND
#   API_<code> / HTTP_<status> / INTERNAL
# 前端只按 code 做分支，message 直接展示给用户。
