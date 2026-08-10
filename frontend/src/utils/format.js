// The church runs on Philadelphia time. The API sends every timestamp as ISO-8601
// already carrying the correct offset for that instant (e.g. "...T19:10:52-04:00"),
// so these helpers only have to render it - and they render in Philadelphia time
// explicitly, so the clock is the same whichever computer or phone it is opened on.
// Daylight saving is handled for us: the offset comes from the server, and the zone
// below is a real named zone, not a fixed number of hours.
export const CHURCH_TZ = 'America/New_York';

export function parseStamp(ts) {
  if (!ts) return null;
  // Tolerates the older bare-SQL form ("2026-08-09 19:10:52") as well as ISO.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(ts))
    ? String(ts).replace(' ', 'T') + 'Z'
    : ts);
  return isNaN(d.getTime()) ? null : d;
}

// 'Aug 9, 7:10 PM' in Philadelphia time.
export function formatStampChurch(ts, opts = {}) {
  const d = parseStamp(ts);
  if (!d) return '';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: CHURCH_TZ, ...opts,
  });
}

// '7:10 PM' in Philadelphia time.
export function formatClockChurch(ts) {
  const d = parseStamp(ts);
  if (!d) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CHURCH_TZ });
}

// 'YYYY-MM-DDTHH:MM' in Philadelphia time, for a datetime-local input.
export function toChurchInputValue(ts) {
  const d = parseStamp(ts);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: CHURCH_TZ,
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
}

// True when the instant falls on today's date in Philadelphia.
export function isChurchToday(ts) {
  const d = parseStamp(ts);
  if (!d) return false;
  const fmt = (x) => x.toLocaleDateString('en-CA', { timeZone: CHURCH_TZ });
  return fmt(d) === fmt(new Date());
}

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
