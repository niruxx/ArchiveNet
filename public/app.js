const form = document.getElementById('archive-form');
const input = document.getElementById('url-input');
const btn = document.getElementById('archive-btn');
const recursiveCheckbox = document.getElementById('recursive-checkbox');
const recursiveWarning = document.getElementById('recursive-warning');

const toast = document.getElementById('toast');
const toastIcon = document.getElementById('toast-icon');
const toastText = document.getElementById('toast-text');

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

const snapshotsBtn = document.getElementById('snapshots-btn');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFile = document.getElementById('import-file');
const themeToggle = document.getElementById('theme-toggle');
const dialogOverlay = document.getElementById('dialog-overlay');
const dialogTitle = document.getElementById('dialog-title');
const dialogBack = document.getElementById('dialog-back');
const dialogClose = document.getElementById('dialog-close');
const dialogBody = document.getElementById('dialog-body');

const recentGallery = document.getElementById('recent-gallery');
const recentGalleryGrid = document.getElementById('recent-gallery-grid');
const RECENT_GALLERY_LIMIT = 6;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function thumbStyle(thumbnail) {
  return thumbnail ? `background-image: url('/archived/${thumbnail}')` : '';
}

/* ---------------- dark mode ---------------- */

const THEME_KEY = 'archivenet-theme';

function syncThemeToggle(theme) {
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

syncThemeToggle(document.documentElement.getAttribute('data-theme') || 'light');

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  syncThemeToggle(next);
});

/* ---------------- recent gallery ---------------- */

async function loadRecentGallery() {
  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();

    if (!res.ok || !sites.length) {
      recentGallery.hidden = true;
      return;
    }

    recentGalleryGrid.innerHTML = sites.slice(0, RECENT_GALLERY_LIMIT).map(renderRecentCard).join('');
    recentGalleryGrid.querySelectorAll('[data-domain]').forEach((card) => {
      card.addEventListener('click', () => openSiteCalendar(card.dataset.domain));
    });
    recentGallery.hidden = false;
  } catch {
    recentGallery.hidden = true;
  }
}

function renderRecentCard(site) {
  return `
    <div class="recent-gallery-card" data-domain="${escapeHtml(site.domain)}">
      <div class="recent-gallery-thumb" style="${thumbStyle(site.thumbnail)}">${site.thumbnail ? '' : '🌐'}</div>
      <div class="recent-gallery-label">${escapeHtml(site.domain)}</div>
    </div>`;
}

loadRecentGallery();

/* ---------------- snackbar ---------------- */

let toastTimer;
function showToast(message, variant = 'success') {
  clearTimeout(toastTimer);
  toastIcon.textContent = variant === 'success' ? '✅' : '⚠️';
  toastText.textContent = message;
  toast.classList.toggle('error', variant === 'error');
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

/* ---------------- archive form ---------------- */

recursiveCheckbox.addEventListener('change', () => {
  recursiveWarning.hidden = !recursiveCheckbox.checked;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  const recursive = recursiveCheckbox.checked;

  btn.disabled = true;
  btn.textContent = recursive ? 'Archiving site…' : 'Archiving…';

  try {
    const res = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, recursive })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Archive failed', 'error');
      return;
    }

    const savedSublinks = data.sublinks.filter((s) => !s.error).length;
    const capNote = data.truncated ? ' (site had more — stopped at the page limit)' : '';
    showToast(
      savedSublinks
        ? `Archive completed — ${savedSublinks} sub-link${savedSublinks === 1 ? '' : 's'} saved${capNote}`
        : 'Archive completed'
    );
    input.value = '';
    loadRecentGallery();
  } catch (err) {
    showToast(err.message || 'Archive failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Archive';
  }
});

/* ---------------- search ---------------- */

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.classList.remove('show');
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 250);
});

document.addEventListener('click', (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.remove('show');
  }
});

async function runSearch(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderSearchResults(data);
  } catch {
    searchResults.innerHTML = '<div class="search-empty">Search failed.</div>';
    searchResults.classList.add('show');
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-empty">No archived links match.</div>';
    searchResults.classList.add('show');
    return;
  }

  searchResults.innerHTML = results.map((entry, i) => `
    <div class="search-row" data-index="${i}">
      <div class="search-thumb" style="${thumbStyle(entry.thumbnail)}">${entry.thumbnail ? '' : '🌐'}</div>
      <div class="search-row-text">
        <div class="search-row-url">${escapeHtml(entry.url)}</div>
        <div class="search-row-meta">${escapeHtml(entry.domain)} · ${escapeHtml(new Date(entry.archivedAt).toLocaleString())}</div>
      </div>
      <div class="snapshot-links">
        <a href="/archived/${entry.dir}/page.html" target="_blank" rel="noopener">HTML</a>
        <a href="/archived/${entry.dir}/page.pdf" target="_blank" rel="noopener">PDF</a>
      </div>
    </div>
  `).join('');

  searchResults.querySelectorAll('.search-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const entry = results[Number(row.dataset.index)];
      searchResults.classList.remove('show');
      openSiteCalendar(entry.domain);
    });
  });

  searchResults.classList.add('show');
}

