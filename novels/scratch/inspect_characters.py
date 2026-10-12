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

print("--- vol23 characters ---")
print(vol23_txt[vol23_txt.find("## 一、 新增登場人物速寫"):vol23_txt.find("## 二、 核心卡牌清單")])

print("--- vol45 characters ---")
print(vol45_txt[vol45_txt.find("## 一、 新增登場人物速寫"):vol45_txt.find("## 二、 核心卡牌清單")])

print("--- vol6 characters ---")
print(vol6_txt[vol6_txt.find("## 一、 新增登場人物速寫"):vol6_txt.find("## 二、 核心卡牌清單")])
