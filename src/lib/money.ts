/** Money is stored as integer kobo everywhere; only the UI shows naira. */
export function formatNaira(kobo: number): string {
  const sign = kobo < 0 ? '-' : '';
  const abs = Math.abs(kobo);
  const naira = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₦${naira}.${String(abs % 100).padStart(2, '0')}`;
}

/** "1,250.50" -> 125050 ; returns null if invalid. */
export function parseNairaToKobo(input: string): number | null {
  const s = input.replace(/,/g, '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [n, k = ''] = s.split('.');
  const kobo = parseInt(n, 10) * 100 + parseInt((k + '00').slice(0, 2), 10);
  return kobo > 0 ? kobo : null;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Local calendar day key, used for the daily offline spending allowance. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2d 4h", "5h 12m", "9m" – for the synchronization countdown. */
export function formatDuration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}
