# إضافة محاضرة جديدة

الهدف أن تكون المحاضرة الجديدة إعداد بيانات وصور، لا نسخة جديدة من واجهة أو Edge Function.

## عقد المحتوى العام

أنشئ manifest وفق `workshops/third-secondary-term-2-lecture-1/public-content.json` ويتضمن:

- `workshop`: slug، العنوان، الصف، الفصل، رقم المحاضرة، وحالة `draft`.
- `tracks`: `class/home`، وضع التشغيل والسياسة.
- `skills`: معرف ثابت واسم وترتيب.
- `questions`: معرف ثابت، المسار والترتيب والمصدر والمهارة والصعوبة والصورة أو النص.
- `parts`: مفتاح الجزء، نوع الإدخال، الخيارات العامة والوحدة.

لا يجوز أن يحتوي الملف العام على `correct`, `answer_spec`, `display_answer`, `hint`, `reason`, `explanation` أو مفاتيح المصدر.

## الملفات الخاصة

مفاتيح المعلم وتقرير التحقق (لأنه قد يسجل فروق المفاتيح) يُنتجان كملفين خاصين بصلاحية 600، ويبقيان في `/tmp` أو `.workshop-private/` المستبعد من Git. لا تُرفع ZIP المعلم أو CSV/JSON/تقرير خاص إلى Pages.

## خطوات L1 الحالية

```bash
node tools/import_workshop_package.mjs \
  --package /path/to/extracted-package \
  --public-output /tmp/l1/public-content.json \
  --private-output /tmp/l1/private-keys.json \
  --report-output /tmp/l1/validation-report.json

node tools/render_workshop_seed_sql.mjs \
  --public /tmp/l1/public-content.json \
  --private /tmp/l1/private-keys.json \
  --report /tmp/l1/validation-report.json \
  --output /tmp/l1/staging-seed.sql
```

الأداة الحالية تقرأ تنسيق حزمة L1 المحدد. للمحاضرات المقبلة يجب إما إنتاج الملفات بالأعمدة نفسها أو إضافة adapter منفصل مع إبقاء manifest والعقد الخاص ثابتين.

## تحقق ما قبل Staging

- لا تكرار في معرفات الأسئلة أو ترتيب المسار.
- كل صورة موجودة وSHA-256 مطابق، ومسارها آمن.
- كل جزء له مفتاح خاص مطابق لنوعه وخياراته.
- السؤال ليس محجوزًا للامتحان أو مستخدمًا في محاضرة معتمدة بحسب سجل الفرز.
- لا تعارض بين CSV وJSON وتقارير القرار.
- تقرير الفحص `ok: true`، والأعداد المتوقعة صحيحة.

## دورة النشر

1. استيراد خاص إلى Staging؛ يبقى `draft/validated`.
2. مراجعة المحتوى والصور والمفاتيح بحسابات اصطناعية.
3. تشغيل اختبارات الهوية والمحاولات والتزامن والتحليلات وإعادة التقييم.
4. اعتماد النسخة، ثم نشر Edge Functions، ثم النسخة وتعريف الورشة، ثم Pages وفق خطة النشر.
5. مراقبة الأخطاء وإبقاء إمكانية إيقاف الورشة بتحويل تعريفها إلى `paused` دون حذف أي بيانات.
