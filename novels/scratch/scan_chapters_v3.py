import os
import re

# 正文目錄
NOVEL_DIR = r"e:\codes\novels\1\novel\聽雨風雲錄\正文"

# 1. 簡體/俗體字檢測字典
SPECIAL_SIMPLIFIED = {
    '着',  # 應為 著
    '并',  # 應為 並/併
    '于',  # 應為 於
    '准',  # 應為 準（但「准許」除外，需在代碼中過濾）
}

def is_simplified_char(char):
    if char in SPECIAL_SIMPLIFIED:
        return True
    # 僅檢測漢字字元
    if not ('\u4e00' <= char <= '\u9fff'):
        return False
    # 如果無法以 cp950 (繁體/Big5) 編碼，說明是簡體字
    try:
        char.encode('cp950')
        return False
    except UnicodeEncodeError:
        return True

# 2. 編輯草稿與編輯痕跡檢測
DRAFT_PATTERNS = [
    r"不，是",
    r"，不，",
    r"，不對，",
    r"，或者說",
    r"不，我",
    r"不，他",
    r"不，她"
]

# 3. 外文殘留檢測
FOREIGN_PATTERNS = [
    r"\bof\b",
    r"\band\b",
    r"\bbut\b",
    r"\bif\b",
    r"\bhis\b",
    r"\bher\b",
    r"\bthey\b",
    r"の"
]

# 4. LaTeX 轉義錯誤與異常字元檢測
LATEX_PATTERNS = [
    r"\t+imes",
    r"\x0c+rac",
    r"\x0c",
    r"\t"
]

# 5. 現代詞彙與術語檢測列表（包含 fix_chapters_v2.py 中所有已被替換的關鍵字，用於覆核是否清乾淨）
MODERN_NOUNS = [
    " his ", "his 眉頭", "his 臉色", "his 腳步", " and ", "和那個丫頭", 
    "不，是如同一道", "不，是如同一尊", "強大風壓氣壓", "瞬間風壓氣壓", 
    "瞬間風壓大氣壓強", "風壓氣壓", "風壓壓強", "百分之十", "百分之二秒", 
    "百分之一秒", "百分之一個呼吸", "萬分之一秒", "千分之五個呼吸",
    "新陳代謝", "毛細血管", "神經質", "痛覺神經", "右臂神經", "頸椎神經", 
    "神經叢", "神經與肌肉", "麻痺神經", "生理性", "生理的", "生理縫隙", 
    "生理知覺", "生理細微", "生理本能", "生理結構", "生理折磨", "生理劇痛", 
    "生理極限", "生理常理", "反射弧", "腔血", "坐標", "座標", "坐標系", 
    "座標系", "落點坐標", "地標坐標", "地圖坐標", "平面坐標", "精確坐標", 
    "坐標定數", "幾何坐標", "三維空間坐標", "坐標點", "坐標矩陣", "力學", 
    "幾何學", "物理", "代償", "真空", "大氣壓", "壓強", "氣壓", "薄膜", 
    "分子", "原子", "細胞", "基因", "荷爾蒙", "共振", "方程式", "算式", 
    "密碼系統", "暗道系統", "系統性", "數據", "比例", "百分之", "萜烯類",
    "好嘞", "嗞嗞", "咴兒兒兒", "咴咴", "咔嚓", "咔", "噼啪", "噼里啪啦", 
    "哐當", "哐", "嘭", "嗬嗬", "擀麵杖", "吸力氣旋"
]

# 排除列表：有些詞彙在特定語境下是合法的（例如數學「分子」與「分母」，「准許」等）
def is_false_positive(noun, line_str):
    if noun == "分子" and ("分母" in line_str or "分子為" in line_str or "分子得" in line_str):
        return True
    if noun == "系統" and ("系統性" not in line_str and "體系" in line_str):
        return True
    return False

