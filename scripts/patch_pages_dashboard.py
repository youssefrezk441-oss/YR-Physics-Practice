from pathlib import Path

src = Path('.github/workflows/pages.yml').read_text(encoding='utf-8')
marker = '      - name: Configure Pages\n'

if marker not in src:
    raise SystemExit('Configure Pages marker not found')

if 'Build hierarchical admin dashboard' not in src:
    block = """      - name: Build hierarchical admin dashboard
        run: |
          python - <<'PY'
          from pathlib import Path

          src=Path('index.html').read_text(encoding='utf-8')
          css='''#adminView>.tabs{display:none!important}.adminSectionBack{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:10px 13px}.adminSectionBack a{color:#000073;text-decoration:none;font-weight:800}@media(max-width:700px){.adminSectionBack{align-items:flex-start;flex-direction:column}}'''
          src=src.replace('</style>',css+'\\n</style>',1)
          marker='<div id=\"mainMsg\"></div>'
          back='<div class=\"adminSectionBack\"><div><b>المحتوى والتدريبات</b><div class=\"muted small\">أنت داخل أداة تنفيذية من لوحة المحتوى.</div></div><a href=\"./admin-content-menu.html\">← العودة لأدوات المحتوى</a></div>'
          if marker not in src: raise SystemExit('content admin main marker missing')
          src=src.replace(marker,back+marker,1)
          old=\"async function openAdmin(user){$('authView').classList.add('hidden');$('adminView').classList.remove('hidden');$('userBar').classList.remove('hidden');$('userEmail').textContent=user.email||'';await loadStructure();await loadQuestions()}\"
          new=\"async function openAdmin(user){$('authView').classList.add('hidden');$('adminView').classList.remove('hidden');$('userBar').classList.remove('hidden');$('userEmail').textContent=user.email||'';await loadStructure();await loadQuestions();const requested=new URLSearchParams(location.search).get('view');if(['questions','newQuestion','trainings','structure'].includes(requested))setMainTab(requested)}\"
          if old not in src: raise SystemExit('content admin openAdmin marker missing')
          src=src.replace(old,new,1)
          Path('content-admin.html').write_text(src,encoding='utf-8')

          sp=Path('sessions-admin.html')
          ss=sp.read_text(encoding='utf-8')
          old=\"await loadHistory()}catch(e){note(e.message,'err')}}\"
          new=\"await loadHistory();if(new URLSearchParams(location.search).get('view')==='history')switchView('history')}catch(e){note(e.message,'err')}}\"
          if old not in ss: raise SystemExit('sessions deep-link marker missing')
          ss=ss.replace(old,new,1)
          sp.write_text(ss,encoding='utf-8')

          Path('index.html').write_text(Path('admin-home.html').read_text(encoding='utf-8'),encoding='utf-8')
          PY
"""
    src = src.replace(marker, block + marker, 1)

Path('pages-dashboard.generated.yml').write_text(src, encoding='utf-8')
