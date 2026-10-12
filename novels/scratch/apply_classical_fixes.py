import os

# 正文目錄
NOVEL_DIR = r"e:\codes\novels\1\novel\聽雨風雲錄\正文"

def apply_fixes():
    print("開始執行古典化名詞與現代物理生理病句修正 (修正版)...")
    
    # 1. 處理第 16 章的複雜替換（股四頭肌、腓腸肌、摩擦係數、薄膜、重力轉換動能）
    ch16_path = os.path.join(NOVEL_DIR, "第16章_影影相隨夜會盟.md")
    if os.path.exists(ch16_path):
        with open(ch16_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        
        # 替換座標
        content = content.replace("秘密地道座標將徹底解開", "秘密地道方位將徹底解開")
        
        # 替換複雜科學段落
        content = content.replace("琉璃瓦表面覆蓋著一層細密的雨水薄膜，使得摩擦係數降到了極低", "琉璃瓦表面覆蓋著一層細密的雨水，使得瓦面極為濕滑")
        content = content.replace("大腿的股四頭肌和小腿的腓腸肌都在以每秒數十次的頻率進行微小的高頻震顫，以便將落地時產生的下墜之重力完全抵消，轉換為平穩向前的動能", "雙腿肌骨都在以極高的頻率微幅震顫，以消解落地之勢，化作平穩前躍之勁")
        
        # 本地手動在 L122 處理時多出的 unicode 錯位位元組，這裡讀取 errors="ignore" 時會被自動修復，並在寫回時保持乾淨的 utf-8
        
        with open(ch16_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 16 章修正完成。")

    # 2. 處理第 17 章
    ch17_path = os.path.join(NOVEL_DIR, "第17章_太師府邸尋密匙.md")
    if os.path.exists(ch17_path):
        with open(ch17_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("便是雁門防線密道的座標與防務圖", "便是雁門防線密道的定位與防務圖")
        with open(ch17_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 17 章修正完成。")

    # 3. 處理第 18 章
    ch18_path = os.path.join(NOVEL_DIR, "第18章_墨玉如意解同餘.md")
    if os.path.exists(ch18_path):
        with open(ch18_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("設計的『千分之一比率尺座標』", "設計的『千分之一大衍局格』")
        with open(ch18_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 18 章修正完成。")

    # 4. 處理第 19 章
    ch19_path = os.path.join(NOVEL_DIR, "第19章_扳指之謎證真兇.md")
    if os.path.exists(ch19_path):
        with open(ch19_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("把防禦圖與暗道座標挖出來", "把防禦圖與暗道方位挖出來")
        with open(ch19_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 19 章修正完成。")

    # 5. 處理第 20 章
    ch20_path = os.path.join(NOVEL_DIR, "第20章_天羅地網設相府.md")
    if os.path.exists(ch20_path):
        with open(ch20_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("林鐵衣都督拿到這座標", "林鐵衣都督拿到這方位")
        content = content.replace("大防務圖的解密座標", "大防務圖的解密方位")
        with open(ch20_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 20 章修正完成。")

    # 6. 處理第 26 章
    ch26_path = os.path.join(NOVEL_DIR, "第26章_流民遍野哭聲哀.md")
    if os.path.exists(ch26_path):
        with open(ch26_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("覆蓋上了一層灰白色的薄膜", "覆蓋上了一層灰白色的翳膜")
        with open(ch26_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 26 章修正完成。")

    # 7. 處理第 31 章
    ch31_path = os.path.join(NOVEL_DIR, "第31章_拋物線下雷霆火.md")
    if os.path.exists(ch31_path):
        with open(ch31_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("被這些幾何學名詞震得", "被這些籌算勾股名詞震得")
        with open(ch31_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 31 章修正完成。")

    # 8. 處理第 32 章
    ch32_path = os.path.join(NOVEL_DIR, "第32章_夜叉檑動鬼神驚.md")
    if os.path.exists(ch32_path):
        with open(ch32_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("在強大壓強的作用下", "在強大風壓的作用下")
        content = content.replace("地下水脈的壓強改變", "地下水脈的重壓改變")
        with open(ch32_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 32 章修正完成。")

    # 9. 處理第 33 章
    ch33_path = os.path.join(NOVEL_DIR, "第33章_雪夜暗道伏奇兵.md")
    if os.path.exists(ch33_path):
        with open(ch33_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        content = content.replace("but 具體座標一直用", "but 具體位置一直用")
        content = content.replace("但具體座標一直用", "但具體位置一直用")
        content = content.replace("入口的座標與山川起伏的重力力矩相結合", "入口的方位與山川起伏的重力地勢相結合")
        with open(ch33_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("第 33 章修正完成。")

    # 10. 全書替換「算式」為「籌式」、「算草」或「籌算之式」
    calc_files = {
        "第3章_九章算術蘊乾坤.md": [
            ("迅速寫下了幾行算式：", "迅速寫下了幾行籌式："),
            ("這組算式中的餘數", "這組籌式中的餘數"),
            ("這算式在籌算上便有無窮多個解", "這籌式在籌算上便有無窮多個解")
        ],
        "第10章_聽雨軒中雷霆動.md": [
            ("「幾何勾股」算式推演了無數遍", "「幾何勾股」籌式推演了無數遍")
        ],
        "第13章_京華風雨洗塵埃.md": [
            ("畫出一個清晰的算式：「這個算式指明", "畫出一個清晰的籌式：「這個籌式指明")
        ],
        "第20章_天羅地網設相府.md": [
            ("幾何線條與算式在她的思維深處", "幾何線條與籌式在她的思維深處")
        ],
        "第21章_麵粉與炭火之舞.md": [
            ("劃出一道道複雜的算式。", "劃出一道道複雜的籌式。"),
            ("大衍求一術算式：", "大衍求一術籌式：")
        ],
        "第31章_拋物線下雷霆火.md": [
            ("留下一個個大衍算術的算式。", "留下一個個大衍算術的籌式。"),
            ("以餘求整』的數理算式。", "以餘求整』的數理籌式。")
        ],
        "第32章_夜叉檑動鬼神驚.md": [
            ("以餘求整』的算式，", "以餘求整』的籌式，")
        ]
    }

    for fname, replacements in calc_files.items():
        fpath = os.path.join(NOVEL_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for old, new in replacements:
                content = content.replace(old, new)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"{fname} 中的「算式」替換完成。")

    # 11. 處理由於「生理」批量替換為「肉身」所產生的不自然語病
    body_phrases_fixes = {
        "第11章_孤影狂刀戰群魔.md": [
            ("超越了肉體的肉身極限", "超越了肉體的承受極限")
        ],
        "第17章_太師府邸尋密匙.md": [
            ("硬生生將這股肉身本能壓制了下去", "硬生生將這股窒息的本能壓制了下去")
        ],
        "第22章_宴會高潮殺機現.md": [
            ("將所有的肉身劇痛生生壓制", "將所有的劇痛生生壓制")
        ],
        "第23章_黑虎折翼大火燃.md": [
            ("精確籌算與肉身極限融合的殺戮幾何", "精確籌算與殺戮本能融合的極致招數")
        ],
        "第29章_寒水孤城老兵血.md": [
            ("牛筋在低溫下的肉身極限拉力", "牛筋在低溫下的承受極限拉力")
        ],
        "第30章_九章算術布防線.md": [
            ("鑽心剔骨的肉身劇痛", "鑽心剔骨的劇痛"),
            ("推算過礌石拋投的肉身極限", "推算過礌石拋投的最大射程")
        ],
        "第32章_夜叉檑動鬼神驚.md": [
            ("以肉身雙腿在雪地裡", "以一雙肉腿在雪地裡"),
            ("令人牙酸的肉身痛楚", "令人牙酸的劇烈痛楚"),
            ("手腕完全失去了旋轉的肉身靈活性", "手腕完全失去了旋轉的靈活"),
            ("如火燒般的肉身劇痛", "如火燒般的劇痛")
        ],
        "第33章_雪夜暗道伏奇兵.md": [
            ("劇烈肉身灼燒痛感", "劇烈灼燒痛感"),
            ("一陣陣黏稠的肉身抽搐，口中", "一陣陣劇烈的抽搐，口中"),
            ("傷口發炎的肉身氣息", "傷口發炎的血腥氣息"),
            ("普通流民與士兵，用最原始的肉身忍耐", "普通流民與士兵，以血肉之軀硬生生忍耐"),
            ("尖銳的肉身痛楚刺激著", "尖銳的痛楚刺激著"),
            ("讓冰冷的金屬肉身性地刺激著牙齦", "讓鐵釘的冰冷與痛楚刺激著牙齦"),
            ("露出一片發青的肉身底色", "露出一片發青的臉色")
        ],
        "第34章_萬軍之中梟狼首.md": [
            ("灼燒著戰馬的肉身皮肉", "灼燒著戰馬的皮肉"),
            ("骨骼碎裂般的肉身劇痛", "骨骼碎裂般的劇痛"),
            ("產生了極短暫的肉身麻木", "產生了極短暫的麻木"),
            ("肌肉都在肉身性地抽搐", "肌肉都在不由自主地抽搐"),
            ("極度的肉身痛楚在大腦中", "極度的痛楚在大腦中")
        ],
        "第35章_王府機關盈不足.md": [
            ("最原始的肉身反射", "最原始的本能反應"),
            ("在極寒下收縮的劇烈肉身刺痛", "在極寒下收縮 of 劇烈刺痛"), # 備用
            ("在極寒下收縮的劇烈肉身刺痛", "在極寒下收縮的劇烈刺痛"),
            ("一陣劇烈的肉身性抽搐", "一陣劇烈的本能抽搐"),
            ("如冰刀割裂喉嚨般的肉身不適感", "如冰刀割裂喉嚨般的劇痛"),
            ("寒水奇毒在肉身劇痛下", "寒水奇毒在劇痛下")
        ],
        "第36章_冰封鐵甲斬國賊.md": [
            ("帶來針刺般的肉身痛楚", "帶來針刺般的劇烈痛楚"),
            ("引發一陣黏稠的肉身抽搐", "引發一陣劇烈的咳嗽與抽搐"),
            ("如萬針穿心般的肉身劇痛", "如萬針穿心般的劇痛"),
            ("毒素與肉身極限碰撞的悲鳴", "毒素與體魄極限碰撞的悲鳴")
        ],
        "第44章_神鏡反射照佛光.md": [
            ("如火燒般的肉身刺痛", "如火燒般的劇烈刺痛")
        ],
        "第46章_一刀寒芒驚正道.md": [
            ("近乎肉身極限的姿態", "近乎體魄極限的姿態")
        ]
    }

    for fname, replacements in body_phrases_fixes.items():
        fpath = os.path.join(NOVEL_DIR, fname)
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for old, new in replacements:
                content = content.replace(old, new)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"{fname} 中的「生理->肉身」語病替換完成。")

    print("所有古典化修復與語病修正執行完畢。")

if __name__ == "__main__":
    apply_fixes()
