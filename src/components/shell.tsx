'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client';
import {
  IconShield,
  IconDashboard,
  IconClients,
  IconVM,
  IconZoom,
  IconBell,
  IconCalling,
  IconOpenAI,
  IconReports,
  IconSettings,
  IconSearch,
  IconRefresh,
  IconMenu,
  IconChatbot,
} from '@/lib/icons';

const NAV = [
  { href: '/', label: 'Dashboard', icon: IconDashboard },
  { href: '/clients', label: 'Clients', icon: IconClients },
  { href: '/vms', label: 'VM Status', icon: IconVM },
  { href: '/zoom', label: 'Zoom Metrics', icon: IconZoom },
  { href: '/calling-reports', label: 'Calling Reports', icon: IconCalling },
  { href: '/openai', label: 'OpenAI Track', icon: IconOpenAI },
  { href: '/alerts', label: 'Alerts', icon: IconBell, badge: true },
  { href: '/chatbot-report', label: 'Chatbot Report', icon: IconChatbot },
  { href: '/reports', label: 'Reports', icon: IconReports },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get<any[]>('/api/alerts?status=active')
        .then((rows) => live && setActiveAlerts(rows.length))
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pathname]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/clients?q=${encodeURIComponent(search)}`);
    setOpen(false);
  };

  return (
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo">
            <IconShield />
          </div>
          <div>
            <b>FWAI Tracker</b>
            <span>Monitoring</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`nav-item ${isActive(n.href) ? 'active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <Icon />
                {n.label}
                {n.badge && activeAlerts > 0 && <span className="count">{activeAlerts}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="userbox">
            <div className="avatar">OP</div>
            <div>
              <div className="nm">Ops Team</div>
              <div className="em">admin workspace</div>
            </div>
          </div>
        </div>
      </aside>

      <div>
        <header className="header">
          <button className="menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            <IconMenu />
          </button>
          <form className="search" onSubmit={submitSearch}>
            <IconSearch />
            <input
              placeholder="Search clients, VMs, applications…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <div className="header-right">
            <button className="btn" onClick={() => router.refresh()}>
              <IconRefresh />
              Refresh
            </button>
            <button className="icon-btn" title="Notifications" onClick={() => router.push('/alerts')}>
              {activeAlerts > 0 && <span className="ndot" />}
              <IconBell />
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>

      {open && <div className="scrim show" onClick={() => setOpen(false)} />}
    </div>
  );
}
