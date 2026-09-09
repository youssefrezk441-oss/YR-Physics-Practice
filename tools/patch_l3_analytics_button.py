from pathlib import Path

TARGET = Path("admin-home.html")
LABEL = "تحليل ورشة المحاضرة الثالثة"
HREF = "./admin-l3-workshop-analytics.html"
ANCHOR = '<a id="managersCard" class="dashCard hidden" href="managers-admin.html">'

CARD = (
    '<a id="l3AnalyticsCard" class="dashCard" href="./admin-l3-workshop-analytics.html">'
    '<div class="iconBox"><svg viewBox="0 0 24 24"><path d="M4 19h16"/>'
    '<path d="M6 16l4-4 3 2 5-7"/><circle cx="6" cy="16" r="1"/>'
    '<circle cx="10" cy="12" r="1"/><circle cx="13" cy="14" r="1"/>'
    '<circle cx="18" cy="7" r="1"/></svg></div>'
    '<div><h3>تحليل ورشة المحاضرة الثالثة</h3>'
    '<p>تحليل أداء الطلاب والأسئلة والمهارات في ورشة المحاضرة الثالثة.</p></div>'
    '<span class="arrow">‹</span></a>\n'
)

text = TARGET.read_text(encoding="utf-8")

if LABEL in text or HREF in text:
    raise SystemExit("ERROR: L3 workshop analytics button/link already exists; refusing to patch twice.")

anchor_count = text.count(ANCHOR)
if anchor_count != 1:
    raise SystemExit(f"ERROR: expected exactly one safe anchor, found {anchor_count}; refusing to guess.")

patched = text.replace(ANCHOR, CARD + ANCHOR, 1)
if patched == text:
    raise SystemExit("ERROR: patch produced no change.")

TARGET.write_text(patched, encoding="utf-8")
print("Patched admin-home.html: added only the L3 workshop analytics card.")
