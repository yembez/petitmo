import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadGelatoConfig } from '../gelato/config';

type GelatoWebhookBody = {
  id?: string;
  orderReferenceId?: string;
  fulfillmentStatus?: string;
  shipment?: {
    trackingCode?: string;
    trackingUrl?: string;
  };
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
    const gelatoOrderId = typeof body.id === 'string' ? body.id.trim() : '';
    const exportRequestId =
      typeof body.orderReferenceId === 'string' ? body.orderReferenceId.trim() : '';
    const fulfillmentStatus =
      typeof body.fulfillmentStatus === 'string' ? body.fulfillmentStatus.trim() : '';

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
      },
    };

    const nowIso = new Date().toISOString();
    if (fulfillmentStatus && isDeliveredStatus(fulfillmentStatus)) {
      patch.delivered_at = nowIso;
      patch.shipped_at = patch.shipped_at ?? nowIso;
    } else if (fulfillmentStatus && isShippedStatus(fulfillmentStatus)) {
      patch.shipped_at = nowIso;
    }

    const { error: upErr } = await supabase.from('export_requests').update(patch).eq('id', row.id);
    if (upErr) {
      console.error('[gelato-webhook] update', upErr.message);
      res.status(500).json({ error: 'Update failed' });
      return;
    }

    console.log('[gelato-webhook] ok', row.id, fulfillmentStatus || 'no-status');
    res.status(200).json({ ok: true });
  });
}
