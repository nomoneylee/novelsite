import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { deleteVolume, reorderChapters } from '@/lib/services/chapterService';
import { ServiceError } from '@/lib/services/errors';
import {
  createAuthor,
  createNovelWithChapter,
  addChapter,
  addVolume,
  cleanupAuthoring,
  type TestAuthor,
  type TestNovel,
} from '../helpers/authoring';

/**
 * FR-003b／FR-003c：卷刪除的空卷條件，與卷內排序的「整批成立或整批不套用」。
 *
 * 排序這一組的重點不在「順序有沒有換成功」，而在**失敗時有沒有留下半套資料**。
 * 章節編號帶唯一約束，天真的實作（逐筆 UPDATE 成新編號）會在中途撞上自己剛寫下的值；
 * 而一旦沒有交易包住，撞破的那一刻資料就停在一個不完整的狀態上。
 */

let author: TestAuthor;
let novel: TestNovel;
/** 同一卷內的三章，編號 1／2／3 */
let ch1: string;
let ch2: string;
let ch3: string;
/** 另一卷與其章節，供「混入他卷」的案例使用 */
let otherVolumeId: string;
let otherChapterId: string;

async function numbersOf(ids: string[]): Promise<number[]> {
  const rows = await prisma.chapter.findMany({
    where: { id: { in: ids } },
    select: { id: true, number: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r.number]));
  return ids.map((id) => byId.get(id)!);
}

beforeAll(async () => {
  await cleanupAuthoring();
  author = await createAuthor('vol-rules');
  novel = await createNovelWithChapter({ authorId: author.id });

  ch1 = novel.chapterId; // number = 1
  ch2 = await addChapter({ novelId: novel.novelId, volumeId: novel.volumeId, number: 2 });
  ch3 = await addChapter({ novelId: novel.novelId, volumeId: novel.volumeId, number: 3 });

  otherVolumeId = await addVolume(novel.novelId, 2);
  otherChapterId = await addChapter({
    novelId: novel.novelId,
    volumeId: otherVolumeId,
    number: 4,
  });
});

afterAll(async () => {
  await cleanupAuthoring();
});

describe('刪除卷：僅限空卷（FR-003c）', () => {
  it('非空卷回 CONFLICT，且卷與其章節皆未被刪除', async () => {
    await expect(deleteVolume(author.id, { volumeId: novel.volumeId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(await prisma.volume.count({ where: { id: novel.volumeId } })).toBe(1);
    expect(await prisma.chapter.count({ where: { volumeId: novel.volumeId } })).toBe(3);
  });

  it('空卷可刪除', async () => {
    const emptyVolumeId = await addVolume(novel.novelId, 9);
    await deleteVolume(author.id, { volumeId: emptyVolumeId });
    expect(await prisma.volume.count({ where: { id: emptyVolumeId } })).toBe(0);
  });
});

describe('卷內排序：整批成立或整批不套用（FR-003b）', () => {
  it('清單缺漏該卷章節 → 整批拒絕，編號未變', async () => {
    const before = await numbersOf([ch1, ch2, ch3]);

    await expect(
      reorderChapters(author.id, { volumeId: novel.volumeId, orderedChapterIds: [ch1, ch2] })
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await numbersOf([ch1, ch2, ch3])).toEqual(before);
  });

  it('清單混入他卷章節 → 整批拒絕，兩卷的編號皆未變', async () => {
    const before = await numbersOf([ch1, ch2, ch3, otherChapterId]);

    await expect(
      reorderChapters(author.id, {
        volumeId: novel.volumeId,
        orderedChapterIds: [ch1, ch2, otherChapterId],
      })
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await numbersOf([ch1, ch2, ch3, otherChapterId])).toEqual(before);
  });

  it('清單含不存在的識別碼 → 整批拒絕，編號未變', async () => {
    const before = await numbersOf([ch1, ch2, ch3]);

    await expect(
      reorderChapters(author.id, {
        volumeId: novel.volumeId,
        orderedChapterIds: [ch1, ch2, 'us1t-ghost-chapter'],
      })
    ).rejects.toBeInstanceOf(ServiceError);

    expect(await numbersOf([ch1, ch2, ch3])).toEqual(before);
  });

  it('1↔2 交換成功；唯一約束未被中間狀態撞破（research R-9 的負值暫存區間）', async () => {
    const before = await numbersOf([ch1, ch2, ch3]);
    expect(before).toEqual([1, 2, 3]);

    await reorderChapters(author.id, {
      volumeId: novel.volumeId,
      orderedChapterIds: [ch2, ch1, ch3],
    });

    expect(await numbersOf([ch2, ch1, ch3])).toEqual([1, 2, 3]);
  });

  it('排序只動該卷的編號集合，volumeId 不變、他卷不受影響（FR-003b）', async () => {
    const rows = await prisma.chapter.findMany({
      where: { id: { in: [ch1, ch2, ch3] } },
      select: { volumeId: true },
    });
    for (const row of rows) expect(row.volumeId).toBe(novel.volumeId);

    const other = await prisma.chapter.findUniqueOrThrow({ where: { id: otherChapterId } });
    expect(other.volumeId).toBe(otherVolumeId);
    expect(other.number).toBe(4);
  });

  it('排序後 DB 內該作品仍無重複編號', async () => {
    const rows = await prisma.chapter.findMany({
      where: { novelId: novel.novelId },
      select: { number: true },
    });
    const numbers = rows.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