def scan_file(filepath):
    filename = os.path.basename(filepath)
    issues = []
    
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    for idx, line in enumerate(lines, 1):
        line_str = line.strip()
        if not line_str:
            continue
            
        # 1. 檢測簡體字
        found_simplified = []
        for char in line_str:
            if is_simplified_char(char):
                # 排除「准許」中的「准」
                if char == '准' and '准許' in line_str:
                    continue
                found_simplified.append(char)
        if found_simplified:
            # 排除「癯」、「絝」、「擀」、「礴」等雖然非cp950但屬繁體字或古雅用字的漢字
            filtered_simplified = [c for c in found_simplified if c not in ['癯', '絝', '擀', '礴']]
            if filtered_simplified:
                issues.append({
                    "type": "簡體/俗體字",
                    "line": idx,
                    "detail": f"發現簡體字: {list(set(filtered_simplified))}",
                    "context": line_str
                })
            
        # 2. 檢測編輯草稿
        for pattern in DRAFT_PATTERNS:
            if re.search(pattern, line_str):
                # 排除正常對話「不，他/她/們...」
                if pattern in ["不，他", "不，她", "不，我"] and ("「不，" in line_str or "『不，" in line_str):
                    continue
                issues.append({
                    "type": "編輯草稿",
                    "line": idx,
                    "detail": f"匹配到編輯草稿模式: '{pattern}'",
                    "context": line_str
                })
                
        # 3. 檢測外文殘留
        for pattern in FOREIGN_PATTERNS:
            if re.search(pattern, line_str, re.IGNORECASE):
                issues.append({
                    "type": "外文殘留",
                    "line": idx,
                    "detail": f"匹配到外文殘留模式: '{pattern}'",
                    "context": line_str
                })
                
        # 4. 檢測 LaTeX 轉義錯誤
        for pattern in LATEX_PATTERNS:
            if re.search(pattern, line_str):
                # markdown 文件中的 \t 通常在代碼塊外是異常的
                issues.append({
                    "type": "LaTeX轉義錯誤/異常字元",
                    "line": idx,
                    "detail": f"匹配到異常字元模式: repr({pattern})",
                    "context": repr(line_str)
                })
                
        # 5. 檢測現代名詞
        found_nouns = []
        for noun in MODERN_NOUNS:
            if noun in line_str:
                if not is_false_positive(noun, line_str):
                    found_nouns.append(noun)
        if found_nouns:
            # 安全過濾：比如「神經」在「神經質」中重複匹配等
            unique_nouns = list(set(found_nouns))
            issues.append({
                "type": "疑似現代名詞",
                "line": idx,
                "detail": f"發現現代詞彙: {unique_nouns}",
                "context": line_str
            })
            
    return issues

def main():
    print("開始掃描《聽雨風雲錄》正文...")
    all_issues = {}
    
    files = [f for f in os.listdir(NOVEL_DIR) if f.endswith(".md") and f != "README.md"]
    def extract_chapter_num(filename):
        match = re.search(r"第(\d+)章", filename)
        return int(match.group(1)) if match else 999
    files.sort(key=extract_chapter_num)
    
    total_issues = 0
    for filename in files:
        filepath = os.path.join(NOVEL_DIR, filename)
        issues = scan_file(filepath)
        if issues:
            all_issues[filename] = issues
            total_issues += len(issues)
            print(f"[{filename}] 發現 {len(issues)} 處疑似問題。")
            
    # 輸出報告
    report_path = r"e:\codes\novels\1\scratch\scan_report_v3.txt"
    with open(report_path, "w", encoding="utf-8") as rf:
        rf.write(f"=== 《聽雨風雲錄》正文自動掃描報告 V3 ===\n")
        rf.write(f"總共掃描章節: {len(files)} 章\n")
        rf.write(f"發現疑似問題總數: {total_issues} 處\n\n")
        
        for filename, issues in all_issues.items():
            rf.write(f"=========================================\n")
            rf.write(f"章節: {filename}\n")
            rf.write(f"=========================================\n")
            for issue in issues:
                rf.write(f"行號: {issue['line']} | 類型: {issue['type']} | 詳情: {issue['detail']}\n")
                rf.write(f"原文: {issue['context']}\n")
                rf.write(f"-----------------------------------------\n")
            rf.write("\n")
            
    print(f"掃描完成！詳細結果已寫入: {report_path}")

if __name__ == "__main__":
    main()
