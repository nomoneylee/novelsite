import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

vol1_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan.md'
vol23_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_2+3.md'
vol45_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_4+5.md'
vol6_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_6.md'

files = [vol1_path, vol23_path, vol45_path, vol6_path]

all_chaps = []
for f in files:
    with open(f, 'r', encoding='utf-8') as fp:
        text = fp.read()
    matches = re.findall(r'\*\s*\*\*第\s*(\d+)\s*章[：:]([^*]+)\*\*', text)
    for m in matches:
        all_chaps.append((int(m[0]), m[1].strip(), os.path.basename(f)))

print(f"Total chapter entries found: {len(all_chaps)}")
print(f"First chapter: {all_chaps[0]}")
print(f"Last chapter: {all_chaps[-1]}")

# Check for gaps or duplicates
nums = [c[0] for c in all_chaps]
missing = []
for i in range(1, len(all_chaps) + 1):
    if i not in nums:
        missing.append(i)

if missing:
    print(f"Missing chapters: {missing}")
else:
    print(f"All chapters 1 to {len(all_chaps)} are perfectly continuous!")
