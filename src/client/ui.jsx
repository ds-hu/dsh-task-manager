/**
 * Small presentational primitives shared by every page: buttons, the search
 * field, empty/error states, the modal shell with a focus trap, and the popup
 * menu used for context menus and the title-bar overflow.
 */
import { useEffect, useRef, useState } from 'react';
import { IconClose, IconSearch, IconWarning } from './icons.jsx';

/**
 * Square icon button with an accessible label and native tooltip.
 * @param {{label: string, onClick?: () => void, disabled?: boolean, testid?: string, children: any, className?: string}} props - props.
 * @returns {any} the button.
 */
export function IconButton(props) {
  return (
    <button
      type="button"
      className={`tm-iconbtn${props.className ? ` ${props.className}` : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testid}
    >
      {props.children}
    </button>
  );
}

/**
 * Text button.
 * @param {{children: any, onClick?: () => void, disabled?: boolean, variant?: 'default' | 'primary' | 'danger', testid?: string, className?: string, title?: string}} props - props.
 * @returns {any} the button.
 */
export function Button(props) {
  const variant = props.variant ?? 'default';
  const classes = ['tm-btn'];
  if (variant === 'primary') classes.push('tm-btn-primary');
  if (variant === 'danger') classes.push('tm-btn-danger');
  if (props.className) classes.push(props.className);
  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      data-testid={props.testid}
    >
      {props.children}
    </button>
  );
}

/**
 * Search box.
 * @param {{value: string, onChange: (value: string) => void, placeholder: string, clearLabel: string, testid?: string}} props - props.
 * @returns {any} the field.
 */
export function SearchField(props) {
  return (
    <div className="tm-search">
      <span className="tm-search-icon" aria-hidden="true">
        <IconSearch size={16} />
      </span>
      <input
        className="tm-search-input"
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        spellCheck={false}
        data-testid={props.testid}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.value !== '' ? (
        <button
          type="button"
          className="tm-search-clear"
          aria-label={props.clearLabel}
          title={props.clearLabel}
          onClick={() => props.onChange('')}
        >
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Centered empty/loading state.
 * @param {{title?: string, detail?: string, spinner?: boolean, testid?: string, children?: any}} props - props.
 * @returns {any} the state block.
 */
export function EmptyState(props) {
  return (
    <div className="tm-empty" data-testid={props.testid}>
      {props.spinner ? <div className="tm-spinner" role="status" aria-label={props.title ?? 'loading'} /> : null}
      {props.title ? <div className="tm-empty-title">{props.title}</div> : null}
      {props.detail ? <div className="tm-empty-detail">{props.detail}</div> : null}
      {props.children}
    </div>
  );
}

/**
 * Error state with a retry button.
 * @param {{title: string, detail?: string, retryLabel: string, onRetry: () => void}} props - props.
 * @returns {any} the state block.
 */
export function ErrorState(props) {
  return (
    <div className="tm-empty" role="alert">
      <span className="tm-error-icon" aria-hidden="true">
        <IconWarning size={28} />
      </span>
      <div className="tm-empty-title">{props.title}</div>
      {props.detail ? <div className="tm-empty-detail">{props.detail}</div> : null}
      <div className="tm-empty-actions">
        <Button onClick={props.onRetry}>{props.retryLabel}</Button>
      </div>
    </div>
  );
}

/**
 * Modal shell: Win11 dialog chrome, `role="dialog"`, focus trap, Esc to close.
 * Rendered inside the panel root (absolute overlay), never in a portal.
 * @param {{title: string, children: any, actions: any, onClose: () => void, testid?: string, wide?: boolean}} props - props.
 * @returns {any} the overlay.
 */
export function Modal(props) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const previous = typeof document !== 'undefined' ? document.activeElement : null;
    const focusables = () =>
      Array.from(
        node.querySelectorAll(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
    const first = focusables()[0];
    if (first && typeof first.focus === 'function') first.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [props.onClose]);

  return (
    <div
      className="tm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className="tm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        data-testid={props.testid}
        ref={ref}
        style={props.wide ? { width: 'min(560px, 100%)' } : undefined}
      >
        <h2 className="tm-dialog-title">{props.title}</h2>
        <div className="tm-dialog-body">{props.children}</div>
        <div className="tm-dialog-actions">{props.actions}</div>
      </div>
    </div>
  );
}

/**
 * Popup menu positioned at viewport coordinates and clamped to the window.
 * Used both as a row context menu and as the title-bar overflow.
 * @param {{x: number, y: number, items: Array<{key: string, label: string, icon?: any, danger?: boolean, onSelect: () => void}>, onClose: () => void, testid?: string}} props - props.
 * @returns {any} the menu.
 */
export function PopupMenu(props) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: props.x, top: props.y });

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof window === 'undefined') return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8));
    setPosition({ left, top });
  }, [props.x, props.y]);

  useEffect(() => {
    const node = ref.current;
    if (node) {
      const first = node.querySelector('button');
      if (first) first.focus();
    }
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) props.onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(ref.current?.querySelectorAll('button') ?? []);
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = items[(index + delta + items.length) % items.length];
      event.preventDefault();
      next.focus();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('contextmenu', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('contextmenu', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [props.onClose]);

  return (
    <div className="tm-menu" role="menu" ref={ref} style={position} data-testid={props.testid}>
      {props.items.map((item, index) =>
        item.separator ? (
          <div className="tm-menu-sep" role="separator" key={`sep-${index}`} />
        ) : (
          <button
            type="button"
            role="menuitem"
            key={item.key}
            className="tm-menu-item"
            data-danger={item.danger ? 'true' : undefined}
            onClick={() => {
              props.onClose();
              item.onSelect();
            }}
          >
            {item.icon ? (
              <span className="tm-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Sortable table header cell.
 * @param {{label: string, sortKey: string, sort: {key: string, dir: 'asc' | 'desc'}, onSort: (key: string) => void, numeric?: boolean, testid?: string}} props - props.
 * @returns {any} the cell.
 */
export function SortHeader(props) {
  const active = props.sort.key === props.sortKey;
  const direction = active ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <div className={`tm-th${props.numeric ? ' tm-th-num' : ''}`} role="columnheader" aria-sort={direction}>
      <button
        type="button"
        className="tm-sort-btn"
        data-active={active ? 'true' : undefined}
        data-testid={props.testid}
        onClick={() => props.onSort(props.sortKey)}
      >
        <span>{props.label}</span>
        <span className="tm-sort-icon" aria-hidden="true">
          {active ? (props.sort.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </div>
  );
}

/**
 * Plain header cell.
 * @param {{label: string, numeric?: boolean}} props - props.
 * @returns {any} the cell.
 */
export function HeaderCell(props) {
  return (
    <div className={`tm-th${props.numeric ? ' tm-th-num' : ''}`} role="columnheader">
      {props.label}
    </div>
  );
}
