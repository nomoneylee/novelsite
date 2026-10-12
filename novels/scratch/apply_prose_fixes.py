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

print(f"Total files to process: {len(md_files)}")

# Exact replacements mapping
replacements = [
    # 1. Dean honorific fixes
    ("院長媽媽", "陳院長"),
    ("院長爸爸", "陳院長"),
    ("陳院長媽媽", "陳院長"),
    
    # 2. Simplified Chinese fixes
    ("極具质感", "極具質感"),
    ("极具质感", "極具質感"),
    ("質感", "質感"),
    ("声音", "聲音"),
    ("花里胡哨", "花俏"),
    ("憂思入里", "憂思入裏"),
    
    # 3. Mainland Vocabulary to Taiwan Vocabulary
    ("大媽們", "阿姨們"),
    ("十幾個大媽", "十幾位阿姨"),
    ("大媽心花怒放", "阿姨心花怒放"),
    ("講給大媽們聽", "講給阿姨們聽"),
    ("全隊大媽", "全隊阿姨"),
    ("大媽", "阿姨"), # general fallback for 大媽
    
    ("屏幕", "螢幕"),
    ("打印", "列印"),
    ("方便麵", "泡麵"),
    ("出租車", "計程車"),
    ("立馬", "立刻"),
    ("忽悠", "唬弄"),
    
    # Contextual 幼兒園 -> 育幼院
    ("幼兒園弟妹", "育幼院弟妹"),
]

# Replacement for '着' -> '著'
# We must be careful not to replace anything unwanted (e.g., if there's any valid use, but '着' in Chinese is virtually always '著' in Taiwan Trad).

modified_files_count = 0
changes_log = []

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
        
    orig_content = content
    
    # Perform string replacements
    for old_s, new_s in replacements:
        if old_s in content:
            count = content.count(old_s)
            content = content.replace(old_s, new_s)
            changes_log.append(f"[第{chap_num}章] 替換 '{old_s}' -> '{new_s}' ({count}次)")
            
    # Replace '着' with '著'
    if '着' in content:
        count = content.count('着')
        content = content.replace('着', '著')
        changes_log.append(f"[第{chap_num}章] 替換簡體字 '着' -> '著' ({count}次)")
        
    # Replace '质' with '質'
    if '质' in content:
        count = content.count('质')
        content = content.replace('质', '質')
        changes_log.append(f"[第{chap_num}章] 替換簡體字 '质' -> '質' ({count}次)")
        
    # Replace '声' with '聲'
    if '声' in content:
        count = content.count('声')
        content = content.replace('声', '聲')
        changes_log.append(f"[第{chap_num}章] 替換簡體字 '声' -> '聲' ({count}次)")
        
    if content != orig_content:
        modified_files_count += 1
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

print(f"\nSuccessfully modified {modified_files_count} files.")
print(f"Total changes recorded: {len(changes_log)}")
print("\nSample changes:")
for log in changes_log[:25]:
    print(" - " + log)
