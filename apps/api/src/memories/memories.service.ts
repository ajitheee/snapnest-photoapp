import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PHOTOS_PER_YEAR = 8;   // max thumbnails shown per year strip
const WINDOW_DAYS    = 14;   // ±14-day fallback window around today's date

@Injectable()
export class MemoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns:
   *  - `yearGroups` — photos grouped by year ("1 year ago", "2 years ago", …).
   *    Three-tier matching, newest-first:
   *      1. Exact same month+day in a past year  →  label "X year(s) ago"
   *      2. ±14 days of today's date in a past year  →  label "X year(s) ago · nearby"
   *      3. Any photo from a past year (time-capsule)  →  label "X year(s) ago"
   *    Within each year the selection rotates daily so a different set surfaces
   *    each day even when many photos share the same calendar date.
   *  - `randomPhoto` — a single random photo for the iOS widget.
   *  - `recentHighlights` — up to 5 favorites from the last 30 days.
   */
  async getMemories(ownerId: string) {
    const today    = new Date();
    const thisMonth = today.getMonth() + 1;
    const thisDay   = today.getDate();
    const thisYear  = today.getFullYear();

    // Day-of-year used as a rotation seed (1-366).
    const dayOfYear = getDayOfYear(today);

    const baseWhere = { ownerId, isDeleted: false, isArchived: false, type: 'IMAGE' as const };

    const allAssets = await this.prisma.asset.findMany({
      where: baseWhere,
      select: {
        id: true,
        fileName: true,
        fileCreatedAt: true,
        thumbnailSmallPath: true,
        thumbnailLargePath: true,
        locationCity: true,
        locationCountry: true,
        isFavorite: true,
        width: true,
        height: true,
        mimeType: true,
        type: true,
      },
      orderBy: { fileCreatedAt: 'desc' },
    });

    // ── Tier 1: exact day match ─────────────────────────────────────────────
    const exactByYear = new Map<number, typeof allAssets>();
    for (const a of allAssets) {
      const d = new Date(a.fileCreatedAt);
      const yr = d.getFullYear();
      if (yr >= thisYear) continue;
      if (d.getMonth() + 1 === thisMonth && d.getDate() === thisDay) {
        if (!exactByYear.has(yr)) exactByYear.set(yr, []);
        exactByYear.get(yr)!.push(a);
      }
    }

    // ── Tier 2: ±WINDOW_DAYS fallback ──────────────────────────────────────
    const windowByYear = new Map<number, typeof allAssets>();
    for (const a of allAssets) {
      const d  = new Date(a.fileCreatedAt);
      const yr = d.getFullYear();
      if (yr >= thisYear) continue;
      const assetDoy = getDayOfYear(d);
      const diff = circularDayDiff(assetDoy, dayOfYear);
      if (diff <= WINDOW_DAYS) {
        if (!windowByYear.has(yr)) windowByYear.set(yr, []);
        windowByYear.get(yr)!.push(a);
      }
    }

    // ── Tier 3: time-capsule — any photo from each past year ────────────────
    const capsuleByYear = new Map<number, typeof allAssets>();
    for (const a of allAssets) {
      const yr = new Date(a.fileCreatedAt).getFullYear();
      if (yr >= thisYear) continue;
      if (!capsuleByYear.has(yr)) capsuleByYear.set(yr, []);
      capsuleByYear.get(yr)!.push(a);
    }

    // Choose best tier: use Tier 1 if ANY year has an exact match,
    // otherwise Tier 2 if ANY year has a window match, otherwise Tier 3.
    let sourceMap: Map<number, typeof allAssets>;
    let tierLabel: 'exact' | 'window' | 'capsule';
    if (exactByYear.size > 0) {
      sourceMap = exactByYear;
      tierLabel = 'exact';
    } else if (windowByYear.size > 0) {
      sourceMap = windowByYear;
      tierLabel = 'window';
    } else {
      sourceMap = capsuleByYear;
      tierLabel = 'capsule';
    }

    // Build year groups sorted newest-first ("1 year ago" first)
    const yearGroups = Array.from(sourceMap.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, photos]) => {
        const yearsAgo = thisYear - year;
        let label: string;
        if (tierLabel === 'window') {
          label = yearsAgo === 1 ? '1 year ago · around this time' : `${yearsAgo} years ago · around this time`;
        } else {
          label = yearsAgo === 1 ? '1 year ago' : `${yearsAgo} years ago`;
        }

        // Rotate the slice so a different batch surfaces each day
        const offset  = dayOfYear % photos.length;
        const rotated = [...photos.slice(offset), ...photos.slice(0, offset)];
        const assets  = rotated.slice(0, PHOTOS_PER_YEAR);

        return { year, yearsAgo, label, count: photos.length, assets };
      });

    // ── Random photo for the home screen widget ──────────────────────────────
    const withThumbs  = allAssets.filter((a) => a.thumbnailSmallPath);
    const pool        = withThumbs.length > 0 ? withThumbs : allAssets;
    const randomPhoto = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;

    // ── Recent highlights (favorites in the last 30 days) ────────────────────
    const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentHighlights = allAssets
      .filter((a) => a.isFavorite && new Date(a.fileCreatedAt) >= thirtyDaysAgo)
      .slice(0, 5);

    return {
      yearGroups,
      randomPhoto,
      recentHighlights,
      meta: {
        totalPhotos : allAssets.length,
        generatedAt : new Date().toISOString(),
      },
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}

/** Shortest arc between two day-of-year values (wraps at 365). */
function circularDayDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 365 - diff);
}
