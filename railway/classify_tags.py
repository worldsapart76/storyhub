"""Heuristic freeform-tag category classifier (Phase G auto-classifier, §6.3.1).

Maps a freeform/warning tag name -> one of the curated categories. Output is a
PROPOSAL: callers set auto_classified=true so every assignment is flagged for
human review (hard rule). First matching rule wins; order encodes the judgment
calls (e.g. "Alpha/Beta/Omega Dynamics" is a Trope, but "Alpha <Name>" is an
Identity). Anything unmatched -> Other.

Categories (ABO removed 2026-06-16): Identity Universe Content Trope Dynamics
Mood Structure Other.

Usage:  python classify_tags.py            # dry-run over the audit freeforms + live tags
"""
from __future__ import annotations

import re

# Ordered (regex, category). First match wins — order resolves overlaps, so the
# sequence is deliberate: Structure, Universe, the A/B/O-dynamics special-case
# (Trope, before Identity so it doesn't read the "Omega" as a role), Content
# (sex/warnings, before Identity/Trope so kinks aren't mis-shelved), then Identity,
# Trope, Dynamics, Mood. Hurt/Comfort -> Mood per browse.md (flagged; see note).
RULES: list[tuple[str, str]] = [
    # --- Structure (pace/form) ---
    (r"\b(slow burn|one[\s-]?shot|drabbles?|ficlets?|epistolary|second person|"
     r"first person|podfic|fanart|fan art|fanvid|comic|illustrated|vignette|"
     r"non[\s-]?linear|five times|fix times|\d ?\+ ?1|chaptered|multi[\s-]?chapter|"
     r"work in progress|\bwip\b|short fic|long fic|microfic|flash fic|"
     r"alternating pov|outsider pov|unreliable narrator)\b", "Structure"),
    (r"\bpov\b|point of view", "Structure"),

    # --- Universe (world/canon framing) — "...AU" lands here first ---
    (r"alternat(e|ive) universe|\bau\b|\bau -|- au\b|canon[\s-]?(compliant|"
     r"divergen|typical|adjacent)|non[\s-]?canon|crossover|cross[\s-]?over|fusion|"
     r"\bset (in|during|post|pre|after|before)|post[\s-]?canon|pre[\s-]?canon|"
     r"modern (setting|au|day)|coffee shop|college|university|high school|"
     r"\bhogwarts\b|space opera|sci[\s-]?fi|science fiction|fantasy|medieval|"
     r"historical|victorian|regency|future|dystopia|apocalyp|soulmate au|"
     r"world ?building|\bcanon\b|\bera\b|time period", "Universe"),

    # --- A/B/O DYNAMICS as a trope (not the role) ---
    (r"alpha/beta/omega|alpha/omega|a/?b/?o\b|omega ?verse|omegaverse|"
     r"\bknotting\b|mating cycles|mating bond|in heat\b|alpha/beta", "Trope"),

    # --- Content (sex + AO3 warning-style content; combined per §6.3.1) ---
    (r"\b(smut|pwp|porn|sex|sexual|nsfw|explicit|oral|anal|blow ?job|hand ?job|"
     r"rim(ming|job)|finger(ing|fuck)|masturbat|orgasm|edging|overstimulat|"
     r"\bkink|bdsm|dom/sub|\bd/s\b|dom(inant|ination)|sub(missive|mission)|"
     r"bondage|spanking|impact play|praise|degrad|humiliat|choking|breath play|"
     r"rough|barebacking|bareback|creampie|cock ?warming|size (kink|difference)|"
     r"\bheat\b|\brut\b|mating|breeding|\bcome\b|\bcum\b|\bcock|aftercare|"
     r"dirty talk|sex toy|frottage|grinding|scent(ing| marking)?|"
     r"violence|graphic|major character death|character death|\bdeath\b|murder|"
     r"\brape\b|non[\s-]?con|noncon|dub[\s-]?con|dubious consent|consent issues|"
     r"torture|abus|assault|\bblood\b|gore|injur|wounds?|self[\s-]?harm|"
     r"suicid|\bdrug|alcohol|drinking|addiction|underage|slavery|kidnap|whump|"
     r"trauma|ptsd|panic attack|eating disorder|abortion|miscarriage)\b", "Content"),

    # --- Identity (what a character IS: species/role/state, usually + a name) ---
    (r"\b(alpha|omega|beta|vampire|werewolf|were[\s-]|human|demon|angel|fae|fairy|"
     r"witch|wizard|hybrid|dragon|merman|mermaid|siren|ghost|spirit|robot|android|"
     r"cyborg|god|goddess|deity|shifter|kitsune|nymph|incubus|succubus|selkie|"
     r"royalty|prince|princess|king|queen|knight|pirate|"
     r"bamf|feral|dark|evil|good|soft) +[A-Z]", "Identity"),
    (r"\b(trans|transgender|nonbinary|non-binary|genderfluid|genderqueer|intersex|"
     r"autistic|adhd|neurodivergent|disabled|amputee|deaf|blind|mute|"
     r"chronic (illness|pain)|mental illness|depression|anxiety)\b", "Identity"),

    # --- Trope (plot devices / relationship setups) ---
    (r"enemies to|friends to|lovers to|to lovers|to friends|to enemies|"
     r"fake (dating|relationship|marriage)|pretend(ing)? (dating|to)|fake[\s-]?date|"
     r"found family|chosen family|"
     r"mutual pining|\bpining\b|unrequited|yearning|"
     r"forced proximity|only one bed|bed[\s-]?sharing|sharing a bed|stuck (together|in)|"
     r"\bmarriage\b|wedding|engage|arranged|courting|courtship|mail[\s-]?order|"
     r"fix[\s-]?it|time travel|time loop|groundhog|amnesia|memory loss|"
     r"soulmate|red string|reincarnation|"
     r"secret identity|identity (reveal|porn)|hidden identity|coming out|"
     r"redemption|rivalry|\brivals\b|\benemies\b|"
     r"\bmpreg\b|pregnan|kid ?fic|\bbaby\b|parenthood|raising|adoption|"
     r"undercover|bodyguard|fake|amnesi|cursed?|curse breaking|magic reveal|"
     r"hurt[\s/]comfort", "Trope"),

    # --- Dynamics (how the relationship operates) ---
    (r"established relationship|getting together|get together|first kiss|first time|"
     r"miscommunication|(lack of |poor )?communication|idiots? (in love|to lovers)|"
     r"oblivious|obliviousness|\bmutual\b|friendship|friends with benefits|"
     r"domestic(ity)?|banter|flirting|jealousy|jealous|possessive|protective|"
     r"polyamory|\bpoly\b|threesome|\bot3\b|love triangle|tension|"
     r"power (imbalance|dynamic)|age (gap|difference)|height difference", "Dynamics"),

    # --- Mood (tone) ---
    (r"\b(fluff|angst|crack|humor|humour|comedy|funny|comfort|feels|"
     r"happy ending|happy|sad|bittersweet|cute|wholesome|tooth[\s-]?rotting|soft|"
     r"emotional|hopeful|cozy|cathartic|heartwarming|melancholy|"
     r"light[\s-]?hearted|whimsical|domestic fluff)\b", "Mood"),
]

