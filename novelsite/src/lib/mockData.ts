/**
 * NovelSite 種子資料（Seed Source）
 * ==================================
 * 這裡是「初始匯入資料庫」的原始資料來源，僅由 `prisma/seed.ts` 使用，
 * 應用程式頁面／元件不再直接 import 本檔，而是透過 `src/lib/repositories/*`
 * 讀取資料庫。
 *
 * 型別統一由 `src/lib/types.ts` 提供。
 */
import type { Novel, Volume, Chapter, Category, NovelDetail } from '@/lib/types';

// ─────────────────────────────────────────────
// 精選作品（Hero 輪播）
// ─────────────────────────────────────────────
export const FEATURED_NOVELS: Novel[] = [
  {
    id: 'featured-1',
    title: '劍破九霄',
    author: '天涯浪客',
    coverColor: 'linear-gradient(135deg, #1a0533 0%, #4a1942 40%, #8b2fc9 100%)',
    category: '玄幻',
    wordCount: 3200000,
    chapterCount: 1247,
    rating: 4.8,
    excerpt:
      '少年蕭塵自廢墟中崛起，手持斷劍踏遍山河，誓要斬破那橫亙天地之間的九重霄。\n一個關於不屈意志與命運抗爭的史詩故事。',
    tags: ['熱血', '修仙', '逆襲', '升級'],
    isFeatured: true,
    weeklyViews: 2840000,
    updateFreq: '每日更新',
  },
  {
    id: 'featured-2',
    title: '繁花似錦',
    author: '南簫詞',
    coverColor: 'linear-gradient(135deg, #0d1b2a 0%, #1b263b 40%, #415a77 100%)',
    category: '言情',
    wordCount: 1560000,
    chapterCount: 623,
    rating: 4.9,
    excerpt:
      '她是名動京城的才女，他是手握兵權的冷麵將軍。\n一紙賜婚，將兩個截然不同的靈魂綑綁在一起。',
    tags: ['古風', '強強', '宅鬥', 'HE'],
    isFeatured: true,
    weeklyViews: 1920000,
    updateFreq: '每日更新',
  },
  {
    id: 'featured-3',
    title: '星際迷途',
    author: '銀河漫遊者',
    coverColor: 'linear-gradient(135deg, #03071e 0%, #06235e 40%, #0466c8 100%)',
    category: '科幻',
    wordCount: 2100000,
    chapterCount: 891,
    rating: 4.7,
    excerpt:
      '西元 2387 年，人類文明在宇宙邊緣發現了一個古老訊號。\n艦長林宇帶領探索號踏上未知星域，卻發現真相比想像中更加驚人。',
    tags: ['硬核', '太空歌劇', '冒險', '智鬥'],
    isFeatured: true,
    weeklyViews: 1540000,
    updateFreq: '每週三更',
  },
];

