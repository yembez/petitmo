/**
 * Envoi Expo Push API (lots) + helpers purge tokens morts.
 * Doc : https://docs.expo.dev/push-notifications/sending-notifications/
 */

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  data?: Record<string, unknown>;
  channelId?: string;
};

export type ExpoPushTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string; expoPushToken?: string };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

export function isExpoPushToken(token: string): boolean {
  const t = token.trim();
  return t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[');
}

export async function sendExpoPushMessages(
  messages: ExpoPushMessage[],
  accessToken?: string,
): Promise<{ tickets: ExpoPushTicket[]; deadTokens: string[] }> {
  const tickets: ExpoPushTicket[] = [];
  const deadTokens: string[] = [];
  if (messages.length === 0) return { tickets, deadTokens };

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  const bearer = (accessToken ?? '').trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('[expoPush] HTTP', res.status, text.slice(0, 400));
      continue;
    }
    let parsed: { data?: ExpoPushTicket[] };
    try {
      parsed = JSON.parse(text) as { data?: ExpoPushTicket[] };
    } catch {
      console.error('[expoPush] JSON', text.slice(0, 200));
      continue;
    }
    const batch = parsed.data ?? [];
    for (let j = 0; j < batch.length; j++) {
      const ticket = batch[j]!;
      tickets.push(ticket);
      if (ticket.status === 'error') {
        const err = ticket.details?.error ?? '';
        if (err === 'DeviceNotRegistered') {
          const fromDetails = ticket.details?.expoPushToken?.trim();
          const fromMsg = chunk[j]?.to?.trim();
          const dead = fromDetails || fromMsg;
          if (dead) deadTokens.push(dead);
        }
      }
    }
  }

  return { tickets, deadTokens };
}
