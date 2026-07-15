import json
with open("logs.1782962823579.json", "r", encoding="utf-8") as f:
    data = json.load(f)
errors = [e for e in data if e.get("severity") == "error"]
# Filter out rate limit
filtered = [e for e in errors if "rate limit" not in e.get("message","").lower() and "429" not in e.get("message","")]
for e in filtered[:50]:
    ts = e.get("timestamp", "?")[:19]
    msg = e.get("message", "")[:400]
    print(f"[{ts}] {msg}")
print(f"\n--- Filtered errors: {len(filtered)} / {len(errors)} total ---")
