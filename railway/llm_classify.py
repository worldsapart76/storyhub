"""LLM freeform-tag classifier (the "Claude API classification" the design calls
for). Classifies AO3 additional/freeform tags into the curated categories — plus an
Exclude verdict for non-descriptive noise (author commentary, jokes, one-offs).

Output feeds tag_curation.json (auto_classified) -> applied to the live tags table.

    python llm_classify.py make-sample              # -> llm_sample_haiku.json + llm_sample_sonnet.json (500 each, disjoint, varied)
    python llm_classify.py run <haiku|sonnet> <in.json> <out.json>

Key: railway/.anthropic-key (gitignored) or ANTHROPIC_API_KEY. Run from railway/.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CACHE = HERE / "migration_cache.sqlite"
AUDIT = HERE / "audit_deleted.json"

MODELS = {"haiku": "claude-haiku-4-5-20251001", "sonnet": "claude-sonnet-4-6"}
# Est. USD per million tokens (input, output) — label outputs as estimates.
PRICES = {"haiku": (1.0, 5.0), "sonnet": (3.0, 15.0)}
CODES = ["Identity", "Universe", "Content", "Trope", "Dynamics", "Mood",
         "Structure", "Other", "Exclude"]
BATCH = 100

SYSTEM = """You categorize AO3 fan-fiction "additional tags" (freeform tags) for a \
personal library's filter UI. Assign each tag EXACTLY ONE code:

- Identity: what a character IS in an AU — species/role/state/occupation/appearance \
("Alpha Steve Rogers", "Vampire X", "Trans Y", "Photographer Derek", "BAMF Hermione", "De-Aged Derek").
- Universe: the world / canon framing — AUs, Canon Compliant/Divergence, crossovers, \
settings, time periods ("Alternate Universe - Coffee Shop", "Canon Divergence", "Crossover", "Modern Setting").
- Content: sexual content AND warning-type content ("Smut", "Anal Sex", "Knotting", \
"Dom/sub", "Graphic Depictions of Violence", "Major Character Death", "Rape/Non-Con", "Suicidal Thoughts", "Drug Use").
- Trope: plot devices / relationship setups ("Enemies to Lovers", "Fake Dating", \
"Found Family", "Soulmates", "Time Travel", "Mpreg", "Fix-It", "Alpha/Beta/Omega Dynamics").
- Dynamics: how an existing relationship operates ("Established Relationship", \
"Getting Together", "Miscommunication", "Idiots in Love", "Domestic", "Polyamory", "Jealousy").
- Mood: emotional tone ("Fluff", "Angst", "Crack", "Humor", "Dark", "Happy Ending", "Bittersweet").
- Structure: pace / form ("Slow Burn", "One Shot", "Drabble", "Alternating POV", "Epistolary", "5+1", "WIP").
- Other: a genuine descriptor that fits none of the above.
- Exclude: NOT a useful filter — author commentary, jokes, meta, or one-off noise \
("i stayed up till midnight writing this", "please I love it", "my first fanfic", "sorry not sorry", "don't judge me").

Pick the single best fit. Prefer a real category over Other. Use Exclude ONLY for \
clearly non-descriptive noise. Output ONLY a compact JSON object mapping each tag's \
number (as a string) to its code, e.g. {"1":"Trope","2":"Exclude"}. No prose, no markdown."""


def _key() -> str:
    f = HERE / ".anthropic-key"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                return line.strip()
    import os
    k = os.environ.get("ANTHROPIC_API_KEY")
    if not k:
        sys.exit("no API key (railway/.anthropic-key or ANTHROPIC_API_KEY)")
    return k


def _corpus():
    """{name: freq} over all OK-scrape + audit freeforms."""
    import sqlite3
    from collections import Counter
    freq = Counter()
    if CACHE.exists():
        c = sqlite3.connect(CACHE)
        for (ff,) in c.execute("SELECT freeforms FROM ao3_scrape WHERE status='ok' AND freeforms IS NOT NULL"):
            for t in json.loads(ff):
                freq[t] += 1
        c.close()
    if AUDIT.exists():
        for w in json.loads(AUDIT.read_text(encoding="utf-8")):
            for t in w.get("freeforms", []):
                freq[t] += 1
    return freq


