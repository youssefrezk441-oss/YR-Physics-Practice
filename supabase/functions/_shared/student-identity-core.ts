export class IdentityInputError extends Error {
  code:string;
  constructor(code:string, message:string){super(message);this.name="IdentityInputError";this.code=code}
}

const digitMap:Record<string,string>={"٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9"};
export const latinDigits=(value:unknown)=>String(value??"").replace(/[٠-٩۰-۹]/g,c=>digitMap[c]??c);
export function normalizeEgyptianPhone(value:unknown){
  let phone=latinDigits(value).replace(/[^0-9+]/g,"");
  if(phone.startsWith("0020"))phone=`+20${phone.slice(4)}`;
  else if(phone.startsWith("20")&&phone.length===12)phone=`+${phone}`;
  else if(phone.startsWith("01")&&phone.length===11)phone=`+20${phone.slice(1)}`;
  else if(/^1[0125][0-9]{8}$/.test(phone))phone=`+20${phone}`;
  if(!/^\+201[0125][0-9]{8}$/.test(phone))throw new IdentityInputError("invalid_phone","رقم الموبايل المصري غير صحيح.");
  return phone;
}
export function normalizeStudentCode(value:unknown){
  const code=latinDigits(value).normalize("NFKC").trim().toUpperCase().replace(/\s+/g,"");
  if(!/^[A-Z]{1,8}[0-9]?(?:-[A-Z0-9]{1,12})+$/.test(code))throw new IdentityInputError("invalid_student_code","كود الطالب غير صحيح.");
  return code;
}
export function isPhoneIdentifier(value:unknown){const v=latinDigits(value).trim();return /^(?:\+?20|0020|0)?1[0125][0-9\s-]{8,}$/.test(v.replace(/[()]/g,""))}
export function validateFullName(value:unknown){
  const name=String(value??"").normalize("NFKC").trim().replace(/\s+/g," ");
  if(name.length<8||name.length>160||!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]+$/u.test(name)||name.split(" ").filter(Boolean).length<4)throw new IdentityInputError("invalid_full_name","اكتب الاسم الرباعي كاملًا.");
  return name;
}
export function parseEgyptianNationalId(value:unknown, today=new Date()){
  const id=latinDigits(value).replace(/\s/g,"");
  if(!/^\d{14}$/.test(id))throw new IdentityInputError("invalid_national_id","الرقم القومي يجب أن يتكون من 14 رقمًا.");
  const century=id[0]==="2"?1900:id[0]==="3"?2000:NaN, year=century+Number(id.slice(1,3)),month=Number(id.slice(3,5)),day=Number(id.slice(5,7));
  const date=new Date(Date.UTC(year,month-1,day));
  if(!Number.isFinite(century)||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw new IdentityInputError("invalid_national_id_date","تاريخ الميلاد داخل الرقم القومي غير صحيح.");
  const now=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
  if(date.getTime()>now||year<1900)throw new IdentityInputError("invalid_birth_date","تاريخ الميلاد غير صحيح.");
  return{id,birthDate:`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`,last4:id.slice(-4)};
}
export function validatePassword(value:unknown){const p=String(value??"");if(p.length<10||p.length>128||!/[A-Za-z\p{L}]/u.test(p)||!/[0-9٠-٩]/.test(p))throw new IdentityInputError("weak_password","استخدم 10 أحرف على الأقل تشمل حروفًا وأرقامًا.");return p}
export function assertExistingProfileIdentityConsent(input:{hasNationalId:boolean,collectionEnabled:boolean,accepted:boolean,noticeVersion:string,currentNoticeVersion:string}){
  if(!input.hasNationalId)return false;
  if(!input.collectionEnabled)throw new IdentityInputError("identity_collection_unavailable","جمع الرقم القومي غير متاح حاليًا. يمكنك تحديث بيانات التواصل فقط.");
  if(!input.accepted||!input.noticeVersion||input.noticeVersion!==input.currentNoticeVersion)throw new IdentityInputError("privacy_consent_required","يلزم قراءة إشعار الخصوصية الحالي والموافقة عليه قبل إرسال الرقم القومي.");
  return true;
}
export const constantStatusMessage="إذا كانت البيانات صحيحة فسيتم تنفيذ الطلب وفق حالته دون كشف وجود حساب من عدمه.";
