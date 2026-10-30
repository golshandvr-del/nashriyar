// Outbound notification channel (ROADMAP phase 9): email / messenger (Bale, Eitaa, …).
// In-app notifications are always stored in the `notifications` table by `notify()`; an outbound
// Notifier is an optional extra delivery path. The default implementation does nothing, so the app
// never depends on an external service. A real provider (SMTP relay, messenger bot) can implement
// this interface later and be passed through Deps without touching call sites.

export interface OutboundMessage {
  userId: string
  type: string
  title: string
  link?: string | null
}

export interface Notifier {
  readonly name: string
  /** Must never throw; failures are swallowed so in-app delivery is unaffected. */
  send(msg: OutboundMessage): Promise<void>
}

export const NullNotifier: Notifier = {
  name: 'null',
  async send() {
    /* intentionally empty — outbound delivery not configured */
  }
}

let current: Notifier = NullNotifier

/** Install an outbound provider (called once by an entry point; default: NullNotifier). */
export function setNotifier(n: Notifier | null | undefined) {
  current = n ?? NullNotifier
}

export function getNotifier(): Notifier {
  return current
}

/** Fire-and-forget delivery used by notify(); errors are ignored by design. */
export async function deliverOutbound(msg: OutboundMessage) {
  try {
    await current.send(msg)
  } catch {
    /* outbound channel failures never affect the request */
  }
}
