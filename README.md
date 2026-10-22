# YR Physics Practice

منصة تعليمية عربية لطلاب الفيزياء. الواجهة ثابتة وتُنشر على GitHub Pages، بينما تعتمد المصادقة والبيانات والتخزين ومنطق الخادم على Supabase.

## التشغيل المحلي

شغّل خادم ملفات من جذر المستودع لأن `student.html` يحمّل ملفات أخرى وقت التشغيل:

```bash
python3 -m http.server 8000
```

ثم افتح `http://127.0.0.1:8000/`. لا تستخدم حسابات طلاب حقيقية في الاختبار المحلي، ولا تنفذ عمليات كتابة على مشروع Supabase الإنتاجي.

## الفحوص الآمنة

```bash
node tools/check_l4_workshop_contract.mjs
node tools/check_inline_scripts.mjs
node tools/check_workshop_input_guards.mjs
node tools/check_supabase_security_contracts.mjs
node tools/check_submission_safety.mjs
node tools/check_public_answer_keys.mjs
node --test tools/tests/*.test.mjs
```

لبناء حزمة Pages محليًا استخدم مجلدًا جديدًا وفارغًا:

```bash
node tools/build_pages_artifact.mjs /tmp/yr-pages-artifact
```

صفحة امتحان الأزهر الخاصة بالطلاب وموقع `chemsteroo/` مستبعدان حاليًا من حزمة Pages، بينما تظل ملفاتهما المصدرية وعارض إدارة امتحان الأزهر وبيانات Supabase محفوظة. هذا تعطيل مؤقت قابل للرجوع ولا يحذف المحتوى.

تستبعد حزمة Pages أيضًا ملفات التشغيل الداخلية مثل `supabase/` و`.github/` و`tools/` وأداة WhatsApp؛ تبقى هذه الملفات في GitHub للمراجعة ولا تُخدم كصفحات عامة.

## النشر

الدفع إلى `main` يشغّل `.github/workflows/pages.yml`. الـworkflow يتحقق من جاهزية صفحات B2، يعيد تشغيل فحوص JavaScript وعقود الأسئلة، يبني حزمة عامة منفصلة، ثم ينشرها إلى GitHub Pages.

نشر Supabase Edge Functions والمهاجرات ليس مؤتمتًا من هذا المستودع حاليًا. لا تنشر أي وظيفة أو migration قبل مراجعة بيئة الهدف وخطة الرجوع.

حالة Supabase المؤكدة والفجوات وخطوات staging موثقة في `supabase/README.md`. مخطط إصدارات مفاتيح الإجابة المضاف هو أساس غير منشور ولا يعيد تصحيح أي محاولة موجودة.

## WhatsApp Bridge

الأداة المحلية موثقة في `whatsapp-bridge/README.md`. تستخدم WhatsApp Web غير الرسمي، وتجب مراجعة الـPreview يدويًا قبل أي إضافة أو حذف.
