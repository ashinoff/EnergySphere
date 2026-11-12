// Иконки — инлайн SVG в одном стиле (линия 1.8, скругления), цвет — currentColor.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = ({ size = 20, ...rest }: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest,
});

export const IconBars = (p: P) => <svg {...base(p)}><path d="M5 20v-6M10 20V9M15 20v-9M20 20V5" /></svg>;
export const IconUser = (p: P) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;
export const IconUsers = (p: P) => <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1.2-3.4 3.6-5 6.5-5s5.3 1.6 6.5 5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 15.3c1.7.7 2.9 2.2 3.5 4.7" /></svg>;
export const IconBook = (p: P) => <svg {...base(p)}><path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z" /><path d="M12 6v13.5" /></svg>;
export const IconDocCheck = (p: P) => <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h4M9 9h2M9.5 17l1.8 1.8L15 15" /></svg>;
export const IconArrowRight = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9.5" /><path d="M8 12h8M13 8.5l3.5 3.5-3.5 3.5" /></svg>;
export const IconArrowLeft = (p: P) => <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const IconBell = (p: P) => <svg {...base(p)}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>;
export const IconChevron = (p: P) => <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>;
export const IconChevronDown = (p: P) => <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>;
export const IconScale = (p: P) => <svg {...base(p)}><path d="M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" /></svg>;
export const IconTrend = (p: P) => <svg {...base(p)}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>;
export const IconAlert = (p: P) => <svg {...base(p)}><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.1" /></svg>;
export const IconDoc = (p: P) => <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
export const IconNetwork = (p: P) => <svg {...base(p)}><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /><path d="M12 7.2V12M12 12l-5.5 5M12 12l5.5 5" /></svg>;
export const IconSearch = (p: P) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
export const IconUpload = (p: P) => <svg {...base(p)}><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>;
export const IconDownload = (p: P) => <svg {...base(p)}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>;
export const IconInbox = (p: P) => <svg {...base(p)}><path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></svg>;
export const IconCamera = (p: P) => <svg {...base(p)}><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.5" /></svg>;
export const IconTarget = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></svg>;
export const IconLayers = (p: P) => <svg {...base(p)}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>;
export const IconList = (p: P) => <svg {...base(p)}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>;
export const IconWrench = (p: P) => <svg {...base(p)}><path d="M14.5 6.5a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3z" /><path d="m10 15-5.5 5.5M14.5 6.5 17 4l3 3-2.5 2.5" /></svg>;
export const IconPlus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconClock = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const IconFolder = (p: P) => <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
export const IconShield = (p: P) => <svg {...base(p)}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
export const IconMap = (p: P) => <svg {...base(p)}><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>;
export const IconLogout = (p: P) => <svg {...base(p)}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></svg>;
export const IconSettings = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>;
export const IconLock = (p: P) => <svg {...base(p)}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
export const IconCheck = (p: P) => <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
export const IconTrash = (p: P) => <svg {...base(p)}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /></svg>;
export const IconEdit = (p: P) => <svg {...base(p)}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></svg>;
export const IconCalendar = (p: P) => <svg {...base(p)}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
export const IconCheckCircle = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="m7.5 12 3 3 6-6" /></svg>;
export const IconPie = (p: P) => <svg {...base(p)}><path d="M12 3v9h9" /><path d="M9 3.5A9 9 0 1 0 20.5 15" /></svg>;
export const IconSliders = (p: P) => <svg {...base(p)}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
export const IconCpu = (p: P) => <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>;
