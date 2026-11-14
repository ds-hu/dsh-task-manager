/**
 * Number, byte and date formatting shared by every page.
 *
 * One `Intl.NumberFormat` set is created per locale and memoized by the caller,
 * so re-rendering 300 process rows never constructs a formatter.
 */

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const DASH = '—';

/**
 * @param {unknown} value - Candidate number.
 * @returns {boolean} whether it is a finite number.
 */
function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Build the formatter face for one locale.
 * @param {string} locale - `zh` / `en` (or any BCP-47 tag).
 * @param {(key: string, vars?: Record<string, string | number>) => string} t - translator.
 * @returns {Record<string, (...args: any[]) => string>} formatters.
 */
export function createFormatters(locale, t) {
  const tag = locale === 'zh' ? 'zh-CN' : locale === 'en' ? 'en-US' : locale;
  const int = new Intl.NumberFormat(tag);
  const one = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const two = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'medium' });

  /**
   * Trim trailing `.0` for the zero case only; Win11 prints `0`, not `0.0`.
   * @param {number} value - Value.
   * @param {Intl.NumberFormat} nf - Formatter.
   * @returns {string} formatted value.
   */
  const rate = (value, nf) => (value === 0 ? '0' : Math.abs(value) < 10 ? one.format(value) : nf.format(Math.round(value)));

  return {
    dash: () => DASH,

    /** @param {number} value - finite number. @returns {string} grouped integer. */
    integer: (value) => (isNum(value) ? int.format(Math.round(value)) : DASH),

    /** PIDs are identifiers, not quantities: never group their digits. */
    pid: (value) => (isNum(value) ? String(Math.trunc(value)) : DASH),

    /** @param {number} value - percentage. @returns {string} one-decimal percentage. */
    percent: (value) => (isNum(value) ? `${one.format(value)}%` : DASH),

    /** @param {number} value - percentage. @returns {string} rounded percentage. */
    percentInt: (value) => (isNum(value) ? `${int.format(Math.round(value))}%` : DASH),

    /**
     * Resident memory: one decimal MB, GB above 10 GB.
     * @param {number} bytes - byte count.
     * @returns {string} formatted size.
     */
    memory: (bytes) => {
      if (!isNum(bytes)) return DASH;
      if (bytes >= 10 * GB) return `${one.format(bytes / GB)} ${t('unit.gb')}`;
      return `${one.format(bytes / MB)} ${t('unit.mb')}`;
    },

    /**
     * `used / total` memory pair, e.g. `4.0/8.0 GB (62%)`.
     * @param {number} used - bytes.
     * @param {number} total - bytes.
     * @param {number} [percent] - used percentage.
     * @returns {string} formatted pair.
     */
    memoryPair: (used, total, percent) => {
      if (!isNum(used) || !isNum(total)) return DASH;
      const gb = total >= GB;
      const unit = gb ? t('unit.gb') : t('unit.mb');
      const div = gb ? GB : MB;
      const pair = `${one.format(used / div)}/${one.format(total / div)} ${unit}`;
      return isNum(percent) ? `${pair} (${int.format(Math.round(percent))}%)` : pair;
    },

    /** @param {number} bytes - byte count. @returns {string} capacity in GB. */
    capacity: (bytes) => (isNum(bytes) ? `${one.format(bytes / GB)} ${t('unit.gb')}` : DASH),

    /** @param {number} bytes - byte count. @returns {string} size in KB. */
    kilobytes: (bytes) => (isNum(bytes) ? `${int.format(Math.round(bytes / 1024))} ${t('unit.kb')}` : DASH),

    /**
     * Disk throughput in MB/s.
     * @param {number} bytesPerSec - bytes per second.
     * @returns {string} formatted rate with unit.
     */
    diskRate: (bytesPerSec) => {
      if (!isNum(bytesPerSec)) return DASH;
      const mb = bytesPerSec / 1e6;
      return `${rate(mb, int)} ${t('unit.mbPerSec')}`;
    },

    /**
     * Network throughput in Mbps.
     * @param {number} bytesPerSec - bytes per second.
     * @returns {string} formatted rate with unit.
     */
    mbps: (bytesPerSec) => {
      if (!isNum(bytesPerSec)) return DASH;
      return `${rate((bytesPerSec * 8) / 1e6, int)} ${t('unit.mbps')}`;
    },

    /**
     * Short Mbps value without the unit, for the narrow performance cards.
     * @param {number} bytesPerSec - bytes per second.
     * @returns {string} formatted number.
     */
    mbpsShort: (bytesPerSec) => {
      if (!isNum(bytesPerSec)) return DASH;
      return rate((bytesPerSec * 8) / 1e6, int);
    },

    /** @param {number} bytesPerSec - bytes per second. @returns {number} Mbps value. */
    mbpsValue: (bytesPerSec) => (isNum(bytesPerSec) ? (bytesPerSec * 8) / 1e6 : 0),

    /** @param {number} bytesPerSec - bytes per second. @returns {number} MB/s value. */
    mbPerSecValue: (bytesPerSec) => (isNum(bytesPerSec) ? bytesPerSec / 1e6 : 0),

    /** @param {number} ghz - clock in GHz. @returns {string} e.g. `0.80 GHz`. */
    ghz: (ghz) => (isNum(ghz) ? `${two.format(ghz)} ${t('unit.ghz')}` : DASH),

    /**
     * Uptime as `d:hh:mm:ss`.
     * @param {number} seconds - uptime seconds.
     * @returns {string} formatted duration.
     */
    uptime: (seconds) => {
      if (!isNum(seconds) || seconds < 0) return DASH;
      const total = Math.floor(seconds);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      return `${days}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    },

    /**
     * CPU time as `h:mm:ss` (or `m:ss` below one hour).
     * @param {number} seconds - CPU seconds.
     * @returns {string} formatted duration.
     */
    cpuTime: (seconds) => {
      if (!isNum(seconds) || seconds < 0) return DASH;
      const total = Math.floor(seconds);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const mm = String(minutes).padStart(2, '0');
      const ss = String(secs).padStart(2, '0');
      return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
    },

    /**
     * Absolute date and time in the active locale.
     * @param {number} epochMs - timestamp.
     * @returns {string} formatted date/time.
     */
    dateTime: (epochMs) => (isNum(epochMs) ? dateTime.format(new Date(epochMs)) : DASH),

    /**
     * Percentage of a part against a total, guarded against zero.
     * @param {number} part - part.
     * @param {number} total - total.
     * @returns {number} percentage, or 0.
     */
    ratio: (part, total) => (isNum(part) && isNum(total) && total > 0 ? (part / total) * 100 : 0),
  };
}
