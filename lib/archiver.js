const fs = require('fs/promises');
const path = require('path');

const MAX_SUBLINKS = 15;
const MAX_RECURSIVE_PAGES = 100;
const NAV_TIMEOUT_MS = 30000;
const LAZY_LOAD_WAIT_MS = 8000;
const MAX_INLINE_BYTES = 8 * 1024 * 1024;

function sanitizeSegment(segment) {
  const cleaned = segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || '_';
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

// The URL you archive -> archived/<domain>/<timestamp>/
function buildMainDir(baseDir, targetUrl, timestamp) {
  const domain = sanitizeSegment(new URL(targetUrl).hostname);
  return path.join(baseDir, domain, timestamp);
}

// A same-domain link found on that page -> <mainDir>/sub-links/<path>/<timestamp>/
function buildSublinkDir(mainDir, targetUrl, timestamp) {
  const pathSegments = new URL(targetUrl).pathname.split('/').filter(Boolean).map(sanitizeSegment);
  return path.join(mainDir, 'sub-links', ...pathSegments, timestamp);
}

function isInlinable(contentType) {
  return (
    /^image\//.test(contentType) ||
    /^font\//.test(contentType) ||
    /^application\/(x-)?font/.test(contentType) ||
    /^application\/vnd\.ms-fontobject/.test(contentType) ||
    /^text\/css/.test(contentType)
  );
}

// Scrolls the page to trigger lazy-loaded images/sections, then returns to the top.
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const distance = 600;
      const maxScroll = 15000;
      let scrolled = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrolled += distance;
        const atBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight;
        if (atBottom || scrolled >= maxScroll) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150);
    });
  });
}

// Inlines a stylesheet's own url(...)/@import references using already-captured resources,
// recursing into @import'd stylesheets (guarded against cycles via `seen`).
function processCss(url, buffer, resources, seen) {
  if (seen.has(url)) return '';
  seen.add(url);
  let text = buffer.toString('utf8');

  text = text.replace(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?\s*;/g, (match, importUrl) => {
    let resolved;
    try {
      resolved = new URL(importUrl, url).href;
    } catch {
      return match;
    }
    const nested = resources.get(resolved);
    if (nested && /^text\/css/.test(nested.contentType)) {
      return processCss(resolved, nested.buffer, resources, seen);
    }
    return `@import url("${resolved}");`;
  });

  text = text.replace(/url\((['"]?)(.*?)\1\)/g, (match, quote, inner) => {
    if (/^data:/.test(inner)) return match;
    let resolved;
    try {
      resolved = new URL(inner, url).href;
    } catch {
      return match;
    }
    const nested = resources.get(resolved);
    if (nested && !/^text\/css/.test(nested.contentType)) {
      return `url(${quote}data:${nested.contentType};base64,${nested.buffer.toString('base64')}${quote})`;
    }
    return `url(${quote}${resolved}${quote})`;
  });

  return text;
}

// Runs inside the browser page: makes the DOM self-contained (inline images/fonts/CSS as
// data URIs, absolute-ize remaining links) and strips scripts, since the DOM has already
// been fully rendered and a frozen static copy is what we want to keep.
function inlineDom(resourceMap, cssMap) {
  const abs = (url) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  };
  const lookup = (url) => resourceMap[abs(url)];

  document.querySelectorAll('img, source').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) el.setAttribute('src', lookup(src) || abs(src));

    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const rewritten = srcset
        .split(',')
        .map((part) => {
          const trimmed = part.trim();
          const spaceIdx = trimmed.indexOf(' ');
          const url = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
          const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx);
          return (lookup(url) || abs(url)) + descriptor;
        })
        .join(', ');
      el.setAttribute('srcset', rewritten);
    }
  });

  document.querySelectorAll('[style*="url("]').forEach((el) => {
    el.setAttribute(
      'style',
      el.getAttribute('style').replace(/url\((['"]?)(.*?)\1\)/g, (m, q, url) => `url(${q}${lookup(url) || abs(url)}${q})`)
    );
  });

  document.querySelectorAll('link[rel~="stylesheet"]').forEach((link) => {
    const href = link.getAttribute('href');
    const cssText = href ? cssMap[abs(href)] : undefined;
    if (cssText === undefined) {
      if (href) link.setAttribute('href', abs(href));
      return;
    }
    const style = document.createElement('style');
    style.textContent = cssText;
    link.replaceWith(style);
  });

  document.querySelectorAll('style').forEach((style) => {
    style.textContent = style.textContent.replace(/url\((['"]?)(.*?)\1\)/g, (m, q, url) => {
      if (/^data:/.test(url)) return m;
      return `url(${q}${lookup(url) || abs(url)}${q})`;
    });
  });

  document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
    const href = link.getAttribute('href');
    if (href) link.setAttribute('href', lookup(href) || abs(href));
  });

  document.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('href', abs(a.getAttribute('href')));
  });

  document.querySelectorAll('link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"]').forEach((el) => el.remove());
  document.querySelectorAll('script').forEach((el) => el.remove());
}

async function saveArchive(page, targetUrl, dir) {
  await page.setViewport({ width: 1024, height: 768 });

  const resources = new Map();
  const onResponse = async (response) => {
    try {
      const contentType = (response.headers()['content-type'] || '').split(';')[0].trim();
      if (!isInlinable(contentType)) return;
      const buffer = await response.buffer();
      if (buffer.length > MAX_INLINE_BYTES) return;
      resources.set(response.url(), { buffer, contentType });
    } catch {
      // resource body unavailable (redirected, aborted, served from disk cache) - skip it
    }
  };
  page.on('response', onResponse);

  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await autoScroll(page);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: LAZY_LOAD_WAIT_MS }).catch(() => {});

  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  const thumbnail = await page.screenshot({ type: 'jpeg', quality: 70 });

  page.off('response', onResponse);

  const resourceMap = {};
  const cssMap = {};
  for (const [url, { buffer, contentType }] of resources) {
    if (/^text\/css/.test(contentType)) {
      cssMap[url] = processCss(url, buffer, resources, new Set());
    } else {
      resourceMap[url] = `data:${contentType};base64,${buffer.toString('base64')}`;
    }
  }

  await page.evaluate(inlineDom, resourceMap, cssMap);
  const html = await page.content();

  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(path.join(dir, 'page.html'), html, 'utf8');
  await fs.writeFile(path.join(dir, 'page.pdf'), pdf);
  await fs.writeFile(path.join(dir, 'thumbnail.jpg'), thumbnail);
  await fs.writeFile(
    path.join(dir, 'metadata.json'),
    JSON.stringify({ url: targetUrl, archivedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  return { url: targetUrl, dir };
}

// Same-domain links found on the page, excluding anything already in `visited`.
// Newly found links are added to `visited` as they're returned, so the same URL
// is never queued twice across an entire crawl. `hasMore` reports whether at least
// one additional qualifying link existed beyond `limit`, so callers can tell a real
// "there was more we didn't capture" apart from "that's genuinely everything".
async function extractSameDomainLinks(page, targetUrl, visited, limit) {
  const origin = new URL(targetUrl).hostname;
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));

  const links = [];
  let hasMore = false;

  for (const href of hrefs) {
    let normalized;
    try {
      const u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      u.hash = '';
      normalized = u.toString();
      if (u.hostname !== origin) continue;
      if (visited.has(normalized)) continue;
    } catch {
      continue; // ignore malformed hrefs (e.g. mailto:, javascript:)
    }

    if (links.length >= limit) {
      hasMore = true;
      break;
    }
    visited.add(normalized);
    links.push(normalized);
  }

  return { links, hasMore };
}

