# Meta (Facebook/Instagram) Lead Ads, Click-to-Messenger and Click-to-WhatsApp as real-time lead sources for AI-DATA (UAE), as of late October 2026

> Source-access caveat (read first): in this research session the hosts `developers.facebook.com`, `leadsync.me` and `blog.kredoo.in` could NOT be fetched directly (DNS blocked by the session's network allow-list). Findings attributed to Meta developer docs below come from search-engine extracts of those pages (the URLs are real Meta doc URLs returned by search), not from a full read of the page. Items I know from prior knowledge but could not re-verify in this session are put in "Gaps" and marked "UNVERIFIED (prior knowledge)". An engineer should open the cited Meta pages once (they now also exist as `.md` variants, e.g. `.../lead-ads/retrieving.md`) before coding.

## 1. How the leadgen webhook works today, what the payload contains, how the full lead is fetched, and current Graph API version / 2025-2026 changes

### Takeaway
Real-time Lead Ads delivery is a two-step "thin webhook + fetch" pattern: Meta POSTs a `leadgen` change on the Page object (containing only IDs: `leadgen_id`, `page_id`, `form_id`, `adgroup_id`/ad id, `created_time`) to your HTTPS callback, and your app then calls `GET /{leadgen_id}` with a Page-scoped token holding `leads_retrieval` to get the actual answers (`field_data`). The Page must be explicitly subscribed to your app via `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`. Current Graph/Marketing API versions are v25.0 (Feb 2026) and very likely v26.0 (July 29, 2026); v24.0 Marketing API expired Oct 6, 2026, and Messenger-destination lead ads creation via API was deprecated in v24.0.

### Cited Findings
**Mechanism / setup**
- Meta's official quickstart for CRM webhooks ("Meta Webhooks for Lead Ads for Customer Relationship Management") is the canonical setup guide; Meta docs now live under the new `developers.facebook.com/documentation/ads-commerce/...` URL tree with `.md` variants — [Meta Webhooks for Lead Ads quickstart](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration); [.md version](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration.md)
- Subscribing a Page: "Have your app send a POST request to the Page's subscribed_apps edge using the Page's access token" requesting the `leadgen` field; confirm with `GET /{page-id}/subscribed_apps` — your app should be listed with `leadgen` in `subscribed_fields` — [Meta Leads webhooks doc](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/) (via search extract); [Meta quickstart](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration)
- `pages_manage_metadata` is the permission that lets the app subscribe the Page to webhooks — [Meta quickstart](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration) (via search extract)
- The webhook carries only IDs; a second Graph API call with the `leadgen_id` is needed to get name/email/answers — [Meta Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving); [Elad Nava Node.js tutorial](https://eladnava.com/get-facebook-ad-lead-notifications-in-realtime-with-node-js-webhooks/); [machouz gist (own webhook without Zapier)](https://gist.github.com/machouz/7c027c9031ef45c0d7a3650f70897757)

**Payload**
- Meta's sample payload nests data in `entry[].changes[]`; each change has `field: "leadgen"` and `value` with `leadgen_id`, `page_id`, `form_id`, `adgroup_id` and a Unix-timestamp `created_time` — [Meta Leads webhooks doc](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/) (via search extract)
- Older doc versions also listed `ad_id` in the value — [Meta Lead Ads v2.5 doc (legacy)](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/leads/v2.5)

**Signature / verification**
- Meta signs the request body with HMAC-SHA256 using the App Secret and sends it in `X-Hub-Signature-256` as `sha256=<hex>` — [Infiq glossary: X-Hub-Signature-256](https://www.infiq.in/glossary/x-hub-signature-256); [Hookdeck WhatsApp webhooks guide](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- The HMAC must be computed over the exact raw bytes received, before JSON parsing; a re-serialised body will not match — [GitHub PR "verify X-Hub-Signature-256 over the bytes that arrived"](https://github.com/Anchit-AI-Hustle/lifecycle-os/pull/84)
- A valid signature proves origin/integrity, not freshness — retries carry the same valid signature, so dedupe by event ID — [Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)

**Retrieving the lead**
- Reading leads requires the `leads_retrieval` permission — [Meta Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)
- Meta's bulk-read example requests `created_time`, `id`, `ad_id`, `form_id`, `field_data` from a form's `leads` edge — [Meta Retrieving Leads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving) (via search extract)
- Using a user token for the lead fetch fails with "(#190) This method must be called with a Page Access Token"; fix is exchanging the user token for a Page token — [LeadSync API guide](https://leadsync.me/blog/meta-lead-gen-api-guide/) (via search extract)

**Versions and 2025-2026 changes**
- v25.0 released February 18, 2026 ("Available until TBD" on the English page; one localized page shows a 2028 expiry) — [Graph API v25.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version25.0); [Versions page (ja_JP)](https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=ja_JP)
- Localized copies of Meta's versions page list v26.0 released July 29, 2026 with expiry not yet set; English page not confirmed in this session — [Versions page (ja_JP)](https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=ja_JP); [Versions page (de_DE)](https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=de_DE). A third-party August 2026 changelog also says Marketing API v26.0 shipped July 29 with version auto-upgrade, and that some v26.0 removals extend to all versions (including unversioned calls) on Oct 27, 2026 — [AdMake AI Aug 2026 changelog](https://admakeai.com/blog/meta-ads-updates-august-2026) (third-party, unconfirmed)
- v24.0 released Oct 8, 2025; Marketing API v24.0 expired Oct 6, 2026 — [Versions page](https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=ja_JP); [api-evangelist Meta changelog mirror](https://raw.githubusercontent.com/api-evangelist/meta/refs/heads/main/changelog/meta-changelog.yml)
- Calls to a retired version are not rejected — they are defaulted to the next oldest usable version (silent behaviour change) — [DEV.to: v20 expiry](https://dev.to/flarecanary/metas-graph-api-v20-expires-september-24-your-calls-wont-fail-theyll-quietly-start-running-v21-2m2a)
- Meta ships a new version roughly every 3-4 months with ~2 years of support — [DEV.to](https://dev.to/flarecanary/metas-graph-api-v20-expires-september-24-your-calls-wont-fail-theyll-quietly-start-running-v21-2m2a)
- Marketing API v24.0: creating lead ads that generate leads in Messenger via the API is deprecated (still possible in Ads Manager) — [Marketing API v24.0 changelog](https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog/version24.0) (via search extract)
- Advantage+ Shopping/App campaign creation via the legacy APIs removed from v25.0, extended to all versions by May 19, 2026 (campaign creation, not lead retrieval) — [PPC Land](https://ppc.land/meta-deprecates-legacy-campaign-apis-for-advantage-structure/)
- I found no deprecation of the `leadgen` webhook field or of `GET /{leadgen_id}` / `/{form_id}/leads` in 2025-2026 — (negative finding; searches of changelog extracts surfaced none)

### Inferences
- Engineering sketch for Express: mount the webhook route with `express.raw({type: 'application/json'})` (not `express.json()`) so HMAC is computed over raw bytes; `GET` handler echoes `hub.challenge` when `hub.verify_token` matches; `POST` handler verifies `X-Hub-Signature-256` with `crypto.timingSafeEqual`, enqueues each `changes[].value` and returns 200 immediately; a worker then calls `GET /v25.0/{leadgen_id}?fields=...` with the tenant's Page/system-user token and upserts on `leadgen_id`.
- Pin an explicit version in every call (e.g. `v25.0` or `v26.0`) and add a calendar reminder for its sunset; because expired versions silently upgrade, an unpinned or stale-pinned integration can change behaviour without errors.
- `adgroup_id` in the webhook value is the ad ID (legacy "adgroup" naming); store both it and the `ad_id` returned by the fetch.

### Gaps
- Could not read Meta's current Leads webhooks / Retrieving pages in full (host blocked). Exact current list of fields in the webhook `value` (whether `ad_id` is still sent alongside `adgroup_id`) is not confirmed.
- UNVERIFIED (prior knowledge): lead object fields available on `GET /{leadgen_id}` include `id, created_time, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, field_data, custom_disclaimer_responses, is_organic, platform, partner_name, post`; `field_data` is an array of `{ "name": "<question key>", "values": ["..."] }`; `custom_disclaimer_responses` is an array of `{ "checkbox_key": "...", "is_checked": "1"|"" }`. Search did not surface any page confirming `custom_disclaimer_responses` in 2026.
- UNVERIFIED (prior knowledge): verification handshake is `GET callback?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...` and must echo `hub.challenge` with 200; the app-level subscription is created in App Dashboard > Webhooks > Page > `leadgen` (or `POST /{app-id}/subscriptions`), separately from the per-Page `subscribed_apps` call. Callback must be HTTPS with a valid (non-self-signed) certificate.
- v26.0 release confirmed only via localized Meta pages and a third-party blog; English changelog not opened. No lead-ads-specific change found for v25/v26.

## 2. Permissions, App Review, Business Verification, Advanced Access, Tech Provider / Facebook Login for Business, token types and Lead Access Manager

### Takeaway
For the platform's own Pages, a Business-owned app in Live mode with a system-user token (assigned to the Pages and ad accounts) and Standard access is the simplest path. For many client agencies' Pages (multi-tenant), AI-DATA must: complete Business Verification, obtain Advanced Access via App Review for `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` (and `ads_management`/`pages_manage_ads` depending on the use case), pass Access Verification as a Tech Provider, and onboard clients through Facebook Login for Business (FBL4B). Each client must also grant the AI-DATA app (or its CRM entry) access in Leads Access settings if they have customised it, otherwise the webhook can be "connected but silent".

### Cited Findings
- Meta's lead-ads CRM doc lists `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` and `ads_management` as required, granted through App Review — [Meta Leads webhooks doc](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/) (via search extract); some community sources list `pages_manage_ads` instead of `ads_management` — [n8n community thread](https://community.n8n.io/t/how-to-setup-facebook-trigger-fb-app-for-lead-forms/14317); [api-evangelist README](https://github.com/api-evangelist/facebook-lead-ads) (lists `leads_retrieval`, `pages_show_list`, `pages_manage_ads`, Page tokens via Facebook Login / Meta Business Login)
- In the current App Dashboard, `leads_retrieval` sits under the use case "Capture & manage ad leads with Marketing API", which unlocks `leads_retrieval` and `pages_manage_metadata` — [Meta Lead Ads to CRM guide (WebX)](https://www.webxdevelopers.com/blog/meta-lead-ads-crm-integration-guide); [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/) (via search extract)
- Access Verification (Tech Provider) is a separate step from App Review and permission access levels; `leads_retrieval` is among the permissions that trigger it — [Meta Access Verification](https://developers.facebook.com/documentation/development/release/access-verification.md)
- Business Verification must be completed by a business admin before Access Verification can start — [Meta Access Verification](https://developers.facebook.com/documentation/development/release/access-verification.md); [Meta Business Verification](https://developers.facebook.com/docs/development/release/business-verification/); [Meta Business Help: Verify your business](https://www.facebook.com/business/help/2058515294227817)
- Without Tech Provider status, "apps claimed by a business cannot be used by other businesses"; once verified, apps claimed by the business can be used by other businesses — [Meta Tech Providers](https://developers.secure.facebook.com/docs/development/release/tech-providers/)
- Tech Provider status does not replace App Review: each permission must still be approved for Advanced Access before a non-role user can grant it — [Meta Tech Providers](https://developers.secure.facebook.com/docs/development/release/tech-providers/)
- For `leads_retrieval`, reviewers ask for specific examples of why the app needs leads for the Pages that grant access, plus a screencast demonstrating the complete Facebook Login for Business (FBL4B) or Meta Business Extension (MBE) flow — [Meta Access Verification](https://developers.facebook.com/documentation/development/release/access-verification.md); [Meta Permissions Reference](https://developers.facebook.com/documentation/development/permissions)
- Tech Provider status reverts to unverified if verification status changes, the app is disconnected from its business, or the business is restricted; it restores automatically once reversed — [Meta Tech Providers](https://developers.secure.facebook.com/docs/development/release/tech-providers/)
- FBL4B: apps with Advanced Access must undergo Ongoing Review to retain access; business clients can invalidate User access tokens through their Business Integrations settings at any time — [Meta Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- Tokens (system user) only capture permissions for assets assigned at generation time: if the Page was added after the token was generated, regenerate it — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/) (via search extract)
- Error code 100 / subcode 33 appears when a Page token is used for an ad-level call; suggested fix is a Business System User token — [Meta Lead Ads Testing & Troubleshooting / vendor guides](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting) (via search extract; exact source page uncertain)
- Vendor advice: for production, derive the Page token from a System User so it does not expire — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/) (vendor claim, not confirmed in Meta docs this session)
- Leads Access Manager: "If the Page admin did not customize leads or give access through the Leads Access Manager, all Page admins get leads access"; if business admins customised it, access depends on that configuration — [Meta Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) (via search extract)
- Leads Access in Business Suite (Integrations > Leads access) controls which people, partners and CRMs can download leads; Meta warns CRMs without proper access won't receive real-time updates, and the Lead Ads Testing Tool shows an error for that CRM — [AdsUploader CRM guide](https://adsuploader.com/blog/facebook-lead-ads-crm-integration); [LeadEnforce: enable leads access](https://leadenforce.com/blog/how-to-enable-leads-access-in-meta-business-suite); [ChakraHQ partner access help](https://chakrahq.com/help/learning-centre/meta-business-manager/integrations-partner-access)
- Missing Leads Access assignment is cited as the most common reason leads fail to reach a CRM — [LeadEnforce](https://leadenforce.com/blog/download-or-retrieve-your-leads-data-from-meta-practical-guide)

### Inferences
- Two-tier design: (a) Own Pages: system user in AI-DATA's Business Manager, assigned the Pages with "Manage leads" / full control, token generated with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_read`/`ads_management`; (b) Client Pages: FBL4B "configuration" flow where the agency selects its Pages; store the returned business-integration token per tenant, exchange for Page tokens (`GET /me/accounts` or `/{page-id}?fields=access_token`), call `subscribed_apps` per Page, and record `page_id -> tenant_id` mapping used to route incoming webhooks.
- Because client admins can revoke via Business Integrations at any time and Ongoing Review can remove access, the platform needs a per-tenant health check (e.g. daily `GET /{page-id}/subscribed_apps` + test `GET /{form_id}/leads?limit=1`) and an in-app "reconnect Meta" prompt.
- Development-mode apps only receive webhooks for Pages where the developer has a role; going Live and Advanced Access are prerequisites before any agency Page will fire.

### Gaps
- Could not read Meta's Permissions Reference in full to confirm whether `ads_management` is strictly required for lead retrieval in 2026 or only `leads_retrieval` + Page permissions (sources conflict: `ads_management` vs `pages_manage_ads`). Also whether `business_management` is needed (it is typically needed only to list/assign business assets; not confirmed).
- UNVERIFIED (prior knowledge): Page access tokens derived from a long-lived (60-day) user token have no expiry but are invalidated when the user loses Page role, changes password, or de-authorises the app; system-user tokens can be created as "never expire" or 60-day expiring; FBL4B issues "business integration system user access tokens" that do not expire unless revoked.
- Whether the Page admin still needs to accept Lead Ads Terms (facebook.com/ads/leadgen/tos) per Page in 2026 — one third-party guide surfaced in search says yes, could not open it to verify — [Kredoo blog](https://blog.kredoo.in/meta-lead-ads-webhook-connected-but-silent/).
- Typical App Review / Access Verification turnaround time in 2026 — no reliable source found.

## 3. Latency, retry behaviour, rate limits, lead retention, bulk download fallback and backfill

### Takeaway
Webhooks normally fire within seconds of submission (Meta's own testing doc says the RTU fires "a few seconds" after creation), but delivery is not guaranteed, so a polling backfill on `/{form_id}/leads` filtered by `time_created` is mandatory. Leads are only retrievable for 90 days; rate limit for lead reads scales with the Page's lead volume (200 x 24 x leads created in the past 90 days).

### Cited Findings
- Meta's Testing and Troubleshooting page: "it takes a few seconds for the RTU to be fired to your endpoint", and you can click Track Status in the tool until the status changes — [Meta Lead Ads Testing & Troubleshooting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting) (via search extract)
- Third-party guide says a dropped webhook is never redelivered, so polling is a useful backfill — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/) (via search extract)
- Meta webhook retries can deliver the same event more than once; dedupe on `leadgen_id` — [LeadSync / WebX guides](https://www.webxdevelopers.com/blog/meta-lead-ads-crm-integration-guide) (via search extract)
- For WhatsApp webhooks (not leadgen), Meta retries with exponential backoff for up to 7 days; manual replay is not natively supported — [Hookdeck WhatsApp webhooks guide](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- Retention: "You have 90 days from the time a lead submits their form to download their information" — [Meta Business Help: Download or retrieve your leads](https://www.facebook.com/business/help/734933888443065); also [LeadEnforce](https://leadenforce.com/blog/download-or-retrieve-your-leads-data-from-meta-practical-guide)
- A webhook-only integration that dies unnoticed doesn't just delay leads, it loses them after 90 days — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/) (via search extract)
- Rate limit: 200 x 24 x (number of leads created in the past 90 days for the Facebook Page) — [Meta Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving) (via search extract); [Rollout API essentials](https://rollout.com/integration-guides/facebook-lead-ads/api-essentials)
- Backfill: `GET /{form_id}/leads` with `filtering=[{"field":"time_created","operator":"GREATER_THAN","value":<unix_ts>}]`; community examples combine `GREATER_THAN` and `LESS_THAN` in a JSON array for a time window — [Meta Retrieving Leads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving) (via search extract); [Ishan: leads between two timestamps](https://ishan.page/blog/2023-06-20-facebook-graph-leads-between/)
- Leads can also be exported (CSV) from Leads Center in Meta Business Suite, filterable by date range and form — [SaveMyLeads: Leads Center](https://savemyleads.com/blog/other/leads-center-in-meta-business-suite); [Meta Business Help](https://www.facebook.com/business/help/734933888443065)

### Inferences
- Recommended reliability pattern: webhook as primary (seconds), plus a per-tenant poller every 5-15 min that lists active forms (`GET /{page-id}/leadgen_forms`) and pulls `/{form_id}/leads` with `time_created > last_seen - overlap`, upserting on lead `id`. This also covers leads that arrived while a token was broken, as long as it is repaired within 90 days.
- Rate limits are generous for active Pages but tiny for a brand-new Page with zero historical leads; poll conservatively for new tenants and back off on error codes 4/17/32/80000-series.
- Respond 200 to the webhook before doing the Graph fetch; slow responses risk timeouts and duplicate retries.

### Gaps
- UNVERIFIED (prior knowledge): Graph API webhooks doc states failed notifications are retried "immediately a few more times" and that undelivered notifications are dropped after roughly 36 hours; notifications may be batched (up to 1000 changes per POST). I found no 2026 source confirming the leadgen retry window — search only confirmed 7 days for WhatsApp.
- No published SLA or measured p50/p95 latency for leadgen webhooks; only Meta's "a few seconds" testing statement.
- Whether `/{ad_id}/leads` filtering behaves identically to `/{form_id}/leads` not verified this session.

## 4. Native CRM integrations in Meta and Conversions API for CRM (sending lead quality back)

### Takeaway
Meta Business Suite has a directory of native CRM integrations (connect inside Business Suite, authenticate on the CRM's side); a custom platform like AI-DATA is not in it unless it becomes a listed partner, so it integrates via webhooks + Leads Access instead. The Conversions API for CRM ("Conversion Leads") lets AI-DATA send lead stage changes back to Meta keyed by `lead_id` (= `leadgen_id`), with `action_source: system_generated` and `event_source: crm`; this matters more in 2026 because Meta reportedly gates the "qualified leads" optimisation goal on CAPI integration from April 2026.

### Cited Findings
- Meta maintains a directory of supported CRM and marketing systems that you search for and connect inside Business Suite; after authenticating on the CRM's side, leads flow automatically — [AdsUploader CRM integration guide](https://adsuploader.com/blog/facebook-lead-ads-crm-integration) (third-party; Meta's directory page not found)
- If your CRM is not in the directory, use a third-party connector or a custom build on Meta's lead webhooks and Conversions API; to send lead signals back for optimisation, connect the CRM to CAPI — [Meta Business Help: Download or retrieve your leads](https://www.facebook.com/business/help/734933888443065) (via search extract)
- Meta publishes a guide for platforms integrating CAPI for CRM on behalf of many advertisers — [Meta: Conversions API for CRM — Integrate as a Platform](https://developers.facebook.com/documentation/ads-commerce/conversions-api/guides/conversions-api-crm-for-platforms)
- Payload spec: `action_source` must be `system_generated` for all Conversion Leads events; `lead_id` (15-17 digits, from the `leadgen_id` webhook field) goes in `user_data`, and an invalid `lead_id` causes rejection; at least one valid custom parameter required; email/phone must be hashed; send each stage change as it happens including the initial lead stage; `event_time` in Unix seconds — [Meta CAPI Conversion Leads Payload Specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification)
- Conflict: the spec text says set `lead_event_source` to `crm`, but its example and the platform guide use `"event_source": "crm"` and `"lead_event_source": "Salesforce"` (i.e. CRM name) — [Payload Specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification); [CRM for Platforms](https://developers.facebook.com/documentation/ads-commerce/conversions-api/guides/conversions-api-crm-for-platforms)
- Optimisation only supports native Lead Ads (Instant Forms) on Facebook/Instagram; the Make module can only be used for leads that came from Lead Ads with a saved Lead ID — [Payload Specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification); [Make: Facebook Conversions API for CRM](https://www.make.com/en/help/apps/marketing/facebook-conversion-leads.html)
- Example implementations: [Kestra blueprint: CRM lead stages to Meta CAPI](https://kestra.io/blueprints/meta-capi-crm-conversion-leads); [Datahash: Meta CAPI for CRM](https://www.datahash.com/docs/signals/destinations/lead-conversions/meta-conversions-api-for-crm/)
- Beginning November 2025, Salesforce Sales Cloud users can send lead events from the CRM directly via CAPI; "require work email" verification added to Instant Forms — [MarTech: Meta lead gen upgrades for "Q5"](https://martech.org/meta-announces-lead-gen-product-upgrades-for-q5-yes-you-read-that-right/)
- Search extract states that beginning April 2026 the "qualified leads" performance goal is no longer available for new campaign creation without a Conversions API integration — attributed to Meta lead-ads material, but I could not open the source page; surfaced alongside [MarTech](https://martech.org/meta-announces-lead-gen-product-upgrades-for-q5-yes-you-read-that-right/) and [Soku: Facebook Lead Ads in 2026](https://soku.ai/blog/facebook-lead-ads) (treat as unverified)

### Inferences
- AI-DATA should persist `leadgen_id` on every lead and expose lead stage changes (e.g. new -> contacted -> qualified -> viewing -> deal) as CAPI events per tenant dataset/pixel; for agencies running Meta campaigns, this is a selling point (better lead quality optimisation) and possibly a requirement for "qualified leads" optimisation.
- CAPI for CRM as a platform needs per-tenant dataset IDs and tokens with `ads_management`/dataset access; plan it as phase 2 after inbound webhook ingestion.

### Gaps
- Meta's official CRM integrations directory page and current partner list were not found; could not verify if listing as a CRM partner is open or invitation-only.
- Exact 2026 rules for the `lead_event_source` vs `event_source` conflict; minimum event volume/stage requirements for Conversion Leads optimisation not confirmed.
- The April 2026 "qualified leads requires CAPI" claim needs confirmation from Meta's Business Help Center.

## 5. Click-to-WhatsApp (CTWA) and Click-to-Messenger (CTM) ads: how leads arrive and how to attribute them

### Takeaway
CTWA/CTM ads do not produce `leadgen` events; the "lead" is the first inbound message, delivered via the WhatsApp Cloud API `messages` webhook (with a `referral` object: `source_id` = ad ID, `headline`, `ctwa_clid`, etc.) or the Messenger `messages`/`messaging_referrals` webhooks (`referral.source: "ADS"`, `ad_id`, `ads_context_data`). Attribution = store the referral on the first message of the conversation; `ctwa_clid` can be sent back to Meta via CAPI for business-messaging conversion optimisation. Replying within 24h opens a 72-hour free messaging window.

### Cited Findings
**WhatsApp (Cloud API)**
- Cloud API message webhooks include a `referral` object with `source_id`, `headline` and `ctwa_clid` as main keys; `ctwa_clid` is omitted entirely for messages originating from an ad in WhatsApp Status — [Meta WhatsApp webhook reference: text messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text/) (via search extract)
- Meta's WhatsApp changelog notes the click ID was added to the referral object in messages webhooks, and the Cloud API referral object differs from the On-Premises API's — [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) (via search extract)
- AWS End User Messaging Social describes storing `ctwa_clid` from the first inbound message and passing it (unhashed) to Meta's Conversions API — [AWS docs: Conversions API](https://docs.aws.amazon.com/social-messaging/latest/userguide/conversions-api.html)
- Third-party wrapper claims the referral is populated only on the first inbound message, with a 7-day attribution window — [docs.rs `late` crate model](https://docs.rs/crate/late/latest/source/src/models/webhook_payload_message_metadata_referral.rs) (unverified)
- Middleware can silently drop the referral block (bug in Evolution API) — [Evolution API issue #2645](https://github.com/evolution-foundation/evolution-api/issues/2645)
- 2026 CTWA guide — [AsisteClick CTWA 2026 guide](https://asisteclick.com/en/blog/click-to-whatsapp-ads-ctwa-conversion-2026/)

**Messenger**
- When a user taps a CTM ad and messages the Page, the app receives ad referral information in the `messages` webhook; both `messages` and `messaging_referrals` must be subscribed — [Meta Messenger `messages` webhook](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messages)
- `message.referral` carries `source` (currently only "ADS"), `type`, `ad_id`, and `ads_context_data` (ad title, ad post ID) — [Meta Messenger `messages` webhook](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messages)
- `messaging_referrals` fires when a user who already has a thread returns via an ad; payload has `ref`, `ad_id`, `source`, `type`, `ads_context_data` (can include photo/video/product/flow IDs) — [Meta `messaging_referrals`](https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks/webhook-events/messaging_referrals)
- One developer reports Meta auto-labels CTM clickers `ad_id.<AD_ID>` but the label webhook sometimes never arrives, so they tag from the referral `ad_id` instead — [ChatbotX PR #1452](https://github.com/ChatbotXIO/ChatbotX/pull/1452)
- Marketing API v24.0 deprecated creating Messenger-destination lead ads via API (Ads Manager still works) — [Marketing API v24.0 changelog](https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog/version24.0)

**Cost of the conversation**
- Replying within 24 hours of a CTWA ad tap opens a 72-hour window where messages (all categories, including marketing templates) are free; the 24h customer-service window still applies to free-form messages — [Wati: CTWA ads cost 2026](https://www.wati.io/en/blog/click-to-whatsapp-ads-cost/); [Go4WhatsUp CTWA guide](https://www.go4whatsup.com/guides/click-to-whatsapp-ads/)
- UAE marketing template rates conflict across sources: ~$0.0816 ([SetSmart](https://setsmart.io/blog/whatsapp-business-api-pricing)); ~AED 0.183 ([Adjoltz](https://adjoltz.com/uae-whatsapp-rate-card)); one UAE guide says AED 0.1832 -> AED 0.2115 per delivered marketing template from 1 October 2026, with the 72h CTWA window unchanged ([Zena/Fictora Labs](https://zena.fictoralabs.ae/whatsapp-pricing-uae/))

### Inferences
- For AI-DATA, CTWA requires each tenant to have a WhatsApp Business Account + phone number on Cloud API with AI-DATA's app subscribed (embedded signup as Tech Provider), which is a heavier onboarding than Lead Ads; a reasonable MVP is Lead Ads first, CTWA second.
- A CTWA "lead" has only a phone number (the WhatsApp `from`) and profile name, not form answers; qualification must happen in-chat (bot/agent), and `source_id` (ad ID) can be resolved to campaign/ad names via Marketing API with `ads_read`.
- Persist `ctwa_clid` on the first message to enable later CAPI "business messaging" conversion events.

### Gaps
- Could not verify current Cloud API referral field list in full (e.g. `source_type`, `source_url`, `body`, `media_type`, `image_url`, `video_url`, `thumbnail_url` — UNVERIFIED prior knowledge).
- Official Meta WhatsApp UAE price as of Oct 2026 not confirmed from Meta's pricing page; third-party figures conflict.
- Whether Instagram Direct (click-to-Instagram-DM) ads expose the same referral data via the Instagram Messaging webhooks was not researched.

## 6. Lead form (Instant Form) features relevant to consent and lead quality

### Takeaway
Instant Forms support three form types (More volume, Higher intent, Rich creative); Higher intent adds a review/confirm screen and optional SMS one-time-passcode phone verification; forms support up to 15 custom questions, conditional logic and disqualification paths, a mandatory advertiser privacy-policy link and optional custom disclaimer/consent checkboxes whose responses come back with the lead. Some of these settings (conditional logic, phone verification) are reportedly not exposed via the Marketing API.

### Cited Findings
- Three official form types: More volume, Higher intent, Rich creative — [AdsUploader: Instant Form types](https://adsuploader.com/blog/facebook-instant-form); [LeadSync Instant Forms 2026](https://leadsync.me/blog/facebook-instant-forms-vs-website-forms/)
- Higher intent adds a review screen before submitting, cutting accidental leads at the cost of volume — [AdsUploader](https://adsuploader.com/blog/facebook-instant-form)
- Higher intent can require leads to verify their phone number with a one-time passcode (an option/checkbox, not forced) — [ClickyOwl: Instant Forms for higher-intent leads](https://clickyowl.com/meta-instant-forms-lead-quality/); [LeadSync](https://leadsync.me/blog/facebook-instant-forms-vs-website-forms/)
- Vendor-reported case study: SMS verification gave a 32% decrease in invalid phone numbers and 2.2x more conversions (treat cautiously) — [AdFirm: Instant Forms vs landing pages 2026](https://www.adfirm.net/blog/meta-lead-gen-instant-forms-2026/) (as surfaced in search; vendor figure)
- Up to 15 custom questions in addition to prefilled contact fields — [AdsUploader](https://adsuploader.com/blog/facebook-instant-form)
- Conditional answers can route the next question and disqualify non-fit users — [LeadSystemsGo: conditional logic](https://www.leadsystemsgo.com/blog/facebook-instant-form-conditional-logic-lead-quality/)
- August 2026 vendor claim: the Marketing API does not expose conditional logic or phone-verification settings on a lead form, so they cannot be audited programmatically — [LeadSystemsGo](https://www.leadsystemsgo.com/blog/facebook-instant-form-conditional-logic-lead-quality/) (vendor claim)
- "Require work email" verification (corporate email) for Instant Forms, available on Instagram or via the Marketing API — [MarTech "Q5" upgrades](https://martech.org/meta-announces-lead-gen-product-upgrades-for-q5-yes-you-read-that-right/)

### Inferences
- For UAE real estate, Higher intent + OTP phone verification is the most relevant quality lever because the phone number is the primary contact channel (calls/WhatsApp); AI-DATA should store whether the form was higher-intent/verified (via form metadata if exposed, or by tenant configuration).
- Consent evidence for UAE PDPL/marketing: store the raw `custom_disclaimer_responses` plus form ID, privacy policy URL and `created_time` as the consent record.

### Gaps
- UNVERIFIED (prior knowledge): every Instant Form must include a link to the advertiser's privacy policy; custom disclaimers can have up to several optional/required checkboxes, returned via `custom_disclaimer_responses` with `checkbox_key` and `is_checked`. No 2026 source surfaced in search to confirm the field and limits.
- Whether form questions/answers are returned in Arabic as entered (UTF-8) and how custom-question keys are named for Arabic forms was not confirmed.
- Meta Business Help Center Instant Forms articles could not be read directly.

## 7. Costs, engineering effort and common pitfalls

### Takeaway
The Graph/Marketing API, webhooks and lead retrieval carry no Meta fee; costs are ad spend (borne by agencies), optional WhatsApp per-message fees for CTWA follow-up (free 72h window after CTWA), and the engineering/compliance cost of App Review, Business Verification and Tech Provider Access Verification. The dominant pitfalls are permission/token problems and silent non-delivery (Page not subscribed, Leads Access not granted, app not Live, wrong token type), which is why a backfill poller and per-tenant health checks are needed.

### Cited Findings
- Webhook-to-CRM is buildable without middleware (examples in Node.js) — [Elad Nava Node.js webhook tutorial](https://eladnava.com/get-facebook-ad-lead-notifications-in-realtime-with-node-js-webhooks/); [machouz gist](https://gist.github.com/machouz/7c027c9031ef45c0d7a3650f70897757); [GitHub meta_leads example](https://github.com/4krishnaveni/meta_leads)
- Pitfall: webhook "connected" but nothing arrives — an article dedicated to this failure mode — [Kredoo: Meta says your lead ads webhook is connected. It still sends nothing.](https://blog.kredoo.in/meta-lead-ads-webhook-connected-but-silent/) (could not open; title from search)
- Pitfall: test lead never shows up when the webhook subscription is missing the `leadgen` field — [LeadSync testing guide](https://leadsync.me/blog/test-facebook-lead-ads/) (via search extract)
- Pitfall: user token instead of Page token -> error #190 "must be called with a Page Access Token" — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/)
- Pitfall: system user token generated before the Page was assigned lacks access; regenerate — [LeadSync](https://leadsync.me/blog/meta-lead-gen-api-guide/)
- Pitfall: a system user can pass every setup step but still use the wrong token for the lead fetch — [Kredoo](https://blog.kredoo.in/meta-lead-ads-webhook-connected-but-silent/) (via search extract)
- Pitfall: CRMs without Leads Access will not receive real-time updates and the testing tool shows an error — [AdsUploader](https://adsuploader.com/blog/facebook-lead-ads-crm-integration)
- Lead Ads Testing Tool: generate a test lead and use "Track Status" to see whether the RTU was delivered — [Meta Testing & Troubleshooting](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/testing-troubleshooting); [AdsUploader: testing tool](https://adsuploader.com/blog/facebook-lead-ads-testing-tool); [Tonkean docs: FB lead ads webhook](https://docs.tonkean.com/en/data-sources/connect-native-data-sources/common-data-sources/facebook-lead-ads-webhook.html)
- Pitfall: silent version upgrade when a pinned version expires — [DEV.to](https://dev.to/flarecanary/metas-graph-api-v20-expires-september-24-your-calls-wont-fail-theyll-quietly-start-running-v21-2m2a)
- Pitfall: verifying HMAC over re-serialised JSON fails — [GitHub PR #84](https://github.com/Anchit-AI-Hustle/lifecycle-os/pull/84)
- Pitfall: Tech Provider status and FBL4B tokens can be revoked/lapse (business restricted, client revokes in Business Integrations, Ongoing Review) — [Meta Tech Providers](https://developers.secure.facebook.com/docs/development/release/tech-providers/); [Meta FBL4B](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business)
- Third-party connectors (Zapier, SaveMyLeads, Bitrix24 Meta Ads Connector) are the common alternative when building is not desired — [AdsUploader](https://adsuploader.com/blog/facebook-lead-ads-crm-integration); [Bitrix24 Meta Ads Connector](https://www.bitrix24.com/apps/app/arseg_security_telec.meta_ads_connector/)

### Inferences
- Engineering effort estimate (inference, not sourced): own-Pages integration (webhook route, HMAC, fetch worker, dedupe, poller, admin UI for token) ~3-6 engineer-days; multi-tenant FBL4B onboarding + per-tenant token store/encryption + subscribed_apps automation + health checks ~2-3 weeks; plus calendar time for Business Verification, App Review (screencast) and Access Verification which is often the critical path.
- Must-have operational features: (1) alert if no leads for a tenant whose ads are active; (2) `subscribed_apps` re-check after any Page role change; (3) token-error classification (190 = re-auth, 10/200 = permission, 100/33 = wrong token/asset) surfacing a "Reconnect Meta" banner; (4) idempotent upsert on `leadgen_id`.

### Gaps
- No authoritative source for typical App Review / Access Verification durations or rejection rates in 2026.
- UNVERIFIED (prior knowledge): Lead Ads Testing Tool URL is `https://developers.facebook.com/tools/lead-ads-testing`; test leads can only be created by users with a Page role and a limited number per form (delete previous test lead to create a new one).

## 8. Middle East / UAE-specific considerations

### Takeaway
Meta's Housing Special Ad Category is not mandated for UAE-based advertisers targeting the UAE (it applies to US-based advertisers and to ads shown in the US, Canada and certain European countries), so UAE real-estate lead ads can use normal targeting — unless a campaign targets those regions (e.g. UK/EU investor audiences), which is common for Dubai off-plan marketing. Local regulation is the bigger constraint: Dubai property ads on social media generally need a DLD/RERA Trakheesi permit number displayed in the ad, and a federal UAE Media Council digital advertising permit regime reportedly tightened from 1 February 2026.

### Cited Findings
- Housing SAC applies to advertisers based in the US/US territories and to advertisers showing ads to people in the US, Canada and certain European countries — [LeadSync: Special Ad Category 2026](https://leadsync.me/blog/special-ad-category-meta/); [ArdorSEO: Housing SAC](https://ardorseo.com/blog/meta-special-ad-category-housing/); [Boostpoint](https://boostpoint.com/meta-special-ad-category/)
- "Europe" in Meta's list covers EU plus UK, Norway, Switzerland, Iceland and several microstates (per third-party reading of Meta docs) — [AdAdvisor](https://adadvisor.ai/blog/meta-special-ad-categories); [ArdorSEO](https://ardorseo.com/blog/meta-special-ad-category-housing/)
- Housing SAC restrictions: ages fixed 18-65+, all genders, no ZIP targeting or location exclusions, no lookalikes; minimum radius 15 miles (25 km) in US/Canada and 10 miles (17 km) in listed European countries (sources conflict on Europe radius) — [ArdorSEO](https://ardorseo.com/blog/meta-special-ad-category-housing/); [Reallyo](https://www.reallyo.com/blog/facebook-ads-for-rental-listings)
- Housing rules did not change in 2025 or 2026 (credit category renamed "financial products and services", required from Jan 21, 2025 for US-related ads) — [Reallyo](https://www.reallyo.com/blog/facebook-ads-for-rental-listings); [LeadSync](https://leadsync.me/blog/special-ad-category-meta/)
- One older (~576 days) source claims the rules extend to Asia and Africa; no other source supports it — [Practina](https://www.practina.com/everything-you-should-know-about-facebook-special-ads/) (likely outdated/incorrect)
- Dubai: brokerages apply for a Trakheesi permit via the DLD system; the permit number is tied to the specific property and advert and covers social media (Instagram, Facebook, TikTok, YouTube, LinkedIn, X) — [Driven Properties: Trakheesi guide](https://www.drivenproperties.com/blog/trakheesi-permit-dubai-guide); [Cushman & Wakefield UAE](https://cushwake.ae/en/news/real-estate-brokers-in-dubai-now-need-to-gain-approval-for-property-ads); [PropSpace: UAE real-estate ad permits](https://www.propspace.com/blog/uae-real-estate-advertising-permits)
- Permit number should be visible in the creative/caption (not only in a bio link) — [Driven Properties](https://www.drivenproperties.com/blog/trakheesi-permit-dubai-guide); [Real Estate Club Dubai](https://realestateclubdubai.com/blog/property-management/trakheesi-permit-in-dubai-what-it-is-how-to-get-it-and-why-short-term-landlords-need-one)
- Brokers can no longer rush out "Just Sold" social ads — [Gulf News](https://gulfnews.com/business/property/dubai-brokers-will-need-to-follow-new-strict-rule-on-just-sold-ads-1.1734060989359)
- UAE digital advertising rules changed on 1 February 2026: a Media Council permit number must appear on paid promotional posts and ads may only run via registered, permit-linked social accounts (single agency source) — [HiDubai: UAE Media Council digital advertising permit](https://focus.hidubai.com/a-guide-to-the-new-uae-media-council-digital-advertising-permit/)
- UAE WhatsApp marketing rate card and marketing law summary (third-party) — [Adjoltz](https://adjoltz.com/uae-whatsapp-rate-card)

### Inferences
- AI-DATA could store the Trakheesi permit number per form/campaign (tenant-supplied) and show it alongside each lead for compliance audits; it is not something the Lead Ads API provides.
- For agencies targeting UK/EU buyers for Dubai off-plan, the Housing SAC will apply to those ad sets, limiting targeting; the lead payload is unaffected.
- Arabic Instant Forms: answers will arrive as UTF-8 strings in `field_data`; normalise phone numbers to E.164 (+971...) and handle Arabic-Indic digits when parsing free-text answers.

### Gaps
- Could not confirm from Meta's Business Help Center the authoritative SAC country list for 2026, nor that Arabic is fully supported in all Instant Form templates (believed yes, UNVERIFIED).
- No source found on whether Trakheesi/Media Council permit rules explicitly cover Meta Instant Forms (lead ads) versus listing ads; assume yes and confirm with DLD/RERA.
- UAE PDPL (Federal Decree-Law No. 45 of 2021) consent requirements for storing and processing lead data, and TDRA rules on marketing calls/SMS, were not researched here (UNVERIFIED prior knowledge that they exist).
