# -*- coding: utf-8 -*-
import os
import re

def main():
    chapter_files = [
        "第1章_聽雨客來陰風緊.md",
        "第2章_冷刃無聲血染衣.md",
        "第3章_九章算術蘊乾坤.md",
        "第4章_江南漕運風浪急.md",
        "第5章_影中之影沈寒石.md",
        "第6章_正道名門偽善人.md",
        "第7章_斷指之刃瞬息斬.md",
        "第8章_白蓮初現亂世萌.md",
        "第9章_雨落無聲殺機伏.md",
        "第10章_聽雨軒中雷霆動.md",
        "第11章_孤影狂刀戰群魔.md",
        "第12章_大鵬展翅入京華.md"
    ]
    base_dir = "novel/聽雨風雲錄/正文"
    
    issues = []

    for fn in chapter_files:
        path = os.path.join(base_dir, fn)
        if not os.path.exists(path):
            issues.append(f"{fn}: File not found")
            continue
        
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
            lines = content.split('\n')

        # Check for consecutive empty lines
        consec_empty = 0
        for i, line in enumerate(lines, 1):
            if line.strip() == '':
                consec_empty += 1
                if consec_empty > 2:
                    issues.append(f"{fn}:{i} -> Multiple consecutive empty lines ({consec_empty})")
            else:
                consec_empty = 0

        # Check for typical duplicate characters (like "的的手", "了了")
        for i, line in enumerate(lines, 1):
            matches = re.findall(r'([\u4e00-\u9fa5])\1', line)
            for m in matches:
                # exclude common duplicated words like "微微", "默默", "依依", "點點", "輕輕", "吃吃", "哈哈", "嘎吱"
                common_dupes = ["微", "默", "依", "點", "輕", "吃", "哈", "嘎", "吱", "喔", "呵呵", "嘻嘻", "啦", "滾滾", "滔滔", "沉沉", "茫茫", "密密", "整整", "嘿嘿", "簌簌", "嘩嘩", "哈哈", "哼哼", "冷冷", "乾乾", "紅紅", "細細", "楚楚", "緩緩", "緊緊", "死死", "步步", "個個", "一眨不眨", "深深", "年年", "夜夜", "日日", "代代", "字字", "句句", "牙牙", "汪汪", "呼呼", "嗡嗡", "沙沙", "悄悄", "津津", "茫茫", "白白", "偏偏", "振振", "赫赫", "落落", "重重", "楚楚", "蠢蠢", "瑟瑟", "振振", "面面", "循循", "滔滔", "草草", "欣欣", "孜孜", "昭昭", "岌岌", "昏昏", "噩噩", "林林", "總總", "星星", "朝朝", "暮暮", "生生", "寸寸", "處處", "乾乾", "淨淨", "奇奇", "怪怪"]
                if m in "".join(common_dupes):
                    continue
                # If it's a duplication, log it for review
                # We can refine this to look for grammar typos like "的" + "的", "了" + "了", "在" + "在"
                if m in ["的", "了", "在", "是", "著", "被", "把", "以", "與"]:
                    issues.append(f"{fn}:{i} -> Potential duplicate grammar character: '{m}{m}'")

        # Check for punctuation errors, e.g. Chinese mixed with English punctuation
        for i, line in enumerate(lines, 1):
            # check for English commas/periods/question marks/exclamations/colons/semicolons next to Chinese characters
            # But allow numbers, math formulas in Chapter 12 (like $S_0 = 10 \times 78 ...$)
            if "第12章" in fn:
                continue
            eng_punc_match = re.search(r'[\u4e00-\u9fa5][,.\?!;:\"\'\(\)]|[,.\?!;:\"\'\(\)][\u4e00-\u9fa5]', line)
            if eng_punc_match:
                issues.append(f"{fn}:{i} -> Mixed punctuation style in line: '{line.strip()[:60]}'")

    with open("scratch/volume_1_lint_issues.txt", "w", encoding="utf-8") as out:
        out.write("\n".join(issues))
    print(f"Done. Found {len(issues)} potential lint issues.")

if __name__ == '__main__':
    main()