function toRelative(baseDir, entry) {
  if (entry.error) return entry;
  return { ...entry, dir: path.relative(baseDir, entry.dir).split(path.sep).join('/') };
}

// Non-recursive: only links found on the main page are archived (up to MAX_SUBLINKS).
// Recursive: every same-domain page reachable by following links is archived too, breadth
// first, up to the MAX_RECURSIVE_PAGES safety cap - real sites can be effectively unbounded,
// so "recursive" still means "bounded, but generously" rather than "the whole internet".
async function archiveUrl(browser, targetUrl, baseDir, options = {}) {
  const recursive = Boolean(options.recursive);
  const onProgress = options.onProgress || (() => {});
  const maxTotalPages = recursive ? MAX_RECURSIVE_PAGES : MAX_SUBLINKS + 1;

  const page = await browser.newPage();
  try {
    const mainDir = buildMainDir(baseDir, targetUrl, formatTimestamp(new Date()));
    const main = await saveArchive(page, targetUrl, mainDir);
    onProgress({ type: 'page', role: 'main', url: targetUrl });

    const visited = new Set([targetUrl]);
    const firstBatch = await extractSameDomainLinks(page, targetUrl, visited, maxTotalPages - 1);
    const queue = firstBatch.links;
    let truncated = firstBatch.hasMore;

    const subResults = [];
    while (queue.length && subResults.length < maxTotalPages - 1) {
      const link = queue.shift();
      const subPage = await browser.newPage();
      try {
        const subDir = buildSublinkDir(mainDir, link, formatTimestamp(new Date()));
        subResults.push(await saveArchive(subPage, link, subDir));
        onProgress({ type: 'page', role: 'sublink', url: link, count: subResults.length });

        if (recursive) {
          const remaining = Math.max(maxTotalPages - 1 - subResults.length - queue.length, 0);
          const more = await extractSameDomainLinks(subPage, link, visited, remaining);
          truncated = truncated || more.hasMore;
          queue.push(...more.links);
        }
      } catch (err) {
        subResults.push({ url: link, error: err.message });
        onProgress({ type: 'error', role: 'sublink', url: link, error: err.message });
      } finally {
        await subPage.close();
      }
    }

    return {
      main: toRelative(baseDir, main),
      sublinks: subResults.map((entry) => toRelative(baseDir, entry)),
      truncated: recursive && (truncated || queue.length > 0),
    };
  } finally {
    await page.close();
  }
}

module.exports = { archiveUrl, buildMainDir, buildSublinkDir, formatTimestamp, MAX_SUBLINKS, MAX_RECURSIVE_PAGES };
