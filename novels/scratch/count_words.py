import os
import glob
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

prose_dir = r"e:\codes\創作小說\novels\novels\novel\社區醫館\正文"
files = [f for f in glob.glob(os.path.join(prose_dir, "*.md")) if not f.endswith("README.md")]

def get_chap_num(filename):
    match = re.search(r'第(\d+)章', os.path.basename(filename))
    return int(match.group(1)) if match else 9999

files.sort(key=get_chap_num)

total_chars_all = 0
total_hanzi_only = 0
total_bytes = 0

volume_stats = {
    '第一卷（老街小館，初露鋒芒 第 1~50 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
    '第二卷（風雲乍起，街坊護短 第 51~100 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
    '第三卷（身心同治，名動全台 第 101~150 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
    '第四卷（失傳名方，正邪交鋒 第 151~210 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
    '第五卷（山海之間，醫者無疆 第 211~260 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
    '第六卷（萬家燈火，人間大夫 第 261~300 章）': {'files': 0, 'hanzi': 0, 'chars': 0, 'bytes': 0},
}

for f in files:
    chap_num = get_chap_num(f)
    size = os.path.getsize(f)
    total_bytes += size
    with open(f, 'r', encoding='utf-8') as fp:
        text = fp.read()
    
    chars_len = len(text.replace(' ', '').replace('\n', '').replace('\r', ''))
    hanzi_len = len(re.findall(r'[\u4e00-\u9fff]', text))
    
    total_chars_all += chars_len
    total_hanzi_only += hanzi_len
    
    if 1 <= chap_num <= 50:
        vol = '第一卷（老街小館，初露鋒芒 第 1~50 章）'
    elif 51 <= chap_num <= 100:
        vol = '第二卷（風雲乍起，街坊護短 第 51~100 章）'
    elif 101 <= chap_num <= 150:
        vol = '第三卷（身心同治，名動全台 第 101~150 章）'
    elif 151 <= chap_num <= 210:
        vol = '第四卷（失傳名方，正邪交鋒 第 151~210 章）'
    elif 211 <= chap_num <= 260:
        vol = '第五卷（山海之間，醫者無疆 第 211~260 章）'
    else:
        vol = '第六卷（萬家燈火，人間大夫 第 261~300 章）'
        
    volume_stats[vol]['files'] += 1
    volume_stats[vol]['hanzi'] += hanzi_len
    volume_stats[vol]['chars'] += chars_len
    volume_stats[vol]['bytes'] += size

print("====================================")
print("《社區醫館》小說字數統計報告")
print("====================================")
print(f"總章節數：{len(files)} 章")
print(f"純漢字總數（不含標點空白）：{total_hanzi_only:,} 字（約 {total_hanzi_only/10000:.1f} 萬字）")
print(f"繁體中文字符總數（含標點符號）：{total_chars_all:,} 字（約 {total_chars_all/10000:.1f} 萬字）")
print(f"正文檔案總容量：{total_bytes / (1024*1024):.2f} MB ({total_bytes:,} bytes)")
print(f"單章平均純漢字數：{total_hanzi_only / len(files):.0f} 字 / 章")
print(f"單章平均字符數（含標點）：{total_chars_all / len(files):.0f} 字 / 章")
print(f"單章平均檔案大小：{total_bytes / len(files) / 1024:.1f} KB / 章")
print("\n--- 各卷字數與篇幅分佈 ---")
for vol, st in volume_stats.items():
    print(f"▶ {vol}")
    print(f"  - 章數：{st['files']} 章")
    print(f"  - 純漢字：{st['hanzi']:,} 字（含標點 {st['chars']:,} 字）")
    print(f"  - 檔案容量：{st['bytes']/1024:.1f} KB (單章平均約 {st['hanzi']/st['files']:.0f} 字)")
