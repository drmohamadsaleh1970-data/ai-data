const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  production: env.NODE_ENV === 'production',
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
  // The platform owner is defined by settings, so the account exists after every restart
  // and is linked to the owner's Google account on first sign-in (see seed.ensureOwner).
  get ownerEmail() { return (env.OWNER_EMAIL || '').trim().toLowerCase(); },
  get ownerTotpSecret() { return (env.OWNER_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase(); },
  // ai-home.world is the investor-data source only. Read lazily so tests and ops can
  // change it without a restart of the config module.
  aihomeSource: {
    get url() { return env.AIHOME_SOURCE_URL || ''; },
    get token() { return env.AIHOME_SOURCE_TOKEN || ''; },
    get syncMinutes() { return Number(env.AIHOME_SYNC_MINUTES || 0); },
  },
};

export const paypalConfigured = () => !!(config.paypal.clientId && config.paypal.clientSecret && config.paypal.webhookId);
