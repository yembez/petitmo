function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

export function loadEnv(): {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  trustProxy: boolean;
} {
  const portRaw = process.env.PORT ?? '8787';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  return {
    port,
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  };
}
