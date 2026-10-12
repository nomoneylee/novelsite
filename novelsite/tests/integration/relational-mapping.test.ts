import { describe, it, expect, beforeAll } from 'vitest';
import { getAllNovels, getNovelDetail, getCategories, usersRepo } from '@/lib/repositories';
import type { Novel, NovelDetail, Category } from '@/lib/types';

/**
 * US1（2-A）關聯化：領域形狀穩定性（FR-002／FR-005／FR-008、US1 AC 6）。
 *
 * 關聯化之後 `Novel.author`／`category`／`tags` 與章節／評論的日期欄位全部改由關聯與
 * 原生 DateTime 遞補，但對外 MUST 維持關聯化之前的形狀與字串格式 —— 這正是
 * 「`src/app` + `src/components` 零 diff」（SC-003）成立的前提。
 *
 * 日期斷言 MUST 為格式（`YYYY-MM-DD`）而非僅斷言型別為 string —— 原生化後若 mapper
 * 直接 `.toISOString()`，型別仍是 string 但畫面會出現 `2026-07-10T00:00:00.000Z`：
 * `ChapterList.tsx:157` 與 `ReviewSection.tsx:166` 皆為裸渲染，屬可見的行為變更。
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

let novels: Novel[];
let categories: Category[];
/** 至少含 1 卷章節的作品（示範資料中為 featured-1） */
let detail: NovelDetail;

beforeAll(async () => {
  novels = await getAllNovels();
  categories = await getCategories();

  for (const n of novels) {
    const d = await getNovelDetail(n.id);
    if (d && d.volumes.some((v) => v.chapters.length > 0)) {
      detail = d;
      break;
    }
  }

  if (!detail) {
    throw new Error('示範資料中找不到具備章節的作品，無法驗證關聯化後的映射');
  }
});

describe('US1 關聯化：作品映射為穩定的領域形狀', () => {
  it('示範資料非空，且每部作品的 author 皆為非空字串（= penName ?? name）', () => {
    expect(novels.length).toBeGreaterThan(0);
    for (const n of novels) {
      expect(typeof n.author).toBe('string');
      expect(n.author.length).toBeGreaterThan(0);
    }
  });

  it('每部作品的 category 皆為分類 label（非 id、非 slug）', () => {
    const labels = new Set(categories.map((c) => c.label));
    expect(labels.size).toBeGreaterThan(0);
    for (const n of novels) {
      expect(labels).toContain(n.category);
    }
  });

  it('tags 若存在 MUST 為非空的 string[]（CSV 已關聯化，不得漏出逗號分隔字串）', () => {
    const withTags = novels.filter((n) => n.tags !== undefined);
    expect(withTags.length).toBeGreaterThan(0);
    for (const n of withTags) {
      expect(Array.isArray(n.tags)).toBe(true);
      expect(n.tags!.length).toBeGreaterThan(0);
      for (const tag of n.tags!) {
        expect(typeof tag).toBe('string');
        expect(tag).not.toContain(',');
      }
    }
  });

  /**
   * FEAT-3 3-B（FR-025）：`Novel.authorBio` 已移除，作者簡介的單一真相來源改為 `User.bio`。
   * 領域型別 `NovelDetail.authorBio` 的**名稱與形狀不變**（UI 零 diff），
   * 但值 MUST 來自作者這個人，而非作品這筆資料 —— 否則同一位作者的兩部作品
   * 可以各有一份不同的簡介，那正是搬家要消滅的狀態。
   */
  it('authorBio MUST 取自作者的 User.bio（FEAT-3 FR-025，非已移除的 Novel.authorBio）', async () => {
    const author = (await usersRepo.findByEmail('content-author-1@novelsite.tw'))!;
    expect(author).not.toBeNull();
    expect(author.bio.length).toBeGreaterThan(0);

    // 該作者名下的作品，其 authorBio 一律等於作者本人的 bio
    const displayName = author.penName ?? author.name;
    const owned = novels.filter((n) => n.author === displayName);
    expect(owned.length).toBeGreaterThan(0);

    for (const n of owned) {
      const d = (await getNovelDetail(n.id))!;
      expect(d.authorBio).toBe(author.bio);
    }
  });

  it('relatedIds MUST 為 string[]（CSV 已改 NovelRelation，順序由 sortOrder 決定）', () => {
    expect(Array.isArray(detail.relatedIds)).toBe(true);
    for (const id of detail.relatedIds) {
      expect(typeof id).toBe('string');
      expect(id).not.toContain(',');
    }
  });
});

describe('US1 日期原生化：對外仍為 YYYY-MM-DD（US1 AC 6、FR-005）', () => {
  it('章節 publishedAt MUST 符合 /^\\d{4}-\\d{2}-\\d{2}$/，MUST NOT 為完整 ISO 8601', () => {
    const chapters = detail.volumes.flatMap((v) => v.chapters);
    expect(chapters.length).toBeGreaterThan(0);
    for (const ch of chapters) {
      expect(ch.publishedAt).toMatch(DATE_ONLY);
    }
  });

  // 註（FEAT-4 4-B）：原本此處另有一則「評論 publishedAt 為 YYYY-MM-DD」的案例。
  // `Review.publishedAt` 已拆為 `createdAt` + `updatedAt`，且對外一律為完整 ISO 8601
  //（`ReviewItem`，contracts/interaction-api.md §1）—— 縮短格式的理由是「欄位被裸渲染」，
  // 而評論的時間改由元件自行格式化，該前提已不成立，故刪除而非改寫。
});
