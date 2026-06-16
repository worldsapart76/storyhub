"""Generate a self-contained audit.html for the 102 deleted-work salvage review.

Reads audit_deleted.json (from audit_deleted.py prep) and embeds it into a single
offline HTML page. Per work: clean summary, recovered tags by kind, the Calibre
reference line with conflicts highlighted, a primary-ship picker, kind fixes for
flagged tags, and category pickers for freeform tags backed by a GLOBAL map (set a
tag's category once, in context, and it applies to every work). Progress persists
in localStorage; "Export decisions" downloads the JSON to feed back into the load.

Usage:  python audit_html.py   ->  audit.html
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "audit_deleted.json"
OUT = HERE / "audit.html"

# The seeded freeform category set (redesign §6.3.1). Reorder/rename later in Tag
# Management; for this one-time audit the seeded names are what tags map to.
CATEGORIES = ["Identity", "Universe", "Content", "Trope", "Dynamics",
              "Mood", "Structure", "Other"]
KINDS = ["fandom", "relationship", "character", "freeform", "warning"]

works = json.loads(DATA.read_text(encoding="utf-8"))

# Seed category defaults from the durable curation (LLM + manual), restricted to
# the freeform tags that appear in these 102 works (keeps the payload small).
cur = {}
cf = HERE / "tag_curation.json"
if cf.exists():
    cur = json.loads(cf.read_text(encoding="utf-8")).get("tags", {})
ff_names = {t for w in works for t in w.get("freeforms", [])}
auto_cat = {n: cur[n]["category"] for n in ff_names if n in cur and cur[n].get("category")}
excluded = sorted(n for n in ff_names if n in cur and cur[n].get("state") == "excluded")

payload = json.dumps({"works": works, "categories": CATEGORIES, "kinds": KINDS,
                      "autoCat": auto_cat, "excluded": excluded},
                     ensure_ascii=False).replace("</", "<\\/")

HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deleted-work salvage audit</title>
<style>
  :root{--bg:#14161a;--card:#1d2025;--line:#2c313a;--txt:#e7e9ee;--mut:#9aa3b2;--acc:#6ea8fe;--warn:#ffb454;--bad:#ff6b6b;--ok:#4ec98f}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 system-ui,Segoe UI,sans-serif}
  header{position:sticky;top:0;z-index:5;background:#0f1115ee;backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  header h1{font-size:16px;margin:0 8px 0 0}
  .prog{color:var(--mut);font-size:13px}
  .spacer{flex:1}
  button{background:#272c34;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:6px 11px;font-size:13px;cursor:pointer}
  button:hover{border-color:var(--acc)} button.on{background:#2b3b57;border-color:var(--acc);color:#cfe0ff}
  button.exp{background:#2b7a4b;border-color:#3a9d63;color:#eafff2;font-weight:600}
  main{max-width:880px;margin:0 auto;padding:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
  .card.reviewed{opacity:.62}
  .card.conflict{border-color:#5a3a3a}
  .top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .top h2{font-size:17px;margin:0}
  .badge{font-size:11px;padding:2px 7px;border-radius:99px;background:#2a2f38;color:var(--mut)}
  .badge.flat{background:#33291a;color:var(--warn)} .badge.typed{background:#1d3326;color:var(--ok)}
  .wid{color:var(--mut);font-size:12px}
  .summary{color:#cdd3dd;margin:10px 0;font-size:14px}
  .cal{font-size:12.5px;color:var(--mut);margin:6px 0;padding:6px 9px;background:#1a1d22;border-radius:7px;border:1px solid var(--line)}
  .cal.bad{border-color:var(--bad);color:#ffd0d0;background:#2a1a1a}
  .cal s{color:var(--bad)}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}
  .row label{font-size:12px;color:var(--mut);min-width:120px}
  select,input[type=text]{background:#0f1115;color:var(--txt);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:13px}
  .grp{margin:9px 0}
  .grp .lab{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .chips{display:flex;gap:6px;flex-wrap:wrap}
  .chip{font-size:12.5px;padding:3px 9px;border-radius:7px;background:#252a32;border:1px solid var(--line)}
  .chip.fl{border-color:var(--warn)}
  .ff{display:flex;gap:6px;align-items:center;background:#252a32;border:1px solid var(--line);border-radius:7px;padding:2px 4px 2px 9px}
  .ff.set{border-color:#33523a}
  .ff.ex{opacity:.55;border-style:dashed}
  .ff select{padding:3px 6px;font-size:12px}
  .flagrow{display:flex;gap:6px;align-items:center;background:#33291a;border:1px solid var(--warn);border-radius:7px;padding:2px 4px 2px 9px}
  .done{display:flex;gap:7px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)}
  .miss{color:var(--bad)}
  .hint{color:var(--mut);font-size:12px}
</style></head>
<body>
<header>
  <h1>Salvage audit — 102 deleted works</h1>
  <span class="prog" id="prog"></span>
  <span class="spacer"></span>
  <button data-f="all" class="on">All</button>
  <button data-f="conflict">Conflicts</button>
  <button data-f="flagged">Flagged</button>
  <button data-f="todo">Unreviewed</button>
  <button class="exp" id="export">⬇ Export decisions</button>
</header>
<main id="list"></main>
<script>
const D = __PAYLOAD__;
const LS = "storyhub-audit-deleted";
const st = JSON.parse(localStorage.getItem(LS) || "{}");
st.tagCategory ||= {}; st.tagKind ||= {}; st.works ||= {};
const save = () => localStorage.setItem(LS, JSON.stringify(st));
let filter = "all";

function wState(w){ return (st.works[w.work_id] ||= {primary_ship:w.primary_ship, primary_collection:w.primary_collection, rating:w.rating, reviewed:false}); }

function opt(v,sel){ return `<option value="${v??''}" ${(''+(v??''))===(''+(sel??''))?'selected':''}>${v||'—'}</option>`; }

function render(){
  const list=document.getElementById("list"); list.innerHTML="";
  let shown=0, done=0;
  for(const w of D.works){
    const s=wState(w);
    if(s.reviewed) done++;
    const flagged=w.flagged||[];
    if(filter==="conflict" && !w.conflicts.collection) continue;
    if(filter==="flagged" && !flagged.length) continue;
    if(filter==="todo" && s.reviewed) continue;
    shown++;
    const c=document.createElement("div");
    c.className="card"+(s.reviewed?" reviewed":"")+(w.conflicts.collection?" conflict":"");
    const calBad=w.conflicts.collection;
    const cal=w.calibre;
    const ratingSel = w.rating? `<span class="badge">${w.rating}</span>` :
      `<select data-act="rating" data-w="${w.work_id}"><option value="">⚠ rating?</option>${["Explicit","Mature","Teen","General","Not Rated"].map(r=>opt(r,s.rating)).join("")}</select>`;
    const ships = w.relationships.length? w.relationships : [];
    c.innerHTML = `
      <div class="top">
        <h2>${esc(w.title||"(untitled)")}</h2>
        <span class="badge ${w.format}">${w.format}</span>
        ${ratingSel}
        <span class="wid">#${w.work_id}${w.authors&&w.authors.length?" · "+esc(w.authors.join(", ")):""}</span>
      </div>
      <div class="summary">${esc(w.summary||"(no summary)")}</div>
      <div class="cal ${calBad?'bad':''}">Calibre ref —
        ship: ${calBad?`<s>${esc(cal.primaryship||'∅')}</s> ⚠ overridden by epub`:esc(cal.primaryship||'∅')} ·
        collection: ${calBad?`<s>${esc(cal.collection||'∅')}</s>`:esc(cal.collection||'∅')}</div>
      <div class="row"><label>Primary ship</label>
        <select data-act="ship" data-w="${w.work_id}">${opt('',s.primary_ship)}${ships.map(r=>opt(r,s.primary_ship)).join("")}</select>
        ${ships.length?'':'<span class="hint">no relationships recovered</span>'}</div>
      <div class="row"><label>Primary collection</label>
        <input type="text" data-act="coll" data-w="${w.work_id}" value="${esc(s.primary_collection||'')}"></div>
      ${grp("Fandoms", w.fandoms, w.fandoms.length?'':'<span class="miss">⚠ none recovered</span>')}
      ${grp("Relationships", w.relationships)}
      ${grp("Characters", w.characters)}
      ${flagged.length?`<div class="grp"><div class="lab">⚠ Kind check (looked like character/fandom)</div>
        ${flagged.map(t=>`<div class="flagrow">${esc(t)} <select data-act="kind" data-w="${w.work_id}" data-t="${esc(t)}">
          ${D.kinds.map(k=>opt(k, st.tagKind[t]||'freeform')).join("")}</select></div>`).join("")}</div>`:''}
      <div class="grp"><div class="lab">Freeform — category (auto-filled; ✎ = excluded as noise, pick a category to keep)</div>
        <div class="chips">${w.freeforms.map(t=>{
          const isExc=(D.excluded||[]).includes(t) && !(t in st.tagCategory);
          const cur = (t in st.tagCategory) ? st.tagCategory[t] : (isExc ? "" : (D.autoCat[t]||""));
          return `<span class="ff ${cur?'set':''} ${isExc?'ex':''}">${esc(t)}
            <select data-act="cat" data-t="${esc(t)}"><option value="">${isExc?'⊘ excluded':'uncategorized'}</option>${D.categories.map(cat=>opt(cat,cur)).join("")}</select></span>`;
        }).join("")||'<span class="hint">none</span>'}</div></div>
      ${grp("Warnings", w.warnings)}
      <div class="done"><label><input type="checkbox" data-act="rev" data-w="${w.work_id}" ${s.reviewed?'checked':''}> Reviewed</label></div>`;
    list.appendChild(c);
  }
  document.getElementById("prog").textContent = `${done}/${D.works.length} reviewed · showing ${shown}`;
}
function grp(lab,arr,extra){ if(!arr||!arr.length) return extra?`<div class="grp"><div class="lab">${lab}</div>${extra}</div>`:"";
  return `<div class="grp"><div class="lab">${lab}</div><div class="chips">${arr.map(t=>`<span class="chip">${esc(t)}</span>`).join("")}</div></div>`; }
function esc(s){ return (s==null?"":(""+s)).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m])); }

document.addEventListener("change",e=>{
  const t=e.target, act=t.dataset.act; if(!act) return;
  if(act==="cat"){ if(t.value) st.tagCategory[t.dataset.t]=t.value; else delete st.tagCategory[t.dataset.t]; save(); render(); return; }
  if(act==="kind"){ st.tagKind[t.dataset.t]=t.value; save(); return; }
  const w=st.works[t.dataset.w]; if(!w) return;
  if(act==="ship") w.primary_ship=t.value||null;
  if(act==="coll") w.primary_collection=t.value||null;
  if(act==="rating") w.rating=t.value||null;
  if(act==="rev"){ w.reviewed=t.checked; save(); render(); return; }
  save();
});
document.querySelectorAll("header button[data-f]").forEach(b=>b.onclick=()=>{
  filter=b.dataset.f; document.querySelectorAll("header button[data-f]").forEach(x=>x.classList.toggle("on",x===b)); render();
});
document.getElementById("export").onclick=()=>{
  const out={tagCategory:st.tagCategory,tagKind:st.tagKind,works:st.works};
  const blob=new Blob([JSON.stringify(out,null,1)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="audit_decisions.json"; a.click();
};
render();
</script></body></html>"""

OUT.write_text(HTML.replace("__PAYLOAD__", payload), encoding="utf-8")
print(f"wrote {OUT}  ({OUT.stat().st_size//1024} KB, {len(works)} works)")
