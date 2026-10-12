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

# Dictionaries for collecting all issues
dean_errors = []
char_errors = []
simp_errors = []
vocab_errors = []
length_errors = []
logic_errors = []

# Exact list of simplified characters that might appear
pure_simp_chars = {
    '质': '質', '声': '聲', '着': '著', '们': '們', '这': '這', '为': '為', '经': '經', '医': '醫',
    '处': '處', '药': '藥', '实': '實', '规': '規', '体': '體', '见': '見', '发': '發', '时': '時',
    '会': '會', '动': '動', '关': '關', '现': '現', '对': '對', '当': '當', '点': '點', '开': '開',
    '业': '業', '样': '樣', '问': '問', '进': '進', '运': '運', '门': '門', '应': '應', '种': '種',
    '长': '長', '产': '產', '统': '統', '气': '氣', '机': '機', '题': '題', '华': '華', '学': '學',
    '总': '總', '线': '線', '变': '變', '节': '節', '识': '識', '联': '聯', '转': '轉', '头': '頭',
    '选': '選', '设': '設', '认': '認', '观': '觀', '权': '權', '结': '結', '带': '帶', '导': '導',
    '报': '報', '争': '爭', '领': '領', '历': '歷', '区': '區', '压': '壓', '别': '別', '济': '濟',
    '传': '傳', '写': '寫', '团': '團', '极': '極', '际': '際', '计': '計', '细': '細', '资': '資',
    '说': '說', '话': '話', '让': '讓', '给': '給', '过': '過', '两': '兩', '并': '並', '从': '從',
    '无': '無', '还': '還', '数': '數', '亿': '億', '儿': '兒', '车': '車', '鸟': '鳥', '鱼': '魚',
    '龙': '龍', '飞': '飛', '书': '書', '画': '畫', '乐': '樂', '东': '東', '绿': '綠', '蓝': '藍',
    '双': '雙', '刘': '劉', '杨': '楊', '赵': '趙', '吴': '吳', '孙': '孫', '朱': '朱', '胡': '胡',
    '郭': '郭', '罗': '羅', '郑': '鄭', '梁': '梁', '谢': '謝', '许': '許', '邓': '鄧', '冯': '馮',
    '韩': '韓', '曹': '曹', '曾': '曾', '彭': '彭', '萧': '蕭', '潘': '潘', '蒋': '蔣', '苏': '蘇',
    '卢': '盧', '姜': '姜', '崔': '崔', '钟': '鍾', '谭': '譚', '陆': '陸', '汪': '汪', '范': '範',
    '贾': '賈', '韦': '韋', '傅': '傅', '邹': '鄒', '孟': '孟', '熊': '熊', '秦': '秦', '邱': '邱',
    '尹': '尹', '薛': '薛', '闫': '閆', '段': '段', '雷': '雷', '侯': '侯', '陶': '陶', '黎': '黎',
    '贺': '賀', '顾': '顧', '毛': '毛', '郝': '郝', '龚': '龔', '邵': '邵', '钱': '錢', '严': '嚴',
    '赖': '賴', '覃': '覃', '洪': '洪', '武': '武', '莫': '莫', '孔': '孔', '汤': '湯', '戴': '戴',
    '殷': '殷', '欧': '歐', '庞': '龐', '樊': '樊', '兰': '蘭', '聂': '聶', '庄': '莊', '项': '項',
    '查': '查', '简': '簡', '盛': '盛', '盖': '蓋', '桑': '桑', '晋': '晉', '席': '席', '麻': '麻',
    '强': '強', '路': '路', '娄': '婁', '危': '危', '童': '童', '颜': '顏', '梅': '梅', '刁': '刁',
    '骆': '駱', '霍': '霍', '虞': '虞', '管': '管', '房': '房', '裘': '裘', '缪': '繆', '宗': '宗',
    '宣': '宣', '贲': '賁', '郁': '郁', '诸': '諸', '钮': '鈕', '嵇': '嵇', '邢': '邢', '滑': '滑',
    '裴': '裴', '荣': '榮', '翁': '翁', '荀': '荀', '羊': '羊', '甄': '甄', '封': '封', '芮': '芮',
    '羿': '羿', '储': '儲', '靳': '靳', '松': '松', '乌': '烏', '焦': '焦', '巴': '巴', '牧': '牧',
    '全': '全', '郗': '郗', '班': '班', '仰': '仰', '秋': '秋', '仲': '仲', '伊': '伊', '宫': '宮',
    '宁': '寧', '仇': '仇', '栾': '欒', '暴': '暴', '甘': '甘', '钭': '鈄', '厉': '厲', '戎': '戎',
    '祖': '祖', '符': '符', '景': '景', '詹': '詹', '束': '束', '韶': '韶', '郜': '郜', '蓟': '薊',
    '薄': '薄', '印': '印', '宿': '宿', '怀': '懷', '蒲': '蒲', '邰': '邰', '鄂': '鄂', '索': '索',
    '咸': '咸', '籍': '籍', '卓': '卓', '蔺': '藺', '屠': '屠', '蒙': '蒙', '池': '池', '乔': '喬',
    '阴': '陰', '胥': '胥', '苍': '蒼', '闻': '聞', '莘': '莘', '党': '黨', '翟': '翟', '贡': '貢',
    '劳': '勞', '逄': '逄', '姬': '姬', '申': '申', '扶': '扶', '堵': '堵', '冉': '冉', '宰': '宰',
    '郦': '酈', '雍': '雍', '郤': '郤', '璩': '璩', '桂': '桂', '濮': '濮', '寿': '壽', '通': '通',
    '边': '邊', '扈': '扈', '燕': '燕', '冀': '冀', '郏': '郟', '浦': '浦', '尚': '尚', '农': '農',
    '温': '溫', '晏': '晏', '柴': '柴', '瞿': '瞿', '阎': '閻', '充': '充', '慕': '慕', '连': '連',
    '茹': '茹', '习': '習', '宦': '宦', '艾': '艾', '容': '容', '易': '易', '慎': '慎', '戈': '戈',
    '庾': '庾', '终': '終', '暨': '暨', '居': '居', '衡': '衡', '耿': '耿', '满': '滿', '弘': '弘',
    '匡': '匡', '寇': '寇', '广': '廣', '禄': '祿', '阙': '闕', '殳': '殳', '沃': '沃', '蔚': '蔚',
    '越': '越', '夔': '夔', '隆': '隆', '巩': '鞏', '厍': '厙', '晁': '晁', '勾': '勾', '敖': '敖',
    '融': '融', '訾': '訾', '辛': '辛', '阚': '闞', '饶': '饒', '毋': '毋', '沙': '沙', '乜': '乜',
    '养': '養', '鞠': '鞠', '须': '須', '丰': '豐', '巢': '巢', '蒯': '蒯', '荆': '荊', '竺': '竺',
    '逯': '逯', '益': '益', '桓': '桓', '态': '態', '绝': '絕', '虽': '雖', '岁': '歲', '怜': '憐',
    '悯': '憫', '惨': '慘', '惭': '慚', '愧': '愧', '愤': '憤', '忧': '憂', '虑': '慮', '伤': '傷',
    '劳': '勞', '累': '累', '困': '困', '险': '險', '恶': '惡', '贫': '貧', '穷': '窮', '贵': '貴',
    '简': '簡', '杂': '雜', '迟': '遲', '钝': '鈍', '敏': '敏', '捷': '捷', '优': '優', '卑': '卑',
    '鄙': '鄙', '聪': '聰', '愚': '愚', '蠢': '蠢', '勇': '勇', '懦': '懦', '坚': '堅', '脆': '脆',
    '软': '軟', '刚': '剛', '严': '嚴', '肃': '肅', '泼': '潑', '朗': '朗', '热': '熱', '漠': '漠',
    '亲': '親', '切': '切', '疏': '疏', '远': '遠', '真': '真', '诚': '誠', '虚': '虛', '伪': '偽',
    '狡': '狡', '猾': '猾', '谦': '謙', '骄': '驕', '傲': '傲', '谨': '謹', '马': '馬', '虎': '虎'
}

