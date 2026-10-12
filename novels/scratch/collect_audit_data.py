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

audit_data = {
    "dean": [],
    "simplified": [],
    "vocabulary": [],
    "names_and_roles": [],
    "file_size": [],
    "timeline_and_logic": []
}

# 1. Check Simplified characters
for filepath in md_files:
    fname = os.path.basename(filepath)
    chap_num = get_chap_num(filepath)
    fsize = os.path.getsize(filepath)
    
    # File size
    if fsize < 6500:
        audit_data["file_size"].append({
            "chapter": chap_num,
            "file": fname,
            "size": fsize,
            "type": "字數偏少",
            "desc": f"單章檔案大小為 {fsize} bytes，低於 plan.md 規範之 6,500 bytes 門檻。"
        })
    elif fsize > 12000:
        audit_data["file_size"].append({
            "chapter": chap_num,
            "file": fname,
            "size": fsize,
            "type": "字數偏多",
            "desc": f"單章檔案大小為 {fsize} bytes，超出 plan.md 規範之 12,000 bytes 上限。"
        })

    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    for lno, line in enumerate(lines, 1):
        # Dean checks
        if "院長媽媽" in line:
            audit_data["dean"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "error_type": "稱謂性別錯誤（院長媽媽）",
                "quote": line.strip(),
                "suggestion": "現任陳院長為陳明輝（老先生/男性），此處誤稱為女性稱謂「院長媽媽」，應統一修正為「陳院長 / 院長爺爺 / 阿公」。"
            })
        if "院長爸爸" in line:
            audit_data["dean"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "error_type": "稱謂變體突變（院長爸爸）",
                "quote": line.strip(),
                "suggestion": "全書常態稱呼為「陳院長 / 院長爺爺 / 阿公」，第 245、246 章突然變體為「院長爸爸」，建議統一為全書一致的稱呼習慣。"
            })
        if "陳院長的七十壽辰" in fname and lno == 1:
            audit_data["dean"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "error_type": "年齡設定衝突（七十壽辰）",
                "quote": line.strip(),
                "suggestion": "characters.md 人物檔案設定陳院長現年 65 歲，第 246 章章名與正文描述為「七十大壽 / 七十壽辰」，存在 5 歲年齡衝突，建議統一修正設定或章節年齡表述。"
            })
            
        # Simplified Chinese Characters
        if "着" in line:
            audit_data["simplified"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "char": "着 -> 著",
                "quote": line.strip()
            })
        if "质" in line:
            audit_data["simplified"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "char": "质 -> 質",
                "quote": line.strip()
            })
        if "声" in line:
            audit_data["simplified"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "char": "声 -> 聲",
                "quote": line.strip()
            })
        if "花里胡哨" in line:
            audit_data["simplified"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "char": "花里胡哨 -> 花裡胡哨/花俏",
                "quote": line.strip()
            })
        if "憂思入里" in line:
            audit_data["simplified"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "char": "憂思入里 -> 憂思入裏/憂思入裡",
                "quote": line.strip()
            })
            
        # Vocabulary issues
        if "大媽" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "大媽",
                "suggestion": "建議改為台灣在地用語「阿姨 / 大嬸 / 歐巴桑 / 媽媽們」",
                "quote": line.strip()
            })
        if "屏幕" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "屏幕",
                "suggestion": "建議改為台灣在地用語「螢幕」",
                "quote": line.strip()
            })
        if "打印" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "打印",
                "suggestion": "建議改為台灣在地用語「列印」",
                "quote": line.strip()
            })
        if "幼兒園" in line and ("育幼院" in line or "小弟妹" in line or "弟妹" in line):
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "幼兒園（混淆育幼院）",
                "suggestion": "此處應指「育幼院」，誤寫為「幼兒園」",
                "quote": line.strip()
            })
        if "方便麵" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "方便麵",
                "suggestion": "建議改為台灣在地用語「泡麵」",
                "quote": line.strip()
            })
        if "出租車" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "出租車",
                "suggestion": "建議改為台灣在地用語「計程車」",
                "quote": line.strip()
            })
        if "立馬" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "立馬",
                "suggestion": "建議改為「立刻 / 馬上」",
                "quote": line.strip()
            })
        if "忽悠" in line:
            audit_data["vocabulary"].append({
                "chapter": chap_num,
                "file": fname,
                "line": lno,
                "term": "忽悠",
                "suggestion": "建議改為「唬弄 / 矇騙 / 瞎扯」",
                "quote": line.strip()
            })

print("Summary of Issues Collected:")
print(f"- 院長相關稱謂與設定矛盾: {len(audit_data['dean'])} 處")
print(f"- 簡體字與用字偏差: {len(audit_data['simplified'])} 處")
print(f"- 大陸用語與語境偏差: {len(audit_data['vocabulary'])} 處")
print(f"- 檔案大小不符合規範: {len(audit_data['file_size'])} 章")
