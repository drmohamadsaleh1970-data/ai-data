const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  production: env.NODE_ENV === 'production',
  // DEMO mode exposes persona sign-in and the email outbox for local evaluation.
  demoMode: env.DEMO_MODE === 'true',
  secureCookies: env.NODE_ENV === 'production',
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  paypal: {
    env: env.PAYPAL_ENV || 'sandbox',
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    planIds: { AGENCY_MONTHLY: env.PAYPAL_PLAN_ID_AGENCY || '', AGENT_MONTHLY: env.PAYPAL_PLAN_ID_AGENT || '' },
  },
  // Days after a failed renewal during which Cold transfers stay allowed. Default 0 =
  // secure default: block new paid transfers as soon as entitlement is invalid.
  graceDays: Number(env.BILLING_GRACE_DAYS || 0),
  magicLinkTtlHours: Number(env.MAGIC_LINK_TTL_HOURS || 48),
  // ai-home.world is the investor-data source only. Read lazily so tests and ops can
  // change it without a restart of the config module.
  aihomeSource: {
    get url() { return env.AIHOME_SOURCE_URL || ''; },
    get token() { return env.AIHOME_SOURCE_TOKEN || ''; },
    get syncMinutes() { return Number(env.AIHOME_SYNC_MINUTES || 0); },
  },
};

export const paypalConfigured = () => !!(config.paypal.clientId && config.paypal.clientSecret && config.paypal.webhookId);

// A public demo on a production host (e.g. a Vercel preview with fictional data) needs a
// second, explicit key so DEMO_MODE can never be switched on in production by accident.
if (config.production && config.demoMode && env.ALLOW_PUBLIC_DEMO !== 'true') {
  throw new Error('DEMO_MODE must not be enabled in production (set ALLOW_PUBLIC_DEMO=true only for a public fictional-data demo).');
}
