import { sb, $, message } from "./student-identity-api.js";

const form = $("form");
const panels = [...document.querySelectorAll(".step-panel")];
const markers = [...document.querySelectorAll("[data-step-marker]")];
const get = (name) => form.elements.namedItem(name);
const requestKey = crypto.randomUUID();
const invite = new URLSearchParams(location.search).get("invite") || "";
let currentStep = 0;
let config = null;
let enabled = false;
let submitting = false;
let captchaId = null;
let captchaToken = "";
let captchaLoad = null;

const asLatinDigits = (input) => String(input || "")
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
const phoneDigits = (input) => asLatinDigits(input).replace(/[\s\-()]/g, "");
const validPhone = (input) => /^(?:01[0125]\d{8}|201[0125]\d{8}|\+201[0125]\d{8})$/.test(phoneDigits(input));
function checkNationalId(input) {
  const value = asLatinDigits(input).replace(/\s/g, "");
  if (!/^[23]\d{13}$/.test(value)) return {valid:false,message:"اكتب الرقم القومي كاملًا: 14 رقمًا تبدأ بـ 2 أو 3."};
  const year = (value[0] === "2" ? 1900 : 2000) + Number(value.slice(1,3));
  const month = Number(value.slice(3,5)), day = Number(value.slice(5,7));
  const date = new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day || date > new Date())
    return {valid:false,message:"تاريخ الميلاد داخل الرقم القومي غير صحيح."};
  return {valid:true,value,year,month,day};
}
const nameValue = () => ["first_name", "second_name", "third_name", "fourth_name"]
  .map((key) => String(get(key).value || "").normalize("NFKC").trim().replace(/\s+/g, " "))
  .join(" ");
