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
# Production blockers added after PR review

- Keep every identity feature flag false, including phone login and profile enforcement.
- Do not enable national-ID collection until a final privacy notice, retention policy and lawful processing path are approved; `draft-v1` is deliberately not production approval.
- Run the PR workflow and then the Staging integration job against a non-production Supabase project with synthetic accounts.
- Confirm Edge Function capacity using the documented inventory plan; do not delete a deployed function to make room without usage evidence.
- The repository currently has no verified Supabase Staging project, so no end-to-end Auth/database assertion may be reported as passed yet.
