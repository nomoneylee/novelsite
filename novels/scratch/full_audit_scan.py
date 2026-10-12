import os
import re
import sys
import glob

sys.stdout.reconfigure(encoding='utf-8')

prose_dir = r"e:\codes\創作小說\novels\novels\novel\社區醫館\正文"
md_files = [f for f in glob.glob(os.path.join(prose_dir, "*.md")) if not f.endswith("README.md")]

def get_chap_num(filename):
    match = re.search(r'第(\d+)章', os.path.basename(filename))
    return int(match.group(1)) if match else 9999

md_files.sort(key=get_chap_num)

# Build Comprehensive Audit Data
audit_report = {
    "dean_issues": [],
    "character_name_typos": [],
    "age_school_inconsistencies": [],
    "mainland_terms": [],
    "simplified_chars": [],
    "file_size_issues": [],
    "heading_formatting_issues": [],
    "logic_plot_issues": []
}

# Simplified Chinese characters detector set (standard common simplified Hanzi)
# Let's define known simplified characters
simp_chars_str = "们这为经医处药实规体见发时会动关现对当点开业样问进运门应种长产统气机题华学总线变声节识联转头选设认观权结带导报争领历区压别济传写团极际计细资说话让给过两并从无还几数亿儿车马鸟鱼龙飞书画乐东红绿蓝单双张刘杨赵吴孙朱胡郭罗郑梁谢许邓冯韩曹曾彭萧潘蒋苏卢姜崔钟谭陆汪范贾韦傅邹孟熊秦邱尹薛闫段雷侯陶黎贺顾毛郝龚邵钱严赖覃洪武莫孔汤戴殷欧庞樊兰聂庄项查简盛盖桑晋席麻强路娄危童颜梅刁骆霍虞管房裘缪宗宣贲郁诸钮嵇邢滑裴荣翁荀羊於甄封芮羿储靳松乌焦巴牧全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖符景詹束韶郜蓟薄印宿怀蒲邰鄂索咸籍卓蔺屠蒙池乔阴胥苍闻莘党翟贡劳逄姬申扶堵冉宰郦雍郤璩桂濮寿通边扈燕冀郏浦尚农温晏柴瞿阎充慕连茹习宦艾容易慎戈庾终暨居衡耿满弘匡寇广禄阙殳沃蔚越夔隆巩厍晁勾敖融訾辛阚饶毋沙乜养鞠须丰巢蒯荆竺逯益桓紧态质绝虽岁爱怜悯惨惭愧愤忧虑伤痛劳累困险恶劣贫穷富贵简单复杂轻松沉重迟钝敏捷优秀卑鄙聪明愚蠢勇敢懦弱坚强脆弱软弱刚强严肃活泼朗内向热冷漠亲切疏远真诚虚伪老狡猾谦骄傲谨马虎"
simp_set = set(simp_chars_str)

