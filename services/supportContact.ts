import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export type SupportMessageKind = 'contact' | 'report';

function supportContactUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/support-contact`;
}

export function isSupportContactConfigured(): boolean {
  return !!(supabaseUrl?.trim() && supabaseAnonKey?.trim());
}

export async function sendSupportMessage(input: {
  email: string;
  message: string;
  kind: SupportMessageKind;
  techContext: string;
}): Promise<void> {
  if (!isSupportContactConfigured()) {
    throw new Error('unconfigured');
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token?.trim() || supabaseAnonKey!;

  const res = await fetch(supportContactUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify({
      email: input.email.trim(),
      message: input.message.trim(),
      kind: input.kind,
      techContext: input.techContext,
    }),
  });

  if (res.status === 429) {
    throw new Error('rate_limited');
  }
  if (!res.ok) {
    throw new Error('send_failed');
  }
}
