// Handing a ready-made message from one page to the Compose screen.
//
// Used by the Finance page: "Say thank you" on a gift, and the pledge
// reminders. The message is parked in sessionStorage and Compose picks it up
// once, on arrival, then clears it. sessionStorage (not a query string) keeps
// the wording, the people and their individual figures together in one piece
// without pushing any of it into the address bar.
export const COMPOSE_PREFILL_KEY = 'hitc_compose_prefill';

// prefill: { recipient_ids, message_type, subject, body, merge, note }
//   merge - each person's own values for the {placeholders}, keyed by member id
//   note  - one line shown above the message saying where it came from
export function openComposeWith(navigate, prefill) {
  try {
    sessionStorage.setItem(COMPOSE_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // Private browsing with storage blocked. Better to arrive at an empty
    // Compose screen than to swallow the click and look broken.
  }
  navigate('/system/public/communication');
}
