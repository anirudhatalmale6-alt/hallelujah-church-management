export function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.substring(0, 5).split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