# Mainland terminology mapping to check
mainland_vocab_map = {
    "信息": "資訊 / 訊息",
    "網絡": "網路",
    "軟件": "軟體",
    "項目": "專案",
    "基礎信息": "基本資料",
    "基本信息": "基本資料",
    "幼兒園": "育幼院 / 幼稚園",
    "打印": "列印",
    "屏幕": "螢幕",
    "內存": "記憶體",
    "視頻": "影片 / 視訊",
    "出租車": "計程車",
    "方便麵": "泡麵",
    "盒飯": "便當",
    "衛生所": "醫館 / 衛生所",
    "立馬": "立刻 / 馬上",
    "忽悠": "唬弄 / 矇騙",
    "靠譜": "可靠 / 牢靠",
    "大媽": "大嬸 / 阿姨 / 歐巴桑",
    "大爺": "大伯 / 阿伯 / 老伯",
    "哥們": "哥們兒 / 兄弟",
    "老鐵": "老兄 / 朋友",
    "牛逼": "厲害 / 強大",
    "搞定": "辦妥 / 搞定",
    "特徵": "特徵 (台灣常用特徵/特色)"
}

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    fsize = os.path.getsize(filepath)
    
    # 1. File size check
    if fsize < 6500:
        audit_report["file_size_issues"].append((chap_num, fname, fsize, "低於 6,500 bytes 規範"))
    elif fsize > 12000:
        audit_report["file_size_issues"].append((chap_num, fname, fsize, "高於 12,000 bytes 規範"))
        
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    full_text = "".join(lines)
    
    # 2. Check Simplified Chinese
    found_simp = []
    for lno, line in enumerate(lines, 1):
        for char in line:
            if char in simp_set:
                found_simp.append((lno, char, line.strip()))
    if found_simp:
        for lno, char, snippet in found_simp[:3]: # keep sample
            audit_report["simplified_chars"].append((chap_num, fname, lno, char, snippet))
            
    # 3. Dean checks
    # Check "院長媽媽"
    if "院長媽媽" in full_text:
        matches = re.findall(r'[^。\n]*院長媽媽[^。\n]*', full_text)
        for m in matches:
            audit_report["dean_issues"].append((chap_num, fname, "稱呼錯誤【院長媽媽】", m.strip()))
    # Check "院長爸爸"
    if "院長爸爸" in full_text:
        matches = re.findall(r'[^。\n]*院長爸爸[^。\n]*', full_text)
        for m in matches:
            audit_report["dean_issues"].append((chap_num, fname, "稱呼變體【院長爸爸】", m.strip()))
    # Check "陳院長媽媽"
    if "陳院長媽媽" in full_text:
        matches = re.findall(r'[^。\n]*陳院長媽媽[^。\n]*', full_text)
        for m in matches:
            audit_report["dean_issues"].append((chap_num, fname, "稱呼嚴重矛盾【陳院長媽媽】", m.strip()))
            
    # Check pronouns for 陳院長
    for lno, line in enumerate(lines, 1):
        if ("陳院長" in line or "現任院長" in line or "老院長" in line) and "她" in line:
            # check if 她 refers to Dean
            if re.search(r'(?:陳院長|現任院長|老院長)[^。]*她', line) or re.search(r'她[^。]*(?:陳院長|老院長)', line):
                audit_report["dean_issues"].append((chap_num, fname, f"性別代詞矛盾（使用女性代詞「她」）Line {lno}", line.strip()))
                
    # 4. Character Names Typos / Inconsistencies
    # Check 林品妤
    if "林品玉" in full_text or "林品瑜" in full_text or "林品羽" in full_text:
        audit_report["character_name_typos"].append((chap_num, fname, "林品妤名字錯字"))
    # Check 蔡志豪
    if "蔡志浩" in full_text or "蔡志華" in full_text:
        audit_report["character_name_typos"].append((chap_num, fname, "蔡志豪名字錯字"))
    # Check 許小糖
    if "唐小糖" in full_text or "許糖糖" in full_text:
        audit_report["character_name_typos"].append((chap_num, fname, "許小糖名字錯字"))
        
    # 5. Age & School inconsistencies
    # Check 小糖 age and grade
    # e.g., 小糖 in elementary school vs junior high school
    if "小糖" in full_text:
        age_matches = re.findall(r'許小糖[^。\n]*?(\d+)\s*歲|(\d+)\s*歲[^。\n]*?許小糖', full_text)
        school_matches = re.findall(r'小糖[^。\n]*?(國小|國中|初中|小學)', full_text)
        if age_matches or school_matches:
            # analyze continuity
            pass
            
    # 6. Mainland terms
    for lno, line in enumerate(lines, 1):
        for m_term, t_term in mainland_vocab_map.items():
            if m_term in line:
                # filter out false positives
                if m_term == "信息" and ("訊息" in line or "消息" in line):
                    continue
                if m_term == "項目" and "專案" in line:
                    continue
                audit_report["mainland_terms"].append((chap_num, fname, lno, m_term, t_term, line.strip()))
                
    # 7. Formatting & Headings check
    for lno, line in enumerate(lines, 1):
        if lno > 1 and re.match(r'^\s*#{1,6}\s+', line):
            audit_report["heading_formatting_issues"].append((chap_num, fname, lno, line.strip()))

print("\n=== AUDIT SUMMARY ===")
print(f"1. Dean Issues: {len(audit_report['dean_issues'])}")
for item in audit_report['dean_issues']:
    print(f"   - [第{item[0]}章] {item[2]}: {item[3]}")

print(f"\n2. Simplified Chinese Character instances: {len(audit_report['simplified_chars'])}")
for item in audit_report['simplified_chars'][:10]:
    print(f"   - [第{item[0]}章 L{item[2]}] 簡體字 '{item[3]}': {item[4]}")

print(f"\n3. Mainland Terminology instances: {len(audit_report['mainland_terms'])}")
for item in audit_report['mainland_terms'][:15]:
    print(f"   - [第{item[0]}章 L{item[2]}] '{item[3]}' -> 建議 '{item[4]}': {item[5]}")

print(f"\n4. File Size Anomalies: {len(audit_report['file_size_issues'])}")
for item in audit_report['file_size_issues'][:10]:
    print(f"   - [第{item[0]}章] {item[1]}: {item[2]} bytes ({item[3]})")
