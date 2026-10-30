# Real-time lead delivery from Google Ads, TikTok, LinkedIn, Snapchat (plus X / Microsoft Ads) into AI-DATA (Node/Express), UAE real estate, as of late October 2026

> **Method note (read first).** This session's network policy blocked direct page fetches from `developers.google.com`, `support.google.com` and `learn.microsoft.com` (DNS refused by the sandbox allowlist). All findings below come from web-search result extracts of the official pages (and some vendor pages). The cited URLs are the official sources, but exact field lists, header names and retry rules have to be re-checked against the live pages before coding. Anything marked **[unverified – background knowledge]** comes from the researcher's prior knowledge (cutoff mid-2026). No source in this session confirmed it.

---

## 1. Google Ads lead form assets: webhook setup, payload, google_key validation, retries, test data, API alternative, retention

### Takeaway
Google Ads lead forms support a **true push webhook**. The advertiser pastes your HTTPS URL plus a shared secret "key" into each lead form. Google POSTs JSON per lead within seconds, with `google_key` in the body (no HMAC signature). It does not guarantee exactly-once delivery, so dedupe on `lead_id`. The Google Ads API also exposes a `lead_form_submission_data` resource, but you have to poll it (GAQL). Manual CSV download covers roughly the last 30 days. Google reportedly keeps the data for up to 60 days (sources conflict).

### Cited Findings
**Setup (UI)**
- The current Google Ads Help article is "How to set up a webhook integration for a lead form" (answer/16729613; the older article ID 9423234 is the legacy one). You enter the webhook URL and key under the form's data-export options: expand "Export leads from Google Ads", then "Other data integration options", then click **Send test data** and check that your CRM receives it. — [Google Ads Help 16729613](https://support.google.com/google-ads/answer/16729613?hl=en)
- The test payload uses a dummy lead ID (a vendor guide quotes `lead_id: "TeStInGlEaDiD123"`), and test leads carry `is_test: true`. — [CustomerLabs guide](https://www.customerlabs.com/blog/webhooks-google-ads-integration-setup/); [Google Lead Form Webhook samples](https://developers.google.com/google-ads/webhook/docs/samples)

**Payload / schema (official "Lead Form Webhook" developer docs)**
- The request is a JSON POST. Fields: `lead_id`, `campaign_id`, `form_id`, `api_version`, `google_key`, `is_test`, `gcl_id` (string), `adgroup_id` and `creative_id` (integers), `lead_submit_time` (described as ISO-8601 in a localized copy), and `user_column_data`. — [Implementation / POST schema](https://developers.google.com/google-ads/webhook/docs/implementation); [Korean-locale mirror (lead_submit_time ISO-8601)](https://developers.google.cn/google-ads/webhook/docs/implementation?authuser=7&hl=ko)
- `user_column_data` is a repeated list of answers. Each answer has `column_id` (e.g., `FULL_NAME`, `PHONE_NUMBER`), a human-readable `column_name` and a `string_value`. "All current data types use the string_value field." — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)
- `is_test`: if it is false **or absent**, treat the lead as a valid production lead. — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)
- In a third-party sample test payload, `adgroup_id` and `creative_id` are 0. — [impressads blog](https://www.impressads.com/blog/impressions-4/how-to-integrate-google-lead-ads-with-your-own-crm-1)
- The schema can change. Google says to **ignore unrecognized fields** because new ones may be added. — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)
- Field name: the official schema uses lowercase `google_key`. Some third-party guides write `Google_key`. — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)

**Auth / verification**
- `google_key` is set by the advertiser for each form. Before processing a lead, check that it matches the value configured in Google Ads. — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)

