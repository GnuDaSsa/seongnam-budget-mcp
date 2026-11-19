import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const indexUrl = 'https://www.seongnam.go.kr/cn03050201';
const category = '연도별 예산서';
const maxAttachmentBytes = 1_000_000_000;

async function get(url) {
  const res = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { 'user-agent': 'SeongnamBudgetResearch/1.0 (public budget freshness check)' }
  });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${url}`);
  return res;
}

export async function listPublished(site, year, request = get) {
  const documents = [];
  let total;
  do {
    const url = new URL('/api/documents', site);
    url.search = new URLSearchParams({ year, category, limit: 20, offset: documents.length });
    const page = await (await request(url)).json();
    if (!Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== documents.length ||
        (total !== undefined && page.total !== total) || !Array.isArray(page.documents) ||
        page.documents.some(d => d.year !== year || d.category !== category || !d.url) ||
        (!page.documents.length && documents.length < page.total)) {
      throw new Error(`Invalid or incomplete published inventory: ${url}`);
    }
    total = page.total;
    documents.push(...page.documents);
  } while (documents.length < total);
  if (documents.length !== total || new Set(documents.map(d => d.url)).size !== total) {
    throw new Error(`Duplicate or inconsistent published inventory for ${year}`);
  }
  return documents;
}

export function hashDay(url) {
  return createHash('sha256').update(url).digest().readUInt32BE(0) % 7;
}

export async function hashAttachment(url, request = get) {
  const location = new URL(url);
  if (location.origin !== new URL(indexUrl).origin ||
      !/^\/humanframe\/file\/sncity\/bgt\/\d{4}\/[^/]+$/.test(location.pathname)) {
    throw new Error(`Unrecognized city budget attachment path: ${url}`);
  }
  const res = await request(url);
  if (Number(res.headers.get('content-length')) > maxAttachmentBytes) {
    await res.body.cancel();
    throw new Error(`Oversized attachment: ${url}`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (bytes > maxAttachmentBytes) throw new Error(`Oversized attachment: ${url}`);
    if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk.subarray(0, 5 - prefix.length)]);
    hash.update(chunk);
  }
  if (!bytes || /text\/html/i.test(res.headers.get('content-type') ?? '') ||
      (/\.pdf$/i.test(location.pathname) && prefix.toString('ascii') !== '%PDF-')) {
    throw new Error(`Unexpected attachment body: ${url}`);
  }
  return hash.digest('hex');
}

export async function compareDocuments(official, published, includeHash, hash = hashAttachment) {
  const source = new Map(official.map(d => [d.url, d]));
  const deployed = new Map(published.map(d => [d.url, d]));
  const edition = d => JSON.stringify([d.year, d.budget_type, d.revision]);
  const publishedEditions = new Set(published.map(edition));
  const changes = [], errors = [];
  let hashesChecked = 0;
  for (const d of official) {
    const row = deployed.get(d.url);
    const basis = { year: d.year, budget_type: d.budget_type, revision: d.revision, url: d.url };
    if (!row) {
      changes.push({ reason: 'missing_from_site', new_edition: !publishedEditions.has(edition(d)), ...basis });
      continue;
    }
    if (row.budget_type !== d.budget_type || row.revision !== d.revision) {
      changes.push({ reason: 'edition_mismatch', ...basis, site_type: row.budget_type, site_revision: row.revision });
    }
    if (!/^[a-f0-9]{64}$/.test(row.sha256 ?? '') || ['discovered','failed'].includes(row.status)) {
      changes.push({ reason: 'not_collected', ...basis, site_status: row.status });
      continue;
    }
    if (!includeHash(d.url)) continue;
    try {
      const digest = await hash(d.url);
      hashesChecked++;
      if (digest !== row.sha256) changes.push({ reason: 'content_replaced', ...basis, site_sha256: row.sha256, source_sha256: digest });
    } catch (error) {
      errors.push({ url: d.url, message: error.message });
    }
  }
  for (const d of published) {
    if (!source.has(d.url)) changes.push({ reason: 'no_longer_listed', year: d.year, url: d.url });
  }
  return { official_count: official.length, published_count: published.length, hashes_checked: hashesChecked, changes, errors };
}

async function release(site) {
  const status = await (await get(new URL('/api/status', site))).json();
  if (!status.asset_binding || !status.release?.verified_source || !/^[a-f0-9]{40}$/.test(status.release.source_sha)) {
    throw new Error('Published site did not return its verified source version');
  }
  return status.release.source_sha;
}

async function run(args) {
  if (args.some(k => !['--full-hash','--inventory-only'].includes(k)) ||
      (args.includes('--full-hash') && args.includes('--inventory-only'))) {
    throw new Error('Use --full-hash, --inventory-only, or no arguments for a daily rotating hash check');
  }
  const site = JSON.parse(await readFile(new URL('../release.config.json', import.meta.url), 'utf8')).site.url;
  const checked = new Date();
  const kst = new Date(checked.getTime() + 9 * 3600_000);
  const report = { checked_at: checked.toISOString(), site, source: indexUrl, release: await release(site) };
  const html = await (await get(indexUrl)).text();
  const parser = spawnSync(process.env.BUDGET_PYTHON || 'python', ['-X','utf8','pipeline/collect.py','--parse-index-stdin'], {
    input: html, encoding: 'utf8', maxBuffer: 16*1024*1024, cwd: new URL('../', import.meta.url)
  });
  if (parser.error || parser.status !== 0) throw new Error(`City index parser: ${parser.error?.message || parser.stderr.trim()}`);
  const docs = JSON.parse(parser.stdout);
  const current = kst.getUTCFullYear();
  const relevant = docs.filter(d => Number.isInteger(d.year) && d.year >= current - 1);
  if (!relevant.length) throw new Error('City index has no current or prior fiscal year attachments');
  const years = new Set([current-1, current, current+1, ...relevant.map(d => d.year)]);
  const published = [];
  for (const year of [...years].sort()) published.push(...await listPublished(site, year));
  const inventoryOnly = args.includes('--inventory-only');
  const full = args.includes('--full-hash');
  const result = await compareDocuments(relevant, published,
    url => !inventoryOnly && (full || hashDay(url) === kst.getUTCDay()));
  if (await release(site) !== report.release) throw new Error('Site changed during audit; run against a single release');
  const state = result.errors.length ? 'incomplete' : result.changes.length ? 'changed' : 'current';
  console.log(JSON.stringify({ ...report, years: [...years].sort(), hash_mode: inventoryOnly ? 'none' : full ? 'all' : 'weekly_rotation', ...result, state }, null, 2));
  return state === 'incomplete' ? 2 : state === 'changed' ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await run(process.argv.slice(2)); }
  catch (error) {
    console.log(JSON.stringify({ state: 'incomplete', message: error.message, cause: error.cause?.message }));
    process.exitCode = 2;
  }
}
