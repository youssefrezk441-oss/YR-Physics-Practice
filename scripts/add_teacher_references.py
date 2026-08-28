from pathlib import Path
import base64,gzip
ROOT=Path(__file__).resolve().parents[1]
for src_name,target_name in [
 ('teacher-references.html.gz.b64','teacher-references.html'),
 ('teacher-reference-lesson1.html.gz.b64','teacher-reference-lesson1.html')
]:
    src=ROOT/'reference-assets'/src_name
    (ROOT/target_name).write_bytes(gzip.decompress(base64.b64decode(src.read_text(encoding='utf-8').strip())))

p=ROOT/'admin-home.html'
text=p.read_text(encoding='utf-8')
if 'id="teacherRefsCard"' not in text:
    anchor='<a id="managersCard" class="dashCard hidden" href="managers-admin.html">'
    if anchor not in text:
        raise SystemExit('admin card anchor not found')
    card='''<a id="teacherRefsCard" class="dashCard hidden" href="teacher-references.html"><div class="iconBox"><svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5z"/><path d="M8 7h1M15 7h1M8 10h1M15 10h1"/></svg></div><div><h3>مرجع شرح الحصص</h3><p>تحضيرك العملي للشرح: التسلسل، أسئلة الإلقاء، السبورة، الأخطاء والمعادلات.</p></div><span class="arrow">‹</span></a>\n'''
    text=text.replace(anchor,card+anchor,1)
old="$('honorCard').classList.toggle('hidden',!honor);$('managersCard').classList.toggle('hidden',!ctx.isOwner);$('empty').classList.toggle('hidden',content||follow||honor||ctx.isOwner)"
new="$('honorCard').classList.toggle('hidden',!honor);$('teacherRefsCard').classList.toggle('hidden',!ctx.isOwner);$('managersCard').classList.toggle('hidden',!ctx.isOwner);$('empty').classList.toggle('hidden',content||follow||honor||ctx.isOwner)"
if old in text:
    text=text.replace(old,new,1)
elif new not in text:
    raise SystemExit('admin owner visibility anchor not found')
p.write_text(text,encoding='utf-8')
print('Teacher references installed.')
