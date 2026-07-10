#!/usr/bin/env python3
"""一次性題庫擴充腳本：把 questions.json 各難度補滿到 TARGET_PER_DIFFICULTY 題。

不需要任何 API key。題目來源：
- 參數化模板（計算、數列、星期推理、記憶、邏輯），以固定亂數種子產生，可重現。
- 人工編寫的內容（成語、常識、相反詞），存於本檔的 curated 資料區。

執行：python seed_questions.py
- 既有 questions.json 的題目全數保留（排最前），新題補到目標數為止。
- 以題目文字（去空白）去重，與 generate_questions.py 的合併規則一致。
- 寫檔前以 generate_questions.validate_questions 驗證，並額外檢查
  每題恰好 4 個不重複選項（對齊前端 js/logic.js 的 isValidQuestion）。
"""

import json
import random
import sys

from generate_questions import (
    DIFFICULTIES,
    OUTPUT_PATH,
    load_existing_bank,
    normalize_question_text,
    validate_questions,
)

TARGET_PER_DIFFICULTY = 300

# 固定種子讓結果可重現。
rng = random.Random(20260612)


def set_rng(r):
    """讓 rebalance_questions.py 等外部腳本注入自己的亂數來源，
    使各腳本的產出各自可重現、互不干擾。"""
    global rng
    rng = r

WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]
CN_POS = ["一", "二", "三", "四", "五", "六", "七"]


def make_q(qtype, text, answer, distractors, unit=""):
    """組出一題：answer 與 distractors 可為 int 或 str，自動加單位。"""
    a = f"{answer}{unit}"
    opts = [a] + [f"{d}{unit}" for d in distractors[:3]]
    if len(set(opts)) != 4:
        raise ValueError(f"選項重複：{text} → {opts}")
    return {"type": qtype, "q": text, "a": a, "opts": opts}


def num_distractors(ans, low=0):
    """為數值答案產生 3 個不重複、不小於 low 的干擾值。"""
    offsets = [1, -1, 2, -2, 10, -10, 5, -5, 3, -3, 4, -4, 20, -20, 6, -6, 8, -8]
    rng.shuffle(offsets)
    out = []
    for o in offsets:
        v = ans + o
        if v != ans and v >= low and v not in out:
            out.append(v)
        if len(out) == 3:
            return out
    raise ValueError(f"無法為 {ans} 產生干擾選項")


def weekday_distractors(ans_idx):
    pool = [WEEKDAYS[i] for i in range(7) if i != ans_idx]
    return [f"星期{d}" for d in rng.sample(pool, 3)]


def weekday_q(qtype, text, ans_idx):
    return make_q(qtype, text, f"星期{WEEKDAYS[ans_idx % 7]}", weekday_distractors(ans_idx % 7))


def memory_questions(pools, k, count, joiner="、"):
    """「記住順序」題：從詞庫抽 k 個不重複項目，問第 n 個是什麼。"""
    out = []
    for _ in range(count):
        pool = rng.choice(pools)
        items = rng.sample(pool, k)
        pos = rng.randrange(1, k + 1)
        ans = items[pos - 1]
        distractors = rng.sample([x for x in items if x != ans], 3)
        text = f"記住順序：{joiner.join(items)}，第{CN_POS[pos - 1]}個是？"
        out.append(make_q("記憶", text, ans, distractors))
    return out


def pick_curated(qtype, rows):
    """curated 資料列：(題目, 正解, [三個干擾選項])。"""
    return [make_q(qtype, q, a, ds) for q, a, ds in rows]


def opposite_questions(pairs, word=False):
    """相反字／相反詞題：干擾選項取自其他題的正解。"""
    answers = [a for _, a in pairs]
    out = []
    for w, a in pairs:
        distractors = rng.sample([x for x in answers if x != a], 3)
        label = "相反詞" if word else "相反字"
        out.append(make_q("語言", f"「{w}」的{label}是？", a, distractors))
    return out


# ── curated 資料 ─────────────────────────────────────────────────────────

MEM_POOLS = [
    ["蘋果", "香蕉", "橘子", "葡萄", "西瓜", "鳳梨", "芒果", "草莓", "梨子", "桃子"],
    ["紅", "藍", "黃", "綠", "紫", "橙", "黑", "白", "粉", "灰"],
    ["狗", "貓", "牛", "羊", "馬", "雞", "鴨", "兔", "豬", "鳥"],
    ["杯子", "雨傘", "眼鏡", "鑰匙", "手錶", "帽子", "毛巾", "椅子", "枕頭", "茶壺"],
    ["3", "7", "1", "9", "5", "2", "8", "4", "6", "0"],
]

OPPOSITE_CHARS = [
    ("高", "低"), ("胖", "瘦"), ("開", "關"), ("早", "晚"), ("新", "舊"),
    ("明", "暗"), ("軟", "硬"), ("輕", "重"), ("粗", "細"), ("遠", "近"),
    ("內", "外"), ("乾", "濕"), ("香", "臭"), ("美", "醜"), ("苦", "甜"),
    ("強", "弱"), ("深", "淺"), ("寬", "窄"), ("買", "賣"), ("進", "退"),
    ("胖", "瘦"), ("動", "靜"),
]

OPPOSITE_WORDS = [
    ("安全", "危險"), ("整齊", "雜亂"), ("勤勞", "懶惰"), ("開始", "結束"),
    ("進步", "退步"), ("成功", "失敗"), ("便宜", "昂貴"), ("安靜", "吵鬧"),
    ("清楚", "模糊"), ("容易", "困難"), ("溫暖", "寒冷"), ("高興", "難過"),
    ("勇敢", "膽小"), ("認真", "馬虎"), ("健康", "生病"), ("乾淨", "骯髒"),
    ("聰明", "愚笨"), ("熱鬧", "冷清"), ("細心", "粗心"), ("節省", "浪費"),
]