// ─────────────────────────────────────────────
// 新書推薦
// ─────────────────────────────────────────────
export const NEW_NOVELS: Novel[] = [
  {
    id: 'new-1',
    title: '長安舊夢',
    author: '墨染青衫',
    coverColor: 'linear-gradient(160deg, #3d1a00 0%, #7c3a00 60%, #b85c00 100%)',
    category: '歷史',
    wordCount: 280000,
    chapterCount: 112,
    rating: 4.6,
    excerpt: '唐朝盛世之下，一個來自未來的魂魄附身於落第書生，在亂世中尋找回家的路。',
    tags: ['穿越', '歷史', '家國', '熱血'],
    isNew: true,
    weeklyViews: 320000,
    updateFreq: '每日更新',
  },
  {
    id: 'new-2',
    title: '都市修仙傳',
    author: '無量天尊',
    coverColor: 'linear-gradient(160deg, #0a0e1a 0%, #1a2744 60%, #2d4a8a 100%)',
    category: '都市',
    wordCount: 450000,
    chapterCount: 187,
    rating: 4.5,
    excerpt: '修仙界的頂尖高手意外轉世重生，回到了都市中的普通高中生活。',
    tags: ['都市', '修仙', '系統', '爽文'],
    isNew: true,
    weeklyViews: 280000,
    updateFreq: '每日三更',
  },
  {
    id: 'new-3',
    title: '偵探事務所',
    author: '霧中行者',
    coverColor: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)',
    category: '懸疑',
    wordCount: 360000,
    chapterCount: 143,
    rating: 4.7,
    excerpt: '廢棄工廠裡的碎屍案，失蹤二十年的藝術大師，兩件看似無關的案子背後有著驚天聯繫。',
    tags: ['推理', '懸疑', '探案', '燒腦'],
    isNew: true,
    weeklyViews: 410000,
    updateFreq: '每週五更',
  },
  {
    id: 'new-4',
    title: '霸道總裁的祕密',
    author: '糖霜奶酪',
    coverColor: 'linear-gradient(160deg, #1a0011 0%, #4a0030 60%, #8b0057 100%)',
    category: '言情',
    wordCount: 520000,
    chapterCount: 209,
    rating: 4.4,
    excerpt: '她以為自己只是他的臨時祕書，卻不知道自己早已深陷一場精心設計的相遇。',
    tags: ['現代', '甜文', '霸總', '職場'],
    isNew: true,
    weeklyViews: 380000,
    updateFreq: '每日更新',
  },
  {
    id: 'new-5',
    title: '量子迷宮',
    author: '光速追風',
    coverColor: 'linear-gradient(160deg, #00111a 0%, #002233 60%, #004466 100%)',
    category: '科幻',
    wordCount: 210000,
    chapterCount: 87,
    rating: 4.8,
    excerpt: '當量子電腦能夠預測未來時，一個程序員發現了系統中最不可能存在的 Bug。',
    tags: ['科幻', '量子', '懸疑', '反烏托邦'],
    isNew: true,
    weeklyViews: 290000,
    updateFreq: '每週三更',
  },
  {
    id: 'new-6',
    title: '山海志異',
    author: '古月傳說',
    coverColor: 'linear-gradient(160deg, #0a1a00 0%, #1a3d00 60%, #2d6600 100%)',
    category: '玄幻',
    wordCount: 680000,
    chapterCount: 276,
    rating: 4.6,
    excerpt: '上古神話世界的大荒之地，一個失憶的神明緩緩甦醒，尋找早已遺忘的過去。',
    tags: ['上古', '神話', '玄幻', '緩熱'],
    isNew: true,
    weeklyViews: 340000,
    updateFreq: '每日兩更',
  },
];

// 排行榜中出現、但不在精選／新書清單裡的獨立作品
export const RANKING_ONLY_NOVELS: Novel[] = [
  {
    id: 'rank-3',
    title: '神武天尊',
    author: '天劍無痕',
    coverColor: 'linear-gradient(135deg, #1a0a00 0%, #4a1a00 50%, #8c3a00 100%)',
    category: '玄幻',
    wordCount: 4500000,
    chapterCount: 1823,
    rating: 4.7,
    excerpt: '至高武道的終極奧義，盡在神武天尊一書。',
    weeklyViews: 1320000,
  },
  {
    id: 'rank-5',
    title: '錦繡山河',
    author: '江南煙雨',
    coverColor: 'linear-gradient(135deg, #1a1000 0%, #4a3000 50%, #8c6000 100%)',
    category: '歷史',
    wordCount: 2100000,
    chapterCount: 876,
    rating: 4.8,
    excerpt: '家國情懷，山河壯闊，一代名臣的傳奇一生。',
    weeklyViews: 980000,
  },
  {
    id: 'rank-7',
    title: '青梅竹馬不散場',
    author: '月下清風',
    coverColor: 'linear-gradient(135deg, #1a0015 0%, #4a003a 50%, #8c0060 100%)',
    category: '言情',
    wordCount: 1200000,
    chapterCount: 498,
    rating: 4.6,
    excerpt: '從小青梅到白頭，這一場愛戀穿越了時光。',
    weeklyViews: 870000,
  },
  {
    id: 'rank-9',
    title: '無限恐怖副本',
    author: '深夜靈魂',
    coverColor: 'linear-gradient(135deg, #0a0010 0%, #1a0030 50%, #2d0050 100%)',
    category: '懸疑',
    wordCount: 3300000,
    chapterCount: 1341,
    rating: 4.5,
    excerpt: '每一個副本都是死亡的考驗，活下去才是唯一目標。',
    weeklyViews: 760000,
  },
];

