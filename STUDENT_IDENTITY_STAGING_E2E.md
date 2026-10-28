# Student identity staging E2E

هذه الاختبارات تكتب بيانات اصطناعية، ولذلك لا يجوز تشغيلها على مشروع الإنتاج
`ltjdhconuiqblxfjzpzj` تحت أي ظرف.

## الاختبار المحلي

المتطلبات: Docker وNode.js 24. يستخدم المشغّل صور PostgreSQL وGoTrue مثبتة
بـSHA256، ويشغّل الرحلة مرتين في البيئة نفسها لإثبات نجاح التنظيف وإعادة التشغيل:

```bash
bash tools/run_student_identity_local_e2e.sh
```

ينشئ المشغّل شبكة وحاويتين بأسماء تبدأ بـ `yr-identity-e2e-`، ويشغّل GoTrue
الحقيقي وPostgreSQL الحقيقي وكود Edge Function عبر Deno، ثم يحذف البيئة كلها عند
الانتهاء. لا يحتاج أسرار إنتاج ولا يتصل بمشروع Supabase سحابي.

## إنشاء مشروع Staging سحابي

1. استخدم مؤسسة Supabase منفصلة للاختبار إن كانت متاحة، أو مشروعًا معزولًا داخل
   المؤسسة الحالية لا يشاركه الإنتاج في المفاتيح أو الشبكات أو النسخ الاحتياطية.
   يلزم قرار المالك قبل إنشاء مشروع مدفوع. راجع صفحة الأسعار عند الإنشاء؛ لا يمكن
   تثبيت تكلفة دقيقة في المستودع، وقد يكفي حد المشاريع المجانية أو يلزم مشروع مدفوع.
2. اختر نفس منطقة الإنتاج إن كانت مناسبة ومتاحة لتقارب السلوك وزمن الاستجابة،
   وإلا أقرب منطقة لمصر. المنطقة قرار إنشاء يصعب تغييره لاحقًا.
3. أنشئ Schema واقعيًا بواسطة تصدير `pg_dump --schema-only` للهيكل المعتمد بعد
   مراجعة الملف واستبعاد المالكين وبيانات الإحصاء والأسرار. لا تستخدم `pg_dump`
   للبيانات، ولا تستعد نسخة احتياطية من الإنتاج. طبّق بعده migrations المطلوبة،
   ومنها `20261028190000_student_identity_registration_v1.sql`.
4. شغّل `tools/check_student_identity_staging_schema.sql`. الفحص يتطلب الجداول
   الحقيقية للطلاب والمحاولات والتصحيح و`admin_access_level`، ويرفض جداول
   `synthetic_*` القديمة. Fixture المحلي لا يُطبّق على Staging.
5. أنشئ حساب إدارة اصطناعيًا في Auth بعنوان `example.invalid`، وأضف له
   `app_metadata.role=admin` وصلاحية `students/edit` من نموذج الصلاحيات الحقيقي
   الذي يستخدمه `admin_access_level`. تحقق باستعلام الدالة؛ ممنوع استبدالها بدالة
   ترجع `edit` دائمًا. الاختبار ينشئ الطالب القديم والموقوف والمجموعة الخاصة به
   تلقائيًا ثم ينظفها.
6. ولّد مفتاحي AES-256 وHMAC جديدين خاصين بـStaging، واحفظهما كـEdge Function
   secrets مع `SUPABASE_DB_URL`. لا تنسخ مفاتيح الإنتاج. انشر `student-identity`
   على Staging فقط، واترك `STUDENT_IDENTITY_TEST_FAILPOINTS` غير معرف.
7. أبقِ كل Feature Flags مغلقة قبل التشغيل.
8. أنشئ GitHub Environment باسم `supabase-staging` مع موافقة يدوية، وأضف:
   - Variable: `STAGING_SUPABASE_URL`
   - Variable: `STAGING_PROJECT_REF`
   - Secret: `STAGING_SUPABASE_ANON_KEY`
   - Secret: `STAGING_SUPABASE_SERVICE_ROLE_KEY`
   - Secret: `STAGING_DATABASE_URL`
   - Secret: `STAGING_ADMIN_EMAIL`
   - Secret: `STAGING_ADMIN_PASSWORD`
9. يجب ألا يساوي `STAGING_PROJECT_REF` مرجع الإنتاج. الاختبار يستخرج المرجع
   فعليًا من الرابط، ويطابقه مع قائمة السماح ومع رابط قاعدة البيانات قبل أي كتابة.

تشغيل الاختبار يدويًا:

```bash
E2E_TARGET=staging \
E2E_SUPABASE_URL=https://TEST_REF.supabase.co \
E2E_ALLOWED_PROJECT_REFS=TEST_REF \
E2E_DB_URL='postgresql://...' \
E2E_ANON_KEY='...' \
E2E_SERVICE_ROLE_KEY='...' \
E2E_STAGING_ADMIN_EMAIL='...' \
E2E_STAGING_ADMIN_PASSWORD='...' \
E2E_ALLOW_WRITES=synthetic-e2e-only \
node --test tools/tests/student-identity-staging.integration.mjs
```

المفاتيح لا توضع في الأمر فعليًا أو في السجلات؛ المثال يوضح أسماء المتغيرات فقط.
كل تشغيل يستخدم مجموعة فريدة ولا يستعمل `ON CONFLICT`. يسجل cleanup قبل أول
مستخدم، ويستعيد Feature Flags الأصلية حتى عند الفشل. يثبت ملكية مستخدم Auth بعلامة
التشغيل أو `registration_request_id` أو علاقة الطلب المسجلة قبل حذفه. ويُظهر فشلًا
صريحًا مع Run ID إذا تعذر التنظيف. حساب إدارة Staging المسبق لا يحذفه الاختبار.

حقن `auth_create_error` و`after_auth_create` محصور في Docker المحلي وCI. في
Staging السحابي يظهر الاختباران كـskipped صراحة، ولا يجوز تعريف مفتاح failpoints
على أي مشروع سحابي معتاد.

بعد التشغيل راقب Logs لدالة `student-identity` وAuth وPostgres، ثم تأكد من نجاح
cleanup وعدم وجود طلبات `residence_area` الخاصة بالـRun ID أو مجموعته. عند فشل
cleanup أوقف أي إعادة تشغيل وراجع الـRun ID المطبوع؛ لا تنفذ حذفًا عامًا.

## ما لا يثبته نجاح Staging

- لا يعتمد إشعار الخصوصية أو سياسة الاحتفاظ قانونيًا.
- لا يحل حد عدد Edge Functions في الإنتاج.
- لا يفعّل SMS أو دخول الهاتف.
- لا يبرر تشغيل Feature Flags أو فرض تحديث الملف على الطلاب.
- لا يغني عن جرد الدوال القديمة وتجربة ترحيل حسابات الإنتاج بخطة رجوع منفصلة.