SUPER_EASY_FACTS = [
    ("紅綠燈的紅燈代表什麼？", "停下來", ["快快走", "轉彎", "倒車"]),
    ("冬天的天氣通常怎麼樣？", "冷", ["熱", "悶", "暖"]),
    ("太陽下山之後是什麼時候？", "晚上", ["中午", "早上", "下午"]),
    ("我們用耳朵做什麼？", "聽聲音", ["看東西", "聞味道", "吃東西"]),
    ("我們用鼻子做什麼？", "聞味道", ["聽聲音", "看東西", "說話"]),
    ("牛奶是什麼顏色？", "白色", ["黑色", "紅色", "綠色"]),
    ("一隻手有幾根手指？", "5根", ["4根", "6根", "10根"]),
    ("人有幾隻眼睛？", "2隻", ["1隻", "3隻", "4隻"]),
    ("蜜蜂會採什麼？", "花蜜", ["樹葉", "石頭", "泥土"]),
    ("公雞通常什麼時候啼叫？", "早上", ["半夜", "中午", "下午"]),
    ("雪是什麼顏色？", "白色", ["黑色", "藍色", "綠色"]),
    ("火摸起來是什麼感覺？", "燙的", ["冰的", "濕的", "軟的"]),
    ("冰塊摸起來是什麼感覺？", "冰的", ["燙的", "熱的", "乾的"]),
    ("西瓜切開裡面是什麼顏色？", "紅色", ["藍色", "黑色", "白色"]),
    ("葡萄最常見是什麼顏色？", "紫色", ["紅色", "黑色", "橘色"]),
    ("我們晚上睡覺通常睡在哪裡？", "床上", ["桌上", "車上", "樹上"]),
    ("煮飯通常在家裡的哪個地方？", "廚房", ["浴室", "陽台", "客廳"]),
    ("洗澡通常在家裡的哪個地方？", "浴室", ["廚房", "書房", "客廳"]),
    ("一年的第一個月是幾月？", "一月", ["二月", "三月", "十二月"]),
    ("過年時常說哪句吉祥話？", "恭喜發財", ["一路順風", "早日康復", "生日快樂"]),
    ("蝴蝶小時候是什麼？", "毛毛蟲", ["蝌蚪", "螞蟻", "蚯蚓"]),
    ("青蛙小時候是什麼？", "蝌蚪", ["毛毛蟲", "小魚", "壁虎"]),
    ("大象的鼻子長得怎麼樣？", "長長的", ["短短的", "圓圓的", "扁扁的"]),
    ("兔子最愛吃什麼？", "紅蘿蔔", ["骨頭", "魚", "竹子"]),
    ("熊貓最愛吃什麼？", "竹子", ["紅蘿蔔", "香蕉", "魚"]),
    ("猴子最愛吃什麼？", "香蕉", ["竹子", "骨頭", "青菜"]),
    ("星星通常什麼時候看得到？", "晚上", ["中午", "早上", "下午"]),
    ("彩虹有幾種顏色？", "7種", ["3種", "5種", "10種"]),
    ("腳踏車有幾個輪子？", "2個", ["3個", "4個", "1個"]),
    ("汽車有幾個輪子？", "4個", ["2個", "3個", "6個"]),
    ("斑馬身上是什麼條紋？", "黑白條紋", ["紅白條紋", "藍黃條紋", "綠色條紋"]),
]

EASY_FACTS = [
    ("一小時有幾分鐘？", "60分鐘", ["100分鐘", "30分鐘", "90分鐘"]),
    ("端午節要吃什麼應景食物？", "粽子", ["月餅", "湯圓", "年糕"]),
    ("中秋節要吃什麼應景食物？", "月餅", ["粽子", "湯圓", "蘿蔔糕"]),
    ("過年包的紅包通常是什麼顏色？", "紅色", ["白色", "藍色", "綠色"]),
    ("台灣最大的天然湖泊是？", "日月潭", ["澄清湖", "蘭潭", "梅花湖"]),
    ("搭火車要去哪裡？", "火車站", ["機場", "碼頭", "公車站"]),
    ("寄信要在信封上貼什麼？", "郵票", ["貼紙", "標籤", "膠帶"]),
    ("生病看醫生要去哪裡？", "醫院", ["學校", "銀行", "郵局"]),
    ("存錢要去哪裡？", "銀行", ["醫院", "學校", "消防局"]),
    ("借書要去哪裡？", "圖書館", ["銀行", "醫院", "郵局"]),
    ("失火了要打電話找誰？", "消防隊", ["郵差", "老師", "店員"]),
    ("遇到小偷要打電話找誰？", "警察", ["醫生", "老師", "郵差"]),
    ("一打鉛筆是幾枝？", "12枝", ["10枝", "6枝", "20枝"]),
    ("水燒開大約是攝氏幾度？", "100度", ["50度", "80度", "200度"]),
    ("台灣夏天最常見的天災是？", "颱風", ["暴風雪", "沙塵暴", "龍捲風"]),
    ("元宵節要吃什麼應景食物？", "湯圓", ["粽子", "月餅", "潤餅"]),
    ("秋天的樹葉常常會怎麼樣？", "變黃掉落", ["開滿花", "長得更綠", "結冰"]),
    ("指南針主要用來分辨什麼？", "方向", ["時間", "溫度", "重量"]),
    ("醫生用什麼工具聽心跳？", "聽診器", ["體溫計", "血壓計", "手電筒"]),
    ("一公斤是幾公克？", "1000公克", ["100公克", "500公克", "10公克"]),
    ("紅綠燈的綠燈代表什麼？", "可以通行", ["趕快停下", "禁止進入", "原地等待"]),
    ("夜市通常什麼時候最熱鬧？", "晚上", ["清晨", "中午", "上午"]),
    ("白米飯是用什麼煮成的？", "米", ["麵粉", "玉米", "黃豆"]),
    ("豆漿主要是用什麼做的？", "黃豆", ["綠豆", "紅豆", "花生"]),
    ("農曆新年是農曆幾月初一？", "正月", ["二月", "三月", "臘月"]),
    ("母親節在每年的幾月？", "5月", ["3月", "8月", "10月"]),
]

