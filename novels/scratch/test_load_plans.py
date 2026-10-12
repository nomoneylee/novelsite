import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

plan_files = {
    'vol1': r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan.md',
    'vol2_3': r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_2+3.md',
    'vol4_5': r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_4+5.md',
    'vol6': r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_6.md'
}

data = {}
for k, path in plan_files.items():
    with open(path, 'r', encoding='utf-8') as f:
        data[k] = f.read()
    print(f"Loaded {k}: {len(data[k])} chars")
