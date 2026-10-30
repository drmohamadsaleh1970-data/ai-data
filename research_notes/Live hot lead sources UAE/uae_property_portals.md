# UAE Property Portals as Real-Time Lead Sources (Property Finder, Bayut, dubizzle, Houza): APIs, Access, and Lead-Ownership Rules (as of Oct 2026)

> **How these notes were gathered.** Web *fetch* was blocked in this session for www.propertyfinder.com and www.bitrix24.com (DNS refused by the sandbox's network allow-list), so I stopped fetching. Every finding below comes from search-engine result excerpts of the cited pages, not from full-page reads. The quoted contract wording came back consistently across several searches, but **check every clause against the live documents before relying on it legally.** The Property Finder Enterprise API reference (api-docs.propertyfinder.net) is password-protected, so only fragments were visible. Bayut and dubizzle publish **no** public lead-API documentation.

---

## 1. Property Finder: what lead APIs and webhooks exist, who can access them, which lead types are exposed, latency and cost

### Takeaway
Property Finder has a real, documented, partner-gated **Enterprise API** with **lead webhooks** (`lead.created`, `lead.updated`, `lead.assigned`) and a `GET /v1/leads` pull endpoint. Authentication is per-agency API key + secret exchanged for a short-lived JWT, and keys are issued from PF Expert. Third-party software must go through the **Property Finder Developer Network (PFDN)**, accept PF's API Access Terms, and (for listing feeds) be on PF's pre-approved CRM list. Latency figures and API pricing are not published.

### Cited Findings
**Programme and portal**
- PF runs the **Property Finder Developer Network (PFDN)**, which it describes as a platform connecting "CRMs, lead management platforms, and custom software developers" to PF. Partners "manage listings and streamline leads through standardized APIs", with documentation and **sandbox environments** for testing. PF says PFDN "ensures agencies can capture, route, and optimize leads effectively across all channels." — [PFDN home](https://pfdn.propertyfinder.com/)
- Partners must **review and accept Property Finder's API Access Terms & Conditions before receiving access**. — [PFDN Integration Guide](https://pfdn.propertyfinder.com/integration-guide) (search excerpt)
- PF's help centre has an article on **upgrading from "API 1.0" to the "Enterprise API"**, so the Enterprise API is the current generation and the older PF Expert API is legacy. — search excerpt referencing [PF Help Center News Updates](https://support.propertyfinder.ae/hc/en-us/categories/21677397758482-News-Updates). I did not open the article itself.
- A third-party CRM-integration guide calls the current product **"Enterprise API 2.0"** and says access depends on "whichever route your CRM qualifies for" (a shortlisted CRM, or a key issued through PF's Expert portal). It says **no developer can switch access on; the agency must request access itself.** — [Codingclave: Property Finder / Bayut CRM integration](https://codingclave.com/uae/services/property-finder-bayut-crm-integration)
- **PF Expert** is PF's agent/agency workspace for listings, leads, credits and agent performance, with CRM integration through the enterprise API. — search excerpt (directory description surfaced with the [PFDN](https://pfdn.propertyfinder.com/) query; source not independently verified)

**Endpoints and webhooks (Enterprise API)**
- The leads pull endpoint is **`GET /v1/leads`**, which needs the **`leads:read`** scope. — [PF Enterprise API docs (password-protected; fragment visible in search)](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- Lead webhook events are **`lead.created`, `lead.updated`, `lead.assigned`** (scope `leads:read`). The docs also list user and listing events, e.g. `listing.published`. — [PF Enterprise API docs](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- **Project (off-plan developer project) lead caveat:** one section says project leads **do not** fire `lead.created`, and another says they only fire `lead.assigned` / `lead.updated`. The two wordings conflict and are unresolved. — [PF Enterprise API docs](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- The **legacy PF Expert API** has a Leads resource with `GET /leads` and `POST`/`PATCH /leads`, filterable by status, source, property, email, name and property type. It documents no webhooks. — [PF Expert API Documentation: Leads](https://expert.propertyfinder.ae/documentation/leads/)

**Authentication**
- An API **key + secret** is exchanged at an "Issue JWT Token" endpoint for an **access token sent in the `Authorization` header**. The token "currently expires in **30 minutes**". The docs also have sections on API-key authorisation and rate limiting. — [PF Enterprise API docs](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- Enterprise API keys are **generated in PF Expert → Developer Resources** and support **scope-based permissions and enforced expiration**. — [PF Enterprise API docs (excerpt)](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- An older community post (about 550 days old at search time) describes HTTP Basic auth (Base64 of `key:secret`) followed by an OAuth **client-credentials** request to an `auth.propertyfinder.com` token endpoint. — [Make Community thread](https://community.make.com/t/need-help-with-property-finder-api-integration-authentication-and-token-request/66187)
- Going over the rate limit returns **HTTP 429**. The numeric limits were not visible. The docs mention an **HMAC signature in an `X-Signature` header (hex)**, but the excerpt did not confirm which messages it covers. — [PF Enterprise API docs](https://api-docs.propertyfinder.net/enterprise-api/index.html)
- A Bitrix24 marketplace app (Infinity BHT, "Property Finder Integrator") says it "listens to all Property Finder webhook events" and validates payloads with **HMAC-SHA256 timing-safe signature validation**. — [Bitrix24 app: Property Finder Integrator](https://www.bitrix24.com/apps/app/infinitybht_llc.property_finder_integrator/) (vendor claim)
- **Conflicting claim on who can access the API:** a page dated 11 Oct 2026 says PF's API is "only for software partners it approves through the PF Developer Network, **not for brokers directly**." — [Cotlet.dev: Property Finder API / MCP](https://cotlet.dev/integrations/property-finder-api-mcp-server). This **conflicts** with the API docs (keys generated by the agency in PF Expert) and with Codingclave (a key issued through the Expert portal).

**Lead types**
- PF Expert has a dedicated **WhatsApp Leads** section with agent-level interaction tracking. **WhatsApp Insights or WhatsApp Enterprise must be enabled** for WhatsApp leads to be recorded. — [PF Help: "What are WhatsApp Leads?"](https://propertyfinderae1703058205.zendesk.com/hc/en-us/articles/20199938398866) (article about 2 years old). PF marketed WhatsApp leads as giving "up to 25% more mobile leads". — [PF Partner Hub](https://www.propertyfinder.ae/partnerhub/want-up-to-25-more-mobile-leads-get-whatsapp-leads/)
- PF's **Leads Insights** reports performance across **Calls, Emails and WhatsApp leads**, so those are the three lead channels PF tracks. — [PF Help (WhatsApp Leads article)](https://propertyfinderae1703058205.zendesk.com/hc/en-us/articles/20199938398866)
- LeadSquared documents a **"Property Finder WhatsApp Enterprise"** integration: "When a lead clicks the WhatsApp button on your Property Finder property listing page, their details are automatically captured". — [LeadSquared help](https://help.leadsquared.com/integrate-propertyfinder-whatsapp-enterprise-with-leadsquared/)
- PropBridge (VortexWeb, a Bitrix24 app) says it uses PF's **Enterprise API with 2-step token authentication** and that VortexWeb is a **PFDN partner**. Fields captured: name, phone, email, portal source, listing reference, agent assignment, message content, timestamp. It deduplicates on phone and email across PF, Bayut and dubizzle. — [Bitrix24 app: PropBridge](https://www.bitrix24.com/apps/app/vortexweb.property_leads/) (vendor claim)

**Known integration partners (none of these is an official PF list)**
- **Saabsoft (Bitrix24 partner) and Property Finder** announced a strategic partnership on 30 Dec 2025. Its app publishes listings to PF and **"receive[s] qualified leads automatically back into Bitrix24."** — [GlobeNewswire press release](https://www.globenewswire.com/news-release/2025/12/30/3211217/0/en/saabsoft-and-property-finder-announce-strategic-partnership-to-transform-real-estate-operations-in-the-uae.html)
- **PropSpace** says it has a direct API integration with Property Finder. — [PropSpace](https://www.propspace.com/real-estate-crm-dubai) (vendor claim)
- **Nexa (HubSpot partner)** "partnered with Property Finder to provide a direct integration from PropSpace and myCRM into HubSpot." — [Digital Nexa](https://www.digitalnexa.com/hubspot-services/integrations/property-finder-integration)
- **HelloLeads**, **LeadSquared**, **PropCRM**, **Ruby CRM**, **PropFusion**, **Wiyo** and **Retyn** each advertise PF connectors. — [HelloLeads](https://helloleads.io/integrations/property-finder-integration/); [LeadSquared](https://help.leadsquared.com/integrate-propertyfinder-whatsapp-enterprise-with-leadsquared/); [PropCRM](https://propcrm.ae/blog/property-portal-integration-guide-uae); [PropFusion](https://www.propfusion.io/integrations); [Wiyo](https://www.wiyo.ae/bayut-property-finder-crm); [Retyn](https://www.retyn.ai/blog/best-propertyfinder-real-estate-crm-streamline-property-listings)
- **Zoho:** only third-party iPaaS connectors were found, e.g. Albato's "near real-time" Bigin-by-Zoho ↔ PF connector. No official PF–Zoho partnership turned up. — [Albato](https://albato.com/connect/bigin_byzohocrm-with-property_finder)
- One integrator says "your company must have **approved API access from Property Finder**" before an integration can be completed. — [MarketingLead.ae guide](https://www.marketinglead.ae/blog/property-finder-api-integration-complete-guide-for-real-estate-companies-in-dubai)

**Costs**
- PF's **CRM-provider terms** set a **12-month default term**, with "**Full payment in advance** [as] the only acceptable form of payment". PF may amend them without notice. — [PF Terms & Conditions for CRM Providers](https://www.propertyfinder.com/terms-conditions-for-crm-providers/) (excerpt). I could not confirm what the fee covers or how much it is.
- PropBridge pricing is tiered by lead volume: **free for 10 leads/month on 1 account**, rising to a top tier with custom field mapping and a 99.9% uptime SLA. — [Bitrix24 PropBridge](https://www.bitrix24.com/apps/app/vortexweb.property_leads/)

### Inferences
- PF is technically the most mature portal for real-time lead delivery. Webhooks plus a signed-token API mean sub-minute delivery is feasible, but PF publishes no latency SLA, so this is an inference from the webhook architecture.
- For AI-DATA, the likely legitimate routes into PF leads are: (a) the **agency** generates an Enterprise API key in PF Expert and authorises AI-DATA to use it on the agency's behalf, which PF's API terms require AI-DATA to comply with (see §5); or (b) AI-DATA becomes a **PFDN partner**. Route (b) is cleaner and needed at scale, because the Cotlet source says API use is only via approved partners.
- Webhooks only cover leads PF itself records. **WhatsApp leads need WhatsApp Insights/Enterprise enabled** on the agency's PF account, and PF-tracked calls appear as leads only if PF's call tracking is active (not verified).
- Project/off-plan leads may need polling of `GET /v1/leads` or handling of `lead.assigned`/`lead.updated`, because `lead.created` may not fire for them.

### Gaps
- Exact webhook payload schema, how webhooks are registered, the signature algorithm and secret, retry policy, numeric rate limits: all behind the password-protected docs.
- Whether call-tracking leads carry the caller number, a recording, call duration, or a masked number. Not found.
- Published latency/SLA: not found.
- Official PFDN partner roster: not public. PFDN shows a sign-up page only. Salesforce and Goyzer were **not** found as named PF integration partners.
- PFDN partner fees and Enterprise API pricing for agencies: not public.

---

## 2. Bayut and dubizzle (Dubizzle Group): Leads API, webhooks, authentication, fields, CRM partners

### Takeaway
Bayut and dubizzle share one advertiser platform (EMPG / Dubizzle Group "Bayut Pro", formerly "Profolio"). They expose an XML listing feed plus a **Leads API / push webhook** to approved CRMs. **No public developer documentation was found.** Vendor accounts disagree on the credential: a "Push API Bearer token" generated in Bayut Pro, "webhook keys", or an API key requested from Bayut support. Call and WhatsApp leads are pushed by webhook. Email/enquiry leads appear to be pulled.

### Cited Findings
- Ruby CRM's setup: "Open **Bayut Pro → settings and generate a Push API Bearer token** for your agency. Ruby validates it on save," and "**One token covers both networks**" (Bayut and dubizzle). — [Ruby CRM: Bayut integration](https://www.rubycrm.ai/integrations/bayut) (vendor)
- PropCRM: "**Dubizzle uses the same EMPG advertiser platform as Bayut.** If you've already connected Bayut, Dubizzle authentication is completed in the same step." Also: "Bayut's API uses slightly different lead data formats than Property Finder (different field names for the same data)." — [PropCRM portal integration guide](https://propcrm.ae/blog/property-portal-integration-guide-uae) (vendor)
- Another vendor: "Bayut and Dubizzle send **call and WhatsApp leads through their webhook keys**". The search excerpt did not name which page this came from. It was one of [PropFusion integrations](https://www.propfusion.io/integrations), [Wiyo](https://www.wiyo.ae/bayut-property-finder-crm) or [PropCRM](https://propcrm.ae/blog/property-portal-integration-guide-uae), so the attribution is **unverified** (vendor claim).
- PropBridge lists Bayut and dubizzle as "**Pull API plus WhatsApp Push webhook**". — [Bitrix24 PropBridge](https://www.bitrix24.com/apps/app/vortexweb.property_leads/) (vendor)
- Other connectors say to "Connect with your **Bayut support team and get the API key** for your account". HelloLeads says customers share "the necessary API credentials provided by Bayut". — [HelloLeads Bayut integration](https://helloleads.io/integrations/bayut-integration/); [LeadSquared: Integrate Bayut](https://help.leadsquared.com/integrate-bayut-with-leadsquared/)
- The official integration points for Bayut are the **XML listing feed** and the **Leads API**, and the Leads API is "pulled by the CRM". — [Codingclave](https://codingclave.com/uae/services/property-finder-bayut-crm-integration)
- An architecture write-up: "Both operate on a **partner/CRM-integration model**. You typically get lead delivery into an approved system, not a general-purpose API key you self-serve from a developer portal." It treats **webhooks as primary and email parsing as a fallback**, explicitly does **not** reproduce Bayut's schema or endpoint paths, and says the portals "are built to sell leads to agents and CRMs" rather than give developers programmatic access. — [Groovyweb: Property Finder and Bayut API Integration: What's Exposed, What's Not](https://www.groovyweb.co/blog/property-finder-bayut-api-integration-architecture)
- PropCRM says it is "an **approved partner of Property Finder, Bayut, and Dubizzle**, which means the integration works with your standard advertiser credentials." — [PropCRM](https://propcrm.ae/blog/property-portal-integration-guide-uae) (vendor claim, unverified)
- Albato sells a no-code Bayut ↔ LeadConnector (GoHighLevel) workflow built on webhook triggers. Comparison articles say brokerages often route Bayut leads to HubSpot via Zapier/Make webhooks. — [Albato](https://albato.com/connect/bayut-with-lead_connector); [Vedain: 10 Best Bayut CRM Integration Options 2026](https://vedain.com/blog/10-best-bayut-crm-integration-options-in-2026)
- Bayut's Terms of Use say Bayut is part of **Dubizzle Group**, which shares technology with Bayut. — [Bayut Terms of Use](https://www.bayut.com/terms.html)
- Unofficial "Bayut APIs" on RapidAPI/Apify **scrape** Bayut's website and "cannot post a listing or deliver your leads". — [Codingclave](https://codingclave.com/uae/services/property-finder-bayut-crm-integration); [dltHub "Bayut API"](https://dlthub.com/context/source/bayut-api)

### Inferences
- Likely pattern, an inference from several vendor accounts: an agency-level token is generated in Bayut Pro, or issued by Bayut support. The CRM registers a webhook endpoint for **call and WhatsApp** events, and polls a pull endpoint for **email/form enquiries**. One credential covers dubizzle property leads too.
- Because the credential is agency-scoped, AI-DATA could receive Bayut/dubizzle leads **only as the agency's appointed CRM/processor**, not as an aggregator, and partner approval may be needed (PropCRM's "approved partner" claim suggests a partner list exists).

### Gaps
- No official Bayut or dubizzle developer portal, endpoint paths, payload schema, signature scheme, rate limits or latency figures were found.
- Whether Bayut's "Leads API" exposes the **caller phone number** for call leads, or only a masked/tracked number: not found.
- No published list of Dubizzle Group approved CRM partners was found.
- No information on whether dubizzle **non-property** verticals (motors, classifieds) have a lead API. That is out of scope here anyway.
- I could not confirm the "Profolio" brand is still in use in 2026. Vendors now say "Bayut Pro".

---

## 3. Houza and other UAE portals

### Takeaway
Houza is a brokerage-consortium portal launched in 2020 and led by a former dubizzle CEO. Its only documented CRM tie-in is a 2020 Propertybase partnership. **No public Houza lead API or webhook was found**, and its 2026 market weight is unclear. No other UAE portal with a documented lead API turned up. Scraper "APIs" (Apify/RapidAPI) are not lead-delivery channels.

### Cited Findings
- Houza is "the first agency-backed, full-scale property portal" for the UAE, created by a consortium of brokerages with a former dubizzle CEO at the helm. — [Gulf News](https://gulfnews.com/business/company-releases/uae-brokerages-unveil-new-property-portal-with-former-dubizzle-ceo-at-helm-1.74399758); [Cushman & Wakefield ME](https://cushwake.ae/en/news/former-dubizzle-ceo-heads-new-portal-looking-to-reshape-the-uae-property-market)
- Houza "**partners with Propertybase CRM**" (2020). It positioned itself as an alternative to the "duopoly of Bayut-Dubizzle and PropertyFinder". — [Online Marketplaces](https://www.onlinemarketplaces.com/articles/new-emirati-portal-houza-partners-with-propertybase-crm/)
- Houza added a **valuation tool** that puts sellers in contact with agents, which acts as a seller-lead generator. — [Online Marketplaces](https://onlinemarketplaces.com/houza-adds-valuation-tool-to-put-sellers-in-contact-with-uae-agents)
- A 2026 CRM guide lists lead capture from "Bayut, Property Finder, Dubizzle and **Houza**" as a standard requirement, and prices UAE real-estate CRMs at roughly **AED 200 to 1,500 per month**. — [Codingclave: Best Real Estate CRM Dubai 2026](https://codingclave.com/blog/real-estate-crm-dubai)
- Apify actors such as "UAE Dubai Property & Real Estate Leads Scraper – PropertyFinder" and "Bayut Agent & Lead Extractor" scrape public listing and agent data. They are not portal-sanctioned, and they put ToS and data-protection compliance on the user. — [Apify PF scraper](https://apify.com/skyline_scrapers/uae-dubai-property-real-estate-leads-scraper-propertyfinder); [Apify dubizzle scraper](https://apify.com/benthepythondev/dubizzle-scraper)

### Inferences
- In 2026 the UAE portal lead market is effectively **Property Finder and Dubizzle Group (Bayut + dubizzle)**. Houza is a minor third channel whose leads most likely arrive by email notification or a CRM-specific connector. That is an inference, as no 2026 source documents it.
- Scraped listing and agent data gives **agent contact details**, not **buyer enquiries**. It is not a "hot lead" source and carries ToS and PDPL risk (see §5–6).

### Gaps
- Houza's 2026 operating status, traffic, and any agent API or webhook: no current sources found.
- Other portals (e.g., JustProperty, Zoom Property, OLX/dubizzle verticals, developer portals) were not verified to offer lead APIs. I found no reliable sources on any.

---

## 4. The UAE real-estate CRM ecosystem and how it ingests portal leads

### Takeaway
UAE brokerages use local real-estate CRMs (PropSpace, PropCRM, Ruby CRM, PropFusion, Wiyo, myCRM, Saabsoft-on-Bitrix24) and global CRMs through connectors (Bitrix24, HubSpot, LeadSquared, HelloLeads, Zoho via Albato, Propertybase). Ingestion is **(1) official portal API/webhook via an approved partner**, **(2) iPaaS webhook bridges (Zapier, Make, Albato)**, or **(3) legacy parsing of lead-notification emails**. Vendors describe email parsing as the older approach.

### Cited Findings
- PropCRM says "some older CRM integrations rely on **email parsing** instead of API webhooks" and advises checking whether a CRM's portal integration is "**webhook-based (real-time) or email parsing-based**". Its multi-branch setup "allows you to connect multiple Property Finder/Bayut/Dubizzle advertiser accounts under a single PropCRM instance, with routing rules per branch", plus automatic duplicate detection on phone and email. — [PropCRM guide](https://propcrm.ae/blog/property-portal-integration-guide-uae)
- Groovyweb's reference architecture: **webhook and email sources → deduplication → idempotent storage → CRM**. — [Groovyweb](https://www.groovyweb.co/blog/property-finder-bayut-api-integration-architecture)
- Bitrix24 is the hub for several UAE connectors: PropBridge (PF + Bayut + dubizzle), Property Finder Integrator (PF webhooks into CRM messenger), and Saabsoft's official PF partnership app. — [Bitrix24 PropBridge](https://www.bitrix24.com/apps/app/vortexweb.property_leads/); [Bitrix24 PF Integrator](https://www.bitrix24.com/apps/app/infinitybht_llc.property_finder_integrator/); [GlobeNewswire](https://www.globenewswire.com/news-release/2025/12/30/3211217/0/en/saabsoft-and-property-finder-announce-strategic-partnership-to-transform-real-estate-operations-in-the-uae.html)
- HubSpot: Nexa's PF-partnered connector routes PropSpace and myCRM into HubSpot. — [Digital Nexa](https://www.digitalnexa.com/hubspot-services/integrations/property-finder-integration)
- LeadSquared has help-centre guides for both PF WhatsApp Enterprise and Bayut. — [LeadSquared PF](https://help.leadsquared.com/integrate-propertyfinder-whatsapp-enterprise-with-leadsquared/); [LeadSquared Bayut](https://help.leadsquared.com/integrate-bayut-with-leadsquared/)
- A Zapier community thread asks how to import PF leads using Zapier and the **PF Expert API**, which shows that agencies DIY polling with their own keys. — [Zapier Community](https://community.zapier.com/how-do-i-3/how-to-import-property-finder-leads-using-zapier-and-pf-expert-api-39111)
- PF's API terms make the **customer responsible** for "any third party accessing or using the API on its behalf (including CRM providers, integrators, or bespoke system developers)". — [PF Terms & Conditions AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt)

### Inferences
- An AI-DATA "live hot lead" feed that wants portal leads most plausibly works as a **CRM-layer integrator**: each agency connects its own PF and Bayut/dubizzle credentials, AI-DATA receives that agency's webhooks, and AI-DATA routes the leads back only within that agency. This mirrors PropCRM's multi-account model.
- Phone and email deduplication across portals is standard, but PF terms bar *pooling* PF leads with other-platform leads (§5). Deduplication must therefore keep provenance labels and must not merge PF leads into a cross-portal pool. How strictly PF reads "combine, mix or associate" is an open question.

### Gaps
- Goyzer, Salesforce (and Salesforce partners such as Propertybase in 2026), and Pixxi integration mechanics were not found in this search window.
- No independent benchmark of email-parsing versus webhook latency in the UAE context was found.

---

## 5. Terms of service and contracts: lead ownership, sharing, pooling, resale, data protection

### Takeaway
Property Finder's published terms are the most explicit. For lead data transferred to an agency, **PF is the data controller and the agency is only a data processor.** Agencies must **label every PF lead as "received from Property Finder"** visibly to all staff, and must **not combine, mix or associate PF leads with a pool of third-party-platform leads.** Agencies are responsible for any CRM or integrator that touches the API. Read together, these make **pooling or reselling PF leads to other agencies effectively prohibited**; that is an inference, as no explicit "no resale" clause was found. Bayut and dubizzle terms found so far only bar collecting users' personal data for commercial purposes. No agency-facing lead clause was retrieved.

### Cited Findings
**Property Finder**
- "The User shall **identify all lead(s) received from Property Finder** in the CRM System, as leads received from Property Finder ensuring that this identification is **visible to all agents, brokers, administrators and account managers** of the User, including a Customer." — [PF Terms & Conditions AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt); same rule extended to "your Affiliates and your Users" in [PF Terms EG](https://www.propertyfinder.eg/en/terms-and-conditions.html)
- "You **shall not combine, mix or associate a lead received from Property Finder with or in a pool of leads** that you have received from a third party platform." — [PF Terms & Conditions AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt)
- "In respect of **Leads data** transferred to the User, **Property Finder is the data controller, and the User is the data processor.**" — [PF Terms & Conditions AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt)
- For **listings** submitted via the API, the reverse applies: "the Customer is the data controller, and Property Finder is the data processor." — [PF Terms & Conditions QA](https://www.propertyfinder.com/qa/terms-and-conditions/) (excerpt). This covers a different data type and does not contradict the AE clause.
- "The User shall ensure that any third party accessing or using the API on its behalf (including CRM providers, integrators, or bespoke system developers) complies with the terms of this Agreement." — [PF Terms AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt)
- Agencies grant PF an "**irrevocable, world-wide, royalty free license to commercialize, reproduce, display, publish, copy, share, license to other persons and otherwise use the Content**", and agencies "will not use any **tracking data** obtained by cookies or tracking tools on our Platforms to target, re-target, advertise or interact in any way with visitors or users of the Platforms." — PF customer/agent terms (excerpt surfaced from propertyfinder.com; candidate URL [PF Terms for Agents/Advertisers](https://www.propertyfinder.com/terms-conditions-for-agents-advertisers/)). I could not fetch the page to confirm the exact document.
- Third-party CRMs publishing via XML feed "must be on Propertyfinder's **pre-approved list of CRM providers**" and accept the CRM Conditions. A CRM's breach "could result in a **suspension of the feed**", and the customer is responsible for its CRM's compliance. — [PF Terms AE](https://www.propertyfinder.com/ae/terms-and-conditions/); [PF Terms for CRM Providers](https://www.propertyfinder.com/terms-conditions-for-crm-providers/)

**Bayut / dubizzle**
- Bayut's terms say its service providers may process personal data only for specified purposes under Bayut's instructions, and not for their own purposes. Data may pass to acquirers in a merger or sale. Bayut is part of Dubizzle Group. — [Bayut Terms of Use](https://www.bayut.com/terms.html)
- Bayut's terms page also has a "Bayut Agency Referral Program – Terms & Conditions" heading. Its text was not retrieved. — [Bayut Terms](https://www.bayut.com/terms.html)
- The dubizzle Terms of Use bar "collecting personal data about other Users or entities for **commercial or unlawful purposes**" and contacting anyone who has asked not to be contacted. That cached version is about 3.4 years old. — [dubizzle Terms of Use](https://uae.dubizzle.com/m/terms/)
- Bayut Egypt's terms say Bayut may share some personal data with "third parties such as agents that use the platform". This is not UAE-specific. — [Bayut.eg Terms](https://www.bayut.eg/en/terms.html)

**UAE data protection (context)**
- The federal **PDPL (Federal Decree-Law No. 45 of 2021)** is in force as primary law, but **the status and number of its Executive Regulations are disputed** across secondary sources. Claims range from "not published as of May 2026" to "Cabinet Decision No. 33 of 2024" to "issued in 2026". Enforcement by the UAE Data Office is described as not fully operational, and one vendor cites a **1 Jan 2027** full-compliance deadline with no primary source. — [Secure.com](https://www.secure.com/blog/compliance/uae-pdpl-compliance); [Commoner Law](https://commoner-law.com/uae/data-privacy-digital-rights/pdpl-data-subject-rights); [Uppersetup](https://uppersetup.com/en/article/uae-personal-data-protection-law-pdpl-the-complete-business). All are secondary sources of mixed quality.

### Inferences
- **Lead ownership:** PF leads are **PF's personal data processed by the agency under PF's instructions**, not an asset the agency owns outright. A processor cannot lawfully sell, share or reuse controller data beyond the controller's instructions. **Pooling PF leads across agencies or reselling them through AI-DATA would very likely breach PF's terms** and could also breach the PDPL's purpose-limitation and consent principles.
- AI-DATA **can** plausibly act as a **sub-processor or CRM for a single agency**, delivering that agency's own PF leads in real time. Conditions: the leads keep the "Property Finder" label, they stay segregated from other portals' lead pools, and AI-DATA is on PF's approved list or PFDN where PF requires it.
- A cross-agency "hot lead marketplace" should source its leads from **AI-DATA's own first-party channels** (its own sites and ads with consent captured), not from portal leads.
- Bayut and dubizzle terms on agency use of leads are not public. Assume restrictions similar to PF's until the agency contract (Bayut Pro / dubizzle advertiser agreement) is reviewed.

### Gaps
- The full PF Customer Agreement, API Access Terms and CRM Provider Terms were not read end-to-end, as fetching was blocked. An explicit "no resale/sublicensing of leads" clause and confidentiality clauses were **not confirmed**.
- The Bayut Pro / dubizzle advertiser agreement (the B2B contract) is not public. Its lead-use and resale terms are unknown.
- How DIFC and ADGM data protection regimes interact with the federal PDPL for AI-DATA's case was not researched (no sources found in this window).
- No enforcement cases or disputes over lead resale by UAE portals were found.

---

## 6. With no public API: are email parsing or authorised-notification approaches legitimate, and what are the risks?

### Takeaway
Parsing an agency's **own** lead-notification emails, with the agency's authorisation, is a widespread, vendor-acknowledged ingestion method, though vendors call it "older" and not real-time. It does not get around contract terms: the leads remain portal-controlled data under the same labelling, no-pooling and processor rules. **Scraping portals for "leads" is a different matter**: it breaches portal ToS and yields agent contact data, not buyer enquiries.

### Cited Findings
- Vendors confirm that "some older CRM integrations rely on **email parsing** instead of API webhooks" and urge buyers to prefer webhook-based, real-time integrations. — [PropCRM](https://propcrm.ae/blog/property-portal-integration-guide-uae)
- A reference architecture treats email as a secondary input that feeds deduplication and idempotent storage alongside webhooks. — [Groovyweb](https://www.groovyweb.co/blog/property-finder-bayut-api-integration-architecture)
- PF's terms extend to "any third party accessing or using the API on its behalf". The lead-labelling, no-pooling and controller/processor clauses attach to **"lead(s) received from Property Finder"** regardless of channel. — [PF Terms AE](https://www.propertyfinder.com/ae/terms-and-conditions/) (excerpt)
- dubizzle's ToU forbids collecting personal data of other users for commercial purposes. Scraper vendors push ToS and data-protection compliance onto the user. — [dubizzle ToU](https://uae.dubizzle.com/m/terms/); [Apify dubizzle scraper](https://apify.com/benthepythondev/dubizzle-scraper)

### Inferences
- **Legitimate pattern:** the agency sets up an auto-forward (or grants scoped mailbox access) of portal lead emails to an AI-DATA ingestion address. AI-DATA parses them, labels the source, and pushes them into **that agency's** pipeline only. Risks:
  - **Brittleness:** template changes break parsers.
  - **Latency:** typically minutes rather than seconds.
  - **Missing channels:** call and WhatsApp leads often do not generate emails (not verified).
  - **Duplicates**, when webhooks also exist.
  - **Contractual:** the data stays PF/Bayut-controlled, so resale or pooling remains prohibited.
  - **Privacy:** the PDPL requires a processing agreement between the agency and AI-DATA, plus security and retention controls.
- Using an agency's portal login to scrape PF Expert or Bayut Pro dashboards would probably breach the API and access terms. PF expects API access through issued keys and PFDN. This is an inference, as no anti-automation clause text was retrieved.

### Gaps
- No portal statement was found that expressly permits or forbids email auto-forwarding of lead notifications to third-party processors.
- The exact content of PF and Bayut lead-notification emails (whether they include full phone and email) was not verified.

---

## 7. RERA/DLD rules relevant to listing leads (Trakheesi, Madmoun)

### Takeaway
In Dubai, every property advertisement, portal listings included, needs a DLD/RERA **Trakheesi advertising permit**. Since **24 April 2023** each permit carries a **Madmoun QR code**, which portals display. DLD uses AI to police listing compliance: it monitored more than 279,000 listings by April 2025. Leads from compliant portal listings are therefore tied to a permitted listing and a licensed broker. Any AI-DATA advertising that generates Dubai property leads would itself need permits.

### Cited Findings
- The Madmoun QR requirement took effect **24 April 2023**. Each Trakheesi permit gets a QR code that shows the advertiser, the property specifications, and whether the property is sold or rented. — [Dalile](https://www.dalile.com/blogs/dubai-madmoun-qr-code-guide-verify-real-estate-ads); [Truhauz](https://truhauz.com/trakheesi-permit-dubai/)
- Bayut shows the QR in a "Regulatory Information" section that links to the Trakheesi permit card. **The agent must add the permit number in Bayut's listing tool** for the QR to appear. — [Bayut: DLD Madmoun service](https://www.bayut.com/mybayut/dld-madmoun-service/); [Bayut Agent Portal guide](https://www.bayut.com/agentportal/agents-guide-to-dld-madmoun-service/)
- In April 2025 DLD's **AI-powered advertising governance platform** had monitored **more than 279,000 listings** across major platforms, auto-modifying many for compliance. — [Dalile](https://www.dalile.com/blogs/dubai-madmoun-qr-code-guide-verify-real-estate-ads)
- DLD rules **limit how many brokers can advertise the same property** and require **transacted properties to be taken down**. No dates were given in the excerpt. — [Gulf News](https://gulfnews.com/business/property/dubai-property-ads-land-department-gets-ai-to-correct-listings-1.500104134)
- PF's CRM-provider terms also cover **listing permits**. — [PF Terms for CRM Providers](https://www.propertyfinder.com/terms-conditions-for-crm-providers/) (excerpt; detail not visible)
- Broker-facing 2026 explainers on when a Trakheesi permit is needed: [Groovyweb: Trakheesi permit](https://www.groovyweb.co/blog/trakheesi-permit-dubai-brokers); [Beeps Digital](https://beepsdigital.com/blog/dubai-property-advertising-permit-trakheesi/); [EGSH](https://egsh.ae/insights/trakheesi-permit-dubai-advertising-compliance). These are secondary sources.

### Inferences
- The Trakheesi permit number on a listing is a useful **lead-quality and attribution field**: it identifies the property, the licensed broker and the permit validity. AI-DATA could store it with each portal lead, if the webhook or email includes the listing reference (PropBridge says listing reference is captured).
- If AI-DATA runs its own property ads to generate "hot leads" in Dubai, those ads probably need Trakheesi permits through a licensed broker. Otherwise AI-DATA should only advertise services, not specific properties. Verify with DLD.

### Gaps
- No primary DLD circular was retrieved, whether on Trakheesi/Madmoun or on rules for selling or transferring buyer leads between brokers. Check dubailand.gov.ae.
- No RERA rule was found that specifically governs **lead resale, referral fees or lead pooling** between brokers. Broker-to-broker referral and commission-sharing rules were not researched.
- No equivalent rules for Abu Dhabi (ADREC/DARI) or other emirates were researched.