**Response / retries / duplicates**
- Success response: HTTP 200 with an empty JSON body `{}`. — [Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)
- A lead is **not guaranteed to be delivered exactly once**, so your handler must dedupe. — [Implementation (sl locale)](https://developers.google.com/google-ads/webhook/docs/implementation?hl=sl)
- Conflict: an older version of the official page shows a 200 response *with an error-message body* marked non-retryable, which reads as a docs inconsistency. Vendor guidance: return 200 only after the lead is saved or queued, 4xx for client errors, 5xx for failures Google should retry. — [reform.app](https://www.reform.app/blog/google-ads-lead-form-api-setup-guide); [LeadsBridge](https://leadsbridge.com/blog/google-lead-form-extension-webhook-integrations/) (vendor/aggregator sources; Google's exact retry schedule was **not** confirmed)
- If the webhook fails or is misconfigured, you don't lose leads, because CSV download is still available. — [Lead Form Webhook Recommendations](https://developers.google.com/google-ads/webhook/docs/recommendations)

**Retention**
- Several guides say manual CSV downloads cover only leads from the **last 30 days**, while Google keeps lead data for up to **60 days**. One guide says the API can export lead data for up to 60 days. Sources conflict, and one 30-day claim is about 3 years old. — [Privyr blog](https://www.privyr.com/blog/how-to-download-leads-from-google-ads/); [SEJ guide](https://www.searchenginejournal.com/google-ads-lead-forms-assets/489843/); [HawkSEM](https://hawksem.com/blog/google-ads-lead-form-assets/)

**Google Ads API alternative (polling)**
- The `LeadFormSubmissionData` resource exists in the Google Ads API (reference v20/v21; a v26 query-builder page exists, so it is still present in current versions). `lead_form_submission_fields[]` (type `LeadFormSubmissionField`, output-only) holds standard-question answers. `custom_lead_form_submission_fields` holds custom questions. You query it via GAQL. — [lead_form_submission_data fields v21](https://developers.google.com/google-ads/api/fields/v21/lead_form_submission_data); [RPC reference v21](https://developers.google.com/google-ads/api/reference/rpc/v21/LeadFormSubmissionData?authuser=4); [v26 query builder](https://developers.google.com/google-ads/api/fields/v26/lead_form_submission_data_query_builder)
- A 2019-era forum post reports `lead_form_submission_fields` returning an empty array while custom fields had data. Treat this as a possible gotcha. — [adwords-api Google Group](https://groups.google.com/g/adwords-api/c/YsBYZyPH6xs)
- Zapier offers "new lead form entry in Google Ads" triggers that can forward to a webhook. This is an alternative path that goes through middleware. — [Zapier template](https://zapier.com/templates/details/6d856a062e034a7fb1261fb2a01f8034a8a531619c06c7c1bea836298a3daf90)

### Inferences
- **Express implementation:** use one route like `POST /webhooks/google-ads/:tenantId`. Parse JSON, compare `body.google_key` to the tenant's stored key with `crypto.timingSafeEqual`, upsert on `lead_id` (unique index), and branch on `is_test`. Map `user_column_data` into `{column_id: string_value}`, falling back to `column_name` for custom questions. Persist or queue *before* returning `200 {}`. Return 5xx only for transient failures.
- **Multi-tenant:** the webhook is configured *per lead form inside each advertiser's Google Ads account*, so every client agency (or you, with access to their account) must paste your URL and key into every form. Use a tenant-scoped URL path plus a per-tenant (or per-form) random key, so a key leak only exposes one tenant. There is no app-approval step for the webhook itself.
- The only auth is a shared secret in the body (no HMAC, no IP allowlist was found). So: require HTTPS, use a long random key, rate-limit, and reject mismatches with 4xx.
- Latency should be seconds (push on submit). No source in this session gave an official SLA.
- The polling API (`lead_form_submission_data`) is best used as a nightly **reconciliation/backfill** to catch leads the webhook missed, not as the primary feed.

### Gaps
- Google's **exact retry schedule** (attempt count, backoff, which status codes trigger retries) was not confirmed. Fetching developers.google.com was blocked.
- The full official list of `column_id` enum values (e.g., FULL_NAME, FIRST_NAME, LAST_NAME, EMAIL, PHONE_NUMBER, POSTAL_CODE, CITY, REGION, COUNTRY, COMPANY_NAME, JOB_TITLE, WORK_EMAIL, WORK_PHONE) is **[unverified – background knowledge]**. A newer `asset_group_id` field (for Performance Max) may also exist **[unverified]**.
- Requirements for the API path are **[unverified – background knowledge]**: developer token (Basic/Standard access application), OAuth per client, or a manager (MCC) account linking client accounts.
- Lead form **eligibility** rules in late 2026 (policy-compliance/spend history requirements, sensitive-vertical exclusions, which campaign types support lead forms: Search / PMax / Demand Gen / Video) were not verified. Check that real-estate advertisers in the UAE are eligible.
- Whether the 30-day download window and 60-day retention are still current was not confirmed from the Google Help page itself.

---

## 2. TikTok Lead Generation (Instant Forms): Leads Center, CRM integrations, Custom API/webhook, download, approvals, latency, UAE

### Takeaway
TikTok Instant Form leads reach external systems in four ways: (a) native "Direct Integrations" (HubSpot, Salesforce, Google Sheets, etc.), (b) third-party middleware (LeadsBridge, Zapier, Make, Albato), (c) **"TikTok Custom API with Webhooks"**, which is real-time push via the TikTok API for Business `/subscription/subscribe/` endpoint, and (d) manual download from Leads Center. **TikTok Ads Manager keeps leads for only 90 days.** I could not confirm the signature scheme or exact payload field names for the lead webhook.

### Cited Findings
- TikTok lists these lead integration types: Direct Integrations, Third-Party Integrations, **TikTok Custom API with Webhooks**, and Website Builder Plugins. Direct: HubSpot, Salesforce Marketing Cloud, Salesforce Sales Cloud, Google Sheets, Klaviyo, ActiveCampaign, Privyr, Constant Contact. Third-party: LeadsBridge, Zapier, Albato, Make. — [TikTok Help: CRM integrations](https://ads.tiktok.com/resources/help/article/available-crm-integrations-tiktok-lead-generation?lang=en%3D); [TikTok Help: Leads Center](https://ads.tiktok.com/help/article/tiktok-leads-center?lang=en)
- TikTok describes Custom API with Webhooks as a way to link your own lead management system, receive updates in real time, and get notifications about lead content directly in your CRM. — [TikTok Help: access leads](https://ads.tiktok.com/help/article/access-leads-data?lang=en)
- **Retention:** TikTok Ads Manager stores lead data for only **90 days**. Only users with **Admin** permission can download and manage leads. — [TikTok Help: access leads on Instant Forms](https://ads.tiktok.com/help/article/access-leads-data-on-instant-forms?lang=en)
- **Download:** in Leads Center, use the download icon and pick a time range. At ad level, click "Download Lead Data" in the Results column. The article is old, so check the current menus. — [TikTok Help: access leads](https://ads.tiktok.com/help/article/access-leads-data?lang=en)
- **HubSpot direct setup:** Tools → Leads Center → Apply for permission → choose the form → map fields → "Send test data". — [TikTok Help: HubSpot](https://ads.tiktok.com/help/article/how-to-integrate-tiktok-lead-gen-with-hubspot)
- **Zapier:** connect through Leads Center, then use the "TikTok Lead Generation" trigger. — [TikTok Help: Zapier](https://ads.tiktok.com/help/article/integrate-tiktok-lead-generation-zapier?lang=en); [Zapier TikTok Lead Generation → Webhooks](https://www.zapier.com/apps/tiktok-lead-generation/integrations/webhook/757240/get-webhooks-for-new-leads-in-tiktok-lead-generation)
- **API for Business webhook:** TikTok's docs list webhook subscriptions for real-time updates on **leads**, ad review status and TikTok Creator Marketplace orders. To subscribe a page, POST to `/subscription/subscribe/` with your access token and the callback URL in a `url` field. A returned `subscription_id` means success. When you configure the webhook, you subscribe to all fields on a lead generation ad, and "every time a new lead is submitted, we send a notification to your endpoint, including information of the lead." — [TikTok API for Business docs (lead webhook page)](https://ads.tiktok.com/gateway/docs/index?identify_key=2b9b4278e47b275f36e7c39a4af4ba067d088e031d5f5fe45d381559ac89ba48&language=ENGLISH&doc_id=1701890921224193); [TikTok API for Business portal](https://business-api.tiktok.com/portal/docs)
- **Related endpoints** listed in the API for Business docs: create a test lead, create a lead download task (async bulk export), get an Instant Form lead, and get form libraries. — [TikTok API for Business docs](https://business-api.tiktok.com/portal/docs); [Get form libraries v1.3](https://business-api.tiktok.com/portal/docs/get-form-libraries/v1.3)
- **Retries:** TikTok's *general* webhook overview (TikTok for Developers, which may be a different product line from API for Business) says notifications are JSON HTTPS POSTs, the endpoint must return 200 quickly, TikTok retries for **up to 72 hours with exponential backoff**, and endpoints may receive the same event more than once, so processing must be idempotent. — [TikTok for Developers: Webhooks overview](https://developers.tiktok.com/doc/webhooks-overview/). A Rollout aggregator guide repeats the 72-hour figure but admits lead-event details aren't in the official docs. — [Rollout](https://rollout.com/integration-guides/tik-tok-lead-generation/api-essentials)
- **UAE:** TikTok lead ads are used for UAE/Dubai real estate. Agencies call real estate one of TikTok's strongest UAE verticals and suggest using it as a 10–15% test-budget channel. Instant Forms collect details in-app, which reduces drop-off. All of this comes from agency/vendor marketing sources, not TikTok. — [biglab.ae TikTok Ads](https://biglab.ae/services/performance-marketing/tiktok-ads/); [stackmatix](https://www.stackmatix.com/blog/tiktok-advertising-real-estate-leads); [clozer blog](https://clozer.pages.dev/blog/tiktok-lead-gen-dubai.html)

### Inferences
- For real-time delivery into AI-DATA, the Custom API path needs a **TikTok API for Business developer app**. Each client agency then authorizes your app via OAuth for its advertiser account / Business Center, and you call `/subscription/subscribe/` per page/form with that token. On each notification, either use the inline lead data or call "get Instant Form lead" to fetch the full record.
- This makes **multi-tenant support plausible**: one app, many authorized advertisers, a token stored per tenant. The webhook callback should carry tenant routing (e.g., `/webhooks/tiktok/:tenantId`), or you route by advertiser/page ID in the payload.
- For agencies that won't authorize an app, a low-effort fallback is TikTok's native **Zapier/Make → AI-DATA webhook** path, or LeadsBridge. Expect polling-level delays from Zapier (minutes).
- The 90-day retention means you should run a periodic "lead download task" backfill for reconciliation.

### Gaps
- **Signature/verification of TikTok lead webhooks** was not found. Search results only covered TikTok Shop signatures, which is a different product. Verify on the API for Business "Webhook" page before relying on any header (e.g., a signature computed with the app secret).
- The **exact payload field names** (e.g., `lead_id`, `page_id`, `advertiser_id`, `create_time`, field-answer array) were not confirmed.
- **Developer app approval**: the process and timeline for API for Business (register as developer, create app, request scopes such as lead/ads management, review time) is **[unverified – background knowledge]**. No source this session described review timelines.
- I found no official statement confirming Lead Generation availability for UAE advertisers. Agency sources and the existence of UAE real-estate campaigns suggest it is available.
- I found no TikTok-published delivery latency SLA.

---

## 3. LinkedIn Lead Gen Forms: Lead Sync API, permissions, approval, webhook subscriptions, payload, alternatives

### Takeaway
LinkedIn provides a **push webhook** ("Lead Notifications") on top of the **Lead Sync API**. This is a **separately-approved program**: Advertising API access does not include it, Company Page verification is required, and the permission is `r_marketing_leadgen_automation`, which newer docs may rename. Webhooks are verified with an HMAC-SHA256 challenge (client secret) re-run every 2 hours, and POSTs carry an `X-LI-Signature` header. The notification identifies a `leadGenFormResponse` URN, which you then fetch via the API. **Webhook validation has been enforced since 16 March 2026.**

### Cited Findings
**Access / approval**
- "Lead Sync API is a separate program, and access to the Advertising API doesn't automatically grant you the access." You request it through the developer app's product list. **Company Page Verification is required** for the developer application. — [LinkedIn: Getting access (Lead Sync)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/getting-access-leadsync); [Lead Syncing (li-lms-2026-09)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync?view=li-lms-2026-09)
- **Permission:** `r_marketing_leadgen_automation` is listed for Lead Sync. A newer use-case page version lists **`r_ads_leadgen_automation`**, so this is a naming discrepancy to check in the current docs. — [Lead Sync use cases (2026-06)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-usecase?view=li-lms-2026-06); [Lead Sync usecases (2026-10)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/usecases?view=li-lms-2026-10&viewFallbackFrom=li-lms-2025-05)
- The API is versioned monthly (doc versions `li-lms-2026-05` … `li-lms-2026-10` exist). — [Migration guide (2026-05)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-api-migration-guide?view=li-lms-2026-05)

**Deprecations (2026)**
- Legacy **Ads Lead Sync and Events Lead Generation APIs** have a sunset date, after which lead syncing through them stops. Legacy `LeadNotificationUrls` webhooks still send the old payload format, so if you also subscribe with the same parameters through the new `leadNotifications` API you will receive **duplicate notifications**. — [Migration Guide for Lead Sync APIs (2025-11)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-api-migration-guide?view=li-lms-2025-11); [Migration guide (2026-06)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-api-migration-guide?view=li-lms-2026-06)
- "Starting **March 16, 2026**, [LinkedIn is] enforcing webhook validation while sending push events for `LEAD_ACTION` type." Unvalidated URLs don't receive new-lead notifications. — [Lead Syncing (2026-07)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync?view=li-lms-2026-07); [Recent Marketing API changes (2026-06)](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes?view=li-lms-2026-06)

**Webhook mechanics**
- You create subscriptions through the **`leadNotifications`** endpoint ("create webhook subscriptions to be notified of Lead Form responses"). Owner-level subscriptions cover all forms under an organization or sponsored (ad) account. Form-level subscriptions cover specific forms. — [Lead Syncing](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync); [n8n LinkedIn credentials docs](https://docs.n8n.io/integrations/builtin/credentials/linkedin.md)
- Lead Sync subscriptions **can't be created in the UI**. You must use the Lead Notification Subscriptions API. — [Hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-linkedin-webhooks-features-and-best-practices)
- **Validation (GET):** LinkedIn sends `challengeCode` as a query parameter. Within **3 seconds** you must return it with `challengeResponse` = hex-encoded HMAC-SHA256 of the challengeCode, keyed with the app's **clientSecret**. LinkedIn re-validates about **every 2 hours**. — [LinkedIn: Webhook validation](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/webhook-validation)
- **Event (POST) signature:** the `X-LI-Signature` header is a hex HMAC-SHA256 keyed with the clientSecret. Sources disagree on the string to sign. Hookdeck says it is the literal prefix `hmacsha256=` followed by the raw JSON body. n8n says it is the HMAC of the JSON POST body. Microsoft's excerpt refers to a "stringToSign" without the definition being visible. Hash the **raw body bytes**. — [LinkedIn webhook validation](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/webhook-validation); [Hookdeck LinkedIn webhooks skill](https://hookdeck.com/webhooks/skills/linkedin-webhooks); [n8n](https://docs.n8n.io/integrations/builtin/credentials/linkedin)
- Return **2xx for every notification**. Notifications can be delivered **more than once**. Microsoft's example dedupes on `leadGenFormResponse` + `occurredAt`. — [n8n](https://docs.n8n.io/integrations/builtin/credentials/linkedin.md); [Lead Syncing (2026-09)](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync?view=li-lms-2026-09&viewFallbackFrom=li-lms-2025-08)
- Microsoft recommends **push over pull** because it gives real-time lead sync. — [Lead Sync use cases](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-usecase?view=li-lms-2026-06)

**Alternatives**
- n8n, Hookdeck guides and vendors (Closely, LeadsBridge, Zapier) offer LinkedIn lead routing. — [Closely blog](https://blog.closelyhq.com/linkedin-webhook-integration-real-time-lead-alerts/); [Hookdeck](https://hookdeck.com/webhooks/platforms/guide-to-linkedin-webhooks-features-and-best-practices)

### Inferences
- **Express implementation:** use `GET /webhooks/linkedin`, which answers `{challengeCode, challengeResponse: hmacHex(clientSecret, challengeCode)}` in under 3 seconds. For `POST /webhooks/linkedin`, capture the raw body (`express.raw` or the `verify` hook on `express.json`) and check `X-LI-Signature` (try both string-to-sign variants against a real event). Enqueue the event, then `GET /rest/leadFormResponses/{id}` with the per-tenant OAuth token and a `LinkedIn-Version: YYYYMM` header to fetch the answers.
- **Multi-tenant:** one LinkedIn developer app (one webhook URL, one client secret). Each agency's ad-account admin completes 3-legged OAuth. You then create an owner-level `leadNotifications` subscription per sponsored account or organization, and route by the `owner` URN in the notification. Member tokens expire (about 60 days, refresh about 1 year) **[unverified – background knowledge]**, so build refresh and re-consent flows.
- **Approval difficulty:** this is the hardest of the four platforms. You need an approved Lead Sync product on a verified company page app, and LinkedIn reviews the use case. Budget weeks, and plan a Zapier/LeadsBridge fallback for go-live. LinkedIn Lead Gen in UAE real estate is mostly relevant for commercial / high-net-worth / investor targeting.
- Latency: push is near real-time, but because the notification only carries a URN, delivery is notification plus one API call (about 1–3 seconds).

### Gaps
- **Typical Lead Sync approval time and rejection rate** were not found from any source.
- The exact current permission name (`r_marketing_leadgen_automation` vs `r_ads_leadgen_automation`) needs confirmation on the live 2026-10 docs.
- The **full notification payload** was not confirmed. Background knowledge suggests fields like `type: "LEAD_ACTION"`, `leadAction` (CREATED/DELETED), `leadGenFormResponse`, `leadGenForm`, `owner`, `leadType`, `associatedEntity`, `occurredAt` **[unverified]**.
- LinkedIn's retry policy for failed webhook POSTs was not found.
- The lead retention window in Campaign Manager (often cited as 90 days) is **[unverified – background knowledge]**.

---

## 4. Snapchat Lead Generation ads: Marketing API leads/webhooks, CRM integrations, UAE

### Takeaway
Snap's official Marketing API "Lead Generation Ads Guide" documents a **native webhook integration** that pushes each submission to your `webhook_url` in real time. The limit is **one webhook integration per form**. There is a test endpoint that sends dummy data, plus list/delete operations, and a signature verification scheme that uses a timestamp `t` header. CRM routes include a native **HubSpot** integration (announced 2025), Zapier and LeadsBridge. Snapchat is widely used for UAE ads.

### Cited Findings
- The Snap Lead Generation Ads Guide documents webhook integrations for receiving lead data as forms are submitted. **Only one webhook integration can be created per form.** Creating one requires a `webhook_url`, which Snap calls for each new lead. A test operation sends dummy data to that URL for end-to-end checks. You can list and delete integrations under a form. — [Snap Marketing API: Lead Generation Ads Guide](https://developers.snap.com/marketing-api/Ads-API/lead-generation-ads)
- **Verification:** the guide's verification section mentions a **timestamp in the `t` header** of the webhook event and a UTF-8 JSON body. The full signing procedure was not visible in the extract. — [Snap Lead Generation Ads Guide](https://developers.snap.com/marketing-api/Ads-API/lead-generation-ads)
- The guide also covers getting a lead form by ID and listing forms under an ad account. Lead Generation is a listed Ads API capability. — [Snap Lead Generation Ads Guide](https://developers.snap.com/marketing-api/Ads-API/lead-generation-ads); [Snap Ads API introduction](https://developers.snap.com/marketing-api/Ads-API/introduction)
- **CRM integrations:** Snap launched a **native HubSpot integration** for lead gen ads (leads flow into HubSpot lists/pipelines, and HubSpot conversion events can be sent back via Snap's Conversions API). — [Marketing Dive](https://www.marketingdive.com/news/snapchat-shores-up-lead-gen-ads-with-new-hubspot-integration/826552/); [Social Media Today](https://www.socialmediatoday.com/news/snapchat-shores-up-lead-gen-ads-with-new-hubspot-integration/826620/)
- **Middleware:** Zapier has "Snapchat Lead Generation" new-lead triggers that can forward to Webhooks by Zapier. LeadsBridge (a Snap Business Partner) offers real-time routing to a generic webhook. — [Zapier Snapchat Lead Gen → Webhooks](https://zapier.com/apps/snapchat-lead-ads/integrations/webhook); [LeadsBridge Snapchat → Webhook](https://leadsbridge.com/documentation/snapchat-lead-generation/webhook-classic/); [LeadsBridge Snapchat Lead Gen guide](https://leadsbridge.com/blog/snapchat-lead-generation/)
- **UAE:** agencies describe Snapchat as high-penetration in the UAE but "underutilised" for lead gen. It is cited for real estate (off-plan / affordable segments), with a recommended 60–90-day test window for high-consideration categories. These are agency marketing claims. — [clozer blog: Snapchat ads UAE](https://clozer.pages.dev/blog/snapchat-ads-uae.html); [biglab.ae Snapchat Ads](https://biglab.ae/services/performance-marketing/snapchat-ads/); [prism-me](https://www.prism-me.com/snapchat-marketing-dubai)

### Inferences
- **Multi-tenant:** one Snap Marketing API OAuth app. Each agency authorizes access to its ad account, and you create a webhook integration **per form** via the API, pointing at `/webhooks/snap/:tenantId`. Because there is **only one webhook per form**, a client already using another webhook-based tool on that form would conflict. Check this at onboarding.
- Native HubSpot / Zapier / LeadsBridge are viable no-code fallbacks for clients who don't want to grant API access.
- Verification likely follows a "timestamp + body" HMAC pattern (Stripe-like, using the `t` header). Implement it with raw-body capture and a replay window once the exact scheme is confirmed.

### Gaps
- The exact **payload schema**, **signature algorithm and secret source**, and **retry policy** for Snap lead webhooks were not available in the search extracts.
- OAuth app creation and approval (e.g., Business Manager OAuth app, `snapchat-marketing-api` scope) were not confirmed this session **[unverified – background knowledge]**.
- I found no lead-retention window for Snap Ads Manager lead downloads.
- I found no official confirmation that Lead Generation ads are enabled for UAE ad accounts. Agency usage suggests they are.

---

## 5. Brief: X (Twitter) and Microsoft Advertising lead forms

### Takeaway
I found **no documented real-time lead webhook** for Microsoft Advertising. Its integrations are CRM-native (e.g., HubSpot), and its API is moving from SOAP to REST (SOAP is supported until 31 January 2027). For X, I found no current lead-form API in this session. Neither platform is a priority for UAE real-estate lead capture.

### Cited Findings
- A Microsoft Advertising September 2026 update describes a **HubSpot** integration where a new lead captured by a Microsoft Advertising campaign can trigger a "next best action" in HubSpot. This is a native CRM integration, not a documented webhook. — [Microsoft Advertising blog, Sept 2026](https://about.ads.microsoft.com/en/blog/post/september-2026/less-busywork-more-growth-what-new-in-microsoft-advertising-this-september)
- Microsoft Advertising is moving from the legacy SOAP API to REST. SOAP integrations are supported through **31 January 2027**, so build any new integration on REST. — [Microsoft Advertising blog, Sept 2026](https://about.ads.microsoft.com/en/blog/post/september-2026/less-busywork-more-growth-what-new-in-microsoft-advertising-this-september); [Bing Ads API overview](https://learn.microsoft.com/en-us/advertising/guides/?view=bingads-13)
- Microsoft Advertising offers a Conversions API (UET CAPI) for sending conversions *to* Microsoft. That is the wrong direction for lead intake. — [Microsoft Advertising CAPI](https://learn.microsoft.com/en-us/advertising/guides/uet-conversion-api-integration?view=bingads-13)

### Inferences
- For Microsoft Ads lead forms, the realistic options are manual download or middleware (Zapier/LeadsBridge), unless the REST API now exposes leads. Low priority for UAE, where Google, Meta, TikTok and Snap dominate paid real-estate leads.

### Gaps
- The existence and mechanics of Microsoft Advertising lead form asset delivery (webhook/API/download window) were not found.
- **X (Twitter):** background knowledge says X/Twitter retired Lead Generation Cards years ago and has no lead-form webhook today **[unverified – no source found this session]**.

---

## 6. Cross-platform: real-time vs polling, costs, multi-tenant summary

### Takeaway
All four main platforms now have a **push (webhook) path**: Google (per-form URL + key), TikTok (API for Business subscription), LinkedIn (leadNotifications, approval required) and Snap (per-form webhook integration). Each also has a polling or download fallback. Middleware such as Zapier is usually polling-based (minutes). The APIs themselves appear to be free, and the cost is the ad spend. Retention windows are short (Google ~30-day CSV, TikTok 90 days), so reconciliation jobs are essential.

### Cited Findings
- **Google:** webhook push. Returns `{}`/200. At-least-once delivery. CSV download is the fallback. — [Google Lead Form Webhook implementation](https://developers.google.com/google-ads/webhook/docs/implementation); [Recommendations](https://developers.google.com/google-ads/webhook/docs/recommendations)
- **TikTok:** webhook push ("real time") via `/subscription/subscribe/`. 90-day retention. Lead download task API. — [TikTok Help](https://ads.tiktok.com/help/article/access-leads-data-on-instant-forms?lang=en); [TikTok API for Business docs](https://ads.tiktok.com/gateway/docs/index?identify_key=2b9b4278e47b275f36e7c39a4af4ba067d088e031d5f5fe45d381559ac89ba48&language=ENGLISH&doc_id=1701890921224193)
- **LinkedIn:** push is recommended for real-time. Pull (`leadFormResponses` finder) is also supported. — [Lead Sync use cases](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/lead-sync-usecase?view=li-lms-2026-06)
- **Snap:** real-time webhook per form. — [Snap Lead Gen Ads Guide](https://developers.snap.com/marketing-api/Ads-API/lead-generation-ads)
- **UAE market context:** one Dubai agency estimates Meta produces about 60–70% of paid real-estate leads in Dubai in 2026, with an average CPL of AED 62 using WhatsApp funnels versus an "industry average" of AED 80–150. This is an agency claim and unverified. — [clozer blog](https://clozer.pages.dev/blog/real-estate-lead-generation-dubai.html)

### Inferences
| Platform | Mechanism | Verification | Typical latency | Approval for your app | Multi-tenant model |
|---|---|---|---|---|---|
| Google Ads | Webhook (per form, UI-configured) | Shared secret `google_key` in body | Seconds | None for webhook; dev token for API | Each tenant pastes URL + key into each form |
| TikTok | Webhook via API for Business subscription; or native CRM / Zapier | Not confirmed (check docs) | Seconds (push) | API for Business developer app | One app, OAuth per advertiser, subscribe per page/form |
| LinkedIn | Webhook (leadNotifications) + fetch | HMAC-SHA256 challenge + `X-LI-Signature` | ~Seconds (notify + fetch) | **Lead Sync program approval + verified Company Page** | One app, OAuth per ad account, subscription per owner |
| Snapchat | Webhook (one per form, API-created) | Timestamped signature (`t` header) | Seconds | Snap Marketing API OAuth app | One app, OAuth per ad account, webhook per form |
| Zapier / Make / LeadsBridge | Middleware → AI-DATA webhook | Your own secret | Minutes (Zapier polling) to near-real-time (LeadsBridge "real-time") | None for you; the client connects their account | Each tenant builds their own zap/bridge |

- Shared Express design: one `/webhooks/:platform/:tenantId` router with **raw-body capture** for HMAC platforms, a per-platform verifier, **idempotent upsert** on (platform, platform_lead_id), a 200 sent only after durable enqueue, and nightly reconciliation pulls (Google `lead_form_submission_data`, TikTok lead download task, LinkedIn `leadFormResponses`, Snap leads) to fill gaps.
- Normalize all platforms into a common lead schema (name, phone with E.164 +971 normalization, email, custom answers such as budget, property type, area, off-plan vs ready, campaign/ad/form IDs, click ID, test flag, submitted_at).
- Costs: no source found states a per-call fee for any of these lead APIs. They are generally free, and the cost is the ad spend plus engineering and approval time. Middleware (Zapier, LeadsBridge) carries subscription costs.

### Gaps
- No source this session gave official pricing statements for the lead APIs (assumed free), or for Zapier/LeadsBridge plans.
- I found no official latency SLAs from any platform.
- Independent (non-agency) CPL benchmarks for TikTok, Snapchat and LinkedIn in UAE real estate were not found.
