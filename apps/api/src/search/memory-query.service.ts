import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

const ML_URL = process.env.ML_SERVICE_URL || 'http://ml:3003';

interface ParsedQuery {
  people: string[];
  locations: string[];
  dateFrom: Date | null;
  dateTo: Date | null;
  visualQuery: string | null;
  originalQuery: string;
}

@Injectable()
export class MemoryQueryService {
  private readonly logger = new Logger(MemoryQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async query(ownerId: string, naturalQuery: string, limit = 50) {
    const parsed = this.parseQuery(naturalQuery);
    const personIds = await this.resolvePersonNames(ownerId, parsed.people);

    const filters: string[] = [];
    const params: any[] = [ownerId];
    let paramIndex = 2;

    filters.push(`a."ownerId" = $1`);
    filters.push(`a."isDeleted" = false`);

    if (personIds.length > 0) {
      filters.push(`a.id IN (SELECT DISTINCT f."assetId" FROM faces f WHERE f."personId" = ANY($${paramIndex}))`);
      params.push(personIds);
      paramIndex++;
    }

    if (parsed.locations.length > 0) {
      const locClauses = parsed.locations.map(loc => {
        const idx = paramIndex++;
        params.push(`%${loc}%`);
        return `(a."locationCity" ILIKE $${idx} OR a."locationState" ILIKE $${idx} OR a."locationCountry" ILIKE $${idx})`;
      });
      filters.push(`(${locClauses.join(' OR ')})`);
    }

    if (parsed.dateFrom) {
      filters.push(`a."fileCreatedAt" >= $${paramIndex}`);
      params.push(parsed.dateFrom);
      paramIndex++;
    }
    if (parsed.dateTo) {
      filters.push(`a."fileCreatedAt" <= $${paramIndex}`);
      params.push(parsed.dateTo);
      paramIndex++;
    }

    let assets: any[];
    let searchContext: string;

    if (parsed.visualQuery && !personIds.length && !parsed.locations.length && !parsed.dateFrom) {
      // Pure visual query — use CLIP semantic search
      assets = await this.semanticSearch(ownerId, parsed.visualQuery, filters, params, limit);
      searchContext = this.buildContext(parsed, personIds, 'semantic');
    } else if (parsed.visualQuery) {
      // Combined: first filter by structured data, then re-rank by CLIP similarity
      const candidates = await this.structuredSearch(filters, params, 200);
      if (candidates.length > 0) {
        assets = await this.rerankByCLIP(candidates, parsed.visualQuery, limit);
        searchContext = this.buildContext(parsed, personIds, 'combined');
      } else {
        assets = [];
        searchContext = this.buildContext(parsed, personIds, 'no_results');
      }
    } else {
      assets = await this.structuredSearch(filters, params, limit);
      searchContext = this.buildContext(parsed, personIds, 'structured');
    }

    return {
      mode: 'memory',
      query: parsed,
      context: searchContext,
      assets: assets.map(a => ({ ...a, fileSizeBytes: a.fileSizeBytes?.toString?.() ?? a.fileSizeBytes })),
      total: assets.length,
      page: 1,
      limit,
    };
  }

  parseQuery(raw: string): ParsedQuery {
    const q = raw.trim();
    const lower = q.toLowerCase();

    const people = this.extractPeople(lower);
    const locations = this.extractLocations(lower);
    const { dateFrom, dateTo } = this.extractDates(lower);
    const visualQuery = this.extractVisualQuery(lower, people, locations);

    return { people, locations, dateFrom, dateTo, visualQuery, originalQuery: q };
  }

  private extractPeople(q: string): string[] {
    const names: string[] = [];

    const patterns = [
      /(?:photos?\s+(?:of|with)|pictures?\s+(?:of|with)|pics?\s+(?:of|with))\s+(.+?)(?:\s+(?:at|in|on|from|during|last|this|near)\b|$)/i,
      /(?:with|of)\s+([A-Z][a-z]+(?:\s+(?:and|&|,)\s+[A-Z][a-z]+)*)/i,
      /\b(mom|dad|mother|father|brother|sister|grandma|grandpa|wife|husband)\b/gi,
    ];

    for (const pat of patterns) {
      const match = q.match(pat);
      if (match && match[1]) {
        const parts = match[1].split(/\s+(?:and|&|,)\s+/).map(s => s.trim()).filter(Boolean);
        names.push(...parts);
      }
    }

    const who = q.match(/\bwho\s+(?:was\s+)?(?:in|at)\b/i);
    if (who) return names;

    return [...new Set(names)];
  }

  private extractLocations(q: string): string[] {
    const locations: string[] = [];

    const patterns = [
      /(?:at|in|from|near)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
      /(?:at|in|from|near)\s+(?:the\s+)?(\w+(?:\s+\w+){0,2}?)(?:\s+(?:last|this|in|on|during|with)\b|[?,.]|$)/gi,
    ];

    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(q)) !== null) {
        const loc = match[1].trim();
        const stopWords = ['the', 'last', 'this', 'my', 'our', 'a', 'an', 'summer', 'winter', 'spring', 'fall',
          'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
          'september', 'october', 'november', 'december', 'week', 'month', 'year',
          'morning', 'evening', 'night', 'afternoon', 'weekend', 'monday', 'tuesday',
          'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        if (loc.length > 1 && !stopWords.includes(loc.toLowerCase())) {
          locations.push(loc);
        }
      }
    }

    return [...new Set(locations)];
  }

  private extractDates(q: string): { dateFrom: Date | null; dateTo: Date | null } {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // "last week"
    if (/last\s+week/i.test(q)) {
      const from = new Date(now); from.setDate(from.getDate() - 7); from.setHours(0, 0, 0, 0);
      return { dateFrom: from, dateTo: now };
    }

    // "last weekend"
    if (/last\s+weekend/i.test(q)) {
      const dayOfWeek = now.getDay();
      const lastSat = new Date(now); lastSat.setDate(lastSat.getDate() - dayOfWeek - 1);
      lastSat.setHours(0, 0, 0, 0);
      const lastSun = new Date(lastSat); lastSun.setDate(lastSun.getDate() + 1);
      lastSun.setHours(23, 59, 59, 999);
      return { dateFrom: lastSat, dateTo: lastSun };
    }

    // "last month"
    if (/last\s+month/i.test(q)) {
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 0, 23, 59, 59, 999);
      return { dateFrom: from, dateTo: to };
    }

    // "last year"
    if (/last\s+year/i.test(q)) {
      return { dateFrom: new Date(year - 1, 0, 1), dateTo: new Date(year - 1, 11, 31, 23, 59, 59, 999) };
    }

    // "this week"
    if (/this\s+week/i.test(q)) {
      const dayOfWeek = now.getDay();
      const monday = new Date(now); monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      monday.setHours(0, 0, 0, 0);
      return { dateFrom: monday, dateTo: now };
    }

    // "this month"
    if (/this\s+month/i.test(q)) {
      return { dateFrom: new Date(year, month, 1), dateTo: now };
    }

    // "this year"
    if (/this\s+year/i.test(q)) {
      return { dateFrom: new Date(year, 0, 1), dateTo: now };
    }

    // "last N days/weeks/months"
    const lastN = q.match(/last\s+(\d+)\s+(day|week|month|year)s?/i);
    if (lastN) {
      const n = parseInt(lastN[1]);
      const unit = lastN[2].toLowerCase();
      const from = new Date(now);
      if (unit === 'day') from.setDate(from.getDate() - n);
      else if (unit === 'week') from.setDate(from.getDate() - n * 7);
      else if (unit === 'month') from.setMonth(from.getMonth() - n);
      else if (unit === 'year') from.setFullYear(from.getFullYear() - n);
      from.setHours(0, 0, 0, 0);
      return { dateFrom: from, dateTo: now };
    }

    // "last summer/winter/spring/fall"
    const seasonMatch = q.match(/last\s+(summer|winter|spring|fall|autumn)/i);
    if (seasonMatch) {
      const season = seasonMatch[1].toLowerCase();
      const sy = season === 'winter' && month < 3 ? year - 2 : year - 1;
      const ranges: Record<string, [Date, Date]> = {
        spring: [new Date(sy, 2, 1), new Date(sy, 4, 31, 23, 59, 59, 999)],
        summer: [new Date(sy, 5, 1), new Date(sy, 7, 31, 23, 59, 59, 999)],
        fall:   [new Date(sy, 8, 1), new Date(sy, 10, 30, 23, 59, 59, 999)],
        autumn: [new Date(sy, 8, 1), new Date(sy, 10, 30, 23, 59, 59, 999)],
        winter: [new Date(sy, 11, 1), new Date(sy + 1, 1, 28, 23, 59, 59, 999)],
      };
      const [from, to] = ranges[season] || [null, null];
      return { dateFrom: from, dateTo: to };
    }

    // "in <Month>" or "<Month> <year>"
    const months: Record<string, number> = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const monthMatch = q.match(/(?:in|from|during)\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+(\d{4}))?/i);
    if (monthMatch) {
      const m = months[monthMatch[1].toLowerCase()];
      const y = monthMatch[2] ? parseInt(monthMatch[2]) : (m > month ? year - 1 : year);
      return { dateFrom: new Date(y, m, 1), dateTo: new Date(y, m + 1, 0, 23, 59, 59, 999) };
    }

    // Standalone month name
    for (const [name, m] of Object.entries(months)) {
      if (q.includes(name) && name.length > 3) {
        const y = m > month ? year - 1 : year;
        return { dateFrom: new Date(y, m, 1), dateTo: new Date(y, m + 1, 0, 23, 59, 59, 999) };
      }
    }

    // "yesterday"
    if (/yesterday/i.test(q)) {
      const from = new Date(now); from.setDate(from.getDate() - 1); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setHours(23, 59, 59, 999);
      return { dateFrom: from, dateTo: to };
    }

    // "today"
    if (/today/i.test(q)) {
      const from = new Date(now); from.setHours(0, 0, 0, 0);
      return { dateFrom: from, dateTo: now };
    }

    // Explicit year: "in 2024", "2024"
    const yearMatch = q.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      const y = parseInt(yearMatch[1]);
      return { dateFrom: new Date(y, 0, 1), dateTo: new Date(y, 11, 31, 23, 59, 59, 999) };
    }

    return { dateFrom: null, dateTo: null };
  }

  private extractVisualQuery(q: string, people: string[], locations: string[]): string | null {
    let remaining = q;

    // Strip known time references
    remaining = remaining.replace(/\b(last|this|next)\s+(week|weekend|month|year|summer|winter|spring|fall|autumn|\d+\s+(?:day|week|month|year)s?)\b/gi, '');
    remaining = remaining.replace(/\b(yesterday|today|tomorrow)\b/gi, '');
    remaining = remaining.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, '');
    remaining = remaining.replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi, '');
    remaining = remaining.replace(/\b20\d{2}\b/g, '');

    // Strip people names
    for (const name of people) {
      remaining = remaining.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }

    // Strip locations
    for (const loc of locations) {
      remaining = remaining.replace(new RegExp(loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }

    // Strip filler words
    remaining = remaining.replace(/\b(photos?|pictures?|pics?|images?|show|me|find|get|search|for|the|a|an|of|with|at|in|from|on|during|my|our|and|or|when|where|what|who|did|do|was|were|is|are|i|we|all|any|some|took|taken|had|have)\b/gi, '');
    remaining = remaining.replace(/[?,.'":;!]/g, '').trim().replace(/\s+/g, ' ').trim();

    return remaining.length >= 2 ? remaining : null;
  }

  private async resolvePersonNames(ownerId: string, names: string[]): Promise<string[]> {
    if (names.length === 0) return [];

    const people = await this.prisma.person.findMany({
      where: { ownerId },
      select: { id: true, name: true },
    });

    const matched: string[] = [];
    for (const searchName of names) {
      const lower = searchName.toLowerCase();
      for (const person of people) {
        if (!person.name) continue;
        const personLower = person.name.toLowerCase();
        if (personLower === lower ||
            personLower.includes(lower) ||
            lower.includes(personLower) ||
            this.fuzzyMatch(lower, personLower)) {
          matched.push(person.id);
        }
      }
    }

    return [...new Set(matched)];
  }

  private fuzzyMatch(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 2) return false;
    let mismatches = 0;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    let j = 0;
    for (let i = 0; i < longer.length && j < shorter.length; i++) {
      if (longer[i] === shorter[j]) { j++; }
      else { mismatches++; }
    }
    mismatches += shorter.length - j;
    return mismatches <= 1;
  }

  private async structuredSearch(filters: string[], params: any[], limit: number): Promise<any[]> {
    const where = filters.join(' AND ');
    const query = `
      SELECT a.id, a."ownerId", a."fileName", a."mimeType", a."type",
             a."thumbnailSmallPath", a."thumbnailLargePath",
             a."fileCreatedAt", a."fileSizeBytes"::text AS "fileSizeBytes",
             a."isFavorite", a."isArchived", a."locationCity", a."locationCountry",
             a."width", a."height"
      FROM assets a
      WHERE ${where}
      ORDER BY a."fileCreatedAt" DESC
      LIMIT ${limit}
    `;
    return this.prisma.$queryRawUnsafe(query, ...params);
  }

  private async semanticSearch(
    ownerId: string,
    visualQuery: string,
    extraFilters: string[],
    extraParams: any[],
    limit: number,
  ): Promise<any[]> {
    try {
      const res = await axios.post(`${ML_URL}/embed/text`, { text: visualQuery }, { timeout: 15000 });
      const embedding: number[] = res.data.embedding;
      if (!embedding || embedding.length !== 512) return [];

      const vec = `[${embedding.join(',')}]`;
      const where = extraFilters.join(' AND ');

      const query = `
        SELECT a.id, a."ownerId", a."fileName", a."mimeType", a."type",
               a."thumbnailSmallPath", a."thumbnailLargePath",
               a."fileCreatedAt", a."fileSizeBytes"::text AS "fileSizeBytes",
               a."isFavorite", a."isArchived", a."locationCity", a."locationCountry",
               a."width", a."height",
               1 - (a."clipEmbedding" <=> '${vec}'::vector) AS similarity
        FROM assets a
        WHERE ${where} AND a."clipEmbedding" IS NOT NULL
        ORDER BY a."clipEmbedding" <=> '${vec}'::vector
        LIMIT ${limit}
      `;
      return this.prisma.$queryRawUnsafe(query, ...extraParams);
    } catch (err: any) {
      this.logger.warn(`Semantic search failed: ${err.message}`);
      return [];
    }
  }

  private async rerankByCLIP(candidates: any[], visualQuery: string, limit: number): Promise<any[]> {
    try {
      const res = await axios.post(`${ML_URL}/embed/text`, { text: visualQuery }, { timeout: 15000 });
      const embedding: number[] = res.data.embedding;
      if (!embedding || embedding.length !== 512) return candidates.slice(0, limit);

      const vec = `[${embedding.join(',')}]`;
      const ids = candidates.map(a => a.id);

      const rows: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT id, 1 - ("clipEmbedding" <=> '${vec}'::vector) AS similarity
        FROM assets
        WHERE id = ANY($1) AND "clipEmbedding" IS NOT NULL
      `, ids);

      const simMap = new Map(rows.map(r => [r.id, Number(r.similarity)]));

      return candidates
        .map(a => ({ ...a, similarity: simMap.get(a.id) ?? 0 }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch {
      return candidates.slice(0, limit);
    }
  }

  private buildContext(parsed: ParsedQuery, personIds: string[], mode: string): string {
    const parts: string[] = [];

    if (personIds.length > 0) {
      parts.push(`Matched ${personIds.length} person(s): ${parsed.people.join(', ')}`);
    } else if (parsed.people.length > 0) {
      parts.push(`Could not find people named: ${parsed.people.join(', ')}`);
    }

    if (parsed.locations.length > 0) {
      parts.push(`Location filter: ${parsed.locations.join(', ')}`);
    }

    if (parsed.dateFrom || parsed.dateTo) {
      const from = parsed.dateFrom?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) ?? 'any';
      const to = parsed.dateTo?.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) ?? 'now';
      parts.push(`Date range: ${from} — ${to}`);
    }

    if (parsed.visualQuery) {
      parts.push(`Visual search: "${parsed.visualQuery}"`);
    }

    if (parts.length === 0) return 'Showing all matching photos';
    return parts.join(' · ');
  }
}