/* ---------------- dialog shell ---------------- */

function openDialog() {
  dialogOverlay.hidden = false;
}

function closeDialog() {
  dialogOverlay.hidden = true;
}

dialogClose.addEventListener('click', closeDialog);
dialogOverlay.addEventListener('click', (e) => {
  if (e.target === dialogOverlay) closeDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dialogOverlay.hidden) closeDialog();
});

snapshotsBtn.addEventListener('click', () => {
  openDialog();
  showSitesGrid();
});

/* ---------------- snapshots grid ---------------- */

async function showSitesGrid() {
  dialogTitle.textContent = 'Snapshots';
  dialogBack.hidden = true;
  dialogBack.onclick = null;
  dialogBody.innerHTML = '<div class="dialog-loading">Loading…</div>';

  try {
    const res = await fetch('/api/sites');
    const sites = await res.json();

    if (!sites.length) {
      dialogBody.innerHTML = '<div class="dialog-empty">No archived sites yet.</div>';
      return;
    }

    dialogBody.innerHTML = `<div class="site-grid">${sites.map(renderSiteCard).join('')}</div>`;

    dialogBody.querySelectorAll('[data-domain]').forEach((card) => {
      card.addEventListener('click', () => showCalendar(card.dataset.domain));
    });

    dialogBody.querySelectorAll('[data-delete-site]').forEach((delBtn) => {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const domain = delBtn.dataset.deleteSite;
        const count = Number(delBtn.dataset.count);

        if (!confirm(`Delete all ${count} snapshot${count === 1 ? '' : 's'} for ${domain}? This cannot be undone.`)) {
          return;
        }

        try {
          const res = await fetch(`/api/sites/${encodeURIComponent(domain)}`, { method: 'DELETE' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            showToast(data.error || 'Delete failed', 'error');
            return;
          }
          showToast(`Deleted ${domain}`);
          showSitesGrid();
          loadRecentGallery();
        } catch (err) {
          showToast(err.message || 'Delete failed', 'error');
        }
      });
    });
  } catch (err) {
    dialogBody.innerHTML = `<div class="dialog-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderSiteCard(site) {
  return `
    <div class="site-card" data-domain="${escapeHtml(site.domain)}">
      <div class="site-thumb" style="${thumbStyle(site.thumbnail)}">${site.thumbnail ? '' : '🌐'}</div>
      <button
        type="button"
        class="site-delete-btn"
        data-delete-site="${escapeHtml(site.domain)}"
        data-count="${site.count}"
        aria-label="Delete all snapshots for ${escapeHtml(site.domain)}"
      >🗑️</button>
      <div class="site-info">
        <div class="site-domain">${escapeHtml(site.domain)}</div>
        <div class="site-meta">${site.count} snapshot${site.count === 1 ? '' : 's'} · ${escapeHtml(new Date(site.latestArchivedAt).toLocaleDateString())}</div>
      </div>
    </div>`;
}

function openSiteCalendar(domain) {
  openDialog();
  showCalendar(domain);
}

/* ---------------- per-site calendar ---------------- */

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function showCalendar(domain) {
  dialogTitle.textContent = domain;
  dialogBack.hidden = false;
  dialogBack.onclick = () => showSitesGrid();
  dialogBody.innerHTML = '<div class="dialog-loading">Loading…</div>';

  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(domain)}`);
    const entries = await res.json();

    if (!res.ok) {
      dialogBody.innerHTML = `<div class="dialog-empty">${escapeHtml(entries.error || 'Site not found.')}</div>`;
      return;
    }
    if (!entries.length) {
      dialogBody.innerHTML = '<div class="dialog-empty">No snapshots for this site.</div>';
      return;
    }

    const byDay = new Map();
    for (const entry of entries) {
      const key = dayKey(new Date(entry.archivedAt));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(entry);
    }

    const latest = new Date(entries[entries.length - 1].archivedAt);
    let viewYear = latest.getFullYear();
    let viewMonth = latest.getMonth();
    let selectedKey = dayKey(latest);

    dialogBody.innerHTML = `
      <div class="calendar-header">
        <button class="icon-btn" id="cal-prev" type="button" aria-label="Previous month">‹</button>
        <span id="cal-month-label"></span>
        <button class="icon-btn" id="cal-next" type="button" aria-label="Next month">›</button>
      </div>
      <div class="calendar-grid" id="calendar-grid"></div>
      <div class="calendar-day-panel" id="calendar-day-panel"></div>
    `;

    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('cal-month-label');
    const dayPanel = document.getElementById('calendar-day-panel');

    function renderMonth() {
      monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

      const cells = WEEKDAYS.map((d) => `<div class="calendar-weekday">${d}</div>`);
      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      for (let i = 0; i < firstOfMonth.getDay(); i++) {
        cells.push('<div class="calendar-day empty"></div>');
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const key = `${viewYear}-${viewMonth}-${day}`;
        const hasArchive = byDay.has(key);
        const isSelected = key === selectedKey;
        cells.push(
          `<div class="calendar-day${hasArchive ? ' has-archive' : ''}${isSelected ? ' selected' : ''}" data-key="${key}">${day}</div>`
        );
      }

      grid.innerHTML = cells.join('');

      grid.querySelectorAll('.calendar-day.has-archive').forEach((cell) => {
        cell.addEventListener('click', () => {
          selectedKey = cell.dataset.key;
          renderMonth();
          renderDayPanel();
        });
      });
    }

    function renderDayPanel() {
      const dayEntries = byDay.get(selectedKey);
      if (!dayEntries) {
        dayPanel.innerHTML = '<div class="dialog-empty">Pick a highlighted date to see its snapshots.</div>';
        return;
      }

      const dateLabel = new Date(dayEntries[0].archivedAt).toLocaleDateString(undefined, {
        month: 'long', day: 'numeric', year: 'numeric'
      });

      dayPanel.innerHTML = `
        <div class="day-panel-header">
          <span>${dayEntries.length} snapshot${dayEntries.length === 1 ? '' : 's'} on ${dateLabel}</span>
          <button type="button" class="btn-text btn-danger" id="delete-day-btn">🗑️ Delete this day</button>
        </div>
        ${dayEntries.map(renderSnapshotRow).join('')}
      `;

      document.getElementById('delete-day-btn').addEventListener('click', async () => {
        if (!confirm(`Delete ${dayEntries.length} snapshot${dayEntries.length === 1 ? '' : 's'} from ${dateLabel}? This cannot be undone.`)) {
          return;
        }

        try {
          const res = await fetch('/api/archives/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dirs: dayEntries.map((e) => e.dir) })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            showToast(data.error || 'Delete failed', 'error');
            return;
          }
          showToast('Day deleted');
          showCalendar(domain);
          loadRecentGallery();
        } catch (err) {
          showToast(err.message || 'Delete failed', 'error');
        }
      });
    }

    document.getElementById('cal-prev').addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderMonth();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderMonth();
    });

    renderMonth();
    renderDayPanel();
  } catch (err) {
    dialogBody.innerHTML = `<div class="dialog-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderSnapshotRow(entry) {
  const time = new Date(entry.archivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const subText = entry.sublinkCount ? ` · ${entry.sublinkCount} sub-link${entry.sublinkCount === 1 ? '' : 's'}` : '';
  return `
    <div class="snapshot-row">
      <div class="snapshot-thumb" style="${thumbStyle(entry.thumbnail)}"></div>
      <div class="snapshot-info">
        <div class="snapshot-url">${escapeHtml(entry.url)}</div>
        <div class="snapshot-time">${time}${subText}</div>
      </div>
      <div class="snapshot-links">
        <a href="/archived/${entry.dir}/page.html" target="_blank" rel="noopener">HTML</a>
        <a href="/archived/${entry.dir}/page.pdf" target="_blank" rel="noopener">PDF</a>
      </div>
    </div>`;
}

/* ---------------- export / import ---------------- */

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  try {
    const res = await fetch('/api/export');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Export failed', 'error');
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    const filename = match ? match[1] : 'archivenet-export.zip';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message || 'Export failed', 'error');
  } finally {
    exportBtn.disabled = false;
  }
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('archive', file);

  importBtn.disabled = true;
  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Import failed', 'error');
      return;
    }

    showToast('Import completed');
    if (!dialogOverlay.hidden) showSitesGrid();
    loadRecentGallery();
  } catch (err) {
    showToast(err.message || 'Import failed', 'error');
  } finally {
    importBtn.disabled = false;
    importFile.value = '';
  }
});
