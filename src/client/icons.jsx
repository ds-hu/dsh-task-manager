/**
 * Original 18px `currentColor` stroke glyphs for the panel and its left rail.
 * No external images, no icon font, no host client packages.
 */

/**
 * Shared SVG shell.
 * @param {{size?: number, children: any, viewBox?: string}} props - glyph props.
 * @returns {any} the svg element.
 */
function Glyph(props) {
  const size = props.size ?? 18;
  return (
    <svg
      width={size}
      height={size}
      viewBox={props.viewBox ?? '0 0 20 20'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {props.children}
    </svg>
  );
}

/** Task Manager / title glyph: monitor with a waveform. */
export function IconTaskManager(props) {
  return (
    <Glyph size={props.size ?? 18} viewBox="0 0 20 20">
      <rect x="2" y="3" width="16" height="11" rx="1.5" />
      <path d="M7 17h6M10 14v3" />
      <path d="M4.5 10.5l2-3 2 4 2.5-5 2 3 2-1.5" />
    </Glyph>
  );
}

/** Processes: a window split into panes. */
export function IconProcesses(props) {
  return (
    <Glyph size={props.size}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M2.5 7.5h15M8 7.5v9" />
    </Glyph>
  );
}

/** Performance: gauge with a needle. */
export function IconPerformance(props) {
  return (
    <Glyph size={props.size}>
      <path d="M3 14.5a7 7 0 1 1 14 0" />
      <path d="M10 14.5l3.5-4.5" />
      <circle cx="10" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
      <path d="M3 16.5h14" />
    </Glyph>
  );
}

/** App history: clock with a rewind arrow. */
export function IconAppHistory(props) {
  return (
    <Glyph size={props.size}>
      <path d="M3.2 6.5A7.5 7.5 0 1 1 2.5 11" />
      <path d="M3.2 2.8v3.7h3.7" />
      <path d="M10 6.5V10l2.6 1.6" />
    </Glyph>
  );
}

/** Startup apps: box with an upward arrow. */
export function IconStartup(props) {
  return (
    <Glyph size={props.size}>
      <path d="M3.5 11v4.5h13V11" />
      <path d="M10 3.5v8M6.8 6.6L10 3.4l3.2 3.2" />
    </Glyph>
  );
}

/** Users: two person silhouettes. */
export function IconUsers(props) {
  return (
    <Glyph size={props.size}>
      <circle cx="8" cy="7" r="2.6" />
      <path d="M3.2 16.2c.4-2.9 2.3-4.5 4.8-4.5s4.4 1.6 4.8 4.5" />
      <path d="M13.4 5.1a2.2 2.2 0 0 1 0 4.2M15.2 12.2c1.2.6 1.9 2 2.1 3.9" />
    </Glyph>
  );
}

/** Details: bulleted list. */
export function IconDetails(props) {
  return (
    <Glyph size={props.size}>
      <path d="M6.5 5.5h10M6.5 10h10M6.5 14.5h10" />
      <circle cx="3.6" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Services: stacked service units. */
export function IconServices(props) {
  return (
    <Glyph size={props.size}>
      <rect x="3" y="3.5" width="14" height="4.4" rx="1" />
      <rect x="3" y="12.1" width="14" height="4.4" rx="1" />
      <path d="M5.6 5.7h.01M5.6 14.3h.01" strokeWidth="2" />
      <path d="M9 5.7h6M9 14.3h6" />
    </Glyph>
  );
}

/** Settings: gear. */
export function IconSettings(props) {
  return (
    <Glyph size={props.size}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4" />
    </Glyph>
  );
}

/** Hamburger. */
export function IconMenu(props) {
  return (
    <Glyph size={props.size}>
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
    </Glyph>
  );
}

/** Refresh: circular arrow. */
export function IconRefresh(props) {
  return (
    <Glyph size={props.size}>
      <path d="M16.2 8.2A6.4 6.4 0 1 0 16.4 12" />
      <path d="M16.4 3.6v4.7h-4.6" />
    </Glyph>
  );
}

/** Overflow: three dots. */
export function IconMore(props) {
  return (
    <Glyph size={props.size}>
      <circle cx="4.4" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="10" r="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Search magnifier. */
export function IconSearch(props) {
  return (
    <Glyph size={props.size ?? 16}>
      <circle cx="8.8" cy="8.8" r="4.8" />
      <path d="M12.4 12.4l3.6 3.6" />
    </Glyph>
  );
}

/** Disclosure chevron (right; rotates when open). */
export function IconChevron(props) {
  return (
    <Glyph size={props.size ?? 12}>
      <path d="M7.5 4.5L13 10l-5.5 5.5" />
    </Glyph>
  );
}

/** Close X. */
export function IconClose(props) {
  return (
    <Glyph size={props.size ?? 16}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Glyph>
  );
}

/** Copy. */
export function IconCopy(props) {
  return (
    <Glyph size={props.size ?? 16}>
      <rect x="6.5" y="6.5" width="10" height="10" rx="1.5" />
      <path d="M13.5 4.5H5.5a1 1 0 0 0-1 1v8" />
    </Glyph>
  );
}

/** Properties / info. */
export function IconInfo(props) {
  return (
    <Glyph size={props.size ?? 16}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.4h.01" strokeWidth="1.8" />
    </Glyph>
  );
}

/** End task / stop. */
export function IconEndTask(props) {
  return (
    <Glyph size={props.size ?? 16}>
      <circle cx="10" cy="10" r="7" />
      <path d="M7.4 7.4l5.2 5.2M12.6 7.4l-5.2 5.2" />
    </Glyph>
  );
}

/** Warning triangle for error states. */
export function IconWarning(props) {
  return (
    <Glyph size={props.size ?? 28}>
      <path d="M10 3.2L17.4 16.3H2.6L10 3.2z" />
      <path d="M10 8v3.6M10 13.9h.01" strokeWidth="1.8" />
    </Glyph>
  );
}

/**
 * Generic process glyph. The tint is inherited from the cell, so app rows get
 * the accent and background/system rows a quieter tone.
 * @param {{size?: number}} props - glyph props.
 * @returns {any} the svg element.
 */
export function ProcessGlyph(props) {
  const size = props.size ?? 16;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="currentColor" opacity=".16" />
      <path d="M4.2 6.2h7.6M4.2 8.6h5.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
