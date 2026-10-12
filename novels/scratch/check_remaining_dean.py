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

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for lno, line in enumerate(lines, 1):
        if "院長媽媽" in line or "院長爸爸" in line or "陳院長媽媽" in line or ("七十壽辰" in fname and lno == 1):
            print(f"[第{chap_num}章 L{lno}] {line.strip()}")
