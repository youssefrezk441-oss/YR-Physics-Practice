import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0/+esm";
import {
  latinDigits,
  looksLikeEgyptianPhone,
  normalizeEgyptianPhone,
} from "./student-account-normalize.js";
const URL = "https://ltjdhconuiqblxfjzpzj.supabase.co",
  KEY = "sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr",
  sb = createClient(URL, KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }),
  emailForCode = (c) =>
    c.trim().toLowerCase().replace(/\s+/g, "") +
    "@students.yrphysicspractice.com";
async function config() {
  const { data, error } = await sb.functions.invoke("student-identity", {
    body: { action: "config" },
  });
  if (error || !data?.ok) throw error || Error("identity unavailable");
  return data;
}
function addLinks(cfg) {
  const panel = document.querySelector("#loginView .loginPanel");
  if (!panel || panel.querySelector(".accountLinks")) return;
  const label =
    document.querySelector('label[for="studentCode"]') ||
    document
      .querySelector("#studentCode")
      ?.closest(".loginField")
      ?.querySelector("label");
  if (label)
    label.textContent = cfg.phone_login_enabled
      ? "كود الطالب أو رقم الموبايل"
      : "كود الطالب";
  const links = document.createElement("div");
  links.className = "accountLinks";
  links.innerHTML = `${cfg.registration_enabled ? '<a href="student-register.html">إنشاء حساب جديد</a>' : ""}<a href="student-recovery.html">نسيت كلمة المرور؟</a>`;
  panel.append(links);
  if (!cfg.phone_login_enabled) {
    const note = document.createElement("div");
    note.className = "accountNote";
    note.textContent =
      "الدخول برقم الموبايل سيظهر بعد توثيق الرقم. الدخول بالكود مستمر دون تغيير.";
    panel.append(note);
  }
  const old = document.getElementById("loginBtn"),
    input = document.getElementById("studentCode"),
    password = document.getElementById("studentPassword");
  if (!old || !input || !password) return;
  const button = old.cloneNode(true);
  old.replaceWith(button);
  button.onclick = async () => {
    const value = latinDigits(input.value).trim(),
      pass = password.value;
    try {
      button.disabled = true;
      if (!value || !pass) throw Error("اكتب الكود وكلمة المرور.");
      const phone = looksLikeEgyptianPhone(value);
      if (phone && !cfg.phone_login_enabled)
        throw Error(
          "الدخول بالموبايل غير مفعّل حتى توثيق الرقم عبر SMS. استخدم كود الطالب.",
        );
      const credentials = phone
        ? { phone: normalizeEgyptianPhone(value), password: pass }
        : { email: emailForCode(value.toUpperCase()), password: pass };
      const { error } = await sb.auth.signInWithPassword(credentials);
      if (error) throw Error("بيانات الدخول غير صحيحة.");
      location.reload();
    } catch (e) {
      const msg = document.getElementById("msg");
      if (msg)
        msg.innerHTML =
          '<div class="msg err">' +
          String(e.message || "تعذر الدخول").replace(/[<>]/g, "") +
          "</div>";
    } finally {
      button.disabled = false;
    }
  };
}
const reviewText = {
  pending_review: "حسابك قيد مراجعة الإدارة",
  suspended_pending_approval: "حسابك موقوف مؤقتًا",
  rejected: "تم رفض طلب التسجيل",
  suspended_by_admin: "الحساب موقوف بواسطة الإدارة",
  status_unavailable: "تعذر التحقق من حالة الحساب",
};
function renderReviewGate(review) {
  if (!review || review.legacy_account || review.status === "approved") return;
  const deadline = review.review_deadline_at
    ? new Date(review.review_deadline_at)
    : null;
  const pending = review.status === "pending_review";
  const box = document.createElement("section");
  box.id = "studentReviewGate";
  box.setAttribute("role", "status");
  box.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;background:#f5f7fb;display:grid;place-items:center;padding:20px;font-family:system-ui,Tahoma,sans-serif;direction:rtl";
  box.innerHTML = `<div style="width:min(560px,100%);background:#fff;border:1px solid #d9e1ef;border-radius:22px;padding:28px;box-shadow:0 18px 60px #17345a22;text-align:center"><div style="font-size:44px">${pending ? "⏳" : "🔒"}</div><h1 style="color:#17345a">${reviewText[review.status] || "حالة الحساب قيد المراجعة"}</h1><p>${pending ? "تم إنشاء حسابك ويمكنك متابعة حالة المراجعة. الوظائف التعليمية ستتاح بعد اعتماد الإدارة." : "بياناتك محفوظة ولا تحتاج إلى إنشاء حساب جديد. سيتم تفعيل الحساب فور صدور القرار المناسب."}</p>${deadline ? `<p><b>${pending ? "تنتهي مهلة المراجعة" : "انتهت مهلة المراجعة"}:</b><br>${deadline.toLocaleString("ar-EG")}</p>` : ""}<p id="reviewCountdown" style="font-size:20px;font-weight:800;color:#8a5a00"></p><button id="reviewRefresh" style="padding:11px 20px;border:0;border-radius:12px;background:#17345a;color:white;cursor:pointer">تحديث الحالة</button> <button id="reviewLogout" style="padding:11px 20px;border:1px solid #17345a;border-radius:12px;background:white;color:#17345a;cursor:pointer">تسجيل الخروج</button></div>`;
  document.body.append(box);
  const update = () => {
    const el = document.getElementById("reviewCountdown");
    if (!el || !pending || !deadline) return;
    const ms = deadline - Date.now();
    el.textContent =
      ms > 0
        ? `الوقت المتبقي: ${Math.ceil(ms / 36e5)} ساعة`
        : "انتهت المهلة؛ حدّث الحالة.";
  };
  update();
  setInterval(update, 60000);
  document.getElementById("reviewRefresh").onclick = () => location.reload();
  document.getElementById("reviewLogout").onclick = async () => {
    await sb.auth.signOut();
    location.reload();
  };
}
async function gate(cfg) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.user || session.user.app_metadata?.role !== "student") return;
  if (
    window.__yrStudentReview &&
    !window.__yrStudentReview.legacy_account &&
    window.__yrStudentReview.status !== "approved"
  ) {
    renderReviewGate(window.__yrStudentReview);
    return;
  }
  const { data, error } = await sb.functions.invoke("student-identity", {
    body: { action: "me" },
  });
  if (error || !data?.ok) {
    if (session.user.app_metadata?.registration_request_id)
      renderReviewGate({ status: "status_unavailable", legacy_account: false });
    return;
  }
  renderReviewGate(data.review);
  if (
    data.review &&
    !data.review.legacy_account &&
    data.review.status !== "approved"
  )
    return;
  const current = Number(data.profile?.profile_schema_version || 0),
    required = Number(data.required_profile_schema_version || 1);
  if (
    data.enforcement &&
    current < required &&
    !location.pathname.endsWith("student-profile-update.html")
  )
    location.replace("student-profile-update.html");
}
(async () => {
  try {
    const cfg = await config();
    addLinks(cfg);
    await gate(cfg);
  } catch {
    /* fail open: legacy code login remains available */
  }
})();
