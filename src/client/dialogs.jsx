/**
 * Win11-style dialogs: end-task confirmation (with force option and host error
 * surface), process properties, and the settings dialog.
 */
import { useState } from 'react';
import { REFRESH_OPTIONS } from './data.js';
import { format } from './i18n.js';
import { Button, Modal } from './ui.jsx';

/**
 * End task confirmation.
 * @param {{process: any, t: any, api: any, onClose: () => void, onDone: () => void}} props - props.
 * @returns {any} the dialog.
 */
export function EndTaskDialog(props) {
  const { process, t, api } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const systemProcess = process.uid === 0 || process.group === 'system';

  const kill = async (signal, force) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/process/kill', {
        pid: process.pid,
        startTime: process.started,
        signal,
        ...(force ? { force: true } : {}),
      });
      props.onDone();
      props.onClose();
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('dialog.endTask.title')}
      testid="tm-dialog-end-task"
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={() => kill('SIGKILL', true)} disabled={busy}>
            {t('action.forceEnd')}
          </Button>
          <Button variant="primary" onClick={() => kill('SIGTERM', false)} disabled={busy}>
            {t('action.endTask')}
          </Button>
        </>
      }
    >
      <div>{format(t('dialog.endTask.body'), { name: process.name, pid: process.pid })}</div>
      {systemProcess ? <div className="tm-dialog-note">{format(t('dialog.endTask.system'), { name: process.name })}</div> : null}
      {error !== null ? (
        <div className="tm-dialog-error" role="alert">
          {`${t('dialog.error')}: ${error.message}`}
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Process properties dialog.
 * @param {{process: any, t: any, fmt: any, onClose: () => void}} props - props.
 * @returns {any} the dialog.
 */
export function PropertiesDialog(props) {
  const { process, t, fmt } = props;
  const rows = [
    { label: t('col.name'), value: process.name },
    { label: t('col.pid'), value: fmt.pid(process.pid) },
    { label: t('dialog.ppid'), value: fmt.pid(process.ppid) },
    { label: t('col.user'), value: process.user ?? fmt.dash() },
    { label: t('col.status'), value: t(`state.${process.state ?? 'unknown'}`) },
    { label: t('col.cpu'), value: fmt.percent(process.cpu) },
    { label: t('col.memory'), value: fmt.memory(process.memBytes) },
    { label: t('col.threads'), value: fmt.integer(process.threads) },
    { label: t('col.priority'), value: fmt.integer(process.priority) },
    { label: t('dialog.started'), value: fmt.dateTime(process.started) },
    { label: t('col.command'), value: process.cmd ?? fmt.dash() },
  ];

  return (
    <Modal
      title={t('dialog.properties')}
      testid="tm-dialog-properties"
      wide
      onClose={props.onClose}
      actions={<Button variant="primary" onClick={props.onClose}>{t('action.close')}</Button>}
    >
      {rows.map((row) => (
        <div className="tm-dialog-row" key={row.label}>
          <span className="tm-dialog-label">{row.label}</span>
          <span className="tm-dialog-value">{row.value}</span>
        </div>
      ))}
    </Modal>
  );
}

/**
 * Settings dialog: refresh interval, kernel threads, compact rows, about.
 * @param {{settings: any, onChange: (patch: any) => void, t: any, health: any, system: any, apiBase: string, onClose: () => void}} props - props.
 * @returns {any} the dialog.
 */
export function SettingsDialog(props) {
  const { settings, onChange, t, health, system } = props;
  const host = [system?.hostname, system?.platform].filter(Boolean).join(' · ');

  return (
    <Modal
      title={t('settings.title')}
      testid="tm-settings-dialog"
      onClose={props.onClose}
      actions={<Button variant="primary" onClick={props.onClose}>{t('action.close')}</Button>}
    >
      <div className="tm-dialog-field">
        <span className="tm-dialog-field-label">{t('settings.refresh')}</span>
        <select
          className="tm-select"
          aria-label={t('settings.refresh')}
          value={settings.refreshIntervalMs}
          onChange={(event) => onChange({ refreshIntervalMs: Number(event.target.value) })}
        >
          {REFRESH_OPTIONS.map((ms) => (
            <option value={ms} key={ms}>
              {format(t('settings.interval'), { value: ms / 1000 })}
            </option>
          ))}
        </select>
      </div>

      <label className="tm-dialog-field">
        <span className="tm-dialog-field-label">{t('settings.showKernel')}</span>
        <input
          type="checkbox"
          className="tm-check"
          checked={settings.showKernelThreads}
          onChange={(event) => onChange({ showKernelThreads: event.target.checked })}
        />
      </label>

      <label className="tm-dialog-field">
        <span className="tm-dialog-field-label">{t('settings.compact')}</span>
        <input
          type="checkbox"
          className="tm-check"
          checked={settings.compactRows}
          onChange={(event) => onChange({ compactRows: event.target.checked })}
        />
      </label>

      <div className="tm-about">
        <div className="tm-dialog-section">{t('settings.about')}</div>
        <div className="tm-about-row">
          <span className="tm-about-label">{t('settings.version')}</span>
          <span className="tm-about-value">{health?.version ?? '—'}</span>
        </div>
        <div className="tm-about-row">
          <span className="tm-about-label">{t('settings.api')}</span>
          <span className="tm-about-value">{props.apiBase}</span>
        </div>
        <div className="tm-about-row">
          <span className="tm-about-label">{t('settings.host')}</span>
          <span className="tm-about-value">{host === '' ? '—' : host}</span>
        </div>
      </div>
    </Modal>
  );
}
