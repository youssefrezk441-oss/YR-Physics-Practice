from pathlib import Path

p=Path('student.html')
s=p.read_text(encoding='utf-8')

css=r'''
/* Student login redesign */
.brand h1{font-size:24px;font-weight:900}.brand p{font-size:18px;font-weight:900;color:#000073;margin-top:4px}.loginShell{display:grid;grid-template-columns:minmax(360px,.95fr) minmax(390px,1.05fr);gap:22px;align-items:stretch;max-width:1080px;margin:28px auto 10px}.loginHero{overflow:hidden;border-radius:24px;border:1px solid #17345d;background:#071a35;box-shadow:0 18px 45px rgba(6,22,48,.18);min-height:610px}.loginHero img{width:100%;height:100%;display:block;object-fit:cover;object-position:center}.loginPanel{margin:0;display:flex;flex-direction:column;justify-content:center;padding:34px 32px;border-radius:24px;min-height:610px}.loginIdentity{text-align:center;margin-bottom:30px}.loginIdentity .platformName{font-size:30px;font-weight:950;color:#000073;margin:0}.loginIdentity .teacherName{font-size:23px;font-weight:950;margin-top:8px;color:#172033}.loginPanel h2{font-size:29px;margin:0 0 8px;text-align:center}.loginPanel .loginHint{text-align:center;color:#667085;margin:0 0 28px;font-size:15px}.loginPanel label{font-size:15px;margin-bottom:8px}.loginPanel input{padding:14px 15px;border-radius:13px;font-size:16px}.loginPanel .primary{margin-top:3px;padding:14px;font-size:17px}.loginFooter{text-align:center;color:#98a2b3;font-size:12px;margin-top:22px}.loginFooter b{color:#667085}.loginPanel .grid{gap:15px}
html[data-theme="dark"] .brand p{color:#67e8f9}html[data-theme="dark"] .loginIdentity .platformName{color:#67e8f9}html[data-theme="dark"] .loginIdentity .teacherName{color:#f8fafc}
@media(max-width:800px){.loginShell{grid-template-columns:1fr;max-width:560px;margin-top:12px;gap:14px}.loginHero{min-height:0;max-height:none}.loginHero img{height:auto;object-fit:contain}.loginPanel{min-height:0;padding:25px 20px}.loginIdentity{margin-bottom:22px}.loginIdentity .platformName{font-size:26px}.loginIdentity .teacherName{font-size:20px}.loginPanel h2{font-size:24px}.brand h1{font-size:21px}.brand p{font-size:16px}}
'''
if '</style>' not in s:
    raise SystemExit('style marker missing')
s=s.replace('</style>',css+'\n</style>',1)

old_brand='<div class="top"><div class="brand"><h1>منصة تدريبات الفيزياء</h1><p>مستر يوسف رزق</p></div>'
new_brand='<div class="top"><div class="brand"><h1>منصة الفيزياء</h1><p>مستر يوسف رزق</p></div>'
if old_brand in s:
    s=s.replace(old_brand,new_brand,1)
else:
    s=s.replace('<h1>منصة تدريبات الفيزياء</h1>','<h1>منصة الفيزياء</h1>',1)

start=s.find('<section id="loginView"')
end=s.find('</section>',start)
if start<0 or end<0:
    raise SystemExit('login section missing')
end+=len('</section>')
new_login='''<section id="loginView" class="loginShell">
<div class="loginHero"><img src="./assets/student-login-hero.webp" alt="منصة الفيزياء — مستر يوسف رزق"></div>
<div class="loginPanel card">
  <div class="loginIdentity"><div class="platformName">منصة الفيزياء</div><div class="teacherName">مستر يوسف رزق</div></div>
  <h2>مرحبًا بك 👋</h2>
  <p class="loginHint">سجّل دخولك إلى حسابك</p>
  <div class="grid">
    <div class="c12"><label>كود الطالب</label><input id="studentCode" autocomplete="username" placeholder="مثال: N3-001"></div>
    <div class="c12"><label>كلمة المرور</label><input id="studentPassword" type="password" autocomplete="current-password" placeholder="اكتب كلمة المرور"></div>
    <div class="c12"><button id="loginBtn" class="btn primary full">دخول</button></div>
  </div>
  <div class="loginFooter">جميع الحقوق محفوظة — <b>مستر يوسف رزق</b></div>
</div>
</section>'''
s=s[:start]+new_login+s[end:]

# Defensive cleanup in case any mockup-only options were ever introduced.
for text in ['الدخول كزائر','تذكرني','نسيت كلمة المرور؟','أدخل بياناتك لبدء التدريب','2025']:
    if text in s:
        print('warning leftover text:',text)

p.write_text(s,encoding='utf-8')
