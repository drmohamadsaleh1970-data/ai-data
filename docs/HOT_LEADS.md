# Getting Hot Leads into AI-DATA

A Hot Lead is a live enquiry: a person who filled in a form and asked to be contacted. AI-DATA receives every lead through one endpoint, `POST /api/public/inquiry`. A **website key** on each lead decides where it goes:

| Key type | Created for | Where the lead goes | Used for |
|---|---|---|---|
| **Hot pool key** | AI-DATA Hot pool | Owner console → *Hot pricing & pool*. The owner allocates each lead to one paying agency (billed from its Hot credits). | Leads you generate yourself (ai-home.world, your campaigns) and sell to agencies |
| **Agency key** | One agency | Straight into that agency's CRM as a HOT lead, assigned round-robin to its agents, with a response-time alert | An agency's own website or campaigns (its own data, not billed) |

Every lead must carry the person's consent to be contacted. Leads without it are rejected.

## 1. Create a website key
1. Sign in as the platform owner and go to **Owner console → Hot pricing & pool → Website lead forms**.
2. Fill in:
   - **Website name**, e.g. `ai-home.world`.
   - **Allowed website address** (optional, recommended), e.g. `https://www.ai-home.world`. Browsers on other sites can then not use the key. It must match exactly, including `www`.
   - **Leads go to:** *AI-DATA Hot pool* or an agency.
3. Click **Create key**. The page shows the key with ready-to-paste code. **Revoke** stops a key immediately.

## 2. Put the form on the website
Paste the code from step 1 where the form should appear (on ai-home.world, a landing page, or an agency site):

```html
<div data-ai-data-form data-site-key="sk_xxxxxxxxxxxxxxxx" data-lang="en"
     data-privacy-url="https://www.ai-home.world/privacy"></div>
<script src="https://ai-data-phi.vercel.app/lead-form.js" defer></script>
```

| Option | Values |
|---|---|
| `data-lang` | `en`, `ar` (right-to-left), `fr`, `ru`, `tr` |
| `data-privacy-url` | Link to your privacy notice. Always set it. |
| `data-notice-version` | Version label of that notice, e.g. `2026-10`. Stored with the consent evidence. |
| `data-color` | Button colour, e.g. `#b8862f` |
| `data-area` | Pre-fills the area, e.g. on a project page |

The form asks for name, phone/WhatsApp, email, area, property type, bedrooms, budget and message, plus a required consent box and an optional marketing box. It includes a hidden anti-bot field and sends no cookies.

## 3. Ad platforms: Meta (Facebook/Instagram), Google, TikTok, LinkedIn
No direct connector is built yet. Use **Zapier** or **Make** to forward each new lead:

1. **Trigger:** *New lead* in Facebook Lead Ads, Google Ads lead forms, TikTok Lead Generation or LinkedIn Lead Gen Forms.
2. **Action:** *Webhooks → POST*, with these settings:
   - **URL:** `https://ai-data-phi.vercel.app/api/public/inquiry`
   - **Header:** `X-Site-Key: <your key>`
   - **Payload type:** JSON
3. **Map the fields:**

```json
{
  "full_name": "{{Full name}}",
  "phone": "{{Phone number}}",
  "email": "{{Email}}",
  "area": "{{Preferred area}}",
  "property_type": "{{Property type}}",
  "budget_max_aed": "{{Budget}}",
  "consent_contact": true,
  "consent_marketing": false,
  "notice_version": "meta-form-2026-10",
  "client_event_id": "{{Lead ID}}"
}
```

- Set `consent_contact` to `true` only if the ad form shows your privacy notice and the person asked to be contacted. Add a custom consent question to the ad form where the platform allows it.
- Always map the platform's **lead ID** to `client_event_id`, so a retried delivery is never stored twice.
- Booleans may be sent as text (`"true"`, `"yes"`).

## 4. Any other system (API)
```bash
curl -X POST https://ai-data-phi.vercel.app/api/public/inquiry \
  -H 'Content-Type: application/json' -H 'X-Site-Key: sk_xxxxxxxxxxxxxxxx' \
  -d '{"full_name":"Test Person","phone":"+971501234567","consent_contact":true,"client_event_id":"test-1"}'
```

| Answer | Meaning |
|---|---|
| `200 {"accepted":true,"destination":"AIHOME_HOT_POOL"}` | Stored in the Hot pool |
| `200 {"accepted":true,"destination":"AGENCY_CRM","lead_id":…}` | Stored in the agency CRM |
| `200 {"duplicate":true}` | Same `client_event_id` already received, nothing new stored |
| `400 NAME_AND_CONTACT_REQUIRED` / `CONSENT_REQUIRED` | Missing name + phone/email, or no consent |
| `401 INVALID_SITE_KEY` | Unknown or revoked key |
| `403 ORIGIN_NOT_ALLOWED` | The key is limited to another website |
| `429 RATE_LIMITED` | More than 10 leads per minute from one IP address |

## 5. Selling pool leads to agencies
1. **Owner console → Hot pricing & pool → Pricing:** choose the model and price, then click **Save & approve pricing** (MFA required). Until then, checkout and allocation stay disabled.
2. After an agency pays for Hot Leads, use **Grant Hot credits** to give it credits.
3. In **AI-DATA Hot pool**, pick the agency next to a lead and click **Allocate**. The lead moves into that agency's CRM and one credit is billed on the separate Hot ledger. Cold quota is never touched.

## Property portals (Property Finder, Bayut, Dubizzle)
Portal leads belong to the agency whose listing produced them. They must stay in that agency's CRM: never pooled, resold or merged. Connect them only through the portal's approved API for that agency. No portal connector is built yet; each needs the agency's own portal agreement and credentials.

## Before taking real leads
- [ ] **Vercel Authentication off** for production (Project → Settings → Deployment Protection), or use a custom domain. Otherwise visitors' browsers get a Vercel login page instead of the form.
- [ ] **Permanent database.** The current Vercel site loses data whenever the server restarts (see `README.md` → *Deploying to Vercel*).
- [ ] A **privacy notice** page on every site that uses the form, linked with `data-privacy-url`.
- [ ] A **key** with an allowed address for each real website (Owner console → Hot pricing & pool → Website lead forms).
- [ ] Hot **pricing** configured, if you sell pool leads.
- [ ] Send one test lead and check that it arrives.
