#!/usr/bin/env python3
"""Verify all live question JPEGs against the published public content manifest."""
import concurrent.futures
import hashlib
import json
import sys
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE = "https://youssefrezk441-oss.github.io/YR-Physics-Practice/"
MANIFEST = "workshops/third-secondary-term-2-lesson-2-book-homework/public-content.json"

def get(path):
    request = Request(urljoin(BASE, path), headers={"User-Agent": "YR-L2-assets-verification/1.0", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=25) as response:
        return response.status, response.read()

status, raw = get(MANIFEST)
assert status == 200, ("manifest", status)
content = json.loads(raw)
assert content["workshop"]["slug"] == "third-secondary-term-2-lesson-2-book-homework"
assert len(content["questions"]) == 115
assert sum(len(q["parts"]) for q in content["questions"]) == 139
assert len({q["image"] for q in content["questions"]}) == 115
assert not any(token in raw for token in [b"model_answer", b"answer_spec", b"display_answer"])

status, page = get("lesson2-book-homework.html")
assert status == 200 and b"third-secondary-term-2-lesson-2-book-homework" in page

def test_image(question):
    status, data = get(question["image"])
    if status != 200 or len(data) < 20000 or not data.startswith(b"\xff\xd8"):
        return (question["image"], "invalid image", status, len(data))
    sha = hashlib.sha256(data).hexdigest()
    if sha != question["image_sha256"]:
        return (question["image"], "sha256 mismatch", sha)
    return None

with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    errors = [result for result in pool.map(test_image, content["questions"]) if result]
if errors:
    print(json.dumps({"passed": False, "errors": errors}, ensure_ascii=False))
    sys.exit(1)
print("PASS 115/115 live JPEG URLs HTTP 200, exact SHA256, public content and page available, no public answer keys")
