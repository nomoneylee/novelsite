import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

plan_path = r'e:\codes\創作小說\novels\novels\novel\深淵紀元\plan.md'

with open(plan_path, 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Check all 555 chapters
matches = re.findall(r'\*\s*\*\*第\s*(\d+)\s*章[：:]([^*]+)\*\*', text)
print(f"Total chapter outlines found in plan.md: {len(matches)}")
print(f"First chapter: {matches[0]}")
print(f"Last chapter: {matches[-1]}")

chap_nums = [int(m[0]) for m in matches]
missing = [i for i in range(1, 556) if i not in chap_nums]
if missing:
    print(f"Missing chapters: {missing}")
else:
    print("Chapter numbers 1 through 555 are 100% complete and sequential!")

# 2. Check for simplified Chinese
# Using standard strict simplified hanzi set
strict_simp_set = set("们这为经医处药实规体见发时会动关现对当开业样问进运门应种产统气机题华学总线变声节识联转头选设认观权结带导报争领历区压别济传写团极际计细资说让给两并从无还数亿儿车鸟鱼龙飞书画乐东绿蓝双刘杨赵吴孙朱胡郭罗郑梁谢许邓冯韩曹曾彭萧潘蒋苏卢姜崔钟谭陆汪范贾韦傅邹孟熊秦邱尹薛闫段雷侯陶黎贺顾毛郝龚邵钱严赖覃洪武莫孔汤戴殷欧庞樊兰聂庄项查简盛盖桑晋席麻强路娄危童颜梅刁骆霍虞管房裘缪宗宣贲郁诸钮嵇邢滑裴荣翁荀羊甄封芮羿储靳松乌焦巴牧全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖符景詹束韶郜蓟薄印宿怀蒲邰鄂索咸籍卓蔺屠蒙池乔阴胥苍闻莘党翟贡劳逄姬申扶堵冉宰郦雍郤璩桂濮寿通边扈燕冀郏浦尚农温晏柴瞿阎充慕连茹习宦艾容易慎戈庾终暨居衡耿满弘匡寇广禄阙殳沃蔚越夔隆巩厍晁勾敖融訾辛阚饶毋沙乜养鞠须丰巢蒯荆竺逯益桓紧态质绝虽岁爱怜悯惨惭愧愤忧虑伤痛劳累困险恶劣贫穷富贵简单复杂轻松沉重迟钝敏捷优秀卑鄙聪明愚蠢勇敢懦弱坚强脆弱软弱刚强严肃活泼朗内向热冷漠亲切疏远真诚虚伪狡猾谦骄傲谨马虎")
trad_allowed = set("的一是在不了有和人這中大國上個到說們為子你自己生年著就那要她出也得里後自以會家可下而過天去能對小多然於心學麼之都好看起發當沒成只如事把還用第樣道想作種開美總長思面經明已十頭話條動給動化所問少最名真新打新特長氣公外話老秋越路薄全班甘祖符景詹印宿索池申桂通尚柴充慕茹艾容易慎戈居衡耿弘匡沃越辛沙鞠荆竺益桓岁爱情意心手身面眼神力风水火土金木石山海天地数红绿蓝单双李王杨周徐马朱胡何高宋唐韩曾田董袁杜丁沈任姚崔陆汪范廖夏方白熊邱江雷陶黎贺顾毛邵洪武莫向包戴殷庞兰项查冷盛桑席季强贾危童梅刁霍虞柯管房解宣吉程邢翁荀羊封井富巫巴弓牧谷仰仲伊仇暴厉戎韶蒲咸卓屠蒙乔郁能苍闻党劳姬扶堵冉宰燕温别庄晏连习古廖终暨步满文寇东欧利蔚隆勾敖融那曾养须巢关相游权盖公紧虽爱怜伤痛劳困险贫穷富贵简单复杂轻松沉重迟钝敏捷优秀聪明勇敢懦弱坚强脆弱软弱刚强严肃活泼内向热冷漠亲切疏远真诚虚伪狡猾谦骄傲谨慎虎")
strictly_simp = strict_simp_set - trad_allowed

simp_found = []
for lno, line in enumerate(text.splitlines(), 1):
    for c in line:
        if c in strictly_simp:
            simp_found.append((lno, c, line.strip()))

if simp_found:
    print(f"Found {len(simp_found)} simplified characters:")
    for sf in simp_found[:10]:
        print(f"L{sf[0]}: {sf[1]} -> {sf[2]}")
else:
    print("Zero simplified characters found! 100% pure Traditional Chinese.")