// 註（FEAT-4 4-D / T143）：手寫的三組排行常數（`WEEKLY_RANKING`／`MONTHLY_RANKING`／
// `ALL_TIME_RANKING`，各 10 筆）已**刪除**（FR-043a）。排行改由 `/api/cron/rankings`
// 依 `NovelDailyStat` 計分重算後寫入 `RankingEntry`，讀取經 `rankingService.getRanking`。
// 留著它們的代價不是「多幾行程式碼」，而是任何一個新頁面都可能再度 import 一組
// 沒有任何原始紀錄支撐的名次，而畫面上看不出差別。

// ─────────────────────────────────────────────
// 分類定義
// ─────────────────────────────────────────────
export const CATEGORIES: Category[] = [
  {
    id: 'fantasy',
    label: '玄幻',
    emoji: '⚡',
    description: '修仙、升級、逆天改命',
    color: '#9d4edd',
    bgColor: 'rgba(157, 78, 221, 0.1)',
  },
  {
    id: 'urban',
    label: '都市',
    emoji: '🏙️',
    description: '現代都市，職場江湖',
    color: '#3a86ff',
    bgColor: 'rgba(58, 134, 255, 0.1)',
  },
  {
    id: 'romance',
    label: '言情',
    emoji: '🌸',
    description: '纏綿悱惻，情深義重',
    color: '#e63b8b',
    bgColor: 'rgba(230, 59, 139, 0.1)',
  },
  {
    id: 'scifi',
    label: '科幻',
    emoji: '🚀',
    description: '星際遠征，未來世界',
    color: '#06b6d4',
    bgColor: 'rgba(6, 182, 212, 0.1)',
  },
  {
    id: 'history',
    label: '歷史',
    emoji: '⚔️',
    description: '家國情懷，史詩鉅著',
    color: '#d97706',
    bgColor: 'rgba(217, 119, 6, 0.1)',
  },
  {
    id: 'mystery',
    label: '懸疑',
    emoji: '🔍',
    description: '燒腦推理，真相追尋',
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
  },
];

// ─────────────────────────────────────────────
// 章節中繼資料生成工具（章號、標題、發佈日）
// 註：正文與字數不在此產生 —— 正文一律來自 `prisma/seed-data/<作品 id>/正文/*.md`，
// `wordCount` 由該正文推導（FR-011a）；此處的 wordCount 僅為型別佔位，seed 不採用。
// ─────────────────────────────────────────────
function makeChapters(
  volumeId: string,
  startNum: number,
  count: number,
  titles: string[]
): Chapter[] {
  return Array.from({ length: count }, (_, i) => {
    const num = startNum + i;
    // 以 (volumeId, number) 決定字數，避免隨機造成 seed 不可重現
    const pseudo = (num * 733 + volumeId.length * 97) % 1500;
    return {
      id: `${volumeId}-ch-${num}`,
      number: num,
      title: titles[i] ?? `第${num}章`,
      wordCount: 2000 + pseudo,
      publishedAt: new Date(2025, 0, 1 + i * 2).toISOString().split('T')[0],
      isLatest: i === count - 1 && startNum > 100,
    };
  });
}

// 註（FEAT-4 4-B / T082）：原 `SAMPLE_REVIEWS` 與三處引用已刪除（FR-043a）。
// 那是**造假來源**：五則評論的評分與讚數沒有任何使用者動作產生它，卻會被算進
// 作品的平均分與評論數；示範環境因此顯示一組永遠對不上任何真實紀錄的數字。
// 評論改由 `POST /api/novels/{id}/reviews` 產生，示範資料的計數一律為 0。

// ─────────────────────────────────────────────
// 作品詳細資料
// ─────────────────────────────────────────────

