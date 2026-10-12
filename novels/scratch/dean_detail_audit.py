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

print("=== 院長描寫詳細審核 ===")

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
        
    # Find any paragraph mentioning 院長
    paras = text.split("\n\n")
    for p in paras:
        if "院長媽媽" in p or "院長爸爸" in p:
            print(f"\n[第{chap_num}章 {fname}] 特殊稱謂段落：")
            print(p.strip())
        elif "陳院長" in p and ("她" in p or "母" in p or "婆" in p or "老婦" in p or "老太太" in p):
            print(f"\n[第{chap_num}章 {fname}] 疑似女性化描寫段落：")
            print(p.strip())
        elif "陳院長" in p and ("他" in p or "父" in p or "老漢" in p or "老爺子" in p or "老先生" in p or "鬍" in p):
            # Sample check male depiction
            pass
