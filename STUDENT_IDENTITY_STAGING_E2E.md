# Student identity staging E2E

هذه الاختبارات تكتب بيانات اصطناعية، ولذلك لا يجوز تشغيلها على مشروع الإنتاج
`ltjdhconuiqblxfjzpzj` تحت أي ظرف.

## الاختبار المحلي

المتطلبات: Docker، Node.js 24، وإمكانية تنزيل صور `postgres:17-alpine` و
`supabase/gotrue:v2.197.0` وحزمة Deno. شغّل:

```bash
bash tools/run_student_identity_local_e2e.sh
```

ينشئ المشغّل شبكة وحاويتين بأسماء تبدأ بـ `yr-identity-e2e-`، ويشغّل GoTrue
الحقيقي وPostgreSQL الحقيقي وكود Edge Function عبر Deno، ثم يحذف البيئة كلها عند
الانتهاء. لا يحتاج أسرار إنتاج ولا يتصل بمشروع Supabase سحابي.

## إنشاء مشروع Staging سحابي

1. أنشئ مشروعًا جديدًا داخل مؤسسة Supabase مخصصة للاختبار إن أمكن. لا تربطه
   بالإنتاج ولا تستخدم نسخة احتياطية أو بيانات أو مفاتيح منه.
2. اختر منطقة قريبة من المستخدمين/الإنتاج لتقارب زمن الاستجابة. راجع شاشة إنشاء
   المشروع وقت التنفيذ لمعرفة الخطة والتكلفة؛ الأسعار والحصة المجانية تتغير، ولا
   ينشئ هذا المستودع مشروعًا مدفوعًا تلقائيًا.
3. طبّق مخطط Staging فقط، ثم Migration الهوية، ثم انشر دالة
   `student-identity` بمفاتيح تشفير/HMAC جديدة خاصة بـStaging.
4. أنشئ GitHub Environment باسم `supabase-staging` مع موافقة يدوية، وأضف:
   - Variable: `STAGING_SUPABASE_URL`
   - Variable: `STAGING_PROJECT_REF`
   - Secret: `STAGING_SUPABASE_ANON_KEY`
   - Secret: `STAGING_SUPABASE_SERVICE_ROLE_KEY`
   - Secret: `STAGING_DATABASE_URL`
5. يجب ألا يساوي `STAGING_PROJECT_REF` مرجع الإنتاج. الاختبار يستخرج المرجع
   فعليًا من الرابط، ويطابقه مع قائمة السماح ومع رابط قاعدة البيانات قبل أي كتابة.

تشغيل الاختبار يدويًا:

```bash
E2E_TARGET=staging \
E2E_SUPABASE_URL=https://TEST_REF.supabase.co \
E2E_ALLOWED_PROJECT_REFS=TEST_REF \
E2E_DB_URL='postgresql://...' \
E2E_ANON_KEY='...' \
E2E_SERVICE_ROLE_KEY='...' \
E2E_ALLOW_WRITES=synthetic-e2e-only \
node --test tools/tests/student-identity-staging.integration.mjs
```

المفاتيح لا توضع في الأمر فعليًا أو في السجلات؛ المثال يوضح أسماء المتغيرات فقط.
الاختبار يوسم مستخدميه بمعرف تشغيل فريد، وينظف الطلبات والعلاقات التي أنشأها فقط
باستخدام `student_identity_staging_cleanup.sql`، ثم يحذف مستخدمي Auth الموسومين.

## ما لا يثبته نجاح Staging

- لا يعتمد إشعار الخصوصية أو سياسة الاحتفاظ قانونيًا.
- لا يحل حد عدد Edge Functions في الإنتاج.
- لا يفعّل SMS أو دخول الهاتف.
- لا يبرر تشغيل Feature Flags أو فرض تحديث الملف على الطلاب.
- لا يغني عن جرد الدوال القديمة وتجربة ترحيل حسابات الإنتاج بخطة رجوع منفصلة.

