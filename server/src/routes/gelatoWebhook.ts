import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadGelatoConfig } from '../gelato/config';

type GelatoWebhookBody = {
  /** Id événement webhook (pas toujours l’id commande Gelato). */
  id?: string;
  orderId?: string;
  orderReferenceId?: string;
  fulfillmentStatus?: string;
  shipment?: {
    trackingCode?: string;
    trackingUrl?: string;
  };
  items?: Array<{
    fulfillments?: Array<{
      trackingCode?: string;
      trackingUrl?: string;
    }>;
  }>;
};

function webhookAuthorized(req: Request, secret: string | null): boolean {
  if (!secret) return true;
  const header =
    (typeof req.headers['x-gelato-webhook-secret'] === 'string'
      ? req.headers['x-gelato-webhook-secret']
      : '') ||
    (typeof req.headers['x-webhook-secret'] === 'string' ? req.headers['x-webhook-secret'] : '');
  return header === secret;
}

function gelatoOrderIdFromBody(body: GelatoWebhookBody): string {
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (orderId) return orderId;
  const eventId = typeof body.id === 'string' ? body.id.trim() : '';
  return eventId;
}

function trackingFromBody(body: GelatoWebhookBody): { code?: string; url?: string } {
  const shipCode = body.shipment?.trackingCode?.trim();
  if (shipCode) {
    return { code: shipCode, url: body.shipment?.trackingUrl?.trim() };
  }
  const items = body.items;
  if (!Array.isArray(items)) return {};
  for (const item of items) {
    const fulfillments = item.fulfillments;
    if (!Array.isArray(fulfillments)) continue;
    for (const f of fulfillments) {
      const code = f.trackingCode?.trim();
      if (code) {
        return { code, url: f.trackingUrl?.trim() };
      }
    }
  }
  return {};
}

function isShippedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes('shipped') || s.includes('in_transit') || s.includes('transit');
}

function isDeliveredStatus(status: string): boolean {
  return status.toLowerCase().includes('delivered');
}

export function registerGelatoWebhookRoute(app: Express, supabase: SupabaseClient): void {
  app.post('/v1/webhooks/gelato', async (req: Request, res: Response) => {
    const config = loadGelatoConfig();
    const secret = config?.webhookSecret ?? null;
    if (!webhookAuthorized(req, secret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as GelatoWebhookBody;
    const gelatoOrderId = gelatoOrderIdFromBody(body);
    const exportRequestId =
      typeof body.orderReferenceId === 'string' ? body.orderReferenceId.trim() : '';
    const fulfillmentStatus =
      typeof body.fulfillmentStatus === 'string' ? body.fulfillmentStatus.trim() : '';
    const tracking = trackingFromBody(body);

    if (!gelatoOrderId && !exportRequestId) {
      res.status(400).json({ error: 'Missing order id' });
      return;
    }

    let query = supabase.from('export_requests').select('id, printer_order_json').limit(1);
    if (exportRequestId) {
      query = query.eq('id', exportRequestId);
    } else {
      query = query.eq('printer_order_id', gelatoOrderId);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('[gelato-webhook] db', error.message);
      res.status(500).json({ error: 'Database error' });
      return;
    }

    const row = rows?.[0] as { id: string; printer_order_json: unknown } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Export request not found' });
      return;
    }

    const patch: Record<string, unknown> = {
      printer_order_json: {
        ...(typeof row.printer_order_json === 'object' && row.printer_order_json
          ? (row.printer_order_json as Record<string, unknown>)
          : {}),
        lastWebhook: body,
        lastWebhookAt: new Date().toISOString(),
        ...(fulfillmentStatus ? { gelatoFulfillmentStatus: fulfillmentStatus } : {}),
        ...(tracking.code ? { trackingCode: tracking.code } : {}),
        ...(tracking.url ? { trackingUrl: tracking.url } : {}),
      },
    };

    const nowIso = new Date().toISOString();
    if (fulfillmentStatus && isDeliveredStatus(fulfillmentStatus)) {
      patch.delivered_at = nowIso;
      patch.shipped_at = patch.shipped_at ?? nowIso;
    } else if (fulfillmentStatus && isShippedStatus(fulfillmentStatus)) {
      patch.shipped_at = nowIso;
    } else if (tracking.code) {
      patch.shipped_at = patch.shipped_at ?? nowIso;
    }

    const { error: upErr } = await supabase.from('export_requests').update(patch).eq('id', row.id);
    if (upErr) {
      console.error('[gelato-webhook] update', upErr.message);
      res.status(500).json({ error: 'Update failed' });
      return;
    }

    console.log(
      '[gelato-webhook] ok',
      row.id,
      fulfillmentStatus || 'no-status',
      tracking.code ? `tracking=${tracking.code}` : '',
    );
    res.status(200).json({ ok: true });
  });
}
