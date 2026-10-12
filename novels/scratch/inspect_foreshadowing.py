import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

vol1_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan.md'
vol23_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_2+3.md'
vol45_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_4+5.md'
vol6_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\深淵紀元plan_6.md'

with open(vol1_path, 'r', encoding='utf-8') as f:
    vol1_txt = f.read()

with open(vol23_path, 'r', encoding='utf-8') as f:
    vol23_txt = f.read()

with open(vol45_path, 'r', encoding='utf-8') as f:
    vol45_txt = f.read()

with open(vol6_path, 'r', encoding='utf-8') as f:
    vol6_txt = f.read()

print("--- vol1 foreshadowing ---")
print(vol1_txt[vol1_txt.find("## 主線伏筆規劃"):vol1_txt.find("## 完整第一卷")])

print("--- vol23 foreshadowing ---")
print(vol23_txt[vol23_txt.find("## 三、 主線伏筆進展表"):vol23_txt.find("# 完整第二卷")])

print("--- vol45 foreshadowing ---")
print(vol45_txt[vol45_txt.find("## 三、 主線伏筆進展表"):vol45_txt.find("# 完整第四卷")])

print("--- vol6 foreshadowing ---")
print(vol6_txt[vol6_txt.find("## 三、 主線伏筆最終回收表"):vol6_txt.find("# 完整第六卷")])
