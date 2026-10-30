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
  const system = get("education_system").value;
  const previous = select.value;
  select.replaceChildren(new Option("اختر المجموعة", ""));
  select.disabled = true;
  if (!config || !grade) {
    hint.textContent = "اختر الصف الدراسي أولًا.";
    return;
  }
  const byGrade = (config.groups || []).filter((g) => gradeCompatible(g, grade));
  const byCenter = center ? byGrade.filter((g) => centerCompatible(g, center)) : byGrade;
  const regularCenter = center === "ناهيا" || center === "كفر حكيم";
  const secondYear = grade === "الصف الثاني الثانوي";
  const mapped = secondYear && regularCenter && ["أزهري", "بكالوريا", "عام"].includes(system)
    ? `${center === "ناهيا" ? "N" : "K"}2-${system === "أزهري" ? "B" : "A"}` : "";
  const filtered = secondYear && regularCenter && !system ? []
    : mapped ? byCenter.filter((g) => String(g.group_code) === mapped)
    : center && center !== "غير ذلك" && center !== "خصوصي" ? byCenter : byGrade;
  for (const group of filtered) {
    select.add(new Option(String(group.group_code) + (group.center_name ? " — " + group.center_name : ""), String(group.group_code)));
  }
  if (mapped && filtered.length === 1) select.value = mapped;
  else if (previous && filtered.some((g) => String(g.group_code) === previous)) select.value = previous;
  select.disabled = !filtered.length;
  hint.textContent = secondYear && regularCenter && !system ? "اختر النظام التعليمي ليتم تحديد مجموعتك تلقائيًا."
    : !filtered.length ? "لا توجد مجموعة متاحة للصف والنظام ومكان الحضور المحددين حاليًا. تواصل مع الإدارة."
    : mapped ? "تم تحديد مجموعتك تلقائيًا وفقًا للصف والنظام التعليمي ومكان الحضور."
    : center === "غير ذلك" || center === "خصوصي"
      ? "اختر المجموعة التي تتبع لها. ستراجع الإدارة طلب الحضور الخاص أو غير المحدد قبل الاعتماد."
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
  if (config.captcha_required && !captchaToken) {
    showError("أكمل التحقق الأمني قبل إنشاء الحساب.");
    return;
  }
  const fields = Object.fromEntries(new FormData(form));
  const payload = {
    ...fields,
    full_name: nameValue(),
    privacy_accepted: fields.privacy === "on",
    privacy_notice_version: config.privacy_notice_version,
    request_idempotency_key: requestKey
  };
  for (const key of ["first_name", "second_name", "third_name", "fourth_name", "privacy"]) delete payload[key];
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