def dump_all(out: str):
    freq = _corpus()
    items = [{"name": n, "freq": f} for n, f in sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))]
    Path(out).write_text(json.dumps(items, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"wrote {len(items)} freeform tags -> {out}")


def make_sample():
    freq = _corpus()
    ranked = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))  # common -> rare
    step = max(1, len(ranked) // 1000)
    spread = ranked[::step][:1000]
    haiku = [{"name": n, "freq": f} for i, (n, f) in enumerate(spread) if i % 2 == 0][:500]
    sonnet = [{"name": n, "freq": f} for i, (n, f) in enumerate(spread) if i % 2 == 1][:500]
    (HERE / "llm_sample_haiku.json").write_text(json.dumps(haiku, ensure_ascii=False, indent=0), encoding="utf-8")
    (HERE / "llm_sample_sonnet.json").write_text(json.dumps(sonnet, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"corpus freeforms={len(freq)}  sampled 1000 across freq range "
          f"(top={ranked[0][1]}x .. tail=1x)")
    print(f"  llm_sample_haiku.json: {len(haiku)}   llm_sample_sonnet.json: {len(sonnet)}  (disjoint)")


def _call(model_id: str, items: list[dict], key: str):
    lines = [f"{i+1}. {it['name']}  (x{it['freq']})" for i, it in enumerate(items)]
    body = json.dumps({
        "model": model_id, "max_tokens": 8000, "temperature": 0,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": "Tags:\n" + "\n".join(lines)}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"})
    resp = json.load(urllib.request.urlopen(req, timeout=180))
    text = "".join(b.get("text", "") for b in resp.get("content", []))
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    mapping = json.loads(text)
    u = resp.get("usage", {})
    return mapping, u.get("input_tokens", 0), u.get("output_tokens", 0)


def _call_retry(model_id, batch, key, tries=4):
    for a in range(tries):
        try:
            return _call(model_id, batch, key)
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
            wait = [5, 15, 40, 90][min(a, 3)]
            print(f"    retry {a+1}/{tries} after error ({e}) — sleeping {wait}s")
            time.sleep(wait)
    raise RuntimeError("batch failed after retries")


def run(model: str, infile: str, outfile: str):
    from collections import Counter
    key = _key()
    model_id = MODELS[model]
    items = json.loads(Path(infile).read_text(encoding="utf-8"))
    out = Path(outfile)
    results = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    todo = [it for it in items if it["name"] not in results]
    print(f"{len(results)} already done, {len(todo)} to classify ({model})")
    tin = tout = 0
    for s in range(0, len(todo), BATCH):
        batch = todo[s:s + BATCH]
        mapping, i_in, i_out = _call_retry(model_id, batch, key)
        tin += i_in; tout += i_out
        for i, it in enumerate(batch):
            results[it["name"]] = {"category": mapping.get(str(i + 1), "Other"), "freq": it["freq"]}
        out.write_text(json.dumps(results, ensure_ascii=False, indent=0), encoding="utf-8")  # save each batch (resumable)
        print(f"  batch {s//BATCH+1}/{(len(todo)+BATCH-1)//BATCH}: {len(batch)} tags  (+{i_in}/{i_out} tok)")
    pin, pout = PRICES[model]
    cost = tin / 1e6 * pin + tout / 1e6 * pout
    dist = Counter(v["category"] for v in results.values())
    print(f"\n{model} ({model_id}) — {len(results)} tags")
    print(f"  tokens: {tin} in / {tout} out   est. cost: ${cost:.4f}")
    print(f"  -> full {len(_corpus())//1000}k-tag run est: ${cost * (len(_corpus())/len(results)):.2f}")
    print("  distribution: " + ", ".join(f"{c}={dist[c]}" for c in CODES if dist[c]))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "make-sample":
        make_sample()
    elif cmd == "dump-all":
        dump_all(sys.argv[2])
    elif cmd == "run":
        run(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit("usage: make-sample | dump-all <out.json> | run <haiku|sonnet> <in.json> <out.json>")
