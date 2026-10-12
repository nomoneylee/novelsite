import os
import re
import glob

prose_dir = r"e:\codes\創作小說\novels\novels\novel\社區醫館\正文"
md_files = [f for f in glob.glob(os.path.join(prose_dir, "*.md")) if not f.endswith("README.md")]

def get_chap_num(filename):
    match = re.search(r'第(\d+)章', os.path.basename(filename))
    return int(match.group(1)) if match else 9999

md_files.sort(key=get_chap_num)

print("=== DEAN / 院長 ANALYSIS ===")
for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    
    # Check "院長媽媽"
    if "院長媽媽" in text or "媽媽" in text:
        matches = re.findall(r'.{0,30}(?:院長媽媽|媽媽).{0,30}', text)
        for m in matches:
            if "院長" in m:
                print(f"Chap {chap_num} ({fname}): {m.strip()}")

    # Check "陳院長" gender pronouns
    # Look for sentences with 陳院長 or 院長 and 她/他
    paragraphs = text.split("\n\n")
    for p in paragraphs:
        if "陳院長" in p or "院長" in p:
            if "她" in p:
                # print snippet where 院長 and 她 occur
                print(f"Chap {chap_num} [FEMALE PRONOUN WITH 院長]: {p[:150]}...")
