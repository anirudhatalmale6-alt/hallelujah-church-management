import { settings } from './api';

// Fallback list (matches api/config.php defaultPersonTypes) used until the
// configured list loads from the server.
export const DEFAULT_PERSON_TYPES = [
  { value: 'church_member', label: 'Church Member', auto_absent: true, builtin: true },
  { value: 'non_member_attendee', label: 'Non-Member Attendee', auto_absent: true, builtin: true },
  { value: 'visitor', label: 'Visitor', auto_absent: false, builtin: true },
  { value: 'ministry_partner', label: 'Ministry Partner', auto_absent: false, builtin: true },
  { value: 'community', label: 'Community', auto_absent: false, builtin: true },
  { value: 'companion', label: 'Companion', auto_absent: false, builtin: true },
];

let cache = null;

export async function loadPersonTypes(force = false) {
  if (cache && !force) return cache;
  try {
    const res = await settings.getPersonTypes();
    if (res?.person_types?.length) {
      cache = res.person_types;
      return cache;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_PERSON_TYPES;
}

export function labelFor(list, value) {
  const t = (list || []).find(x => x.value === value);
  return t ? t.label : (value || 'Church Member');
}

// Stable color classes for known types; a deterministic fallback for custom ones.
const KNOWN_COLORS = {
  church_member: 'bg-primary-50 text-primary-700',
  non_member_attendee: 'bg-yellow-50 text-yellow-700',
  visitor: 'bg-blue-50 text-blue-700',
  ministry_partner: 'bg-emerald-50 text-emerald-700',
  community: 'bg-amber-50 text-amber-700',
  companion: 'bg-purple-50 text-purple-700',
};
const FALLBACK_COLORS = [
  'bg-sky-50 text-sky-700',
  'bg-rose-50 text-rose-700',
  'bg-teal-50 text-teal-700',
  'bg-indigo-50 text-indigo-700',
  'bg-orange-50 text-orange-700',
  'bg-lime-50 text-lime-700',
];

export function colorFor(value) {
  if (KNOWN_COLORS[value]) return KNOWN_COLORS[value];
  let hash = 0;
  for (let i = 0; i < (value || '').length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}
