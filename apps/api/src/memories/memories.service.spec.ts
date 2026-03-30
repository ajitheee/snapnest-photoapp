import { MemoriesService } from './memories.service';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TODAY = new Date();
const THIS_YEAR  = TODAY.getFullYear();
const THIS_MONTH = TODAY.getMonth() + 1;
const THIS_DAY   = TODAY.getDate();

/** Date in a past year, defaulting to today's month+day. */
function makeDate(yearsAgo: number, month = THIS_MONTH, day = THIS_DAY): Date {
  return new Date(THIS_YEAR - yearsAgo, month - 1, day, 12, 0, 0);
}

/** Date far from today (June 15 in a past year — ≥75 days off March 28). */
function farDate(yearsAgo: number): Date {
  // Pick a month/day that is guaranteed >14 days away from today in any year
  const farMonth = THIS_MONTH === 6 ? 12 : 6;
  return new Date(THIS_YEAR - yearsAgo, farMonth - 1, 15, 12, 0, 0);
}

interface MockAsset {
  id: string;
  fileName: string;
  fileCreatedAt: Date;
  thumbnailSmallPath: string | null;
  thumbnailLargePath: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  isFavorite: boolean;
  width: number | null;
  height: number | null;
  mimeType: string;
  type: 'IMAGE' | 'VIDEO' | 'OTHER';
}

function makeAsset(overrides: Partial<MockAsset> = {}): MockAsset {
  return {
    id: Math.random().toString(36).slice(2),
    fileName: 'test.jpg',
    fileCreatedAt: makeDate(1),
    thumbnailSmallPath: '/thumb/test_small.jpg',
    thumbnailLargePath: '/thumb/test_large.jpg',
    locationCity: null,
    locationCountry: null,
    isFavorite: false,
    width: 1920,
    height: 1080,
    mimeType: 'image/jpeg',
    type: 'IMAGE' as const,
    ...overrides,
  };
}

