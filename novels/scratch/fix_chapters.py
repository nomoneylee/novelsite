import os
import re

# 定義要處理的目錄
novel_dir = r"e:\codes\novels\1\novel\聽雨風雲錄\正文"

# 特定的簡體字替換字典
replacements = {
    "着": "著",
    "脸": "臉",
    "显": "顯",
    "攒": "攢",
    "狭": "狹",
    "时": "時",
    "narrow / 狭": "狹",
}

# 遍歷所有章節檔案
modified_files = []

for filename in os.listdir(novel_dir):
    if not filename.endswith(".md") or filename == "README.md":
        continue
        
    filepath = os.path.join(novel_dir, filename)
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
        
    original_content = content
    
    # 1. 替換俗體字與簡體字
    for old, new in replacements.items():
        content = content.replace(old, new)
        
    # 2. 修正 LaTeX 轉義錯誤
    # \t + imes 替換為 \times
    content = re.sub(r"\t+imes", r"\\times", content)
    # \x0c (換頁符) + rac 替換為 \frac
    content = re.sub(r"\x0crac", r"\\frac", content)
    
    # 3. 修正第 31 章的草稿與日文字元殘留
    if filename == "第31章_拋物線下雷霆火.md":
        bad_draft = "在重力錘の物理拉扯下猛烈地一甩，不，是重力錘的物理拉扯下猛烈地一甩"
        good_draft = "在重力錘的物理拉扯下猛烈地一甩"
        if bad_draft in content:
            content = content.replace(bad_draft, good_draft)
            print("已修正第 31 章 L147 的草稿殘留")
            
    # 4. 修正第 33 章的草稿與英文單詞殘留
    if filename == "第33章_雪夜暗道伏奇兵.md":
        content = content.replace("陸大石坐在城牆內側 of 石階上，不，是坐在城防石階上", "陸大石坐在城防石階上")
        content = content.replace("老兵 and 死士，不，是來自大乾各地的老兵與死士", "來自大乾各地的老兵與死士")
        
    # 5. 修正第 34 章的草稿與英文殘留
    if filename == "第34章_萬軍之中梟狼首.md":
        content = content.replace("木質棚頂 of 飛鴉，不，是木質棚頂的飛鴉", "木質棚頂的飛鴉")
        
    # 6. 修正第 36 章的草稿殘留
    if filename == "第36章_冰封鐵甲斬國賊.md":
        content = content.replace("「察覺不到陸乾雄脖頸處這微不足不足道，不，是微不足道的變化」", "「察覺不到陸乾雄脖頸處這微不足道的變化」")
        content = content.replace("「卻如同尊，不，是如下一尊不可戰勝的修羅神像。」", "「卻如同一尊不可戰勝的修羅神像。」")
        content = content.replace("「滿臉都是焦記，不，是滿臉都是焦急與擔憂；林鐵衣則手按長劍，神神，不，是神色冷峻。」", "「滿臉都是焦急與擔憂；林鐵衣則手按長劍，神色冷峻。」")
        
    # 7. 修正第 20 章和第 25, 26 章的英文單詞殘留
    if filename == "第20章_天羅地網設相府.md":
        content = content.replace("那 and ...", "那...")
    if filename == "第25章_北風捲地白草折.md":
        content = content.replace(" his 喉頭劇烈蠕動了幾下", " 他的喉頭劇烈蠕動了幾下")
    if filename == "第26章_流民遍野哭聲哀.md":
        content = content.replace("but if his 刀能為這些", "但如果他的刀能為這些")
        content = content.replace("但如果 his 刀能為這些", "但如果他的刀能為這些")

    if content != original_content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        modified_files.append(filename)

print(f"修復完成！共修改了 {len(modified_files)} 個章節。")
print("修改章節列表:", modified_files)