MEDIUM_FACTS = [
    ("閏年的二月有幾天？", "29天", ["28天", "30天", "31天"]),
    ("平年的二月有幾天？", "28天", ["29天", "30天", "27天"]),
    ("一年分成幾個季節？", "4個", ["2個", "3個", "5個"]),
    ("台灣最長的河流是？", "濁水溪", ["淡水河", "高屏溪", "大甲溪"]),
    ("雙十節是幾月幾日？", "10月10日", ["10月1日", "11月10日", "9月10日"]),
    ("清明節通常在國曆幾月？", "4月", ["3月", "5月", "6月"]),
    ("農曆七月七日是什麼節日？", "七夕", ["中元節", "重陽節", "元宵節"]),
    ("新台幣最大面額的紙鈔是多少元？", "2000元", ["1000元", "5000元", "500元"]),
    ("一公里是幾公尺？", "1000公尺", ["100公尺", "500公尺", "10000公尺"]),
    ("水在攝氏幾度會結冰？", "0度", ["10度", "零下50度", "5度"]),
    ("人體正常體溫大約是攝氏幾度？", "37度", ["35度", "39度", "40度"]),
    ("台北101大樓總共有幾層樓？", "101層", ["100層", "88層", "110層"]),
    ("健保卡主要是做什麼用的？", "看病就醫", ["搭車付款", "借書", "提款"]),
    ("端午節在農曆幾月幾日？", "五月五日", ["五月十五日", "四月五日", "六月六日"]),
    ("重陽節在農曆幾月幾日？", "九月九日", ["八月八日", "十月十日", "七月七日"]),
    ("冬至這一天傳統上要吃什麼？", "湯圓", ["月餅", "粽子", "春捲"]),
    ("台灣的國花是什麼花？", "梅花", ["櫻花", "杜鵑花", "蘭花"]),
]

HARD_FACTS = [
    ("「一甲子」是指幾年？", "60年", ["50年", "30年", "100年"]),
    ("「半世紀」是指幾年？", "50年", ["25年", "60年", "100年"]),
    ("「三更半夜」的三更大約是幾點？", "晚上11點到凌晨1點", ["晚上9點到11點", "凌晨3點到5點", "晚上7點到9點"]),
    ("世界上最高的山峰是？", "聖母峰", ["玉山", "富士山", "喜馬拉雅山脈的K2"]),
    ("「不惑之年」是指幾歲？", "40歲", ["30歲", "50歲", "60歲"]),
    ("「而立之年」是指幾歲？", "30歲", ["20歲", "40歲", "50歲"]),
    ("「古稀之年」是指幾歲？", "70歲", ["60歲", "80歲", "90歲"]),
    ("一刻鐘是幾分鐘？", "15分鐘", ["10分鐘", "30分鐘", "5分鐘"]),
]

IDIOM_MEANINGS = [
    ("守株待兔", "不努力只想碰運氣"), ("對牛彈琴", "對不懂的人講道理"),
    ("井底之蛙", "見識狹小的人"), ("雪中送炭", "在別人困難時伸出援手"),
    ("錦上添花", "好上加好"), ("亡羊補牢", "出錯後及時補救"),
    ("自相矛盾", "言行前後不一致"), ("掩耳盜鈴", "自己騙自己"),
    ("騎虎難下", "事情做到一半難以停止"), ("熟能生巧", "練習多了自然熟練"),
    ("樂極生悲", "太高興反而出了事"), ("一舉兩得", "做一件事得到兩種好處"),
    ("事半功倍", "花一半力氣得到加倍效果"), ("五花八門", "種類繁多"),
    ("一目了然", "一看就清楚明白"), ("川流不息", "來往不斷"),
    ("雨後春筍", "新事物大量出現"), ("有備無患", "事先準備就不怕出事"),
    ("知足常樂", "懂得滿足就常保快樂"), ("大同小異", "大部分相同只有小差別"),
    ("異口同聲", "大家說法完全一致"), ("後來居上", "後起的超越先前的"),
    ("名不虛傳", "名聲與實際相符"), ("愛不釋手", "喜歡得捨不得放下"),
    ("心曠神怡", "心情開朗舒暢"), ("半信半疑", "有點相信又有點懷疑"),
]

