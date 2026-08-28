from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

# 1) Show teacher reference card to any authenticated admin, not owner-only.
p=ROOT/'admin-home.html'
text=p.read_text(encoding='utf-8')
old="$('teacherRefsCard').classList.toggle('hidden',!ctx.isOwner);"
new="$('teacherRefsCard').classList.remove('hidden');"
if old not in text and new not in text:
    raise SystemExit('admin-home teacher reference visibility anchor not found')
text=text.replace(old,new)
p.write_text(text,encoding='utf-8')

# 2) Allow any valid admin account into teacher references menu.
p=ROOT/'teacher-references.html'
text=p.read_text(encoding='utf-8')
old="try{const ctx=await loadAdminAccess(sb);if(!ctx.isOwner)throw new Error('owner only');document.getElementById('gate').classList.add('hidden');document.getElementById('app').classList.remove('hidden')}catch(e){document.getElementById('gate').innerHTML='<div class=\"gateCard\"><h2>مرجع المدرس</h2><p>هذه الصفحة متاحة لحساب المالك فقط.</p><a href=\"admin-home.html\">العودة إلى لوحة الإدارة</a></div>'}"
new="try{await loadAdminAccess(sb);document.getElementById('gate').classList.add('hidden');document.getElementById('app').classList.remove('hidden')}catch(e){document.getElementById('gate').innerHTML='<div class=\"gateCard\"><h2>مرجع المدرس</h2><p>هذه الصفحة متاحة لحسابات الإدارة فقط.</p><a href=\"admin-home.html\">العودة إلى لوحة الإدارة</a></div>'}"
if old not in text and new not in text:
    raise SystemExit('teacher-references auth anchor not found')
text=text.replace(old,new)
p.write_text(text,encoding='utf-8')

# 3) Allow any valid admin account into lesson 1 teacher reference.
p=ROOT/'teacher-reference-lesson1.html'
text=p.read_text(encoding='utf-8')
old="try{const ctx=await loadAdminAccess(sb);if(!ctx.isOwner)throw new Error('owner only');document.getElementById('gate').classList.add('hidden');document.getElementById('app').classList.remove('hidden')}catch(e){document.getElementById('gate').innerHTML='<div class=\"gateCard\"><h2>مرجع المدرس</h2><p>هذه الصفحة متاحة لحساب المالك فقط.</p><a href=\"admin-home.html\">العودة إلى لوحة الإدارة</a></div>'}"
new="try{await loadAdminAccess(sb);document.getElementById('gate').classList.add('hidden');document.getElementById('app').classList.remove('hidden')}catch(e){document.getElementById('gate').innerHTML='<div class=\"gateCard\"><h2>مرجع المدرس</h2><p>هذه الصفحة متاحة لحسابات الإدارة فقط.</p><a href=\"admin-home.html\">العودة إلى لوحة الإدارة</a></div>'}"
if old not in text and new not in text:
    raise SystemExit('teacher lesson auth anchor not found')
text=text.replace(old,new)
p.write_text(text,encoding='utf-8')

print('Teacher reference visibility fixed for admin accounts.')