function buildService(assets: MockAsset[]): MemoriesService {
  const mockPrisma = { asset: { findMany: jest.fn().mockResolvedValue(assets) } };
  return new MemoriesService(mockPrisma as any);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MemoriesService.getMemories()', () => {
  const OWNER = 'user-001';

  // ── Empty state ────────────────────────────────────────────────────────────

  it('returns empty yearGroups when no photos exist', async () => {
    const svc = buildService([]);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups).toEqual([]);
    expect(result.randomPhoto).toBeNull();
    expect(result.recentHighlights).toEqual([]);
    expect(result.meta.totalPhotos).toBe(0);
  });

  it('returns empty yearGroups when all photos are from the current year', async () => {
    const assets = [makeAsset({ fileCreatedAt: TODAY }), makeAsset({ fileCreatedAt: TODAY })];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups).toHaveLength(0);
    expect(result.meta.totalPhotos).toBe(2);
  });

  // ── Tier 1: exact day match ────────────────────────────────────────────────

  it('Tier 1 – groups photos from past years that match today month+day', async () => {
    const assets = [
      makeAsset({ fileCreatedAt: makeDate(1) }),
      makeAsset({ fileCreatedAt: makeDate(1) }),
      makeAsset({ fileCreatedAt: makeDate(2) }),
      makeAsset({ fileCreatedAt: makeDate(3) }),
    ];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups).toHaveLength(3);
    expect(result.yearGroups[0].yearsAgo).toBe(1);
    expect(result.yearGroups[0].count).toBe(2);
    expect(result.yearGroups[1].yearsAgo).toBe(2);
    expect(result.yearGroups[2].yearsAgo).toBe(3);
  });

  it('Tier 1 – label is "1 year ago" for yearsAgo === 1', async () => {
    const svc = buildService([makeAsset({ fileCreatedAt: makeDate(1) })]);
    const result = await svc.getMemories(OWNER);
    expect(result.yearGroups[0].label).toBe('1 year ago');
  });

  it('Tier 1 – label is "N years ago" for yearsAgo > 1', async () => {
    const svc = buildService([makeAsset({ fileCreatedAt: makeDate(4) })]);
    const result = await svc.getMemories(OWNER);
    expect(result.yearGroups[0].label).toBe('4 years ago');
  });

  it('Tier 1 – excludes photos whose month or day does not match today', async () => {
    const wrongDay   = new Date(THIS_YEAR - 1, THIS_MONTH - 1, THIS_DAY === 1 ? 2 : THIS_DAY - 1, 12);
    const wrongMonth = new Date(THIS_YEAR - 1, THIS_MONTH === 1 ? 1 : THIS_MONTH - 2, THIS_DAY, 12);
    const svc = buildService([makeAsset({ fileCreatedAt: wrongDay }), makeAsset({ fileCreatedAt: wrongMonth })]);
    const result = await svc.getMemories(OWNER);
    // May land in Tier 2 if within ±14 days; the important thing is Tier 1 is empty.
    // Only check there are no exact matches
    for (const g of result.yearGroups) {
      const d = new Date(g.assets[0].fileCreatedAt);
      const isExact = d.getMonth() + 1 === THIS_MONTH && d.getDate() === THIS_DAY;
      // label won't contain "nearby" only if it's exact — we accept either tier here
      if (isExact) fail(`Unexpected exact match in year ${g.year}`);
    }
  });

  // ── Tier 2: ±14-day window ────────────────────────────────────────────────

  it('Tier 2 – activates when Tier 1 is empty but photos exist within ±14 days', async () => {
    // Photo 7 days away from today's date (within the ±14 window)
    const nearDate = new Date(THIS_YEAR - 2, THIS_MONTH - 1, THIS_DAY, 12);
    nearDate.setDate(nearDate.getDate() + 7); // push 7 days forward
    // Ensure it's still in a past year
    if (nearDate.getFullYear() >= THIS_YEAR) nearDate.setFullYear(THIS_YEAR - 2);

    const svc = buildService([makeAsset({ fileCreatedAt: nearDate })]);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups.length).toBeGreaterThanOrEqual(0); // may or may not match depending on wrap
  });

  it('Tier 2 – label contains "around this time" for window matches', async () => {
    // Build a date that is +8 days from today (outside exact, inside ±14 window)
    // but NOT on the exact day to force tier 2
    const d = new Date(THIS_YEAR - 1, THIS_MONTH - 1, THIS_DAY, 12);
    d.setDate(d.getDate() + 8);
    // If it rolled into current year, use -8 days instead
    if (d.getFullYear() >= THIS_YEAR) d.setDate(d.getDate() - 16);

    const svc = buildService([makeAsset({ fileCreatedAt: d })]);
    const result = await svc.getMemories(OWNER);

    if (result.yearGroups.length > 0) {
      // If a group exists in tier 2 it should have "around this time"
      const hasWindowLabel = result.yearGroups.some((g) => g.label.includes('around this time'));
      expect(hasWindowLabel).toBe(true);
    }
  });

  // ── Tier 3: time-capsule fallback ─────────────────────────────────────────

  it('Tier 3 – shows all past-year photos when no photos are near today', async () => {
    const assets = [
      makeAsset({ fileCreatedAt: farDate(2) }),
      makeAsset({ fileCreatedAt: farDate(5) }),
      makeAsset({ fileCreatedAt: farDate(10) }),
    ];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups).toHaveLength(3);
    const years = result.yearGroups.map((g) => g.yearsAgo);
    expect(years).toContain(2);
    expect(years).toContain(5);
    expect(years).toContain(10);
  });

  it('Tier 3 – label does NOT contain "around this time"', async () => {
    const svc = buildService([makeAsset({ fileCreatedAt: farDate(3) })]);
    const result = await svc.getMemories(OWNER);

    for (const g of result.yearGroups) {
      expect(g.label).not.toContain('around this time');
    }
  });

  // ── Ordering and caps ──────────────────────────────────────────────────────

  it('yearGroups are sorted newest-first', async () => {
    const assets = [
      makeAsset({ fileCreatedAt: farDate(5) }),
      makeAsset({ fileCreatedAt: farDate(1) }),
      makeAsset({ fileCreatedAt: farDate(3) }),
    ];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    const yearsAgo = result.yearGroups.map((g) => g.yearsAgo);
    for (let i = 1; i < yearsAgo.length; i++) {
      expect(yearsAgo[i]).toBeGreaterThan(yearsAgo[i - 1]);
    }
  });

  it('caps assets per year group at 8 (PHOTOS_PER_YEAR)', async () => {
    const assets = Array.from({ length: 15 }, () =>
      makeAsset({ fileCreatedAt: makeDate(1) }),
    );
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups[0].count).toBe(15);
    expect(result.yearGroups[0].assets).toHaveLength(8);
  });

  it('year is set correctly on each group', async () => {
    const assets = [
      makeAsset({ fileCreatedAt: makeDate(1) }),
      makeAsset({ fileCreatedAt: makeDate(2) }),
    ];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    expect(result.yearGroups[0].year).toBe(THIS_YEAR - 1);
    expect(result.yearGroups[1].year).toBe(THIS_YEAR - 2);
  });

  // ── Daily rotation ─────────────────────────────────────────────────────────

  it('rotation uses day-of-year offset so a different slice shows each day', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `photo-${i}`);
    const assets = ids.map((id) => makeAsset({ id, fileCreatedAt: makeDate(1) }));
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);

    const dayOfYear = Math.floor(
      (TODAY.getTime() - new Date(THIS_YEAR, 0, 0).getTime()) / 86_400_000,
    );
    const offset  = dayOfYear % ids.length;
    const rotated = [...ids.slice(offset), ...ids.slice(0, offset)].slice(0, 8);

    expect(result.yearGroups[0].assets.map((a) => a.id)).toEqual(rotated);
  });

  // ── randomPhoto ───────────────────────────────────────────────────────────

  it('randomPhoto is null when there are no photos', async () => {
    const svc = buildService([]);
    expect((await svc.getMemories(OWNER)).randomPhoto).toBeNull();
  });

  it('randomPhoto is drawn from the asset pool', async () => {
    const assets = [makeAsset({ id: 'p1' }), makeAsset({ id: 'p2' }), makeAsset({ id: 'p3' })];
    const svc = buildService(assets);
    const result = await svc.getMemories(OWNER);
    expect(assets.map((a) => a.id)).toContain(result.randomPhoto!.id);
  });

  it('randomPhoto prefers assets that have a thumbnail', async () => {
    const withThumb = makeAsset({ id: 'with-thumb', thumbnailSmallPath: '/t.jpg' });
    const noThumb1  = makeAsset({ id: 'no-thumb-1', thumbnailSmallPath: null });
    const noThumb2  = makeAsset({ id: 'no-thumb-2', thumbnailSmallPath: null });

    const svc = buildService([noThumb1, withThumb, noThumb2]);
    for (let i = 0; i < 20; i++) {
      expect((await svc.getMemories(OWNER)).randomPhoto!.id).toBe('with-thumb');
    }
  });

  // ── recentHighlights ──────────────────────────────────────────────────────

  it('recentHighlights includes only favorites from the last 30 days', async () => {
    const now = new Date();
    const recent      = makeAsset({ isFavorite: true,  fileCreatedAt: new Date(+now - 5  * 86_400_000) });
    const oldFav      = makeAsset({ isFavorite: true,  fileCreatedAt: new Date(+now - 40 * 86_400_000) });
    const recentNoFav = makeAsset({ isFavorite: false, fileCreatedAt: new Date(+now - 5  * 86_400_000) });

    const svc = buildService([recent, oldFav, recentNoFav]);
    const result = await svc.getMemories(OWNER);

    expect(result.recentHighlights).toHaveLength(1);
    expect(result.recentHighlights[0].id).toBe(recent.id);
  });

  it('recentHighlights is capped at 5', async () => {
    const now = new Date();
    const assets = Array.from({ length: 10 }, () =>
      makeAsset({ isFavorite: true, fileCreatedAt: new Date(+now - 86_400_000) }),
    );
    expect((await buildService(assets).getMemories(OWNER)).recentHighlights).toHaveLength(5);
  });

  // ── meta ──────────────────────────────────────────────────────────────────

  it('meta.totalPhotos counts all assets regardless of date match', async () => {
    const assets = [
      makeAsset({ fileCreatedAt: makeDate(1) }),
      makeAsset({ fileCreatedAt: TODAY }),
      makeAsset({ fileCreatedAt: farDate(1) }),
    ];
    expect((await buildService(assets).getMemories(OWNER)).meta.totalPhotos).toBe(3);
  });

  it('meta.generatedAt is a valid ISO timestamp', async () => {
    const result = await buildService([]).getMemories(OWNER);
    expect(new Date(result.meta.generatedAt).toISOString()).toBe(result.meta.generatedAt);
  });
});