const JIAN_PO_VOLUMES: Volume[] = [
  {
    id: 'vol-1',
    number: 1,
    title: '第一捲：廢土崛起',
    chapters: makeChapters('vol-1', 1, 20, [
      '序章：廢墟少年',
      '第一章：斷劍',
      '第二章：初入修煉',
      '第三章：靈氣覺醒',
      '第四章：意外天賦',
      '第五章：第一場戰鬥',
      '第六章：廢棄礦脈',
      '第七章：神秘老者',
      '第八章：傳承之地',
      '第九章：劍意初現',
      '第十章：突破玄境',
      '第十一章：蕭氏危機',
      '第十二章：抉擇',
      '第十三章：出走',
      '第十四章：江湖初遇',
      '第十五章：比武招親',
      '第十六章：意外勝利',
      '第十七章：引起注意',
      '第十八章：暗流湧動',
      '第十九章：卷末：踏上征程',
    ]),
  },
  {
    id: 'vol-2',
    number: 2,
    title: '第二捲：天下英雄',
    chapters: makeChapters('vol-2', 21, 25, [
      '第二十一章：天武城',
      '第二十二章：四大家族',
      '第二十三章：比武大會',
      '第二十四章：強中更有強中手',
      '第二十五章：禁忌功法',
      '第二十六章：追殺',
      '第二十七章：荒野求生',
      '第二十八章：奇遇',
      '第二十九章：秘境',
      '第三十章：古老傳承',
      '第三十一章：劍道領悟',
      '第三十二章：歸來',
      '第三十三章：復仇',
      '第三十四章：震驚四方',
      '第三十五章：更大的舞台',
      '第三十六章：皇都邀請',
      '第三十七章：宗門選拔',
      '第三十八章：天才雲集',
      '第三十九章：初露鋒芒',
      '第四十章：宗門入列',
      '第四十一章：師傅',
      '第四十二章：嚴苛修煉',
      '第四十三章：突破瓶頸',
      '第四十四章：心魔',
      '第四十五章：卷末：破繭而出',
    ]),
  },
  {
    id: 'vol-3',
    number: 3,
    title: '第三捲：九霄之路',
    chapters: makeChapters('vol-3', 46, 15, [
      '第四十六章：域外征伐',
      '第四十七章：未知勢力',
      '第四十八章：謎之組織',
      '第四十九章：九霄秘密',
      '第五十章：天道法則',
      '第五十一章：逆天之戰',
      '第五十二章：生死邊緣',
      '第五十三章：神秘救援',
      '第五十四章：覺醒',
      '第五十五章：破霄第一步',
      '第五十六章：強敵環伺',
      '第五十七章：結盟',
      '第五十八章：最終決戰（一）',
      '第五十九章：最終決戰（二）',
      '第一千二百四十七章：劍破九霄',
    ]),
  },
];

