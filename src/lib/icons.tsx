import type { ReactNode } from 'react';

type P = { className?: string };
const S = ({ children, className }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    {children}
  </svg>
);

export const IconShield = (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} {...p}>
    <path d="M12 2l8 4v5c0 5-3.5 9-8 11-4.5-2-8-6-8-11V6l8-4z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IconDashboard = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </S>
);
export const IconClients = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <circle cx="18" cy="9" r="2.3" />
    <path d="M16.5 20c0-2 .8-3.5 2-4.3" />
  </S>
);
export const IconVM = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="13" width="18" height="7" rx="1.5" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </S>
);
export const IconZoom = (p: P) => (
  <S {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10l5-3v10l-5-3" />
  </S>
);
export const IconBell = (p: P) => (
  <S {...p}>
    <path d="M12 3a6 6 0 0 0-6 6c0 5-2 7-2 7h16s-2-2-2-7a6 6 0 0 0-6-6z" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </S>
);
export const IconReports = (p: P) => (
  <S {...p}>
    <path d="M4 4v16h16" />
    <path d="M8 14l3-3 3 2 4-5" />
  </S>
);
export const IconCalling = (p: P) => (
  <S {...p}>
    <path d="M4 5c0-1 .8-2 1.8-2h2L9.5 7 7.8 8.6a12 12 0 0 0 5.6 5.6L15 12.5l4 1.7v2c0 1-1 1.8-2 1.8A13 13 0 0 1 4 5z" />
    <path d="M15 3h6M18 3v6" />
  </S>
);
// Token/credit meter — a gauge dial, matching the budget idea rather than any
// vendor mark.
export const IconOpenAI = (p: P) => (
  <S {...p}>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="M12 17l4.5-4.5" />
    <circle cx="12" cy="17" r="1.4" />
  </S>
);
export const IconUpload = (p: P) => (
  <S {...p}>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </S>
);
export const IconSettings = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.5 12a7.5 7.5 0 0 0-.12-1.3l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-2.2-1.3L14.5 2h-5l-.3 2.6a7.5 7.5 0 0 0-2.2 1.3l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2.6l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 2.2 1.3l.3 2.6h5l.3-2.6a7.5 7.5 0 0 0 2.2-1.3l2.4 1 2-3.5-2-1.5c.08-.43.12-.86.12-1.3z" />
  </S>
);
export const IconSearch = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </S>
);
export const IconRefresh = (p: P) => (
  <S {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </S>
);
export const IconMenu = (p: P) => (
  <S {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </S>
);
export const IconChevronLeft = (p: P) => (
  <S {...p}>
    <path d="M15 18l-6-6 6-6" />
  </S>
);
export const IconInfo = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </S>
);
export const IconPlus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const IconX = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);
export const IconCheck = (p: P) => (
  <S {...p}>
    <path d="M5 12l5 5L20 7" />
  </S>
);
export const IconAlertTriangle = (p: P) => (
  <S {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </S>
);
export const IconAlertCircle = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </S>
);
export const IconXCircle = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9l-6 6M9 9l6 6" />
  </S>
);
export const IconUsersStat = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
  </S>
);
export const IconWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.6 4.7-1.2A10 10 0 1 0 12 2z" />
  </svg>
);
export const IconChatbot = (p: P) => (
  <S {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M9 10h.01M12 10h.01M15 10h.01" strokeLinecap="round" />
  </S>
);
