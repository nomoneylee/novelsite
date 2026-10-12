import os
import re
import glob

prose_dir = r"e:\codes\創作小說\novels\novels\novel\社區醫館\正文"

# List of files
md_files = [f for f in glob.glob(os.path.join(prose_dir, "*.md")) if not f.endswith("README.md")]

# Sort files by chapter number
def get_chap_num(filename):
    match = re.search(r'第(\d+)章', os.path.basename(filename))
    if match:
        return int(match.group(1))
    return 9999

md_files.sort(key=get_chap_num)

print(f"Auditing {len(md_files)} chapters...")

# Simplified Chinese common characters test list
# (Selected common simplified characters that have distinct traditional counterparts)
simp_chars = set("们这为经医处药实规体见发时会动关现对当后与点开业样问进运门应种样长产统气机问题华学经总线变声节识联转头选设认观权结带导报争领历区压别报济传写步团极际计细导改资")

results = {
    "dean_inconsistencies": [],
    "simplified_chars": [],
    "subheadings": [],
    "out_of_story_notes": [],
    "file_size_anomalies": [],
    "taiwan_vocab_issues": [],
    "character_name_issues": []
}

# Terminology checks (Mainland vs Taiwan)
mainland_terms = [
    ("信息", "資訊"),
    ("軟件", "軟體"),
    ("網絡", "網路"),
    ("項目", "專案"),
    ("基礎信息", "基本資料"),
    ("基本信息", "基本資料"),
    ("幼兒園", "幼兒園/育幼院"),
    ("打印", "列印"),
    ("屏幕", "螢幕"),
    ("內存", "記憶體"),
    ("程序員", "工程師/程式設計師"),
    ("視頻", "影片/視訊"),
    ("高校", "大專院校/大學"),
    ("公安", "警察/員警"),
    ("出租車", "計程車"),
    ("方便麵", "泡麵"),
    ("盒飯", "便當")
]

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    size = os.path.getsize(filepath)
    
    # File size check
    if size < 6500 or size > 12000:
        results["file_size_anomalies"].append((chap_num, fname, size))
        
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    content = "".join(lines)
    
    # 1. Dean checks
    # Look for 院長媽媽 vs other terms
    has_yuanzhang_mama = "院長媽媽" in content
    has_yuanzhang_baba = "院長爸爸" in content
    has_chen_minghui = "陳明輝" in content
    has_chen_hean = "陳和安" in content
    
    # Look for contexts around 院長
    for line_idx, line in enumerate(lines, 1):
        if "院長媽媽" in line:
            results["dean_inconsistencies"].append((chap_num, fname, line_idx, "院長媽媽", line.strip()))
        if "院長爸爸" in line:
            results["dean_inconsistencies"].append((chap_num, fname, line_idx, "院長爸爸", line.strip()))
            
        # Check subheadings (# or ## or ### inside body, except line 1)
        if line_idx > 1 and re.match(r'^\s*#{1,6}\s+', line):
            results["subheadings"].append((chap_num, fname, line_idx, line.strip()))
            
        # Check out-of-story notes
        if any(bad in line for bad in ["欲知後事如何", "請看下回", "本章完", "未完待續", "作者有話說", "ps:", "PS:"]):
            results["out_of_story_notes"].append((chap_num, fname, line_idx, line.strip()))
            
        # Check mainland terms
        for m_term, t_term in mainland_terms:
            if m_term in line:
                # Filter out valid phrases like "訊息" vs "信息", or "網絡" in specialized context if any
                results["taiwan_vocab_issues"].append((chap_num, fname, line_idx, m_term, t_term, line.strip()))

print("Scan complete.")
print(f"Dean inconsistencies found: {len(results['dean_inconsistencies'])}")
print(f"Subheadings found: {len(results['subheadings'])}")
print(f"Out of story notes found: {len(results['out_of_story_notes'])}")
print(f"File size anomalies: {len(results['file_size_anomalies'])}")
print(f"Mainland vocab issues: {len(results['taiwan_vocab_issues'])}")
