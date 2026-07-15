import json, sys
with open("logs.1782962823579.json", "r", encoding="utf-8") as f:
    data = json.load(f)
errors = [e for e in data if e.get("severity") == "error"]
for e in errors[-50:]:
    ts = e.get("timestamp", "?")[:19]
    msg = e.get("message", "")[:300]
    print(f"[{ts}] {msg}")
print(f"\n--- Total errors: {len(errors)} / {len(data)} entries ---")