function showError(text) {
  message(text);
  $("message").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function registrationCall(action, payload = {}) {
  const { data, error } = await sb.functions.invoke("student-identity", { body: { action, ...payload } });
  if (error) {
    let detail = null;
    try {
      if (error.context?.clone) detail = await error.context.clone().json();
      else if (error.context?.json) detail = await error.context.json();
    } catch (_) { /* relay/network errors have no JSON body */ }
    throw new Error(detail?.message || error.message || "تعذر الاتصال بالخدمة");
  }
  if (data?.error) throw new Error(data.message || "تعذر إكمال التسجيل");
  return data;
}
function fillReview() {
  const values = [
    ["الاسم الرباعي", nameValue()],
    ["الرقم القومي", "•••• •••• ••" + asLatinDigits(get("national_id").value).slice(-4)],
    ["الصف الدراسي", get("grade_level").value],
    ["النظام التعليمي", get("education_system").value],
    ["مكان الحضور", get("attendance_location").value],
    ["المجموعة", get("group_code").value],
    ["منطقة السكن", get("residence_area").value || "غير محددة"],
    ["هاتف الطالب", phoneDigits(get("student_phone").value)],
    ["هاتف ولي الأمر", phoneDigits(get("guardian_phone").value)]
  ];
  const area = $("review");
  area.replaceChildren();
  for (const [label, value] of values) {
    const box = document.createElement("div");
    box.className = "reviewRow";
    const cap = document.createElement("small");
    cap.textContent = label;
    const text = document.createElement("strong");
    text.textContent = value;
    box.append(cap, text);
    area.append(box);
  }
}
function gradeCompatible(group, grade) {
  const g = String(group.grade_level || "").normalize("NFKC");
  return grade.includes("الثاني") ? g.includes("الثاني") || g.startsWith("2")
    : grade.includes("الثالث") && (g.includes("الثالث") || g.startsWith("3"));
}
function centerCompatible(group, attendance) {
  if (!attendance || attendance === "غير ذلك") return true;
  const name = String(group.center_name || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const code = String(group.group_code || "").normalize("NFKC").toUpperCase();
  if (attendance === "ناهيا") return name.includes("ناهيا") || name.includes("nahya") || /^N[23]/.test(code);
  if (attendance === "كفر حكيم") return name.includes("كفرحكيم") || name.includes("kafr") || /^K[23]/.test(code);
  if (attendance === "خصوصي") return name.includes("خصوصي") || name.includes("private") || code.includes("PRIVATE");
  return true;
}
function refreshGroups() {
  const select = get("group_code");
  const hint = $("groupHint");
  const grade = get("grade_level").value;
  const center = get("attendance_location").value;
  const previous = select.value;
  select.replaceChildren(new Option("اختر المجموعة", ""));
  select.disabled = true;
  if (!config || !grade) {
    hint.textContent = "اختر الصف الدراسي أولًا.";
    return;
  }
  const byGrade = (config.groups || []).filter((g) => gradeCompatible(g, grade));
  const byCenter = center ? byGrade.filter((g) => centerCompatible(g, center)) : byGrade;
  const filtered = center && center !== "غير ذلك" ? byCenter : byGrade;
  for (const group of filtered) {
    select.add(new Option(String(group.group_code) + (group.center_name ? " — " + group.center_name : ""), String(group.group_code)));
  }
  if (previous && filtered.some((g) => String(g.group_code) === previous)) select.value = previous;
  select.disabled = !filtered.length;
  hint.textContent = !filtered.length ? "لا توجد مجموعة متاحة للصف ومكان الحضور المحددين حاليًا. تواصل مع الإدارة لتحديد مجموعتك."
    : center === "غير ذلك"
      ? "اختر مجموعتك الفعلية، وستراجع الإدارة مكان الحضور."
      : "المجموعات المعروضة توافق الصف ومكان الحضور. ستراجع الإدارة بياناتك قبل الاعتماد.";
}
function updateControls() {
  panels.forEach((panel, i) => { panel.hidden = i !== currentStep; });
  markers.forEach((marker, i) => {
    marker.classList.toggle("active", i === currentStep);
    marker.classList.toggle("done", i < currentStep);
    marker.setAttribute("aria-current", i === currentStep ? "step" : "false");
    marker.querySelector(".stepCircle").textContent = i < currentStep ? "✓" : String(i + 1);
  });
  $("prev").hidden = currentStep === 0;
  $("next").hidden = currentStep === 3;
  $("submitBtn").hidden = currentStep !== 3;
  $("next").disabled = !enabled || submitting;
  $("prev").disabled = submitting;
  $("submitBtn").disabled = !enabled || submitting;
}
function enterStep(index) {
  currentStep = index;
  updateControls();
  if (index === 3) {
    fillReview();
    if (config?.captcha_required) {
      renderCaptcha().catch((error) => {
        showError(error.message || "تعذر تشغيل التحقق الأمني");
        $("submitBtn").disabled = true;
      });
    }
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}
function validateStep(index) {
  const panel = panels[index];
  if (index === 0) {
    const id = get("national_id");
    const parsed = checkNationalId(id.value);
    id.setCustomValidity(parsed.valid ? "" : parsed.message);
    const idStatus = $("idStatus");
    idStatus.textContent = parsed.valid ? "صيغة الرقم وتاريخ الميلاد صحيحان. لا تُثبت هذه الخطوة ملكية الرقم." : parsed.message;
    idStatus.className = parsed.valid ? "hint valid" : "hint invalid";
    const name = nameValue();
    const parts = ["first_name","second_name","third_name","fourth_name"].map((key) => get(key));
    for (const input of parts) {
      input.setCustomValidity("");
      if (!input.value.trim()) input.setCustomValidity("اكتب هذا الجزء من الاسم.");
      else if (!/^[\p{L}\p{M}\s.'’-]+$/u.test(input.value.trim())) input.setCustomValidity("استخدم الحروف فقط في الاسم.");
    }
    if (name.length < 8 || name.length > 160) {
      const first = parts.find((part) => !part.validationMessage) || parts[0];
      first.setCustomValidity("تأكد من كتابة الاسم الرباعي كاملًا.");
    }
  }
  if (index === 1 && (!get("group_code").value || get("group_code").disabled)) {
    showError("لا توجد مجموعة مختارة. راجع الصف ومكان الحضور، أو تواصل مع الإدارة.");
    return false;
  }
  if (index === 2) {
    for (const key of ["student_phone", "guardian_phone"]) {
      const input = get(key);
      input.setCustomValidity(validPhone(input.value) ? "" : "اكتب رقم موبايل مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015.");
    }
    const password = get("password");
    password.setCustomValidity("");
    if (!/[\p{L}]/u.test(password.value) || !/[0-9٠-٩]/.test(password.value) || password.value.length < 10)
      password.setCustomValidity("كلمة المرور يجب أن تكون 10 أحرف على الأقل وبها حروف وأرقام.");
    const confirm = get("password_confirm");
    confirm.setCustomValidity(confirm.value === password.value ? "" : "كلمتا المرور غير متطابقتين.");
  }
  for (const el of panel.querySelectorAll("input, select")) {
    if (el.disabled) continue;
    if (!el.checkValidity()) { el.reportValidity(); el.focus(); return false; }
  }
  return true;
}
function resetFieldError(event) {
  if (event.target?.setCustomValidity) event.target.setCustomValidity("");
}
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (captchaLoad) return captchaLoad;
  captchaLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("تعذر تحميل التحقق الأمني. تحقق من الإنترنت."));
    document.head.appendChild(script);
  });
  return captchaLoad;
}
async function renderCaptcha() {
  $("captchaWrap").classList.remove("hidden");
  if (!config?.captcha_sitekey || !config?.captcha_ready)
    throw new Error("التحقق الأمني غير جاهز؛ لن يتم استقبال تسجيلات جديدة الآن.");
  if (captchaId !== null) return;
  await loadTurnstile();
  if (!window.turnstile) throw new Error("تعذر تشغيل التحقق الأمني.");
  captchaId = window.turnstile.render("#turnstileWidget", {
    sitekey: config.captcha_sitekey,
    action: "student_registration",
    callback(token) {
      captchaToken = token;
      $("captchaStatus").textContent = "تم التحقق الأمني. يمكنك إنشاء الحساب.";
    },
    "expired-callback"() {
      captchaToken = "";
      $("captchaStatus").textContent = "انتهت صلاحية التحقق؛ أعد المحاولة.";
    },
    "error-callback"() {
      captchaToken = "";
      $("captchaStatus").textContent = "تعذر التحقق؛ حاول مرة أخرى.";
    }
  });
  $("captchaStatus").textContent = "أكمل التحقق الأمني قبل إرسال الطلب.";
}
document.querySelectorAll(".toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.previousElementSibling;
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "إظهار" : "إخفاء";
  });
});
form.addEventListener("input", resetFieldError);
get("national_id").addEventListener("input", () => {
  const el = get("national_id");
  const newValue = asLatinDigits(el.value).replace(/[^0-9]/g,"").slice(0,14);
  if (el.value !== newValue) el.value = newValue;
  const parsed = checkNationalId(newValue);
  $("idStatus").textContent = parsed.valid ? "صيغة الرقم وتاريخ الميلاد صحيحان." : "يجب إدخال 14 رقمًا صحيحًا تتضمن تاريخ الميلاد.";
  $("idStatus").className = parsed.valid ? "hint valid" : "hint";
});
for (const name of ["grade_level", "attendance_location", "education_system"]) {
  get(name).addEventListener("change", refreshGroups);
}
$("next").addEventListener("click", () => {
  if (!enabled || submitting || !validateStep(currentStep)) return;
  if (currentStep < 3) enterStep(currentStep + 1);
});
$("prev").addEventListener("click", () => {
  if (!submitting && currentStep > 0) enterStep(currentStep - 1);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!enabled || submitting) return;
  for (let i = 0; i < panels.length; i++) {
    if (i !== currentStep) enterStep(i);
    if (!validateStep(i)) return;
  }
  if (currentStep !== 3) enterStep(3);
  if (!config.national_id_collection_enabled) {
    showError("جمع الرقم القومي غير مفعّل على الخادم حاليًا. لن نستقبل البيانات قبل اكتمال متطلبات الخصوصية.");
    return;
  }
  if (config.captcha_required && !captchaToken) {
    showError("أكمل التحقق الأمني قبل إنشاء الحساب.");
    return;
  }
  const fields = Object.fromEntries(new FormData(form));
  const payload = {
    ...fields,
    national_id: checkNationalId(fields.national_id).value,
    identity_consent_accepted: fields.identity_consent === "on",
    full_name: nameValue(),
    privacy_accepted: fields.privacy === "on",
    privacy_notice_version: config.privacy_notice_version,
    request_idempotency_key: requestKey
  };
  for (const key of ["first_name", "second_name", "third_name", "fourth_name", "privacy", "identity_consent"]) delete payload[key];
  if (invite) payload.registration_invite = invite;
  if (config.captcha_required) payload.captcha_token = captchaToken;
  submitting = true;
  updateControls();
  $("submitBtn").textContent = "جارٍ إنشاء الحساب…";
  try {
    const result = await registrationCall("submit_registration", payload);
    $("studentCode").textContent = result.student_code || "—";
    const deadline = result.review_deadline_at ? new Date(result.review_deadline_at) : null;
    $("deadline").textContent = deadline && !Number.isNaN(deadline.valueOf())
      ? deadline.toLocaleString("ar-EG") : "سيتم إعلامك بواسطة الإدارة";
    $("wizard").classList.add("hidden");
    $("message").classList.add("hidden");
    $("receipt").classList.remove("hidden");
    $("copyCode").onclick = async () => {
      try { await navigator.clipboard.writeText(result.student_code); $("copyCode").textContent = "تم النسخ"; }
      catch (_) { $("copyCode").textContent = "حدد الكود وانسخه يدويًا"; }
    };
    $("receipt").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message || "تعذر إنشاء الحساب. حاول مرة أخرى.");
    if (config?.captcha_required && captchaId !== null && window.turnstile) {
      captchaToken = "";
      window.turnstile.reset(captchaId);
      $("captchaStatus").textContent = "أعد التحقق الأمني قبل المحاولة التالية.";
    }
  } finally {
    submitting = false;
    $("submitBtn").textContent = "إنشاء الحساب والحصول على الكود";
    updateControls();
  }
});
updateControls();
try {
  config = await registrationCall("config");
  if (!config.registration_enabled) throw new Error("التسجيل الجديد غير متاح حاليًا. تواصل مع الإدارة.");
  if (!config.national_id_collection_enabled) throw new Error("جمع الرقم القومي متوقف مؤقتًا لحين استكمال متطلبات حماية البيانات وموافقة ولي الأمر.");
  if (config.privacy_notice_version !== "v2-2026-10-30") throw new Error("إشعار خصوصية الرقم القومي لم يُعتمد في إعدادات الخادم بعد.");
  if (config.registration_invite_required && !invite) throw new Error("يلزم فتح رابط الدعوة المخصص لإتمام التسجيل.");
  if (config.captcha_required && (!config.captcha_ready || !config.captcha_sitekey))
    throw new Error("التحقق الأمني غير جاهز حاليًا. التسجيل مغلق لحين الإصلاح.");
  if (!Array.isArray(config.groups) || !config.groups.length)
    throw new Error("لا توجد مجموعات متاحة للتسجيل حاليًا.");
  enabled = true;
  refreshGroups();
  updateControls();
} catch (error) {
  showError(error.message || "التسجيل غير متاح الآن.");
  enabled = false;
  updateControls();
}