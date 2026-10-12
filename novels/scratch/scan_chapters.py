import os
import re

# 正文目錄
NOVEL_DIR = r"e:\codes\novels\1\novel\聽雨風雲錄\正文"

# 這些是在 cp950 中存在，但在繁體小說中應使用對應繁體字的俗體/簡體字
SPECIAL_SIMPLIFIED = {
    '着',  # 應為 著
    '并',  # 應為 並/併
    '于',  # 應為 於
    '准',  # 應為 準
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

# 3. 外文介詞與殘留檢測
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

# 4. LaTeX 轉義錯誤檢測
LATEX_PATTERNS = [
    r"\t+imes",
    r"\x0c+rac",
    r"\x0c", # 換頁符
    r"\t"    # 製表符（有時也是 LaTeX 的 \t 轉義錯誤）
]

# 5. 現代名詞與術語檢測列表
MODERN_NOUNS = [
    "物理", "動脈", "靜脈", "毛細血管", "神經", "生理", "重力加速度", 
    "熱力學", "比表面積", "布朗運動", "氣流壓縮", "分子", "原子", 
    "細胞", "基因", "新陳代謝", "荷爾蒙", "反射弧", "腔血", 
    "神經叢", "防潮薄膜", "真空", "共振", "大氣壓", "氣壓", 
    "力學", "慣性", "加速度", "函數", "坐標", "方程式", "代償", 
    "系統", "數據", "比例", "百分之"
]

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
                found_simplified.append(char)
        if found_simplified:
            issues.append({
                "type": "簡體/俗體字",
                "line": idx,
                "detail": f"發現簡體字: {list(set(found_simplified))}",
                "context": line_str
            })
            
        # 2. 檢測編輯草稿
        for pattern in DRAFT_PATTERNS:
            if re.search(pattern, line_str):
                issues.append({
                    "type": "編輯草稿",
                    "line": idx,
                    "detail": f"匹配到編輯草稿模式: '{pattern}'",
                    "context": line_str
                })
                
        # 3. 檢測外文介詞
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
                # 排除合法的 \t（如縮進），但在 markdown 小說中很少使用 \t 縮進
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
                found_nouns.append(noun)
        if found_nouns:
            issues.append({
                "type": "疑似現代名詞",
                "line": idx,
                "detail": f"發現現代詞彙: {found_nouns}",
                "context": line_str
            })
            
    return issues

def main():
    print("開始掃描《聽雨風雲錄》正文...")
    all_issues = {}
    
    # 獲取所有章節檔案
    files = [f for f in os.listdir(NOVEL_DIR) if f.endswith(".md") and f != "README.md"]
    # 按照章節順序排序
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
    report_path = r"e:\codes\novels\1\scratch\scan_report.txt"
    with open(report_path, "w", encoding="utf-8") as rf:
        rf.write(f"=== 《聽雨風雲錄》正文自動掃描報告 ===\n")
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
