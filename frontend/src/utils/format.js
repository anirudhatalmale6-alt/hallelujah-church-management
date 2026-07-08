export function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.substring(0, 5).split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Format a 'YYYY-MM-DD' service date as month-date-year: 'MM-DD-YYYY'.
// Pure string math so there are no timezone off-by-one surprises.
export function fmtServiceDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  return (y && m && d) ? `${m}-${d}-${y}` : String(dateStr);
}

export function downloadCSV(headers, rows, filename) {
  const escape = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const csv = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(',')),
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
