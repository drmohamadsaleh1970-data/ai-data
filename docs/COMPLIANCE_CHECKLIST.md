# Privacy and third-party permissions checklist

The software enforces these controls. It **cannot certify legality**. Get a professional assessment under UAE PDPL (and DIFC/ADGM if relevant) before distributing any personal data to subscribers.

## Before you enable `COLD_SUBSCRIBER_TRANSFER` in production
- [ ] For every `data_provenance` source, document the licence or contract, the legal basis, and the permitted purposes: search, PII display, transfer to subscribers, calling, WhatsApp, email, retention and cross-border access.
- [ ] Confirm that the registry or source terms allow redistribution to third-party agencies. A registry label alone is not enough.
- [ ] Publish a transparency notice and a data-subject request channel.
- [ ] Load Do-Not-Call and suppression lists. Use **Owner → Master DB → Opt-out** for individual requests; it propagates to every tenant copy.
- [ ] Approve each source under **Owner → Rights & governance**. Unapproved records stay `RESTRICTED_PENDING_REVIEW`: no PII is shown and they cannot be transferred.

## What is enforced in code
- PII is masked on the server for subscribers. Restricted rows carry no PII at all.
- Free-text name search is not offered, so masked previews cannot be used to probe identities.
- Subscribers have no raw-export routes, and guessable export URLs are hard-denied and audited.
- The owner XLSX export needs MFA and is watermarked, recorded in a manifest, and audited.
- Logging an outreach activity is blocked for suppressed contacts. The CRM shows a lawful-basis warning when no marketing permission is on record.
- Nationality is never used in scoring or routing.
- Anonymous search events store no identity, IP or session ID, and are never turned into leads.
- Hot consent is stored on each lead. Allocation is refused for sources marked `isolation_required` (Property Finder, Bayut, Dubizzle).

## Connectors: what each owner or agency must obtain
| Connector | What you need |
|---|---|
| Google Sign-In | OAuth web client, authorized origins |
| PayPal | Business account, REST app (sandbox and live), 2 billing plans, webhook subscribed to `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.*` |
| Meta Lead Ads | Meta app, Page access, `leads_retrieval`, `leadgen` webhook, app review |
| Google Ads lead forms | Webhook URL and key per form |
| TikTok Lead Gen | TikTok for Business, CRM integration approval |
| LinkedIn Lead Sync | Program approval and OAuth |
| WhatsApp Business | WABA, Cloud API token, verified number, webhook, approved templates |
| Property Finder / Bayut / Dubizzle | Signed API agreements. Respect source isolation (no pooling, resale or merging). |

Every connector shows **NOT CONNECTED** or **APPROVAL REQUIRED** until it is actually configured. The adapters beyond first-party forms are not implemented yet; see the README.
