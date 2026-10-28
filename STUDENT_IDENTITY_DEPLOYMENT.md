# نشر نظام هوية الطلاب

1. لا تستخدم الإنتاج أولًا. أنشئ Supabase Staging ببيانات اصطناعية وبنية مماثلة.
2. أنشئ مفتاحي 32 بايت مستقلين، خزنهما كـSecrets: `STUDENT_IDENTITY_ENCRYPTION_KEY_B64` و`STUDENT_IDENTITY_HMAC_KEY_B64`.
3. طبق `20261028190000_student_identity_registration_v1.sql`. تحقق أن كل Flags مغلقة.
4. عالج حد Edge Functions ثم انشر `student-identity` مع `verify_jwt=false` لأن التسجيل والتفعيل عامان، بينما تتحقق الإجراءات الخاصة داخليًا من JWT والصلاحيات.
5. اختبر التسجيل والموافقة والتفعيل والتكرار والفشل وإعادة المحاولة ببيانات اصطناعية.
6. انشر Pages إلى Preview. فعّل `registration_enabled` فقط لمجموعة اختبار تشغيلية.
7. لا تفعل الهاتف قبل إعداد SMS وربط الهاتف بالمستخدم نفسه وتوثيقه وحل المكررات؛ بعدها فعّل `sms_provider_ready` ثم `phone_login_enabled`.
8. فعّل `profile_update_enabled` دون فرض، وراقب الإكمال.
9. بعد تغطية كل وظائف الطالب بالخادم، فعّل `profile_enforcement_enabled` تدريجيًا. مفتاح التعطيل الفوري هو نفس الحقل.

لا تُشغّل Migration أو Flags على الإنتاج دون نسخة احتياطية وموافقة مستقلة.
