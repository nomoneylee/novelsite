import sys
import re

def check_chapter(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()

    cjk = re.findall(r'[\u4e00-\u9fff]', text)
    dialogues = re.findall(r'「[^」]*」', text)
    cjk_dialogue = sum(len(re.findall(r'[\u4e00-\u9fff]', d)) for d in dialogues)
    ratio = (cjk_dialogue / len(cjk)) * 100 if cjk else 0

    print(f"File: {file_path}")
    print(f"CJK Words: {len(cjk)}")
    print(f"CJK Dialogue Words: {cjk_dialogue}")
    print(f"Dialogue Ratio: {ratio:.2f}%")

    forbidden = [
        '不由自主', '一絲', '嘴角勾起', '深吸一口氣', '夜色漸濃',
        '煙火氣', '萬家燈火', '老街的風', '悄然', '守護',
        '心中湧起', '說不出的滋味', '眼中閃過', '握緊拳頭', '嘴角微揚',
        '晨霧散去', '帶走了', '帶來了', '流淌'
    ]

    found_forbidden = []
    for f_word in forbidden:
        count = len(re.findall(re.escape(f_word), text))
        if count > 0:
            found_forbidden.append((f_word, count))

    if found_forbidden:
        print("Forbidden Words Found:")
        for w, c in found_forbidden:
            print(f"  - {w}: {c}")
    else:
        print("Forbidden Words: None found!")

    # Check last 5 lines for anti-patterns
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    last_5 = lines[-5:] if len(lines) >= 5 else lines
    print("\nLast Lines for Deletion Test:")
    for l in last_5:
        print(f"  {l}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        check_chapter(sys.argv[1])
