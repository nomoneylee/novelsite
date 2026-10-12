import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

files = [
    r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan.md',
    r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_2+3.md',
    r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_4+5.md',
    r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_6.md',
]

for filepath in files:
    fname = os.path.basename(filepath)
    print("=" * 60)
    print(f"FILE: {fname}")
    print("=" * 60)
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    # Print lines that start with #, ##, ###, or special markers
    for lno, line in enumerate(lines, 1):
        if line.startswith("#"):
            print(f"L{lno}: {line.strip()}")
