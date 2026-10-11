"""OpenAI chat-completions adapter that looks like the slice of the Anthropic SDK assistant.py uses (messages.stream / messages.create).
History and tool calls stay in Anthropic's block format everywhere else in the app; this file translates at the edge."""
import json
from types import SimpleNamespace as NS
import requests

URL = "https://api.openai.com/v1/chat/completions"


class Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self, mode="json", exclude_none=True):
        return dict(self.__dict__)


class RateLimitError(Exception):
    pass


def to_openai(system, messages):
    out = [{"role": "system", "content": system}] if system else []
    for m in messages:
        c = m["content"]
        if isinstance(c, str):
            out.append({"role": m["role"], "content": c}); continue
        if m["role"] == "assistant":
            calls = [{"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}} for b in c if b.get("type") == "tool_use"]
            msg = {"role": "assistant", "content": "".join(b.get("text", "") for b in c if b.get("type") == "text") or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        elif any(b.get("type") == "image" for b in c):   # text + images in one user turn (Anthropic block format in, OpenAI parts out)
            out.append({"role": "user", "content": [{"type": "text", "text": b["text"]} if b.get("type") == "text" else {"type": "image_url", "image_url": {"url": f"data:{b['source']['media_type']};base64,{b['source']['data']}"}} for b in c]})
        else:
            for b in c:
                if b.get("type") == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": str(b.get("content", ""))})
                elif b.get("type") == "text":
                    out.append({"role": "user", "content": b["text"]})
    return out


class Stream:
    def __init__(self, resp):
        self.r, self.text, self.calls, self.finish = resp, "", {}, None
        self.usage = NS(input_tokens=0, output_tokens=0, cache_read_input_tokens=0)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.r.close(); return False

    @property
    def text_stream(self):
        for line in self.r.iter_lines():
            if not line.startswith(b"data: "):
                continue
            if line[6:] == b"[DONE]":
                break
            j = json.loads(line[6:])
            u = j.get("usage")
            if u:
                self.usage = NS(input_tokens=u.get("prompt_tokens", 0), output_tokens=u.get("completion_tokens", 0), cache_read_input_tokens=0)
            for ch in j.get("choices") or []:
                d = ch.get("delta") or {}
                if d.get("content"):
                    self.text += d["content"]; yield d["content"]
                for tc in d.get("tool_calls") or []:
                    c = self.calls.setdefault(tc["index"], {"id": "", "name": "", "args": ""}); f = tc.get("function") or {}
                    c["id"] = tc.get("id") or c["id"]; c["name"] = f.get("name") or c["name"]; c["args"] += f.get("arguments") or ""
                self.finish = ch.get("finish_reason") or self.finish

    def get_final_message(self):
        def args(s):
            try:
                return json.loads(s or "{}")
            except ValueError:
                return {}
        tools = [Block(type="tool_use", id=c["id"], name=c["name"], input=args(c["args"])) for _, c in sorted(self.calls.items())]
        stop = "tool_use" if tools else {"length": "max_tokens", "content_filter": "refusal"}.get(self.finish, "end_turn")
        return NS(content=([Block(type="text", text=self.text)] if self.text else []) + tools, stop_reason=stop, usage=self.usage)


class Messages:
    def __init__(self, key):
        self.key = key

    def _post(self, model, system, messages, tools, max_tokens, output_config, stream):
        body = {"model": model, "messages": to_openai(system, messages), "max_completion_tokens": max_tokens}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
        if output_config and output_config.get("effort"):
            body["reasoning_effort"] = output_config["effort"]
        if stream:
            body.update(stream=True, stream_options={"include_usage": True})
        r = requests.post(URL, headers={"Authorization": "Bearer " + self.key}, json=body, stream=stream, timeout=180)
        if r.status_code >= 400:
            try:
                msg = r.json()["error"]["message"]
            except Exception:
                msg = r.reason or str(r.status_code)
            raise (RateLimitError if r.status_code == 429 else RuntimeError)(msg)
        return r

    def stream(self, model, messages, system=None, tools=None, max_tokens=4000, output_config=None, **_):
        return Stream(self._post(model, system, messages, tools, max_tokens, output_config, True))

    def create(self, model, messages, system=None, max_tokens=1200, output_config=None, **_):
        j = self._post(model, system, messages, None, max_tokens, output_config, False).json()
        u = j.get("usage") or {}
        return NS(content=[Block(type="text", text=j["choices"][0]["message"].get("content") or "")], usage=NS(input_tokens=u.get("prompt_tokens", 0), output_tokens=u.get("completion_tokens", 0), cache_read_input_tokens=0))


class OpenAIClient:
    def __init__(self, key):
        self.messages = Messages(key)
