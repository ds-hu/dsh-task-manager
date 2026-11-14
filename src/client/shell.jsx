/**
 * Panel shell: the 44px title row, the collapsible left rail, the 48px page
 * header and the Processes status bar.
 */
import { useRef, useState } from 'react';
import {
  IconAppHistory,
  IconDetails,
  IconEndTask,
  IconMenu,
  IconMore,
  IconPerformance,
  IconProcesses,
  IconRefresh,
  IconServices,
  IconSettings,
  IconStartup,
  IconTaskManager,
  IconUsers,
} from './icons.jsx';
import { Button, IconButton, PopupMenu } from './ui.jsx';

/** Pages in rail order; ids double as main-panel keys. */
export const NAV_ITEMS = [
  { id: 'processes', titleKey: 'title.processes', testid: 'tm-nav-processes', Icon: IconProcesses },
  { id: 'performance', titleKey: 'title.performance', testid: 'tm-nav-performance', Icon: IconPerformance },
  { id: 'appHistory', titleKey: 'title.appHistory', testid: 'tm-nav-app-history', Icon: IconAppHistory },
  { id: 'startup', titleKey: 'title.startup', testid: 'tm-nav-startup', Icon: IconStartup },
  { id: 'users', titleKey: 'title.users', testid: 'tm-nav-users', Icon: IconUsers },
  { id: 'details', titleKey: 'title.details', testid: 'tm-nav-details', Icon: IconDetails },
  { id: 'services', titleKey: 'title.services', testid: 'tm-nav-services', Icon: IconServices },
];

/**
 * Title row: app glyph, title, refresh and overflow menu.
 * @param {{t: any, onRefresh: () => void, onSettings: () => void}} props - props.
 * @returns {any} the row.
 */
export function TitleBar(props) {
  const { t } = props;
  const moreRef = useRef(null);
  const [menu, setMenu] = useState(null);

  const openMenu = () => {
    const rect = moreRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ x: Math.max(8, rect.right - 190), y: rect.bottom + 4 });
  };

  return (
    <div className="tm-titlebar">
      <span className="tm-titlebar-icon" aria-hidden="true">
        <IconTaskManager size={20} />
      </span>
      <span className="tm-titlebar-title">{t('panel')}</span>
      <span className="tm-titlebar-spacer" />
      <IconButton label={t('action.refresh')} onClick={props.onRefresh} testid="tm-refresh">
        <IconRefresh size={16} />
      </IconButton>
      <span ref={moreRef} style={{ display: 'flex' }}>
        <IconButton
          label={t('nav.more')}
          onClick={() => (menu === null ? openMenu() : setMenu(null))}
          testid="tm-more"
        >
          <IconMore size={16} />
        </IconButton>
      </span>
      {menu !== null ? (
        <PopupMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              key: 'refresh',
              label: t('action.refreshNow'),
              icon: <IconRefresh size={16} />,
              onSelect: props.onRefresh,
            },
            { key: 'sep', separator: true },
            {
              key: 'settings',
              label: t('nav.settings'),
              icon: <IconSettings size={16} />,
              onSelect: props.onSettings,
            },
          ]}
        />
      ) : null}
    </div>
  );
}

/**
 * Left rail: hamburger, seven pages, settings pinned to the bottom.
 * @param {{t: any, page: string, collapsed: boolean, onToggle: () => void, onNavigate: (id: string) => void, onSettings: () => void}} props - props.
 * @returns {any} the rail.
 */
export function NavRail(props) {
  const { t, collapsed } = props;

  return (
    <nav className="tm-rail" data-collapsed={collapsed ? 'true' : 'false'} aria-label={t('panel')}>
      <div className="tm-rail-toggle">
        <IconButton
          label={collapsed ? t('nav.expand') : t('nav.collapse')}
          onClick={props.onToggle}
          testid="tm-nav-toggle"
        >
          <IconMenu size={18} />
        </IconButton>
      </div>
      <div className="tm-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.Icon;
          const label = t(item.titleKey);
          const active = props.page === item.id;
          return (
            <button
              type="button"
              key={item.id}
              className="tm-nav-item"
              aria-current={active ? 'page' : undefined}
              aria-label={label}
              title={collapsed ? label : undefined}
              data-testid={item.testid}
              onClick={() => props.onNavigate(item.id)}
            >
              <span className="tm-nav-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="tm-nav-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="tm-rail-footer">
        <button
          type="button"
          className="tm-nav-item"
          aria-label={t('nav.settings')}
          title={collapsed ? t('nav.settings') : undefined}
          data-testid="tm-settings"
          onClick={props.onSettings}
        >
          <span className="tm-nav-icon" aria-hidden="true">
            <IconSettings size={18} />
          </span>
          <span className="tm-nav-label">{t('nav.settings')}</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Page header: 48px, 20px/600 title, right-aligned actions.
 * @param {{title: string, children?: any}} props - props.
 * @returns {any} the header.
 */
export function PageHeader(props) {
  return (
    <div className="tm-page-header">
      <h1 className="tm-page-title">{props.title}</h1>
      <div className="tm-page-actions">{props.children}</div>
    </div>
  );
}

/**
 * Processes status bar: counters on the left, End task on the right.
 * @param {{items: string[], endTaskLabel: string, endTaskDisabled: boolean, onEndTask: () => void}} props - props.
 * @returns {any} the bar.
 */
export function StatusBar(props) {
  return (
    <div className="tm-statusbar" data-testid="tm-status-bar">
      <div className="tm-statusbar-items">
        {props.items.map((text, index) => (
          <span className="tm-statusbar-item" key={index}>
            {text}
          </span>
        ))}
      </div>
      <Button
        className="tm-statusbar-btn"
        disabled={props.endTaskDisabled}
        onClick={props.onEndTask}
        testid="tm-end-task"
      >
        <IconEndTask size={14} />
        <span>{props.endTaskLabel}</span>
      </Button>
    </div>
  );
}
