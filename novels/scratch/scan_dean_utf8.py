import os
import re
import sys
import glob

sys.stdout.reconfigure(encoding='utf-8')

prose_dir = r"e:\codes\創作小說\novels\novels\novel\社區醫館\正文"
md_files = [f for f in glob.glob(os.path.join(prose_dir, "*.md")) if not f.endswith("README.md")]

def get_chap_num(filename):
    match = re.search(r'第(\d+)章', os.path.basename(filename))
    return int(match.group(1)) if match else 9999

md_files.sort(key=get_chap_num)

print("=== 院長稱謂與性別全面掃描 ===")
dean_terms = ["院長媽媽", "院長爸爸", "陳院長媽媽", "院長阿姨", "陳和安", "陳明輝", "老院長", "陳院長", "現任院長"]

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
        
    for term in ["院長媽媽", "院長爸爸", "陳院長媽媽", "院長阿姨"]:
        if term in text:
            # find sentence
            matches = re.findall(rf'[^。！？\n]*{term}[^。！？\n]*[。！？\n]', text)
            for m in matches:
                print(f"[第{chap_num}章] 發現稱謂【{term}】：{m.strip()}")