IDIOM_SYNONYMS = [
    ("緣木求魚", "徒勞無功", ["一舉兩得", "順水推舟", "如魚得水"]),
    ("班門弄斧", "自不量力", ["精益求精", "出類拔萃", "虛懷若谷"]),
    ("未雨綢繆", "防患未然", ["亡羊補牢", "臨陣磨槍", "得過且過"]),
    ("望梅止渴", "畫餅充飢", ["雪中送炭", "豐衣足食", "津津有味"]),
    ("唇亡齒寒", "休戚相關", ["井水不犯河水", "各自為政", "漠不關心"]),
    ("殊途同歸", "異曲同工", ["南轅北轍", "背道而馳", "分道揚鑣"]),
    ("雪上加霜", "禍不單行", ["雙喜臨門", "否極泰來", "錦上添花"]),
    ("隔靴搔癢", "不得要領", ["一針見血", "正中下懷", "對症下藥"]),
    ("邯鄲學步", "東施效顰", ["獨樹一幟", "自成一家", "別出心裁"]),
    ("守口如瓶", "三緘其口", ["口若懸河", "侃侃而談", "暢所欲言"]),
    ("滴水穿石", "持之以恆", ["一曝十寒", "淺嘗輒止", "三心二意"]),
    ("錙銖必較", "斤斤計較", ["慷慨大方", "一擲千金", "寬宏大量"]),
    ("朝三暮四", "反覆無常", ["始終如一", "堅定不移", "言出必行"]),
    ("一丘之貉", "狼狽為奸", ["志同道合", "情同手足", "相敬如賓"]),
    ("「當局者迷」的下一句通常是？", "旁觀者清", ["井水不犯河水", "百聞不如一見", "近朱者赤"]),
    ("「百聞不如一見」是什麼意思？", "親眼看一次勝過聽說多次", ["多聽別人意見比較好", "新聞比親眼可靠", "聽一百次才能記住"]),
    ("「三思而後行」是什麼意思？", "做事前要仔細考慮", ["做事要快不要想", "想三天才能做事", "邊做邊想就好"]),
]

LOGIC_NAMES = [
    ("小明", "小華", "小芳"), ("小強", "小美", "小傑"),
    ("阿宏", "阿珠", "阿福"), ("小玲", "小偉", "小琪"),
    ("大寶", "二寶", "三寶"), ("小安", "小婷", "小凱"),
]

SUMDIFF_ITEMS = [
    ("蘋果", "橘子", "顆"), ("紅球", "白球", "顆"), ("男生", "女生", "人"),
    ("雞", "鴨", "隻"), ("鉛筆", "原子筆", "枝"), ("糖果", "餅乾", "個"),
]

TRANSITIVE = [
    ("跑得比{}快", "誰跑得最慢？", "誰跑得最快？"),
    ("年紀比{}大", "誰年紀最小？", "誰年紀最大？"),
    ("個子比{}高", "誰個子最矮？", "誰個子最高？"),
    ("力氣比{}大", "誰力氣最小？", "誰力氣最大？"),
]

DISCOUNT_ITEMS = ["外套", "鞋子", "包包", "電鍋", "毛毯", "襯衫", "電風扇", "棉被"]
MONEY_ITEMS = [("麵包", "個"), ("便當", "個"), ("飲料", "杯"), ("車票", "張"), ("肥皂", "塊"), ("毛巾", "條")]


# ── 各難度產生器（候選數刻意多於需求，去重後擇優取前段）─────────────────

def gen_super_easy():
    out = []
    adds = [(a, b) for a in range(1, 10) for b in range(1, 10)]
    rng.shuffle(adds)
    out += [make_q("計算", f"{a} + {b} = ？", a + b, num_distractors(a + b, low=0)) for a, b in adds[:80]]
    subs = [(a, b) for a in range(3, 20) for b in range(1, min(10, a))]
    rng.shuffle(subs)
    out += [make_q("計算", f"{a} − {b} = ？", a - b, num_distractors(a - b, low=0)) for a, b in subs[:60]]
    muls = [(a, b) for a in range(2, 6) for b in range(2, 6)]
    rng.shuffle(muls)
    out += [make_q("計算", f"{a} × {b} = ？", a * b, num_distractors(a * b, low=1)) for a, b in muls]
    for s in range(1, 11):
        for d in (1, 2):
            seq = [s + d * i for i in range(4)]
            ans = s + d * 4
            out.append(make_q("數列", "、".join(map(str, seq)) + "、？", ans, num_distractors(ans, low=0)))
    out += memory_questions(MEM_POOLS, 4, 65)
    out += pick_curated("常識", SUPER_EASY_FACTS)
    out += opposite_questions(OPPOSITE_CHARS)
    return out