_COMPILED = [(re.compile(p, re.I), c) for p, c in RULES]


def categorize(name: str) -> str:
    n = name.strip()
    for rx, cat in _COMPILED:
        if rx.search(n):
            return cat
    return "Other"


# --------------------------------------------------------------------------- #

def _dry():
    import json
    import os
    import urllib.request
    from collections import Counter
    from pathlib import Path

    names: set[str] = set()
    # audit freeforms
    p = Path(__file__).with_name("audit_deleted.json")
    if p.exists():
        for w in json.loads(p.read_text(encoding="utf-8")):
            names.update(w.get("freeforms", []))
    # live freeform tags (needs AUTH_TOKEN + HUB env)
    hub = os.environ.get("HUB", "https://ffstoryhub.up.railway.app")
    tok = os.environ.get("AUTH_TOKEN")
    if tok:
        req = urllib.request.Request(f"{hub}/api/tags?kind=freeform&limit=20000",
                                     headers={"Authorization": f"Bearer {tok}"})
        for t in json.load(urllib.request.urlopen(req, timeout=60)):
            names.add(t["name"])

    by_cat: dict[str, list[str]] = {}
    dist = Counter()
    for nm in names:
        c = categorize(nm)
        dist[c] += 1
        by_cat.setdefault(c, []).append(nm)
    print(f"classified {len(names)} unique freeform tags")
    for c, n in dist.most_common():
        print(f"  {c:<10} {n}")
    print("\n--- samples per category ---")
    for c in ["Identity", "Universe", "Content", "Trope", "Dynamics", "Mood", "Structure", "Other"]:
        ex = sorted(by_cat.get(c, []))[:18]
        print(f"\n{c} ({len(by_cat.get(c, []))}):")
        for e in ex:
            print(f"   {e}")


if __name__ == "__main__":
    _dry()
