"""Deterministic fake of the bits of the Anthropic SDK that assistant.py uses (LIFE_AI_MOCK=1). For tests and demos without a key.
Phrases:  'add task X' -> create_task tool call (confirm card);  'what restaurants' -> read tool then a grounded answer;  'remember X' -> remember tool;
anything else -> a short echo. After a tool result arrives it answers in text."""
import re, json
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
        if "picking exactly one allowed value" in (kw.get("system") or "") and '"verdict"' in kw["system"]:   # entry-rules multiple choice (decide() fallback)
            t = messages[-1]["content"] if isinstance(messages[-1]["content"], str) else ""
            a = {"verdict": "visa_free" if "do not need a visa" in t else "visa_required", "stay": "up to 30 days", "onward": "yes", "form": "no", "health": "no"}
            for cc in re.findall(r'"held_(\w\w)"', kw["system"]): a["held_" + cc] = "1" if cc == "us" and "valid US visa" in t else "none"   # numbered-statement questions
            if '"resident"' in kw["system"]: a["resident"] = "1" if "UAE residents" in t else "none"
            return NS(content=[Block(type="text", text=json.dumps(a))], usage=NS(input_tokens=100, output_tokens=20, cache_read_input_tokens=0))
        if "fill in missing details" in (kw.get("system") or ""):   # list-item enrichment
            items = json.loads(messages[-1]["content"])
            fake = {"restaurant": {"cuisine": "Burgers", "city": "Dubai", "price": "$$"}, "media": {"genre": "Drama", "language": "English", "year": "1999", "medium": "movie"}}
            return NS(content=[Block(type="text", text=json.dumps({"items": [{"n": i["n"], **fake[i["kind"]]} for i in items]}))], usage=NS(input_tokens=100, output_tokens=30, cache_read_input_tokens=0))
        if "shared social-media post" in (kw.get("system") or ""):   # share-to-list extraction
            t = messages[-1]["content"]
            t = t if isinstance(t, str) else " ".join(b.get("text", "") for b in t)   # text + image blocks
            low = t.lower()
            item = ({"type": "movie", "title": "Past Lives", "creator": "Celine Song", "year": "2023", "genre": "Drama, Romance", "language": "English, Korean", "cast": "Greta Lee, Teo Yoo", "notes": "Quiet and devastating"} if "movie" in low else
                    {"type": "show", "title": "Severance", "notes": "Slow-burn office thriller"} if "series" in low else
                    {"type": "cafe", "title": "Tomoca", "city": "Dubai", "notes": "Try the croissant"} if "croissant" in low else
                    {"type": "restaurant", "title": "Pompi", "city": "Rome", "cuisine": "Italian", "price": "$$", "tags": ["Date Night", "outdoor seating"], "address": "Via della Albania 12", "notes": "Get the tiramisu"} if "pompi" in low else None)
            return NS(content=[Block(type="text", text=json.dumps({"items": [item] if item else []}))], usage=NS(input_tokens=100, output_tokens=40, cache_read_input_tokens=0))
        return NS(content=[Block(type="text", text="Saturday. Plenty of room today.")], usage=NS(input_tokens=100, output_tokens=20, cache_read_input_tokens=0))


class MockClient:
    messages = Messages()
