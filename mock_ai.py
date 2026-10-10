"""Deterministic fake of the bits of the Anthropic SDK that assistant.py uses (LIFE_AI_MOCK=1). For tests and demos without a key.
Phrases:  'add task X' -> create_task tool call (confirm card);  'what restaurants' -> read tool then a grounded answer;  'remember X' -> remember tool;
anything else -> a short echo. After a tool result arrives it answers in text."""
import re
from types import SimpleNamespace as NS


class Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def model_dump(self, mode="json", exclude_none=True):
        return {k: v for k, v in self.__dict__.items() if v is not None}


class Stream:
    def __init__(self, text, tool_uses, stop):
        self._text, self._tools, self._stop = text, tool_uses, stop

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    @property
    def text_stream(self):
        for i in range(0, len(self._text), 12):
            yield self._text[i:i + 12]

    def get_final_message(self):
        content = ([Block(type="text", text=self._text)] if self._text else []) + self._tools
        return NS(content=content, stop_reason=self._stop, usage=NS(input_tokens=400, output_tokens=60, cache_read_input_tokens=0))


class Messages:
    def stream(self, model, messages, **kw):
        last = messages[-1]
        if last["role"] == "user" and isinstance(last["content"], list) and last["content"] and last["content"][0].get("type") == "tool_result":
            res = " | ".join(str(b.get("content"))[:160] for b in last["content"])
            return Stream(f"Done. ({res[:200]})", [], "end_turn")
        text = last["content"] if isinstance(last["content"], str) else ""
        low = text.lower()
        m = re.search(r"add (?:a )?task[: ]+(.*)", low)
        if m:
            return Stream("Sure — here's the task.", [Block(type="tool_use", id="toolu_mock1", name="create_task", input={"title": m.group(1).strip().capitalize(), "priority": 2})], "tool_use")
        m = re.search(r"remember (?:that )?(.*)", low)
        if m:
            return Stream("", [Block(type="tool_use", id="toolu_mock2", name="remember", input={"text": m.group(1).strip()})], "tool_use")
        if "restaurant" in low:
            return Stream("", [Block(type="tool_use", id="toolu_mock3", name="list_items", input={"query": "rome"})], "tool_use")
        return Stream("You said: " + text[:80], [], "end_turn")

    def create(self, model, messages, **kw):
        return NS(content=[Block(type="text", text="Saturday. Plenty of room today.")], usage=NS(input_tokens=100, output_tokens=20, cache_read_input_tokens=0))


class MockClient:
    messages = Messages()