def gen_easy():
    out = []
    adds = [(a, b) for a in range(12, 90) for b in range(11, 90) if a + b < 150]
    rng.shuffle(adds)
    out += [make_q("計算", f"{a} + {b} = ？", a + b, num_distractors(a + b)) for a, b in adds[:45]]
    subs = [(a, b) for a in range(30, 100) for b in range(11, 90) if a - b >= 5]
    rng.shuffle(subs)
    out += [make_q("計算", f"{a} − {b} = ？", a - b, num_distractors(a - b, low=0)) for a, b in subs[:35]]
    muls = [(a, b) for a in range(2, 10) for b in range(2, 10)]
    rng.shuffle(muls)
    out += [make_q("計算", f"{a} × {b} = ？", a * b, num_distractors(a * b, low=1)) for a, b in muls[:35]]
    divs = [(b * q, b) for b in range(2, 10) for q in range(2, 13)]
    rng.shuffle(divs)
    out += [make_q("計算", f"{n} ÷ {b} = ？", n // b, num_distractors(n // b, low=1)) for n, b in divs[:35]]
    monies = [(item, unit, p, n) for item, unit in MONEY_ITEMS for p in range(10, 55, 5) for n in range(2, 5)]
    rng.shuffle(monies)
    out += [
        make_q("計算", f"一{unit}{item}{p}元，買{n}{unit}共多少元？", p * n, num_distractors(p * n, low=1), unit="元")
        for item, unit, p, n in monies[:30]
    ]
    arith = [(s, d) for s in range(2, 30, 3) for d in (3, 4, 5, 10)]
    rng.shuffle(arith)
    for s, d in arith[:28]:
        seq = [s + d * i for i in range(4)]
        ans = s + d * 4
        out.append(make_q("數列", "、".join(map(str, seq)) + "、？", ans, num_distractors(ans, low=0)))
    out += memory_questions(MEM_POOLS, 5, 40)
    out += pick_curated("常識", EASY_FACTS)
    out += opposite_questions(OPPOSITE_WORDS, word=True)
    return out


def gen_medium():
    out = []
    days_after = [(w, n) for w in range(7) for n in range(6, 17)]
    rng.shuffle(days_after)
    out += [
        weekday_q("推理", f"今天星期{WEEKDAYS[w]}，{n}天後是星期幾？", w + n)
        for w, n in days_after[:40]
    ]
    base_target = [(b, bo, t, to) for b, bo in [("昨天", -1), ("前天", -2)] for t, to in [("明天", 1), ("後天", 2), ("大後天", 3)]]
    combos = [(w, b, bo, t, to) for w in range(7) for b, bo, t, to in base_target]
    rng.shuffle(combos)
    out += [
        weekday_q("推理", f"{b}是星期{WEEKDAYS[w]}，{t}是星期幾？", w + (to - bo))
        for w, b, bo, t, to in combos[:25]
    ]
    monies = [(item, unit, p, n) for item, unit in MONEY_ITEMS for p in range(25, 90, 5) for n in range(3, 7)]
    rng.shuffle(monies)
    out += [
        make_q("計算", f"一{unit}{item}{p}元，買{n}{unit}共多少元？", p * n, num_distractors(p * n, low=1), unit="元")
        for item, unit, p, n in monies[:35]
    ]
    changes = [(p, paid) for paid in (100, 200, 500) for p in range(15, paid - 10, 7)]
    rng.shuffle(changes)
    out += [
        make_q("計算", f"用{paid}元買{p}元的東西，應找回多少元？", paid - p, num_distractors(paid - p, low=0), unit="元")
        for p, paid in changes[:30]
    ]
    times = [(h, m) for h in range(1, 4) for m in range(5, 60, 10)]
    rng.shuffle(times)
    out += [
        make_q("計算", f"{h}小時{m}分鐘共是幾分鐘？", h * 60 + m, num_distractors(h * 60 + m, low=1), unit="分鐘")
        for h, m in times[:20]
    ]
    out += [make_q("計算", f"{w}個星期共有幾天？", w * 7, num_distractors(w * 7, low=1), unit="天") for w in range(2, 10)]
    out += [make_q("計算", f"{y}年共有幾個月？", y * 12, num_distractors(y * 12, low=1), unit="個月") for y in range(2, 10)]
    muls = [(a, b) for a in range(12, 40) for b in range(3, 10)]
    rng.shuffle(muls)
    out += [make_q("計算", f"{a} × {b} = ？", a * b, num_distractors(a * b, low=1)) for a, b in muls[:30]]
    for s, r in [(s, r) for s in (2, 3, 4, 5) for r in (2, 3)]:
        seq = [s * r**i for i in range(4)]
        ans = s * r**4
        out.append(make_q("數列", "、".join(map(str, seq)) + "、？", ans, num_distractors(ans, low=1)))
    arith = [(s, d) for s in range(5, 40, 4) for d in (6, 7, 8, 9, 11)]
    rng.shuffle(arith)
    for s, d in arith[:17]:
        seq = [s + d * i for i in range(4)]
        ans = s + d * 4
        out.append(make_q("數列", "、".join(map(str, seq)) + "、？", ans, num_distractors(ans, low=0)))
    out += memory_questions(MEM_POOLS, 6, 35)
    answers = [m for _, m in IDIOM_MEANINGS]
    out += [
        make_q("語言", f"「{idiom}」是什麼意思？", m, rng.sample([x for x in answers if x != m], 3))
        for idiom, m in IDIOM_MEANINGS
    ]
    out += pick_curated("常識", MEDIUM_FACTS)
    return out


def gen_hard():
    out = []
    combos = [(a, b, c) for a in range(6, 16) for b in range(6, 16) for c in range(11, 60, 7)]
    rng.shuffle(combos)
    out += [make_q("計算", f"{a} × {b} + {c} = ？", a * b + c, num_distractors(a * b + c, low=1)) for a, b, c in combos[:30]]
    combos2 = [(a, b, c, d) for a in range(7, 16) for b in range(7, 13) for c in range(3, 9) for d in range(3, 9) if a * b > c * d]
    rng.shuffle(combos2)
    out += [
        make_q("計算", f"{a} × {b} − {c} × {d} = ？", a * b - c * d, num_distractors(a * b - c * d, low=0))
        for a, b, c, d in combos2[:30]
    ]
    discounts = [(item, p, k) for item in DISCOUNT_ITEMS for p in range(400, 2100, 150) for k in (7, 8, 9)]
    rng.shuffle(discounts)
    out += [
        make_q("計算", f"一件{item}原價{p}元，打{k}折後多少元？", p * k // 10, num_distractors(p * k // 10, low=1), unit="元")
        for item, p, k in discounts[:25]
    ]
    for n in range(6, 16):
        out.append(make_q("計算", f"正方形邊長{n}公分，面積是幾平方公分？", n * n, num_distractors(n * n, low=1)))
        out.append(make_q("計算", f"正方形邊長{n}公分，周長是幾公分？", n * 4, num_distractors(n * 4, low=1)))
    rects = [(a, b) for a in range(5, 15) for b in range(3, 12) if a > b]
    rng.shuffle(rects)
    out += [
        make_q("計算", f"長方形長{a}公分、寬{b}公分，面積是幾平方公分？", a * b, num_distractors(a * b, low=1))
        for a, b in rects[:15]
    ]
    ropes = [(f, length) for f in (2, 3) for length in range(6, 26, 2)]
    rng.shuffle(ropes)
    out += [
        make_q("計算", f"一條繩子對折{ '兩' if f == 2 else '三' }次後長{length}公分，原本長幾公分？", length * 2**f, num_distractors(length * 2**f, low=1))
        for f, length in ropes[:12]
    ]
    reads = [(p, d) for p in range(15, 50, 5) for d in range(6, 13)]
    rng.shuffle(reads)
    out += [
        make_q("計算", f"一本書{p * d}頁，每天讀{p}頁，幾天可以讀完？", d, num_distractors(d, low=1), unit="天")
        for p, d in reads[:15]
    ]
    ages = [(names, a, b, c) for names in LOGIC_NAMES for a in range(2, 6) for b in range(2, 6) for c in range(18, 41, 4)]
    rng.shuffle(ages)
    out += [
        make_q(
            "邏輯",
            f"{n1}比{n2}大{a}歲，{n2}比{n3}小{b}歲。若{n3}今年{c}歲，{n1}幾歲？",
            c - b + a,
            num_distractors(c - b + a, low=1),
            unit="歲",
        )
        for (n1, n2, n3), a, b, c in ages[:30]
    ]
    sumdiffs = [(x, y, u, t, d) for x, y, u in SUMDIFF_ITEMS for t in range(14, 41, 2) for d in (2, 4, 6) if (t + d) % 2 == 0]
    rng.shuffle(sumdiffs)
    out += [
        make_q(
            "邏輯",
            f"籃子裡有{x}和{y}共{t}{u}，{x}比{y}多{d}{u}，{x}有幾{u}？",
            (t + d) // 2,
            num_distractors((t + d) // 2, low=1),
            unit=u,
        )
        for x, y, u, t, d in sumdiffs[:25]
    ]
    people = ["甲", "乙", "丙", "丁"]
    for rel, q_min, q_max in TRANSITIVE:
        chain = "，".join(people[i] + rel.format(people[i + 1]) for i in range(3))
        out.append(make_q("邏輯", f"{chain}，{q_min}", people[3], [people[0], people[1], people[2]]))
        out.append(make_q("邏輯", f"{chain}，{q_max}", people[0], [people[3], people[1], people[2]]))
    hard_week = [(w, b, bo, t, to) for w in range(7)
                 for b, bo in [("大前天", -3), ("前天", -2), ("4天前", -4), ("5天前", -5), ("6天前", -6), ("8天前", -8)]
                 for t, to in [("明天", 1), ("後天", 2), ("大後天", 3)]]
    rng.shuffle(hard_week)
    out += [
        weekday_q("推理", f"{b}是星期{WEEKDAYS[w]}，{t}是星期幾？", w + (to - bo))
        for w, b, bo, t, to in hard_week[:30]
    ]
    for s in range(2, 12, 2):  # 二階等差：差距遞增 2
        seq, cur, d = [s], s, 4
        for _ in range(4):
            cur += d
            d += 2
            seq.append(cur)
        out.append(make_q("數列", "、".join(map(str, seq[:5])) + "、？", cur + d, num_distractors(cur + d, low=1)))
    for a, b in [(1, 2), (2, 3), (3, 4), (1, 4), (2, 5), (3, 5)]:  # 費氏型：後項為前兩項之和
        seq = [a, b]
        for _ in range(4):
            seq.append(seq[-1] + seq[-2])
        out.append(make_q("數列", "、".join(map(str, seq[:5])) + "、？", seq[5], num_distractors(seq[5], low=1)))
    for k in range(2, 8):  # 平方數列（不同起點）
        seq = [i * i for i in range(k, k + 5)]
        ans = (k + 5) ** 2
        out.append(make_q("數列", "、".join(map(str, seq)) + "、？", ans, num_distractors(ans, low=1)))
    for s in range(60, 130, 10):  # 遞減且差距遞減 1
        seq, cur, d = [s], s, 10
        for _ in range(4):
            cur -= d
            d -= 1
            seq.append(cur)
        out.append(make_q("數列", "、".join(map(str, seq[:5])) + "、？", cur - d, num_distractors(cur - d, low=0)))
    out += [
        make_q("語言", q if "？" in q else f"「{q}」最接近哪個成語？", a, ds)
        for q, a, ds in IDIOM_SYNONYMS
    ]
    out += memory_questions(MEM_POOLS, 7, 25)
    out += pick_curated("常識", HARD_FACTS)
    return out


# ── rebalance 補題用資料與產生器（見 rebalance_questions.py）──────────────
# 目的：補足題庫中數量最少的題型（邏輯、推理、常識、語言、數列），
# 讓單一題型不超過 generate_questions.TYPE_CAP 的佔比上限。

# 歸類題的類別詞庫。兩組難度各自獨立，避免跨難度產生相同題文。
CATEGORY_POOLS_BASIC = [
    ("水果", ["蘋果", "香蕉", "橘子", "葡萄", "西瓜", "鳳梨", "芒果", "草莓"]),
    ("動物", ["狗", "貓", "牛", "羊", "馬", "雞", "兔子", "豬"]),
    ("交通工具", ["汽車", "公車", "火車", "腳踏車", "捷運", "飛機", "船"]),
    ("身體部位", ["眼睛", "鼻子", "耳朵", "嘴巴", "手", "腳", "肩膀"]),
    ("衣物", ["外套", "襯衫", "褲子", "裙子", "帽子", "襪子", "手套"]),
    ("顏色", ["紅色", "藍色", "黃色", "綠色", "紫色", "黑色", "白色"]),
]

CATEGORY_POOLS_HARDER = [
    ("蔬菜", ["高麗菜", "菠菜", "紅蘿蔔", "白蘿蔔", "青椒", "茄子", "南瓜"]),
    ("家電", ["電視", "冰箱", "洗衣機", "電風扇", "冷氣", "電鍋", "吹風機"]),
    ("文具", ["鉛筆", "橡皮擦", "直尺", "剪刀", "筆記本", "膠水", "訂書機"]),
    ("職業", ["醫生", "老師", "警察", "廚師", "司機", "護理師", "農夫"]),
    ("樂器", ["鋼琴", "吉他", "小提琴", "笛子", "二胡", "喇叭", "鼓"]),
    ("廚房用品", ["菜刀", "砧板", "湯鍋", "平底鍋", "鍋鏟", "湯勺", "碗盤"]),
]

# 相反詞第二批（easy 語言補題；與 OPPOSITE_WORDS 不重複）。
OPPOSITE_WORDS_2 = [
    ("增加", "減少"), ("出發", "抵達"), ("升高", "降低"), ("向前", "向後"),
    ("白天", "黑夜"), ("上升", "下降"), ("擁擠", "空曠"), ("複雜", "簡單"),
    ("熱情", "冷淡"), ("大方", "小氣"), ("樂觀", "悲觀"), ("謙虛", "驕傲"),
    ("溫柔", "粗魯"), ("充足", "缺乏"), ("熟悉", "陌生"), ("流行", "過時"),
    ("集合", "解散"), ("贊成", "反對"),
]

# hard 常識第二批（與 HARD_FACTS 不重複）。
HARD_FACTS_2 = [
    ("「花甲之年」是指幾歲？", "60歲", ["50歲", "70歲", "80歲"]),
    ("「知天命」是指幾歲？", "50歲", ["40歲", "60歲", "70歲"]),
    ("一世紀是幾年？", "100年", ["50年", "10年", "1000年"]),
    ("「一旬」是指幾天？", "10天", ["7天", "15天", "30天"]),
    ("「一炷香」的時間大約是多久？", "30分鐘", ["5分鐘", "2小時", "半天"]),
    ("十二生肖排第一的是？", "鼠", ["牛", "虎", "豬"]),
    ("十二生肖排最後的是？", "豬", ["狗", "雞", "猴"]),
    ("農曆十二月又稱為什麼月？", "臘月", ["正月", "荷月", "桂月"]),
    ("端午節划龍舟是為了紀念誰？", "屈原", ["孔子", "關公", "岳飛"]),
    ("世界上最大的海洋是？", "太平洋", ["大西洋", "印度洋", "北冰洋"]),
    ("台灣最高的山是？", "玉山", ["阿里山", "雪山", "合歡山"]),
    ("「白露」與「霜降」屬於什麼？", "二十四節氣", ["國定假日", "傳統戲曲", "十二生肖"]),
    ("水在高山上的沸點會怎麼樣？", "變低", ["變高", "不變", "變成兩倍"]),
    ("一公噸是幾公斤？", "1000公斤", ["100公斤", "500公斤", "10000公斤"]),
    ("「三伏天」指的是什麼時候？", "一年最熱的時候", ["一年最冷的時候", "梅雨季節", "颱風季節"]),
    ("「數九寒天」指的是什麼時候？", "一年最冷的時候", ["一年最熱的時候", "春暖花開時", "中秋前後"]),
    ("圍棋主要用哪兩種顏色的棋子？", "黑與白", ["紅與黑", "紅與綠", "黃與藍"]),
    ("「朝霞不出門，晚霞行千里」是關於什麼的諺語？", "天氣", ["飲食", "農耕", "健康"]),
    ("國道高速公路一般最高速限是時速幾公里？", "110公里", ["90公里", "130公里", "150公里"]),
    ("奧運會每幾年舉辦一次？", "4年", ["2年", "3年", "5年"]),
]

# hard 語言第二批：成語近義題（與 IDIOM_SYNONYMS 不重複）。
HARD_IDIOMS_2 = [
    ("畫蛇添足", "多此一舉", ["恰到好處", "畫龍點睛", "一氣呵成"]),
    ("杯弓蛇影", "疑神疑鬼", ["泰然自若", "心安理得", "處變不驚"]),
    ("破釜沉舟", "背水一戰", ["猶豫不決", "畏首畏尾", "進退兩難"]),
    ("囫圇吞棗", "不求甚解", ["融會貫通", "舉一反三", "精益求精"]),
    ("投鼠忌器", "有所顧忌", ["肆無忌憚", "為所欲為", "毫無顧忌"]),
    ("東山再起", "捲土重來", ["一蹶不振", "銷聲匿跡", "急流勇退"]),
    ("如虎添翼", "錦上添花", ["雪上加霜", "每況愈下", "趁火打劫"]),
    ("循序漸進", "按部就班", ["一步登天", "揠苗助長", "急於求成"]),
    ("車水馬龍", "川流不息", ["門可羅雀", "杳無人煙", "冷冷清清"]),
    ("袖手旁觀", "置身事外", ["挺身而出", "當仁不讓", "見義勇為"]),
]

SEASONS_NEXT = [
    ("春天過後是什麼季節？", "夏天", ["秋天", "冬天", "春天"]),
    ("夏天過後是什麼季節？", "秋天", ["春天", "冬天", "夏天"]),
    ("秋天過後是什麼季節？", "冬天", ["夏天", "春天", "秋天"]),
    ("冬天過後是什麼季節？", "春天", ["夏天", "秋天", "冬天"]),
]


def month_distractors(ans_month):
    pool = [m for m in range(1, 13) if m != ans_month]
    return [f"{m}月" for m in rng.sample(pool, 3)]


def odd_one_out_questions(pools, count):
    """歸類邏輯題：三個同類 + 一個異類，問哪一個不屬於該類。"""
    out = []
    seen = set()
    attempts = 0
    while len(out) < count and attempts < count * 30:
        attempts += 1
        (cat, members), (_ocat, omembers) = rng.sample(pools, 2)
        picks = rng.sample(members, 3)
        outsider = rng.choice(omembers)
        key = frozenset(picks + [outsider, cat])
        if key in seen:
            continue
        seen.add(key)
        items = picks + [outsider]
        rng.shuffle(items)
        text = f"{'、'.join(items)}，哪一個不是{cat}？"
        out.append(make_q("邏輯", text, outsider, picks))
    return out


def gen_extra_super_easy():
    """super_easy 補題候選：歸類邏輯 + 單步時序推理。"""
    out = []
    out += odd_one_out_questions(CATEGORY_POOLS_BASIC, 45)
    for w in range(7):
        out.append(weekday_q("推理", f"今天星期{WEEKDAYS[w]}，明天是星期幾？", w + 1))
        out.append(weekday_q("推理", f"今天星期{WEEKDAYS[w]}，昨天是星期幾？", w + 6))
    for m in range(1, 13):
        nxt = m % 12 + 1
        prv = (m - 2) % 12 + 1
        out.append(make_q("推理", f"{m}月的下一個月是幾月？", f"{nxt}月", month_distractors(nxt)))
        out.append(make_q("推理", f"{m}月的上一個月是幾月？", f"{prv}月", month_distractors(prv)))
    return out


def gen_extra_easy():
    """easy 補題候選：歸類邏輯 + 短跨距星期推理 + 季節推理 + 相反詞。"""
    out = []
    out += odd_one_out_questions(CATEGORY_POOLS_HARDER, 45)
    for w in range(7):
        for n in (2, 3, 4, 5):
            out.append(weekday_q("推理", f"今天星期{WEEKDAYS[w]}，{n}天後是星期幾？", w + n))
        out.append(weekday_q("推理", f"昨天是星期{WEEKDAYS[w]}，今天是星期幾？", w + 1))
        out.append(weekday_q("推理", f"今天星期{WEEKDAYS[w]}，前天是星期幾？", w + 5))
    out += pick_curated("推理", SEASONS_NEXT)
    out += opposite_questions(OPPOSITE_WORDS_2, word=True)
    return out


def gen_extra_medium():
    """medium 補題候選：三人遞移比較邏輯（與 hard 的四人版題文不同）。"""
    out = []
    for names in LOGIC_NAMES:
        n1, n2, n3 = names
        for rel, q_min, q_max in TRANSITIVE:
            chain = f"{n1}{rel.format(n2)}，{n2}{rel.format(n3)}"
            out.append(make_q("邏輯", f"{chain}，{q_min}", n3, [n1, n2, "無法判斷"]))
            out.append(make_q("邏輯", f"{chain}，{q_max}", n1, [n2, n3, "無法判斷"]))
    return out


def gen_extra_hard():
    """hard 補題候選：常識第二批 + 成語近義 + 新型數列。"""
    out = []
    out += pick_curated("常識", HARD_FACTS_2)
    out += [
        make_q("語言", f"「{idiom}」最接近哪個成語？", a, ds)
        for idiom, a, ds in HARD_IDIOMS_2
    ]
    for s in range(2, 7):  # 乘2加1數列
        seq = [s]
        for _ in range(4):
            seq.append(seq[-1] * 2 + 1)
        out.append(make_q("數列", "、".join(map(str, seq[:4])) + "、？", seq[4], num_distractors(seq[4], low=1)))
    for s in (11, 15, 19, 23, 27):  # 交錯數列：+a、−b 交替
        for a, b in ((5, 2), (7, 3), (9, 4)):
            seq = [s]
            for i in range(4):
                seq.append(seq[-1] + (a if i % 2 == 0 else -b))
            out.append(make_q("數列", "、".join(map(str, seq[:4])) + "、？", seq[4], num_distractors(seq[4], low=0)))
    return out


def check_question_shape(q):
    """對齊前端 isValidQuestion：恰好 4 個不重複字串選項，且含正解。"""
    assert isinstance(q["type"], str) and q["type"].strip()
    assert isinstance(q["q"], str) and q["q"].strip()
    assert isinstance(q["a"], str) and q["a"].strip()
    assert isinstance(q["opts"], list) and len(q["opts"]) == 4
    assert len(set(q["opts"])) == 4
    assert q["a"] in q["opts"]


def main():
    existing = load_existing_bank(OUTPUT_PATH)
    new = {
        "super_easy": gen_super_easy(),
        "easy": gen_easy(),
        "medium": gen_medium(),
        "hard": gen_hard(),
    }
    bank = {}
    for diff in DIFFICULTIES:
        old_qs = existing.get(diff) if isinstance(existing.get(diff), list) else []
        rng.shuffle(new[diff])
        seen, out = set(), []
        for q in list(old_qs) + new[diff]:
            key = normalize_question_text(q.get("q", ""))
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(q)
            if len(out) >= TARGET_PER_DIFFICULTY:
                break
        if len(out) < TARGET_PER_DIFFICULTY:
            print(f"錯誤：難度 {diff} 只湊到 {len(out)} 題（目標 {TARGET_PER_DIFFICULTY}）", file=sys.stderr)
            sys.exit(1)
        for q in out:
            check_question_shape(q)
        bank[diff] = out

    validate_questions(bank)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=2)
        f.write("\n")
    total = sum(len(bank[d]) for d in DIFFICULTIES)
    print(f"已寫入 questions.json：{ '、'.join(f'{d} {len(bank[d])} 題' for d in DIFFICULTIES) }，共 {total} 題。")


if __name__ == "__main__":
    main()
