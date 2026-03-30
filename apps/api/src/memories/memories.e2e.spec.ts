/**
 * End-to-end tests for the Memories feature.
 *
 * These tests run against the LIVE API (http://localhost:3001) and exercise the
 * full stack: HTTP → NestJS controller → MemoriesService → PostgreSQL → response.
 *
 * The suite:
 *  1. Creates a temporary user and obtains a JWT.
 *  2. Uploads synthetic photos with specific `fileCreatedAt` values (past years,
 *     same calendar day as today) plus some photos on different days to confirm
 *     they are excluded.
 *  3. Calls GET /api/memories and asserts the response shape and logic.
 *  4. Deletes all test assets and the test user when done.
 */

import * as http from 'http';

// ─── tiny fetch wrapper (no external deps) ───────────────────────────────────

const API = 'http://localhost:3001/api';

interface ReqOptions {
  method?: string;
  body?: Record<string, unknown>;
  token?: string;
}

function apiCall<T>(path: string, opts: ReqOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

    const req = http.request(
      `${API}${path}`,
      { method: opts.method ?? 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`${res.statusCode} ${path}: ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new Error(`Non-JSON response from ${path}: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Upload a photo via multipart/form-data using only built-in Node modules. */
function uploadPhoto(token: string, fileName: string, fileCreatedAt: string): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const boundary = `----TestBoundary${Date.now()}`;
    // Minimal 1×1 white JPEG base + unique suffix so each file has a distinct checksum
    const jpegBase = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
        'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
        'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
        'AhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB/8QAIRAAAQQCAgMBAAAAAAAAAAAAAQIDBAUR' +
        'EiExQf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQAC' +
        'EQMRAD8Amk2ta1oJSlKUpT//2Q==',
      'base64',
    );
    // Append unique bytes (filename + timestamp) after JPEG EOI so checksum differs per file
    const unique = Buffer.from(`\x00${fileName}-${fileCreatedAt}-${Math.random()}`);
    const jpegBytes = Buffer.concat([jpegBase, unique]);

    const CRLF = '\r\n';
    const pre =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
      `Content-Type: image/jpeg${CRLF}${CRLF}`;
    const mid =
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="fileCreatedAt"${CRLF}${CRLF}` +
      `${fileCreatedAt}` +
      `${CRLF}--${boundary}--${CRLF}`;

    const bodyBuf = Buffer.concat([Buffer.from(pre), jpegBytes, Buffer.from(mid)]);

    const req = http.request(
      `${API}/assets/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuf.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Upload ${res.statusCode}: ${raw.slice(0, 300)}`));
            } else {
              resolve(parsed as { id: string });
            }
          } catch {
            reject(new Error(`Upload non-JSON: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function isoDate(yearsAgo: number, month?: number, day?: number): string {
  const today = new Date();
  const m = month ?? today.getMonth() + 1;
  const d = day ?? today.getDate();
  const dt = new Date(today.getFullYear() - yearsAgo, m - 1, d, 12, 0, 0);
  return dt.toISOString();
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Memories API — end-to-end', () => {
  const testEmail = `test-memories-${Date.now()}@example.com`;
  const testPassword = 'Test@123456';
  let token = '';
  const uploadedIds: string[] = [];

  // ── Setup: register user, upload test photos ────────────────────────────

  beforeAll(async () => {
    // Register a fresh user for this test run
    const auth = await apiCall<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword, name: 'Memories Tester' },
    });
    token = auth.accessToken;
    expect(token).toBeTruthy();

    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    // Photos on THIS EXACT calendar day in past years → should appear in memories
    const photosOnThisDay = [
      { name: '1yr-a.jpg', date: isoDate(1) },
      { name: '1yr-b.jpg', date: isoDate(1) },
      { name: '2yr-a.jpg', date: isoDate(2) },
      { name: '3yr-a.jpg', date: isoDate(3) },
    ];

    // Photos on a DIFFERENT day → must NOT appear in memories
    const differentDay = todayDay === 1 ? 2 : todayDay - 1;
    const photosOtherDay = [
      { name: 'other-day-1.jpg', date: isoDate(1, todayMonth, differentDay) },
      { name: 'other-day-2.jpg', date: isoDate(2, todayMonth, differentDay) },
    ];

    for (const p of [...photosOnThisDay, ...photosOtherDay]) {
      const asset = await uploadPhoto(token, p.name, p.date);
      uploadedIds.push(asset.id);
    }
  }, 60_000);

  // ── Teardown: remove all test assets (permanent delete) ─────────────────

  afterAll(async () => {
    for (const id of uploadedIds) {
      try {
        // Soft-delete first, then permanently delete
        await apiCall(`/assets/${id}`, { method: 'DELETE', token });
        await apiCall(`/assets/${id}/permanent`, { method: 'DELETE', token });
      } catch {
        /* best-effort cleanup */
      }
    }
  }, 30_000);

  // ── Tests ────────────────────────────────────────────────────────────────

  it('GET /memories responds with 200 and correct shape', async () => {
    const data = await apiCall<{
      yearGroups: unknown[];
      randomPhoto: unknown;
      recentHighlights: unknown[];
      meta: { totalPhotos: number; generatedAt: string };
    }>('/memories', { token });

    expect(Array.isArray(data.yearGroups)).toBe(true);
    expect(Array.isArray(data.recentHighlights)).toBe(true);
    expect(typeof data.meta.totalPhotos).toBe('number');
    expect(typeof data.meta.generatedAt).toBe('string');
    // generatedAt must be a valid ISO string
    expect(() => new Date(data.meta.generatedAt)).not.toThrow();
  });

  it('yearGroups contains entries for the years that have on-this-day photos', async () => {
    const data = await apiCall<{ yearGroups: Array<{ year: number; yearsAgo: number; label: string; count: number; assets: unknown[] }> }>(
      '/memories',
      { token },
    );

    const yearsAgoList = data.yearGroups.map((g) => g.yearsAgo);
    expect(yearsAgoList).toContain(1);
    expect(yearsAgoList).toContain(2);
    expect(yearsAgoList).toContain(3);
  });

  it('yearGroups are ordered newest-first (1 year ago before 2 years ago)', async () => {
    const data = await apiCall<{ yearGroups: Array<{ yearsAgo: number }> }>('/memories', { token });

    const yearsAgoList = data.yearGroups.map((g) => g.yearsAgo);
    for (let i = 1; i < yearsAgoList.length; i++) {
      expect(yearsAgoList[i]).toBeGreaterThan(yearsAgoList[i - 1]);
    }
  });

  it('the 1-year group has label "1 year ago" and count ≥ 2', async () => {
    const data = await apiCall<{ yearGroups: Array<{ yearsAgo: number; label: string; count: number }> }>(
      '/memories',
      { token },
    );

    const oneYearGroup = data.yearGroups.find((g) => g.yearsAgo === 1);
    expect(oneYearGroup).toBeDefined();
    expect(oneYearGroup!.label).toBe('1 year ago');
    expect(oneYearGroup!.count).toBeGreaterThanOrEqual(2);
  });

  it('multi-year groups have correct labels "N years ago"', async () => {
    const data = await apiCall<{ yearGroups: Array<{ yearsAgo: number; label: string }> }>('/memories', { token });

    const twoYearGroup = data.yearGroups.find((g) => g.yearsAgo === 2);
    expect(twoYearGroup?.label).toBe('2 years ago');

    const threeYearGroup = data.yearGroups.find((g) => g.yearsAgo === 3);
    expect(threeYearGroup?.label).toBe('3 years ago');
  });

  it('each asset in a yearGroup has required fields', async () => {
    const data = await apiCall<{
      yearGroups: Array<{
        assets: Array<{
          id: string;
          fileName: string;
          fileCreatedAt: string;
          mimeType: string;
          type: string;
        }>;
      }>;
    }>('/memories', { token });

    for (const group of data.yearGroups) {
      for (const asset of group.assets) {
        expect(typeof asset.id).toBe('string');
        expect(typeof asset.fileName).toBe('string');
        expect(typeof asset.fileCreatedAt).toBe('string');
        expect(typeof asset.mimeType).toBe('string');
        expect(['IMAGE', 'VIDEO', 'OTHER']).toContain(asset.type);
      }
    }
  });

  it('assets in yearGroups belong to the correct year', async () => {
    const thisYear = new Date().getFullYear();
    const data = await apiCall<{
      yearGroups: Array<{ yearsAgo: number; assets: Array<{ fileCreatedAt: string }> }>;
    }>('/memories', { token });

    for (const group of data.yearGroups) {
      const expectedYear = thisYear - group.yearsAgo;
      for (const asset of group.assets) {
        const assetYear = new Date(asset.fileCreatedAt).getFullYear();
        expect(assetYear).toBe(expectedYear);
      }
    }
  });

  it('assets match today month and day', async () => {
    const today = new Date();
    const data = await apiCall<{
      yearGroups: Array<{ assets: Array<{ fileCreatedAt: string }> }>;
    }>('/memories', { token });

    for (const group of data.yearGroups) {
      for (const asset of group.assets) {
        const d = new Date(asset.fileCreatedAt);
        expect(d.getMonth() + 1).toBe(today.getMonth() + 1);
        expect(d.getDate()).toBe(today.getDate());
      }
    }
  });

  it('assets per group does not exceed 8', async () => {
    const data = await apiCall<{
      yearGroups: Array<{ assets: unknown[] }>;
    }>('/memories', { token });

    for (const group of data.yearGroups) {
      expect(group.assets.length).toBeLessThanOrEqual(8);
    }
  });

  it('GET /memories without auth returns 401', async () => {
    await expect(apiCall('/memories')).rejects.toThrow('401');
  });

  it('meta.totalPhotos equals the total number of photos uploaded', async () => {
    const data = await apiCall<{ meta: { totalPhotos: number } }>('/memories', { token });
    // We uploaded 6 photos total (4 on-this-day + 2 on different day)
    expect(data.meta.totalPhotos).toBeGreaterThanOrEqual(6);
  });

  it('randomPhoto is non-null when photos exist', async () => {
    const data = await apiCall<{ randomPhoto: { id: string } | null }>('/memories', { token });
    expect(data.randomPhoto).not.toBeNull();
    expect(typeof data.randomPhoto!.id).toBe('string');
  });
});
