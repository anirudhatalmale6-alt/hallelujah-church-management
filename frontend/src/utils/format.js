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

// Birthdays are often known as a month and a day only ("July 18"), with no year.
// The column is a real DATE, so those are stored with the sentinel year 1904 - a
// leap year, so 29 February still works. The year dropdown only offers 1920 and
// later, so 1904 can never be typed in by hand: it always means "no year".
export const DOB_NO_YEAR = '1904';

export function dobPart(value, part) {
  const [y, m, d] = String(value || '').split('-');
  if (!y || !m || !d) return '';
  if (part === 'y') return y === DOB_NO_YEAR ? '' : y;
  if (part === 'm') return String(parseInt(m, 10));
  return String(parseInt(d, 10));
}

// Blanking the month or the day removes the birthday altogether (that is how a
// date entered by mistake is undone). Blanking only the year keeps the month and
// the day, and simply stops recording the year.
export function setDobPart(value, part, next) {
  const parts = {
    y: dobPart(value, 'y'),
    m: dobPart(value, 'm'),
    d: dobPart(value, 'd'),
  };
  if (!next) {
    if (part !== 'y') return '';
    parts.y = '';
    if (!parts.m || !parts.d) return '';
  } else {
    parts[part] = next;
  }

  const y = parts.y || DOB_NO_YEAR;
  const m = parts.m || '1';
  const daysInMonth = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  const d = Math.min(parseInt(parts.d || '1', 10), daysInMonth);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 'July 18, 1985', or just 'July 18' when the year is not known.
export function formatBirthday(value) {
  const [y, m, d] = String(value || '').split('-');
  if (!y || !m || !d || value === '0000-00-00') return '';
  const date = new Date(`${y}-${m}-${d}T00:00:00`);
  if (isNaN(date.getTime())) return '';
  const opts = { month: 'long', day: 'numeric' };
  if (y !== DOB_NO_YEAR) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
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