/** 作品詳情種子資料（含長版簡介、分捲、評論、相關作品） */
export const NOVEL_DETAILS: Record<string, NovelDetail> = {
  'featured-1': {
    ...FEATURED_NOVELS[0],
    description: `少年蕭塵，生於廢墟之地，父母雙亡，手持一把殘缺斷劍，在眾人的嘲笑與輕視中，踏上了一條逆天改命的修仙之路。

這片大陸，修煉為尊，強者為王。靈根等級決定一切，天才橫行，廢材如草芥。然而，蕭塵那柄破舊的斷劍，卻蘊含著一段驚天秘密。

從廢土到霄雲，從廢材到劍神。他以一己之力，斬破橫亙天地之間的九重霄，顛覆整個修仙界的秩序，留下一段傳唱千年的不朽傳說。

「天若壓我，我便斬天；道若礙我，我便逆道。」—— 蕭塵

這是一個關於不屈意志與命運抗爭的史詩故事，也是一段少年以劍問道、以血淬魂的傳奇旅程。每一章節都是一次熱血的洗禮，每一場戰鬥都是對命運的宣戰。`,
    status: 'ongoing',
    authorBio:
      '天涯浪客，網文界知名玄幻作者，代表作《劍破九霄》累計閱讀量破億。擅長宏大世界觀建構與熱血戰鬥描寫，文筆細膩又不失磅礴之氣，深受讀者喜愛。',
    totalViews: 128000000,
    favoriteCount: 2340000,
    commentCount: 187000,
    // 註（FEAT-4 4-B / T082）：示範資料已無評論，評分人數固定為 0。
    // 評分本身（Novel.rating）的歸零屬 US3 的示範計數歸零（T113），本刀不擴大範圍。
    ratingCount: 0,
    latestChapterId: 'vol-3-ch-60',
    firstChapterId: 'vol-1-ch-1',
    volumes: JIAN_PO_VOLUMES,
    relatedIds: ['featured-3', 'rank-3', 'new-6'],
  },
  'featured-2': {
    ...FEATURED_NOVELS[1],
    description: `大楚盛世，繁花似錦，歌舞昇平之下暗流湧動。

她，蘇若錦，名動京城的第一才女，詩書琴棋無一不精，更有一顆玲瓏心竅，洞察世事。她以為自己會嫁給那個與她詩書相通的翩翩公子，卻沒想到一道聖旨，將她許配給了讓整個京城聞風喪膽的鎮北大將軍——裴淵。

他，裴淵，十五歲上戰場，二十歲封侯，手握北境三十萬大軍，冷面鐵血，從不近女色。朝中諸人皆說他是殺神，她卻在那張冰冷的臉後，窺見了他不為人知的溫柔。

一紙賜婚，看似天差地別的兩人，如何在彼此的磨合中，慢慢靠近，又如何在驚濤駭浪的宅鬥朝爭中，並肩而立？

這是一個強強相遇、勢均力敵的愛情故事，沒有一味退讓的傻白甜，只有兩個同樣驕傲靈魂的漫長試探與最終歸屬。`,
    status: 'ongoing',
    authorBio:
      '南簫詞，言情小說作家，以深厚的歷史文化底蘊見長。筆下的女主角個個獨立自強，男主霸道中不失溫柔。代表作《繁花似錦》橫掃各大平台言情榜首。',
    totalViews: 89000000,
    favoriteCount: 1850000,
    commentCount: 134000,
    // 註（FEAT-4 4-B / T082）：示範資料已無評論，評分人數固定為 0。
    // 評分本身（Novel.rating）的歸零屬 US3 的示範計數歸零（T113），本刀不擴大範圍。
    ratingCount: 0,
    latestChapterId: 'ff2-latest',
    firstChapterId: 'ff2-first',
    volumes: [],
    relatedIds: ['new-4', 'rank-7', 'featured-1'],
  },
  'featured-3': {
    ...FEATURED_NOVELS[2],
    description: `西元 2387 年，人類文明已擴張至銀河系第三旋臂。在一次例行的深空探測任務中，偵測衛星捕捉到一個來自宇宙邊緣的古老訊號——那是一串被破譯後揭示了驚人信息的脈衝，訊號源已存在超過二十億年。

聯合地球政府迅速組建了由最頂尖科學家與軍事人員組成的混合探索小隊，由艦長林宇率領「探索號」踏上這段未知的旅程。

然而，他們即將發現的，遠不只是一個文明的遺跡。那個訊號背後，隱藏著整個宇宙的終極秘密，以及一個足以改變人類對自身存在認知的殘酷真相。

在浩瀚星海中，生死邊緣上，林宇和他的隊員們必須面對的，不僅是未知的外星威脅，更是人性在絕境中的終極考驗。`,
    status: 'ongoing',
    authorBio:
      '銀河漫遊者，理工背景出身的硬科幻作家，擅長將嚴謹的科學理論融入扣人心弦的太空冒險故事。文風嚴謹紮實，情節緊湊，是科幻迷心目中的標竿作者。',
    totalViews: 67000000,
    favoriteCount: 1240000,
    commentCount: 98000,
    // 註（FEAT-4 4-B / T082）：示範資料已無評論，評分人數固定為 0。
    // 評分本身（Novel.rating）的歸零屬 US3 的示範計數歸零（T113），本刀不擴大範圍。
    ratingCount: 0,
    latestChapterId: 'sf3-latest',
    firstChapterId: 'sf3-first',
    volumes: [],
    relatedIds: ['new-5', 'new-2', 'featured-1'],
  },
};

// 註（FEAT-2 2-C）：原本兩組作者後台示範常數（作品列表與草稿章節）的死 export 已刪除
// （FR-017、SC-004）。作者後台改由 `repositories/authors.ts` 以 `authorId` 讀真實資料。
