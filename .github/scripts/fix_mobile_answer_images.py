from pathlib import Path

FILES = [Path("student-base.html"), Path("student.html")]

old_load = "async function answerImageLoad(file){return await new Promise((resolve,reject)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('تعذر قراءة الصورة.'))};img.src=u})}"
new_load = "function answerImageDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('تعذر قراءة الصورة.'));r.readAsDataURL(file)})}\nasync function answerImageLoad(file){const src=await answerImageDataUrl(file);return await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر قراءة الصورة.'));img.src=src})}"

old_preview = "if(!previewUrl)previewUrl=URL.createObjectURL(blob);"
new_preview = "if(!previewUrl)previewUrl=await answerImageDataUrl(blob);"

old_remove = "row.deleted=true;if(row.preview_url)URL.revokeObjectURL(row.preview_url);"
new_remove = "row.deleted=true;"

for p in FILES:
    if not p.exists():
        raise SystemExit(f"missing file: {p}")
    s = p.read_text(encoding="utf-8")

    if old_load in s:
        s = s.replace(old_load, new_load, 1)
    elif "function answerImageDataUrl(file)" not in s:
        raise SystemExit(f"answerImageLoad marker not found in {p}")

    if old_preview in s:
        s = s.replace(old_preview, new_preview, 1)
    elif new_preview not in s:
        raise SystemExit(f"preview marker not found in {p}")

    if old_remove in s:
        s = s.replace(old_remove, new_remove, 1)

    if "URL.createObjectURL" in s:
        raise SystemExit(f"URL.createObjectURL still exists in {p}")
    if "URL.revokeObjectURL" in s:
        raise SystemExit(f"URL.revokeObjectURL still exists in {p}")
    if "function answerImageDataUrl(file)" not in s:
        raise SystemExit(f"FileReader helper missing in {p}")

    p.write_text(s, encoding="utf-8")
