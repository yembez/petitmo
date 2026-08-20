/**
 * Liste des commandes livre (espace parent). Auth JWT requise.
 * Filtre : print_order payées, e-mail du compte = crm_contacts.email.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function gelatoFulfillmentStatus(printerOrderJson: unknown): string {
  if (!printerOrderJson || typeof printerOrderJson !== 'object') return '';
  const o = printerOrderJson as Record<string, unknown>;
  if (typeof o.gelatoFulfillmentStatus === 'string' && o.gelatoFulfillmentStatus.trim()) {
    return o.gelatoFulfillmentStatus.trim().toLowerCase();
  }
  const last = o.lastWebhook;
  if (last && typeof last === 'object') {
    const fs = (last as Record<string, unknown>).fulfillmentStatus;
    if (typeof fs === 'string' && fs.trim()) return fs.trim().toLowerCase();
  }
  return '';
}

function orderStatusLabel(row: {
  payment_status: string | null;
  status: string | null;
  printer_order_id: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  printer_order_json: unknown;
}): string {
  if (row.payment_status === 'refunded') return 'refunded';
  const gelato = gelatoFulfillmentStatus(row.printer_order_json);
  if (row.delivered_at || gelato.includes('delivered')) return 'delivered';
  if (gelato.includes('returned')) return 'returned';
  if (
    row.status === 'failed' ||
    gelato === 'failed' ||
    gelato === 'canceled' ||
    gelato === 'cancelled' ||
    gelato === 'on_hold'
  ) {
    return 'failed';
  }
  if (gelato.includes('in_transit') || gelato.includes('transit')) return 'in_transit';
  if (row.shipped_at || gelato.includes('shipped')) return 'shipped';
  if (
    row.printer_order_id ||
    row.status === 'sent_to_printer' ||
    gelato === 'in_production' ||
    gelato === 'printed' ||
    gelato === 'passed' ||
    gelato === 'uploading' ||
    gelato === 'created'
  ) {
    return 'printing';
  }
  if (row.payment_status === 'paid') return 'paid';
  return 'paid';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === anonKey) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  const email = (userData.user?.email ?? '').trim().toLowerCase();
  if (userErr || !email) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(url, serviceKey);
  const { data: contact, error: cErr } = await supabase
    .from('crm_contacts')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (cErr) {
    console.error('[print-orders] crm', cErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  if (!contact?.id) {
    return jsonRes({ orders: [] }, 200);
  }

  const { data: rows, error: qErr } = await supabase
    .from('export_requests')
    .select(
      'id, created_at, paid_at, price_cents, payment_status, status, printer_order_id, shipped_at, delivered_at, shipping_name, book_id, child_local_id, printer_order_json',
    )
    .eq('crm_contact_id', contact.id)
    .eq('type', 'print_order')
    .in('payment_status', ['paid', 'refunded'])
    .order('created_at', { ascending: false })
    .limit(40);

  if (qErr) {
    console.error('[print-orders] select', qErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  const bookIds = [
    ...new Set(
      (rows ?? [])
        .map((row) => (typeof row.book_id === 'string' ? row.book_id.trim() : ''))
        .filter(Boolean),
    ),
  ];
  const titlesById = new Map<string, string>();
  if (bookIds.length > 0) {
    const { data: bookRows, error: bErr } = await supabase
      .from('books')
      .select('id, title')
      .in('id', bookIds);
    if (bErr) {
      console.warn('[print-orders] books', bErr.message);
    } else {
      for (const b of bookRows ?? []) {
        const id = typeof b.id === 'string' ? b.id.trim() : '';
        const title = typeof b.title === 'string' ? b.title.trim() : '';
        if (id && title) titlesById.set(id, title);
      }
    }
  }

  const orders = (rows ?? []).map((row) => {
    const bookId = typeof row.book_id === 'string' ? row.book_id.trim() : '';
    const childId = typeof row.child_local_id === 'string' ? row.child_local_id.trim() : '';
    return {
      id: row.id,
      createdAt: row.paid_at || row.created_at,
      priceCents: typeof row.price_cents === 'number' ? row.price_cents : 0,
      status: orderStatusLabel(row),
      shippingName: typeof row.shipping_name === 'string' ? row.shipping_name : '',
      bookId,
      childId,
      bookTitle: titlesById.get(bookId) ?? '',
    };
  });

  return jsonRes({ orders }, 200);
});
