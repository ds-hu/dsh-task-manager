/**
 * Panel stylesheet.
 *
 * Kept as one template string and injected once into the host document, because
 * the client bundle is a single JS module (no separate CSS asset). Class names
 * are prefixed `tm-` so they cannot collide with host styles.
 */

export const STYLE_ID = 'dsh-task-manager-styles';

export const CSS = `
.tm-root {
  --tm-bg: #f3f3f3;
  --tm-surface: #ffffff;
  --tm-surface-alt: #f7f7f7;
  --tm-text: #1b1b1b;
  --tm-text-secondary: #5c5c5c;
  --tm-divider: #e5e5e5;
  --tm-accent: #0067c0;
  --tm-accent-soft: #e5f1fb;
  --tm-row-hover: #f0f0f0;
  --tm-row-selected: #cce4f7;
  --tm-grid: #e8e8e8;
  --tm-graph: #3b82f6;
  --tm-graph-fill: rgba(59, 130, 246, .16);
  --tm-danger: #c42b1c;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--tm-bg);
  color: var(--tm-text);
  font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.tm-root[data-theme="dark"] {
  --tm-bg: #202020;
  --tm-surface: #272727;
  --tm-surface-alt: #2d2d2d;
  --tm-text: #ffffff;
  --tm-text-secondary: #b9b9b9;
  --tm-divider: #3a3a3a;
  --tm-accent: #4cc2ff;
  --tm-accent-soft: #1d3a52;
  --tm-row-hover: #2f2f2f;
  --tm-row-selected: #294a66;
  --tm-grid: #3a3a3a;
  --tm-graph: #4cc2ff;
  --tm-graph-fill: rgba(76, 194, 255, .16);
  --tm-danger: #ff99a4;
}
.tm-root *, .tm-root *::before, .tm-root *::after { box-sizing: border-box; }

/* ---------- title row ---------- */
.tm-titlebar {
  flex: 0 0 44px;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 14px;
  background: var(--tm-surface);
  border-bottom: 1px solid var(--tm-divider);
}
.tm-titlebar-icon { width: 20px; height: 20px; color: var(--tm-accent); display: flex; align-items: center; justify-content: center; flex: 0 0 20px; }
.tm-titlebar-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-titlebar-spacer { flex: 1; min-width: 0; }
.tm-iconbtn {
  width: 32px; height: 32px; flex: 0 0 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 4px; padding: 0;
  background: transparent; color: inherit; cursor: pointer;
}
.tm-iconbtn:hover:not(:disabled) { background: var(--tm-row-hover); }
.tm-iconbtn:active:not(:disabled) { background: var(--tm-row-selected); }
.tm-iconbtn:disabled { opacity: .45; cursor: default; }
.tm-iconbtn:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -2px; }

/* ---------- body / rail ---------- */
.tm-body { flex: 1; min-height: 0; display: flex; }
.tm-rail {
  width: 196px; flex: 0 0 196px;
  display: flex; flex-direction: column;
  padding: 6px 8px 8px;
  background: var(--dsw-specific-sidebar-fill, var(--tm-surface-alt));
  border-right: 1px solid var(--tm-divider);
  transition: width .15s ease, flex-basis .15s ease;
  overflow: hidden;
}
.tm-rail[data-collapsed="true"] { width: 48px; flex-basis: 48px; padding: 6px 4px 8px; }
.tm-rail-toggle { margin-bottom: 6px; }
.tm-rail[data-collapsed="true"] .tm-rail-toggle { margin-left: 0; }
.tm-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.tm-nav-item {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  height: 36px; width: 100%;
  padding: 0 10px;
  border: 0; border-radius: 4px;
  background: transparent; color: var(--tm-text);
  font: inherit; font-size: 13px; text-align: left; white-space: nowrap;
  cursor: pointer;
}
.tm-nav-item:hover { background: var(--tm-row-hover); }
.tm-nav-item[aria-current="page"] { background: var(--tm-accent-soft); color: var(--tm-accent); font-weight: 600; }
.tm-nav-item[aria-current="page"]::before {
  content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px;
  border-radius: 2px; background: var(--tm-accent);
}
.tm-nav-item:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -2px; }
.tm-nav-icon { width: 18px; height: 18px; flex: 0 0 18px; display: flex; align-items: center; justify-content: center; }
.tm-nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tm-rail[data-collapsed="true"] .tm-nav-item { justify-content: center; gap: 0; padding: 0; }
.tm-rail[data-collapsed="true"] .tm-nav-label { display: none; }
.tm-rail-footer { margin-top: auto; padding-top: 6px; border-top: 1px solid var(--tm-divider); }

/* ---------- content column ---------- */
.tm-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--tm-bg); }
.tm-page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tm-page-header {
  flex: 0 0 48px; height: 48px;
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px;
  background: var(--tm-surface);
  border-bottom: 1px solid var(--tm-divider);
}
.tm-page-title { flex: 1; min-width: 0; margin: 0; font-size: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-page-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.tm-page-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tm-scroll { flex: 1; min-height: 0; overflow: auto; position: relative; overscroll-behavior: contain; }
.tm-toolbar {
  flex: 0 0 44px; height: 44px;
  display: flex; align-items: center; gap: 10px;
  padding: 0 16px;
  background: var(--tm-surface);
  border-bottom: 1px solid var(--tm-divider);
}
.tm-toolbar-spacer { flex: 1; min-width: 0; }
.tm-footnote {
  flex: 0 0 auto;
  padding: 8px 16px;
  border-top: 1px solid var(--tm-divider);
  background: var(--tm-surface);
  font-size: 12px; color: var(--tm-text-secondary);
}

/* ---------- buttons ---------- */
.tm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 14px;
  border: 1px solid var(--tm-divider); border-radius: 4px;
  background: var(--tm-surface); color: inherit;
  font: inherit; font-size: 12px; white-space: nowrap;
  cursor: pointer;
}
.tm-btn:hover:not(:disabled) { background: var(--tm-row-hover); }
.tm-btn:active:not(:disabled) { background: var(--tm-row-selected); }
.tm-btn:disabled { opacity: .45; cursor: default; }
.tm-btn:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: 1px; }
.tm-btn-primary { background: var(--tm-accent); border-color: var(--tm-accent); color: #fff; }
.tm-btn-primary:hover:not(:disabled) { background: var(--tm-accent); filter: brightness(1.08); }
.tm-btn-danger { color: var(--tm-danger); }
.tm-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--tm-danger) 12%, transparent); }
.tm-btn-sm { height: 26px; padding: 0 10px; }

/* ---------- search ---------- */
.tm-search {
  display: flex; align-items: center; gap: 6px;
  height: 30px; min-width: 220px; max-width: 380px; flex: 0 1 340px;
  padding: 0 8px;
  border: 1px solid var(--tm-divider); border-radius: 4px;
  background: var(--tm-surface); color: var(--tm-text-secondary);
}
.tm-search:focus-within { border-color: var(--tm-accent); box-shadow: 0 0 0 1px var(--tm-accent); }
.tm-search-icon { display: flex; flex: 0 0 16px; width: 16px; height: 16px; }
.tm-search-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--tm-text); font: inherit; font-size: 12px; }
.tm-search-input::placeholder { color: var(--tm-text-secondary); opacity: .8; }
.tm-search-clear { border: 0; background: transparent; color: inherit; cursor: pointer; display: flex; padding: 0; border-radius: 2px; }
.tm-search-clear:hover { color: var(--tm-text); }

/* ---------- tables ---------- */
.tm-table { display: flex; flex-direction: column; min-width: 0; }
.tm-table-header {
  position: sticky; top: 0; z-index: 3;
  display: grid; align-items: center;
  flex: 0 0 32px; height: 32px;
  padding: 0 8px 0 16px;
  background: var(--tm-surface);
  border-bottom: 1px solid var(--tm-divider);
  font-size: 12px; font-weight: 600; color: var(--tm-text-secondary);
  user-select: none;
}
.tm-table-header.tm-table-header-actions { padding-right: 40px; }
.tm-table-row {
  display: grid; align-items: center;
  min-height: 30px; height: 30px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--tm-divider) 55%, transparent);
  font-size: 13px; color: var(--tm-text);
  cursor: default; user-select: none;
}
.tm-root[data-compact="true"] .tm-table-row { min-height: 26px; height: 26px; }
.tm-table-row:hover { background: var(--tm-row-hover); }
.tm-table-row[aria-selected="true"] { background: var(--tm-row-selected); }
.tm-table-row[aria-selected="true"]:hover { background: var(--tm-row-selected); }
.tm-table-row:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -2px; }
.tm-grid-processes { column-gap: 4px; grid-template-columns: minmax(220px, 1fr) 88px 76px 104px 96px 88px; }
.tm-grid-details { column-gap: 4px; grid-template-columns: minmax(200px, 1.4fr) 76px 92px 120px 76px 104px 92px 92px 68px 76px minmax(240px, 2fr); min-width: 1180px; }
.tm-grid-services { column-gap: 4px; grid-template-columns: minmax(180px, 1fr) 76px minmax(220px, 1.6fr) 96px 96px; min-width: 720px; }
.tm-grid-history { column-gap: 4px; grid-template-columns: minmax(200px, 1fr) 120px 120px 130px 170px; min-width: 760px; }
.tm-grid-startup { column-gap: 4px; grid-template-columns: minmax(180px, 1fr) minmax(240px, 2fr) 96px 100px; min-width: 700px; }
.tm-grid-users { column-gap: 4px; grid-template-columns: 140px 110px 140px 140px; min-width: 540px; }
.tm-th { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-th-num { text-align: right; padding-right: 4px; }
.tm-sort-btn {
  display: inline-flex; align-items: center; gap: 3px;
  border: 0; background: transparent; color: inherit;
  font: inherit; font-weight: 600; padding: 0; cursor: pointer;
  max-width: 100%; overflow: hidden;
}
.tm-sort-btn:hover { color: var(--tm-text); }
.tm-sort-btn:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: 2px; border-radius: 2px; }
.tm-sort-btn[aria-sort="ascending"], .tm-sort-btn[aria-sort="descending"] { color: var(--tm-text); }
.tm-sort-icon { font-size: 9px; line-height: 1; opacity: .9; }
.tm-cell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-cell-num { text-align: right; padding-right: 4px; font-variant-numeric: tabular-nums; }
.tm-cell-status { color: var(--tm-text-secondary); font-size: 12px; }
.tm-cell-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tm-cell-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-cell-icon { width: 16px; height: 16px; flex: 0 0 16px; display: flex; align-items: center; justify-content: center; }
.tm-chevron-btn {
  width: 18px; height: 18px; flex: 0 0 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 3px; padding: 0; background: transparent; color: var(--tm-text-secondary); cursor: pointer;
}
.tm-chevron-btn:hover { background: var(--tm-row-hover); color: var(--tm-text); }
.tm-chevron-btn:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -1px; }
.tm-chevron { transition: transform .12s ease; display: flex; }
.tm-chevron[data-open="true"] { transform: rotate(90deg); }
.tm-indent { flex: 0 0 20px; width: 20px; }

/* process groups */
.tm-group-row {
  display: grid; align-items: center;
  height: 32px; min-height: 32px;
  padding: 0 8px 0 10px;
  background: var(--tm-surface);
  border-bottom: 1px solid var(--tm-divider);
  font-size: 13px; font-weight: 600;
  cursor: pointer; user-select: none;
}
.tm-root[data-compact="true"] .tm-group-row { height: 28px; min-height: 28px; }
.tm-group-row:hover { background: var(--tm-surface-alt); }
.tm-group-row:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -2px; }
.tm-group-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tm-group-label-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- status bar ---------- */
.tm-statusbar {
  flex: 0 0 38px; height: 38px;
  display: flex; align-items: center; gap: 16px;
  padding: 0 12px 0 16px;
  background: var(--tm-surface);
  border-top: 1px solid var(--tm-divider);
  font-size: 12px; color: var(--tm-text-secondary);
}
.tm-statusbar-items { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.tm-statusbar-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-statusbar-btn { margin-left: auto; }

/* ---------- progress line ---------- */
.tm-progress { position: absolute; top: 0; left: 0; right: 0; height: 2px; overflow: hidden; z-index: 30; pointer-events: none; }
.tm-progress::before {
  content: ""; position: absolute; top: 0; left: -40%; width: 40%; height: 100%;
  background: var(--tm-accent); animation: tm-progress 1.1s linear infinite;
}
@keyframes tm-progress { to { left: 100%; } }

/* ---------- empty / loading / error ---------- */
.tm-empty {
  flex: 1; min-height: 180px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 40px 24px;
  color: var(--tm-text-secondary); font-size: 13px; text-align: center;
}
.tm-empty-title { color: var(--tm-text); font-size: 14px; font-weight: 600; }
.tm-empty-detail { max-width: 520px; line-height: 1.5; }
.tm-empty-actions { display: flex; gap: 8px; margin-top: 4px; }
.tm-spinner {
  width: 20px; height: 20px; flex: 0 0 20px;
  border: 2px solid var(--tm-divider); border-top-color: var(--tm-accent);
  border-radius: 50%; animation: tm-spin .8s linear infinite;
}
@keyframes tm-spin { to { transform: rotate(360deg); } }
.tm-error-icon { width: 28px; height: 28px; color: var(--tm-danger); }

/* ---------- performance ---------- */
.tm-perf { flex: 1; min-height: 0; display: flex; }
.tm-perf-cards { width: 232px; flex: 0 0 232px; overflow-y: auto; padding: 8px; background: var(--tm-surface); border-right: 1px solid var(--tm-divider); }
.tm-perf-card {
  width: 100%; min-height: 64px;
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
  padding: 6px 10px 6px 8px;
  border: 0; border-left: 3px solid transparent; border-radius: 4px;
  background: transparent; color: inherit; text-align: left; cursor: pointer;
}
.tm-perf-card:hover { background: var(--tm-row-hover); }
.tm-perf-card[aria-current="true"] { background: var(--tm-accent-soft); border-left-color: var(--tm-accent); }
.tm-perf-card:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: -2px; }
.tm-perf-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tm-perf-card-canvas { width: 60px; height: 30px; flex: 0 0 60px; display: block; }
.tm-perf-card-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.tm-perf-card-label { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-perf-card-sub { font-size: 11px; color: var(--tm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-perf-detail { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px 24px 20px; overflow: auto; }
.tm-perf-head { display: flex; align-items: baseline; gap: 16px; min-width: 0; }
.tm-perf-title { margin: 0; font-size: 28px; font-weight: 300; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-perf-model { margin-left: auto; flex: 0 1 auto; min-width: 0; text-align: right; font-size: 12px; color: var(--tm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-perf-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 12px; color: var(--tm-text-secondary); }
.tm-graph-wrap { position: relative; flex: 1 1 280px; min-height: 180px; max-height: 460px; margin-top: 2px; }
.tm-graph { display: block; width: 100%; height: 100%; }
.tm-graph-labels { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--tm-text-secondary); padding-top: 2px; }
.tm-logical { margin-top: 16px; }
.tm-logical-title { font-size: 12px; font-weight: 600; color: var(--tm-text-secondary); margin-bottom: 6px; }
.tm-logical-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.tm-logical-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tm-logical-canvas { display: block; width: 100%; height: 56px; border: 1px solid var(--tm-divider); border-radius: 3px; background: var(--tm-surface); }
.tm-logical-label { font-size: 11px; color: var(--tm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 24px; margin-top: 18px; align-content: start; }
.tm-stat { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.tm-stat-label { font-size: 12px; color: var(--tm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tm-stat-value { font-size: 20px; font-weight: 300; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------- users ---------- */
.tm-users { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.tm-user-card {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
  background: var(--tm-surface);
  border: 1px solid var(--tm-divider); border-radius: 6px;
}
.tm-user-avatar {
  width: 40px; height: 40px; flex: 0 0 40px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--tm-accent); color: #fff;
  font-size: 16px; font-weight: 600; text-transform: uppercase;
}
.tm-user-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.tm-user-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-user-meta { font-size: 12px; color: var(--tm-text-secondary); }
.tm-user-metrics { display: flex; gap: 28px; flex: 0 0 auto; }
.tm-user-metric { display: flex; flex-direction: column; gap: 1px; min-width: 56px; }
.tm-user-metric-label { font-size: 11px; color: var(--tm-text-secondary); }
.tm-user-metric-value { font-size: 16px; font-weight: 300; }
.tm-section-title { font-size: 14px; font-weight: 600; padding: 4px 16px 0; }

/* ---------- context menu ---------- */
.tm-menu {
  position: fixed; z-index: 1200;
  min-width: 184px; padding: 4px;
  display: flex; flex-direction: column;
  background: var(--tm-surface);
  border: 1px solid var(--tm-divider); border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
}
.tm-menu-item {
  display: flex; align-items: center; gap: 8px;
  height: 30px; padding: 0 10px;
  border: 0; border-radius: 4px; background: transparent; color: inherit;
  font: inherit; font-size: 13px; text-align: left; white-space: nowrap; cursor: pointer;
}
.tm-menu-item:hover, .tm-menu-item:focus-visible { background: var(--tm-row-hover); outline: none; }
.tm-menu-item[data-danger="true"] { color: var(--tm-danger); }
.tm-menu-icon { width: 16px; height: 16px; flex: 0 0 16px; display: flex; align-items: center; justify-content: center; }
.tm-menu-sep { height: 1px; margin: 4px 6px; background: var(--tm-divider); }

/* ---------- dialogs ---------- */
.tm-overlay {
  position: absolute; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .35);
}
.tm-dialog {
  width: min(480px, 100%); max-height: 86%;
  display: flex; flex-direction: column;
  background: var(--tm-surface); color: var(--tm-text);
  border: 1px solid var(--tm-divider); border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, .28);
  overflow: hidden;
}
.tm-dialog-title { margin: 0; padding: 20px 20px 6px; font-size: 20px; font-weight: 600; }
.tm-dialog-body { padding: 6px 20px 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.45; }
.tm-dialog-note { font-size: 12px; color: var(--tm-text-secondary); }
.tm-dialog-error { color: var(--tm-danger); font-size: 12px; }
.tm-dialog-row { display: flex; gap: 12px; font-size: 13px; }
.tm-dialog-label { flex: 0 0 108px; color: var(--tm-text-secondary); }
.tm-dialog-value { flex: 1; min-width: 0; word-break: break-word; }
.tm-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 18px 20px 20px; }
.tm-dialog-field { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 34px; }
.tm-dialog-field-label { font-size: 13px; }
.tm-select {
  height: 30px; min-width: 120px; padding: 0 8px;
  border: 1px solid var(--tm-divider); border-radius: 4px;
  background: var(--tm-surface); color: var(--tm-text); font: inherit; font-size: 12px;
}
.tm-select:focus-visible { outline: 2px solid var(--tm-accent); outline-offset: 1px; }
.tm-check { width: 18px; height: 18px; accent-color: var(--tm-accent); cursor: pointer; }
.tm-about { margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--tm-divider); display: flex; flex-direction: column; gap: 6px; }
.tm-about-row { display: flex; gap: 12px; font-size: 12px; }
.tm-about-label { flex: 0 0 72px; color: var(--tm-text-secondary); }
.tm-about-value { flex: 1; min-width: 0; word-break: break-all; }
.tm-dialog-section { font-size: 14px; font-weight: 600; margin-top: 4px; }

/* ---------- scrollbars ---------- */
.tm-perf-cards, .tm-perf-detail, .tm-nav, .tm-dialog-body { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--tm-text-secondary) 60%, transparent) transparent; }
.tm-scroll::-webkit-scrollbar, .tm-perf-cards::-webkit-scrollbar, .tm-perf-detail::-webkit-scrollbar, .tm-dialog-body::-webkit-scrollbar { width: 12px; height: 12px; }
.tm-scroll::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--tm-text-secondary) 75%, transparent); }
.tm-scroll::-webkit-scrollbar-thumb, .tm-perf-cards::-webkit-scrollbar-thumb, .tm-perf-detail::-webkit-scrollbar-thumb, .tm-dialog-body::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--tm-text-secondary) 55%, transparent);
  border: 3px solid transparent; background-clip: content-box; border-radius: 6px;
}
.tm-scroll::-webkit-scrollbar-track { background: transparent; }

/* ---------- responsive ---------- */
@media (max-width: 720px) {
  .tm-perf-cards { width: 180px; flex-basis: 180px; }
  .tm-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .tm-root *, .tm-root *::before, .tm-root *::after {
    transition: none !important;
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
  }
  .tm-progress::before { left: 0; width: 100%; opacity: .5; animation: none !important; }
}
`;

/**
 * Inject the panel stylesheet once per document.
 * @returns {void}
 */
export function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