# Mainland words to flag
mainland_words = [
    ("大媽", "阿姨 / 大嬸 / 歐巴桑"),
    ("屏幕", "螢幕"),
    ("打印", "列印"),
    ("幼兒園", "育幼院 / 幼稚園"),
    ("方便麵", "泡麵"),
    ("出租車", "計程車"),
    ("立馬", "立刻 / 馬上"),
    ("忽悠", "唬弄 / 矇騙"),
    ("花里胡哨", "花俏 / 華而不實"),
    ("特徵", "特徵"),
    ("網絡", "網路"),
    ("信息", "資訊 / 訊息"),
    ("軟件", "軟體"),
    ("項目", "專案")
]

for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    fsize = os.path.getsize(filepath)
    
    # File size check
    if fsize < 6500:
        length_errors.append((chap_num, fname, fsize, f"篇幅過短（{fsize} bytes < 6,500 bytes 目標規範）"))
    elif fsize > 12000:
        length_errors.append((chap_num, fname, fsize, f"篇幅偏長（{fsize} bytes > 12,000 bytes 目標規範）"))
        
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    for lno, line in enumerate(lines, 1):
        # 1. Dean checks
        if "院長媽媽" in line:
            dean_errors.append((chap_num, fname, lno, "稱呼錯誤【院長媽媽】（現任院長為陳明輝老先生，非女性）", line.strip()))
        if "院長爸爸" in line:
            dean_errors.append((chap_num, fname, lno, "稱呼變體【院長爸爸】（與全書通稱『陳院長 / 院長爺爺 / 阿公』不一致）", line.strip()))
        if "陳院長媽媽" in line:
            dean_errors.append((chap_num, fname, lno, "稱呼嚴重矛盾【陳院長媽媽】", line.strip()))
        if "七十壽辰" in fname or ("七十大壽" in line and "院長" in line):
            dean_errors.append((chap_num, fname, lno, "年齡設定衝突（characters.md 設定陳院長 65 歲，正文稱七十大壽）", line.strip()))
            
        # 2. Simplified Chinese
        for char, trad in pure_simp_chars.items():
            if char in line:
                # Check if it is a false match (e.g. trad characters that share codepoint)
                # '着' vs '著'
                if char == '着':
                    simp_errors.append((chap_num, fname, lno, f"簡體字【{char}】應為【{trad}】", line.strip()))
                elif char in ['质', '声']:
                    simp_errors.append((chap_num, fname, lno, f"簡體字【{char}】應為【{trad}】", line.strip()))
                    
        # Check '里' in non-standard context
        if "花里胡哨" in line:
            simp_errors.append((chap_num, fname, lno, "簡體字詞【花里胡哨】應為【花裡胡哨 / 花俏】", line.strip()))
        if "憂思入里" in line:
            simp_errors.append((chap_num, fname, lno, "簡體字詞【憂思入里】應為【憂思入裏 / 憂思入裡】", line.strip()))
            
        # 3. Mainland words
        for m_word, s_sugg in mainland_words:
            if m_word in line:
                if m_word == "大媽":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【大媽】建議改為【{s_sugg}】", line.strip()))
                elif m_word == "屏幕":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【屏幕】建議改為【{s_sugg}】", line.strip()))
                elif m_word == "打印":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【打印】建議改為【{s_sugg}】", line.strip()))
                elif m_word == "幼兒園" and "育幼院" in fname or ("育幼院" in line and "幼兒園" in line):
                    vocab_errors.append((chap_num, fname, lno, f"名詞混淆【幼兒園】（育幼院非幼兒園）", line.strip()))
                elif m_word == "立馬":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【立馬】建議改為【{s_sugg}】", line.strip()))
                elif m_word == "方便麵":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【方便麵】建議改為【{s_sugg}】", line.strip()))
                elif m_word == "出租車":
                    vocab_errors.append((chap_num, fname, lno, f"大陸用語【出租車】建議改為【{s_sugg}】", line.strip()))

print("=== AUDIT RESULTS COUNT ===")
print(f"Dean Errors: {len(dean_errors)}")
print(f"Simplified Chinese Errors: {len(simp_errors)}")
print(f"Mainland Vocab Errors: {len(vocab_errors)}")
print(f"Length/Size Violations: {len(length_errors)}")
