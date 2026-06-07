// Reservation confirmation SMS — PLACEHOLDER sender.
//
// No real SMS provider is wired up (no Twilio etc. — see CLAUDE.md rule 18). This stub builds the
// message + confirm link and logs it. The real provider drops in behind `sendReservationSms`
// later without changing callers. The returned `link` is also surfaced in the dashboard so the
// flow is fully testable while the sender is stubbed.

export interface ReservationSmsInput {
  toPhone: string | null | undefined;
  businessName: string;
  businessPhone?: string | null;
  customerName?: string | null;
  date?: string | null;
  time?: string | null;
  partySize?: number | null;
  windowHours: number;
  confirmUrl: string;
}

export interface ReservationSmsResult {
  sent: boolean;       // whether a real provider accepted it (always false while stubbed)
  link: string;        // the confirm URL (surfaced in the dashboard since SMS is stubbed)
  body: string;        // the composed message
  reason?: string;     // why it wasn't really sent
}

// Builds the SMS copy: reservation summary + confirm link + cancel info + deadline.
export function composeReservationSms(input: ReservationSmsInput): string {
  const when = [input.date, input.time].filter(Boolean).join(' at ');
  const party = input.partySize ? ` for ${input.partySize}` : '';
  const cancelLine = input.businessPhone
    ? `Need to change or cancel? Call ${input.businessPhone}.`
    : 'Need to change or cancel? Just call us.';
  return (
    `${input.businessName}: thanks${input.customerName ? `, ${input.customerName}` : ''}! ` +
    `To hold your reservation${when ? ` on ${when}` : ''}${party}, please confirm by adding a card: ${input.confirmUrl} ` +
    `Please confirm within ${input.windowHours} hours or the reservation will be released. ${cancelLine}`
  );
}

// Builds the absolute confirm URL for a reservation token.
export function reservationConfirmUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/confirm/${token}`;
}

// Stub sender. Logs the composed message + link and returns it. Never throws — a failure here must
// not break the post-call pipeline.
export async function sendReservationSms(input: ReservationSmsInput): Promise<ReservationSmsResult> {
  const body = composeReservationSms(input);
  if (!input.toPhone) {
    console.warn('[FD] reservation SMS not sent — no caller phone number');
    return { sent: false, link: input.confirmUrl, body, reason: 'no_phone' };
  }
  // Placeholder: a real provider call goes here. For now we log so the link is testable.
  console.log(`[FD] (stub) reservation SMS → ${input.toPhone}: ${body}`);
  return { sent: false, link: input.confirmUrl, body, reason: 'provider_not_configured' };
}
