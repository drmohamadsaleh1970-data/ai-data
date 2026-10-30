# UAE Live-Lead Platform (AI-DATA): Compliance Rules and Vercel Real-Time Architecture, as of 30 Oct 2026

Method note for the report writer: in this session WebFetch was blocked for some hosts (vercel.com, assets.ctfassets.net were outside the session's allowed network domains), so most findings below come from search-engine extracts of the cited pages and from Vercel's documentation index (Vercel MCP doc search), not from full-page reads. Primary government texts (the Cabinet Resolution 56/2024 PDF, the PDPL Gazette text) could not be opened directly. Figures that rest only on vendor or blog sources are flagged.

---

## A1. Federal PDPL (Decree-Law 45/2021): status, consent, rights, cross-border, penalties, regulator; DIFC/ADGM carve-out

### Takeaway
The federal PDPL has been in force since 2 Jan 2022, but as of autumn 2026 its Executive Regulations and the Cabinet decision on penalties have still **not** been issued. The UAE Data Office never became fully operational and on 14 June 2026 was folded into a new Federal Authority for Artificial Intelligence and Data. A mainland or ordinary free-zone platform should still build to the PDPL now: provable consent, data-subject rights and the right to object to direct marketing. DIFC- and ADGM-incorporated entities fall under their own regimes instead.

### Cited Findings
**Status and Executive Regulations**
- The PDPL took effect on 2 January 2022. As of early October 2026, one firm could not find the executive regulations or the Cabinet decision on violations and penalties on the official legislation portal. — [Kayrouz & Associates](https://www.kayrouzandassociates.com/insights/cross-border-data-transfers-under-uae-law-in-2026); [Securiti](https://securiti.ai/uae-personal-data-protection-law/)
- A September 2026 guide states that the Executive Regulations "have not been issued". A mid-2026 legal guide says they have not been published as a discrete instrument in the Official Gazette. Chambers' 2026 guide reportedly says the same. — [BusinessDubai blog](https://www.businessdubai.ae/blogs/uae-pdpl-data-protection); [business-ciso.com](https://business-ciso.com/blog/uae-pdpl-executive-regulations-status); [Chambers Data Protection & Privacy 2026 – UAE](https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/uae/trends-and-developments/O24528)
- **Conflict:** two low-quality sites claim the regulations are in force, with a 1 Jan 2027 compliance deadline. Neither cites an official source and both are contradicted by the sources above. — [itsecnow.com](https://itsecnow.com/regulators/pdpl-executive-regulations-2026); [promptquorum.com](https://www.promptquorum.com/local-llms/uae-pdpl-data-sovereignty-local-ai-2026)
- No adequacy list and no standard contractual clauses for cross-border transfers have been published. The Data Office has reportedly communicated 72 hours as the operative breach-notification standard, but no regulation fixing that deadline has been published. — [globallawexperts.com](https://globallawexperts.com/uaes-new-digital-rulebook-2026-data/); [Kayrouz](https://www.kayrouzandassociates.com/insights/cross-border-data-transfers-under-uae-law-in-2026)

**Regulator**
- The UAE Data Office, called the "Bureau" in the PDPL, was established by Federal Decree-Law 44/2021 but never became fully operational. — [Securiti](https://securiti.ai/uae-personal-data-protection-law/); [Al Tamimi](https://www.tamimi.com/law_update_articles/uae-establishes-new-federal-authority-for-ai-and-data-a-significant-step-in-the-evolution-of-digital-regulation/)
- On 14 June 2026 the Cabinet created the **Federal Authority for Artificial Intelligence and Data**. It consolidates the Emirates Data Office, the UAE AI Office and TDRA's digital-government sector, reports to the Cabinet and is chaired by Minister of State for AI Omar Sultan Al Olama. It is the expected PDPL supervisory authority. — [Gulf News](https://gulfnews.com/uae/uae-creates-federal-authority-for-artificial-intelligence-and-data-1.500573822); [Eversheds Sutherland, June 2026](https://www.eversheds-sutherland.com/en/global/insights/uae-establishesthe-federal-artificial-intelligence-and-data-authority-june-2026); [Al Tamimi](https://www.tamimi.com/law_update_articles/uae-establishes-new-federal-authority-for-ai-and-data-a-significant-step-in-the-evolution-of-digital-regulation/); [Lexology](https://www.lexology.com/library/detail.aspx?g=1e65518e-464d-400f-951a-7e4a7b67319a)

**Consent and data-subject rights**
- Where processing relies on consent, the controller must be able to **prove** it. Consent must be specific, clear and unambiguous (described as "explicit", by clear affirmative action), given in a clear, simple, accessible form, in writing or electronically, and the data subject must be told of the right to withdraw. Withdrawal is possible "at any time" and does not affect processing that was lawful before it. These are secondary summaries of Art. 6. — [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2022/uae-federal-decree-law-on-personal-data-protection/); [Modulos – lawful processing & rights](https://docs.modulos.ai/frameworks/uae-pdpl/lawful-processing-and-data-subject-rights); [Paoletti – data subject rights](https://paoletti.com/uaes-new-data-protection-law-rights-of-a-data-subject/)
- Data subjects can ask the controller to stop processing for direct marketing. **Conflict on the article number:** one source puts this right in Art. 17, another in Art. 18. — [Modulos FAQ](https://docs.modulos.ai/frameworks/uae-pdpl/faq); [The Art of Service](https://compliance.theartofservice.com/frameworks/uae-federal-data-protection-law)
- Separately, the UAE Consumer Protection Law reportedly gives consumers a right not to have their information used for marketing, with explicit consent acting as an exception. — [DataGuidance – UAE direct marketing overview](https://www.DataGuidance.com/opinion/uae-overview-direct-marketing-requirements); [Mondaq](https://www.mondaq.com/compliance/1229090/compliance-%7C%7C-communications-with-customers)
- Practitioner guidance says controllers must keep a record of when, how and for what purpose consent was obtained. This is guidance, not statutory text. — [Captain Compliance](https://captaincompliance.com/education/pdpl-uae/)

**Cross-border transfer**
- Transfers outside the UAE are allowed to jurisdictions with adequate protection, or otherwise via contractual safeguards or exceptions such as the data subject's explicit consent. No adequacy list has been published. — [Middle East Briefing](https://www.middleeastbriefing.com/news/uae-data-protection-obligations-and-cross-border-data-transfer-for-businesses/); [ABS Partners](https://abspartners.ae/uae-personal-data-protection-law-2/); [Kayrouz](https://www.kayrouzandassociates.com/insights/cross-border-data-transfers-under-uae-law-in-2026)

**Penalties**
- Art. 26 leaves violations and administrative penalties to a Council of Ministers decision proposed by the Data Office, and that decision has not been issued. **Conflicting secondary figures:** "AED 50,000 to AED 5 million" is the most often repeated, another source says "up to USD 100,000 per violation", and neither has been verified against a primary text. — [Securiti](https://securiti.ai/uae-personal-data-protection-law/); [Al Maazmi Lawyers](https://www.almaazmilawyers.com/insights/pdpl-uae-data-protection-compliance-guide); [Kayrouz](https://www.kayrouzandassociates.com/insights/cross-border-data-transfers-under-uae-law-in-2026)

**DIFC / ADGM**
- PDPL Art. 2 excludes free zones that have their own data-protection legislation: DIFC (DIFC Data Protection Law, Law No. 5 of 2020) and ADGM (Data Protection Regulations 2021). Companies in other free zones (media, tech, logistics, general trading) are governed by the PDPL exactly like mainland companies. A group with both onshore and DIFC/ADGM operations is likely subject to both regimes. **Conflict:** one source says the PDPL applies to DIFC/ADGM too, but the weight of sources says they are carved out. — [UAE Expert Hub](https://www.uaeexperthub.com/uae-data-protection-law-pdpl/); [EdLaw PDPL summary](https://edlaw.eduverse.com/docs/jurisdiction/nat/ae/pdpl/README.md); [recordinglaw.com](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/uae-data-privacy-laws/); contrary view: [Middle East Briefing](https://www.middleeastbriefing.com/news/uae-data-protection-obligations-and-cross-border-data-transfer-for-businesses/)
- Data flowing between onshore and DIFC/ADGM entities counts as a cross-border transfer requiring a lawful mechanism. DIFC and ADGM regimes also require informing data subjects about direct marketing and letting them object. — [Middle East Briefing](https://www.middleeastbriefing.com/news/uae-data-protection-obligations-and-cross-border-data-transfer-for-businesses/); [DataGuidance](https://www.DataGuidance.com/opinion/uae-overview-direct-marketing-requirements)

### Inferences
- With no Executive Regulations, no penalty schedule and a regulator still being reorganised, enforcement risk under the PDPL is currently lower than under the telemarketing regime (A2), which is actively enforced. A new supervisory body plus pending regulations means obligations could harden quickly in 2027, so the platform should be built to a GDPR-like baseline now.
- If AI-DATA stores UAE leads in a non-UAE database (for example Neon Frankfurt or Supabase Mumbai, see B1), that is a cross-border transfer. With no adequacy list, the safest basis is explicit consent captured on the lead form ("your details may be stored and processed outside the UAE by our service providers"), plus contractual safeguards with the vendors.
- Lead forms should carry a clear purpose statement, for example "to be contacted by a licensed broker about this property by phone, WhatsApp, SMS or email", because consent is purpose-specific. They also need an unsubscribe or stop-marketing path on every channel.

### Gaps
- The official Gazette text of Decree-Law 45/2021 (exact article numbers for consent, rights and Art. 2 exclusions) could not be opened in this session.
- No sources found on whether the new Federal AI & Data Authority has issued any PDPL guidance since June 2026.
- DIFC/ADGM fine levels and direct-marketing specifics were not researched in depth. They are relevant only if the operating entity is DIFC/ADGM-incorporated.

---

## A2. Telemarketing (Cabinet Resolutions 56 and 57 of 2024): hours, attempts, recording, penalties; inbound enquiries; SMS and WhatsApp

### Takeaway
Since 27 Aug 2024, all marketing by phone call, SMS and social-media or messaging apps (which on the plain wording includes WhatsApp) by licensed companies, free-zone companies included, requires prior approval. It must use company-registered local numbers, never personal numbers. Calls are allowed only 9am–6pm. No further calls after a refusal. Unanswered calls are capped at once a day and twice a week. Calls must be recorded, with notice at the start of the call, and DNCR numbers must be suppressed. Fines run up to AED 150,000 per violation, and RERA separately punishes broker cold-calling. No source clearly exempts calls made in response to a lead's own enquiry.

### Cited Findings
- Cabinet Resolution No. 56 of 2024 regulates telemarketing, and Resolution No. 57 of 2024 sets the penalties. Both took effect on **27 August 2024**. They cover phone calls, marketing texts and marketing messages via social-media apps, and apply to licensed companies including those in free zones. — [Clyde & Co, July 2024](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne); [Pinsent Masons](https://www.pinsentmasons.com/out-law/news/uae-telemarketing-rules-ensure-businesses-operate-transparency-integrity); [Ministry of Economy press release](https://www.moet.gov.ae/en/-/ministry-of-economy-and-telecommunications-and-digital-government-regulatory-authority-review-regulatory-legislations-in-organizing-operational-mechanisms-for-telemarketing-companies-in-the-uae-and-enhancing-consumer-protection-in-line-with-best-practices); [Official English text (PDF, not fetchable in this session)](https://assets.ctfassets.net/imwh2nthh7vk/4dgC0O0b94CaeGjxfRNa8Z/70fd454f112fe5f226e54d5b2722cfd7/Cab_56_En.pdf); [RealLaw table of the decision](https://app.reallaw.ai/en/legal-table/doc/cabinet-decision-no-56-of-2024-concerning-the-telemarketing-regulations-512)
- **Company obligations:**
  - Prior approval from the competent authority. Sources name TDRA, with the Ministry of Economy supervising execution.
  - Train marketing staff on conduct and use of the DNCR.
  - Use local numbers registered under the company's trade licence.
  - Keep a record of marketing calls.
  - Natural persons may not make marketing calls from personal numbers.
  — [Clyde & Co](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne); [Lexology – New Telemarketing Regulations](https://www.lexology.com/library/detail.aspx?g=f366efd4-286e-4a6c-b537-0b652bc81168); [Legal500](https://www.legal500.com/developments/thought-leadership/new-telemarketing-rules-and-regulations-in-the-uae-a-comprehensive-guide-to-fines-and-enforcement/)
- **Hours:** calls only between **9:00am and 6:00pm**. Reported fines for violations are AED 10,000, rising to AED 50,000 for repeat offences. — [Khaleej Times](https://www.khaleejtimes.com/uae/new-telemarketing-rules-in-uae-full-list-of-fines-explained-as-laws-will-go-into-effect-from-august); [Legal500](https://www.legal500.com/developments/thought-leadership/new-telemarketing-rules-and-regulations-in-the-uae-a-comprehensive-guide-to-fines-and-enforcement/)
- **Attempts:** once a consumer rejects the product or service, the company must not call again. If calls go unanswered, at most **once a day and twice a week**. One source applies the cap after no answer or a hang-up. — [Clyde & Co](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne); [Lexology (Clyde & Co reprint)](https://www.lexology.com/library/detail.aspx?g=bebc2336-1f72-4aae-9c20-a806473b3a28)
- **Recording (Art. 4(7)):** marketing calls must be recorded, and the consumer informed of the recording at the start of the call. Reported fines:
  - Failure to notify: AED 10k, then 20k, then 30k.
  - Failure to record: AED 10k–50k.
  These figures come from a vendor table and vary across sources. — [Khaleej Times](https://www.khaleejtimes.com/uae/new-telemarketing-rules-in-uae-full-list-of-fines-explained-as-laws-will-go-into-effect-from-august); [MajLeads penalty table (vendor)](https://www.majleads.com/blog/tdra-fines-penalty-table); [MajLeads – call recording & PDPL (vendor)](https://www.majleads.com/blog/pdpl-call-recording-consent-uae)
- **Call conduct:** agents should confirm the customer wants to continue before pitching. — [Lumaa (vendor)](https://lumaa.ai/uae-ai-calling-compliance.html); [YuVerse (vendor)](https://www.yuverse.ai/resources/posts/tdra-telemarketing-rules-uae)
- **Penalties (Res. 57/2024)** include warnings, fines and suspension or cancellation of licences for companies, and fines and restrictions for individuals. Reported tiers (sources vary; verify against the official text):
  - Operating without approval: AED 75k, then 100k, then 150k (Art. 4/1).
  - Calling DNCR numbers: AED 50k for a first violation, up to AED 150k.
  - Missing staff training: AED 10k, then 25k, then 50k.
  — [Legal500](https://www.legal500.com/developments/thought-leadership/new-telemarketing-rules-and-regulations-in-the-uae-a-comprehensive-guide-to-fines-and-enforcement/); [The Law Reporters](https://thelawreporters.com/new-uae-telemarketing-laws-detailed-fines-unveiled-as-regulations-begin-27-august); [Al Rowaad](https://www.alrowaad.ae/legal-blog/new-telemarketing-rules-and-regulations-in-the-uae-a-comprehensive-guide-to-fines-and-enforcement/)
- **Enforcement is real:** over 2,000 people were fined and banned for misusing personal numbers for telemarketing. — [Gulf News](https://gulfnews.com/uae/crime/uae-fines-and-bans-over-2000-for-misusing-personal-numbers-in-telemarketing-1.1727928576834)
- **Real estate specifically:**
  - A Dubai brokerage-focused guide summarises the requirements as prior approval, an "interest-based" communication channel, DNCR suppression, company-registered numbers, recording, transparency and contact controls. It notes that DLD asks the public to report unsolicited promotional calls from real-estate companies. — [DVNC.ae (industry blog)](https://dvnc.ae/blog/cold-calling-rules-uae-dubai-real-estate-brokers)
  - RERA has separately fined a brokerage AED 50,000 and suspended nine brokers for three months for cold calling and direct telemarketing (2022), and runs a "Report Malicious Calls" service in Dubai REST. — [DLD press release](https://dubailand.gov.ae/en/news-media/rera-fines-real-estate-brokerage-office-aed-50-000-for-cold-calling-suspends-nine-brokers)
- **Does earlier consent override DNCR?** One vendor source says a DNCR-registered consumer stays opted out even where consent was captured earlier. This is unverified against the resolution text. — [YuVerse – DNCR (vendor)](https://www.yuverse.ai/resources/posts/dncr-do-not-call-registry-uae)
- **SMS marketing (TDRA):**
  - Promotional SMS must use a sender ID prefixed "**AD-**" (for example "AD-AIDATA").
  - Sender IDs must be registered separately with **e&** and **du** and generally must match the registered company name. Numeric and unregistered sender IDs are blocked.
  - Reported approval times vary: 5–10 business days, 10–15 business days, or 2–4 weeks.
  — [sent.dm](https://www.sent.dm/resources/ae-sms-guidance); [Telerivet](https://www.telerivet.com/blog/uae-sms-compliance-tdra-ad-prefix); [Clickatell](https://www.clickatell.com/sms-country-regulations/united-arab-emirates-uae/); [MessageCentral](https://www.messagecentral.com/sms-guideline/uae)
- Brands sending promotional SMS must also upload a **consent database to TDRA's Consent Management System (CMS)**. Promotional SMS with no consent list in the CMS is reportedly not delivered but still charged. This comes from a vendor source. — [D7 Networks](https://d7networks.com/blog/the-regulations-for-sending-sms-in-uae/); [sent.dm](https://www.sent.dm/resources/ae-sms-guidance)
- Consumers can block an SMS sender by texting "<AD-sender ID> B" to **7726**. — [TDRA FAQs](https://tdra.gov.ae/en/FAQs)
- International sender IDs reportedly cost about USD 40/month each (vendor). — [MessageCentral](https://www.messagecentral.com/sms-guideline/uae)
- PDPL-centric guidance for SMS and WhatsApp marketing in 2026 exists from an SMS vendor (consent, opt-out). — [BroadNet](https://www.broadnet.me/blog/uae-pdpl-sms-whatsapp-marketing-2026)

### Inferences
- **Inbound enquiry vs. consent:** the regulation is aimed at unsolicited marketing, and an inbound enquiry ("call me about this property") is the strongest evidence of an "interest-based" contact. No source found states an explicit exemption, though, so AI-DATA should treat every follow-up as regulated telemarketing:
  - Call only 9am–6pm Gulf Standard Time. Leads arriving after 6pm get an instant automated acknowledgement (email, or WhatsApp utility template if opted in) and a call queued for 9am. This matters for an "instant callback" feature.
  - Call only from the brokerage's licence-registered numbers, never an agent's personal mobile (the platform should store and enforce an approved caller-ID list).
  - Announce the recording at the start of the call and keep recordings.
  - Enforce attempt caps in software (≤1 unanswered attempt per day and ≤2 per week per number) and a hard stop on "not interested".
  - Store the enquiry plus consent record (A5) as proof of interest.
- **DNCR:** the safest design screens every number before outbound marketing calls, even for inbound leads. Where the lead's own explicit request to be called is recorded, the company has a stronger argument, but this is untested (see Gaps).
- **WhatsApp follow-ups** sent by a brokerage are plausibly "marketing messages via social-media apps" under Res. 56. Apply the same consent, opt-out, hours and frequency discipline.
- **Agent alert SMS** sent to the platform's own staff or brokers are internal/transactional, not consumer marketing, so the "AD-" prefix should not apply. A registered (non-AD) sender ID is still needed for delivery in the UAE.

### Gaps
- The official Res. 56/57 text could not be opened, so exact article numbers, the definition of "consumer consent", any exemption for existing customers or requested callbacks, and recording-retention periods are unverified.
- Whether the 9am–6pm window and frequency caps apply to SMS and WhatsApp messages as well as voice calls: sources speak mainly of "calls".
- No source found on how TDRA treats an online form submission as consent for DNCR purposes.

---

## A3. Do Not Call Registry (DNCR): how businesses check numbers

### Takeaway
DNCR is operated by TDRA. Consumers register by SMS, and approved telemarketing companies must not call registered numbers. No public source found in this session describes the business-side lookup mechanism (portal, API or bulk scrub) or required scrub frequency. Confirm it with TDRA as part of the telemarketing approval process.

### Cited Findings
- TDRA runs the DNCR. Companies must not call numbers on it and must train staff on its use. — [Clyde & Co](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne); [Pinsent Masons](https://www.pinsentmasons.com/out-law/news/uae-telemarketing-rules-ensure-businesses-operate-transparency-integrity)
- Consumers register by texting "DNCR" to **2211** or **1012** (sources vary; one du-specific note gives a different format). — [Khaleej Times](https://www.khaleejtimes.com/uae/new-telemarketing-rules-in-uae-full-list-of-fines-explained-as-laws-will-go-into-effect-from-august); [angelindubai.com](https://www.angelindubai.com/post/how-to-report-cold-calls-uae-telemarketing-rules)
- A vendor states that Res. 56/2024 requires businesses to show:
  - staff training programmes on DNCR usage;
  - recordkeeping systems using TDRA-provided forms;
  - compliance with time restrictions and consent mechanisms.
  — [sent.dm](https://www.sent.dm/resources/ae-sms-guidance)
- Calling DNCR numbers is the costliest violation, at up to AED 150,000. — [Legal500](https://www.legal500.com/developments/thought-leadership/new-telemarketing-rules-and-regulations-in-the-uae-a-comprehensive-guide-to-fines-and-enforcement/)

### Inferences
- Design a pluggable "DNCR check" step in the outbound workflow: a provider adapter, results cached per number with a timestamp, and the call or campaign blocked when the result is unknown. Then wire it to whatever TDRA access the brokerage obtains on approval.
- Keep an internal suppression list as well (numbers that said "stop" or "not interested", SMS 7726 blocks reported by the provider), independent of the DNCR.

### Gaps
- No primary or authoritative source on the business DNCR lookup interface, cost, or scrub frequency. Contact TDRA, or a TDRA-approved telemarketing compliance provider, directly.

---

## A4. Real-estate advertising and broker rules (DLD/RERA Trakheesi and Madmoun; Abu Dhabi ADREC/Madhmoun); lead handling and sharing

### Takeaway
In Dubai, any real-estate advertisement, including social media and therefore paid lead-generation ads, needs a DLD **Trakheesi** permit, and the permit's **Madmoun** QR code lets consumers verify the ad. DLD actively fines non-compliant firms. In Abu Dhabi, ADREC runs its own **Madhmoun** permit via the DARI platform, open only to ADREC-registered brokers and companies. No rule found specifically governs sharing or selling lead data between brokers, so the PDPL purpose and consent rules (A1) govern.

### Cited Findings
- DLD: "real estate companies and establishments operating in Dubai and wishing to publish any real estate advertisement in the emirate are required to apply for a permit through the Trakheesi system". DLD fined 10 companies and warned 30 for advertising non-compliance. — [DLD news](https://dubailand.gov.ae/en/news-media/dld-fines-10-real-estate-companies-and-warns-another-30-for-not-adhering-to-advertising-requirements/)
- The permit applies whether the ad appears on a property portal, social media, a billboard or in print. — [beepsdigital (agency)](https://beepsdigital.com/blog/dubai-property-advertising-permit-trakheesi/); [EGSH (consultancy)](https://egsh.ae/insights/trakheesi-permit-dubai-advertising-compliance)
- **Madmoun:**
  - A QR code is issued for every Trakheesi ad permit so customers can verify the ad's authenticity and validity.
  - It became a requirement from 24 April 2023, initially for print and audiovisual ads.
  — [Gulf News](https://gulfnews.com/business/property/dubai-land-department-launches-madmoun-service-for-real-estate-ad-verification-1.95202094)
- All Dubai property-ad mechanisms are regulated through Trakheesi. The owner must sign a marketing agreement (**Form A**) before a brokerage can market the property online, in print or on radio. — [Cushman & Wakefield](https://www.cushwake.ae/en/news/real-estate-brokers-in-dubai-now-need-to-gain-approval-for-property-ads); [builtenvironmentme.com](https://www.builtenvironmentme.com/dubai-reveals-new-property-marketing-rule-for-brokers)
- Reported fines for ad violations start at AED 50,000 (consultancy source, unverified against DLD). — [EGSH](https://egsh.ae/insights/trakheesi-permit-dubai-advertising-compliance)
- RERA punishes cold calling: a brokerage was fined AED 50k and nine brokers were suspended for three months (2022). — [DLD](https://dubailand.gov.ae/en/news-media/rera-fines-real-estate-brokerage-office-aed-50-000-for-cold-calling-suspends-nine-brokers)
- **Abu Dhabi:**
  - A Madhmoun ad permit, issued through ADREC's DARI platform, has reportedly been required since July 2025.
  - Only ADREC-licensed brokers and companies can apply, and the owner must approve the broker's request.
  - Reportedly at most three ADREC-licensed brokers may advertise a single property at the same time.
  These come from broker blogs; verify with ADREC. — [Driven Properties](https://www.drivenproperties.com/blog/adrec-abu-dhabi-real-estate-centre-guide); [Oplus Realty](https://oplusrealty.com/adrec-abu-dhabi-real-estate-centre-guide-2026/); [PropSpace](https://www.propspace.com/blog/uae-real-estate-advertising-permits)
- Consumers are advised to report persistent, unsolicited property sales calls, especially from callers who will not give verifiable RERA details, to DLD. — [Sanaya Real Estate (2026 consumer guide)](https://sanayarealestate.com/verify-dubai-property-listing-legitimate-rera-dld-2026-guide/)

### Inferences
- Lead-gen ads and landing pages that promote specific Dubai properties should display the Trakheesi permit number and Madmoun QR, and be published by or for a RERA-licensed brokerage. AI-DATA should store the permit number against each lead source or campaign. The DLD wording ("any real estate advertisement") plausibly covers Meta/TikTok/Google lead forms.
- Leads should be routed only to RERA-registered (Dubai) or ADREC-registered (Abu Dhabi) brokers, so the platform should store each agent's BRN/licence and expiry and block routing to unlicensed users.
- **Lead sharing or selling:** under the PDPL, a lead captured "to be contacted about property X by brokerage Y" cannot lawfully be passed to brokerage Z without a disclosed purpose and consent. The lead form should name the recipient brokerage(s), or say "partner brokers", with explicit consent, and the platform should log every hand-off.

### Gaps
- No DLD/RERA or ADREC rule found that specifically regulates lead-data sharing, lead resale, or lead-generation companies that are not brokers.
- Whether a pure lead-gen platform (not itself a broker) must hold a RERA licence or Trakheesi permit when running ads for brokers: no source found.
- ADREC primary documents were not available. The figures above come from broker blogs.

---

## A5. Consent-record best practice

### Takeaway
Because the PDPL requires the controller to be able to prove consent, and TDRA requires consent databases for promotional SMS plus records of marketing calls, AI-DATA should store an immutable, per-channel consent event for every lead. That event should be linked to the exact notice text version shown.

### Cited Findings
- The controller must be able to prove the data subject's consent, which must be specific, clear and unambiguous and withdrawable at any time. — [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2022/uae-federal-decree-law-on-personal-data-protection/); [Modulos](https://docs.modulos.ai/frameworks/uae-pdpl/lawful-processing-and-data-subject-rights)
- Practitioner guidance: keep a record of when, how and for what purpose consent was obtained. — [Captain Compliance](https://captaincompliance.com/education/pdpl-uae/)
- Promotional SMS requires a consent database uploaded to TDRA's CMS. — [D7 Networks](https://d7networks.com/blog/the-regulations-for-sending-sms-in-uae/)
- Marketing calls must be recorded and a record of marketing calls kept. — [Clyde & Co](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne); [Khaleej Times](https://www.khaleejtimes.com/uae/new-telemarketing-rules-in-uae-full-list-of-fines-explained-as-laws-will-go-into-effect-from-august)

### Inferences (recommended schema, not sourced as a legal requirement)
- `consent_events` table, append-only, with these fields:
  - `lead_id`
  - `channel_scope`: call, SMS, WhatsApp, email, and data-sharing with named brokers
  - `purpose` text
  - `granted` true or false (false = withdrawal)
  - `timestamp_utc`
  - `source`: form URL or page ID, ad platform plus ad, form and campaign IDs, Trakheesi permit number
  - `notice_version_id`, with a hash of the exact consent wording and privacy-notice version shown
  - `capture_method`: unticked checkbox, platform lead-form disclaimer, or verbal on a recorded call
  - `ip` and `user_agent` (personal data, so keep them under a retention limit)
  - `language` (AR/EN)
  - `cross_border_ack`
  - `evidence_ref`: raw webhook payload ID, call-recording ID
- `contact_attempts` table: `lead_id`, `agent_id`, `caller_number` (must be a licence-registered number), `channel`, `started_at` (GST, used to enforce 9am–6pm), `outcome` (answered, no answer, refused), `recording_ref`, `dncr_check_id`. Use it to enforce the once-a-day / twice-a-week caps and the stop after refusal.
- Keep the raw inbound webhook body (encrypted) as evidence. For Meta/Google lead forms, store the platform's own consent/disclaimer text ID.

### Gaps
- No UAE regulator guidance found on minimum consent-record fields or retention periods.

---

## B1. Persistent database options on Vercel (2026): Neon, Supabase, Turso/libSQL, PlanetScale; regions near UAE; serverless pooling

### Takeaway
No major serverless Postgres or SQLite provider confirmed a UAE or Bahrain region in this research. **Frankfurt** (Neon, Supabase, and likely Turso) and **Mumbai** (Supabase, AWS ap-south-1) are the realistic nearest options. Turso/libSQL is the lowest-friction migration from `node:sqlite`, but Supabase announced its acquisition of Turso on about 2 Oct 2026, which adds roadmap uncertainty. Neon (Vercel Marketplace) is the safest Postgres default. Use Vercel's `attachDatabasePool` with Fluid compute.

### Cited Findings
- **Neon regions:** the official docs list AWS US East (N. Virginia), US East (Ohio), US West (Oregon), Europe (Frankfurt), Asia Pacific (Singapore) and Asia Pacific (Sydney). No Middle East region. One cached docs build lists Israel (Tel Aviv) `aws-il-central-1`, which is unconfirmed. — [Neon regions docs](https://neon.tech/docs/introduction/regions)
- **Neon pricing (third-party summaries):**
  - Free plan: 100 projects, 100 CU-hours, 1 GB per project (reportedly doubled from 0.5 GB in Oct 2026), 10 branches.
  - Free projects inactive for 90+ days are subject to deletion from 5 Oct 2026.
  - Launch plan: about $0.106 per CU-hour, no minimum.
  — [draxlr](https://www.draxlr.com/blogs/supabase-vs-neon/); [checkthat.ai](https://checkthat.ai/brands/neon/pricing); [designrevision](https://www.designrevision.com/blog/supabase-vs-neon)
- **Supabase regions:** the official page lists South Asia (Mumbai) `ap-south-1`, Singapore, Tokyo, Seoul, Sydney, São Paulo, Stockholm and others, with general regions US East, Frankfurt and Singapore. A third-party claim of UAE and Bahrain regions conflicts with the official snippet. — [Supabase regions docs](https://supabase.com/docs/guides/platform/regions); conflicting: [Nearbase](https://nearbase.dev/blog/supabase-vs-rds/)
- **Supabase pricing:** free projects pause after a week of inactivity. Pro is $25/month including $10 compute credits. — [draxlr](https://www.draxlr.com/blogs/supabase-vs-neon/); [srvrlss.io](https://www.srvrlss.io/provider/supabase/)
- **Turso:**
  - Free: 100 databases, 5 GB storage, 500M row reads/month. Paid from $4.99/month.
  - One source says scale-to-zero was deprecated in January 2026 (unverified).
  — [devtoolpicks](https://devtoolpicks.com/blog/turso-vs-neon-vs-supabase-indie-hackers-2026); [PkgPulse](https://www.pkgpulse.com/guides/neon-vs-supabase-vs-turso-2026)
- **Supabase is acquiring Turso** (announced about 2 Oct 2026, alongside a $150M round led by GIC):
  - Turso "keeps running … databases, APIs, and workflows continue as they do today", and Turso Database stays open source.
  - Terms, pricing commitments, SLA and close date were not disclosed.
  — [Turso blog](https://turso.tech/blog/turso-is-joining-supabase); [PR Newswire](https://www.prnewswire.com/news-releases/supabase-announces-150m-in-new-funding-and-turso-acquisition-302896752.html); [beri.net](https://www.beri.net/article/supabase-turso-acquisition-database-per-agent-sqlite-postgres-pricing-continuity)
- **AWS region names:** `me-central-1` is Middle East (UAE) and `me-south-1` is Middle East (Bahrain). — [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- **Pooling on Vercel:** call `attachDatabasePool(pool)` from `@vercel/functions` right after creating a `pg` (or mysql2, ioredis, etc.) pool, so idle clients are released before Fluid-compute functions suspend. — [Vercel docs – @vercel/functions](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- Vercel advises that a function's region "should match your database region". — [Vercel docs – debug slow functions](https://vercel.com/docs/functions/debug-slow-functions)

### Inferences
- **Lowest code change:** Turso/libSQL (`@libsql/client`) speaks SQLite SQL, so the existing schema and queries carry over. The client API is async, unlike the sync `node:sqlite` `DatabaseSync`, so call sites need `await`.
- **Most durable choice:** Neon Postgres in `aws-eu-central-1` (Frankfurt) with the Vercel function region set to `fra1`. That needs SQL dialect changes from SQLite. Alternatively, Supabase in `ap-south-1` with functions in `bom1` would also give Realtime (B3) in the same vendor.
- **Latency:** an application tier in Frankfurt or Mumbai adds tens of milliseconds for UAE users. That is negligible for lead alerts compared with SMS or push delivery.
- **Data residency:** none of these keeps data in the UAE, so the cross-border consent and contract approach in A1 applies.

### Gaps
- PlanetScale Postgres pricing and regions were not researched in this session.
- Turso region list (whether it offers Mumbai or Frankfurt) not confirmed.
- Neon and Supabase official pricing pages not opened; figures are from third-party summaries.

---

## B2. Webhook ingestion: fast 200, HMAC, idempotency, durable queue and retries (QStash, Vercel Queues, Inngest, Trigger.dev), backfill cron

### Takeaway
Use this pattern: verify the signature, persist the raw event with a unique key (idempotent upsert), enqueue, return 2xx in well under a few seconds, then process and alert asynchronously from a durable queue with retries. On Vercel in 2026 the native option is **Vercel Queues (public beta)**, which has built-in idempotency keys and a 24h–7d retention. QStash and Inngest are mature third-party alternatives with free tiers.

### Cited Findings
- **Vercel Queues:**
  - In **public beta** for all teams, no allow-listing (beta reported from about 27 Feb 2026). Still shown as a "BETA" usage SKU on the pricing page in July 2026.
  - Priced from **$0.60 per 1M operations**. Messages are metered in 4 KiB chunks. Sends with an idempotency key are billed 2x. Push-mode consumers are billed at Fluid compute rates.
  — [Vercel changelog](https://vercel.com/changelog/vercel-queues-now-in-public-beta); [Vercel queues skill (openai/plugins)](https://github.com/openai/plugins/blob/main/plugins/vercel/skills/vercel-queues/SKILL.md); [usagepricing.com](https://www.usagepricing.com/blueprint/vercel)
- **Vercel Queues send options:**
  - `retentionSeconds`: default 24h, min 60s, max 7 days.
  - `delaySeconds`.
  - `idempotencyKey`: deduplicates within min(retention, 24h), max 256 characters.
  - Queues are **regional** (for example `fra1.vercel-queue.com`), and messages sent to one region cannot be consumed from another.
  — [Vercel Queues SDK docs](https://vercel.com/docs/queues/sdk); [Vercel Queues API docs](https://vercel.com/docs/queues/api)
- **Upstash QStash:** free tier reported as 1,000 messages/day in 2026 sources (older sources say 500/day), 10 active schedules, 7-day max delay. Pay-as-you-go about $1 per 100K messages. Each retry attempt is billed as a message. — [agentdeals.dev](https://agentdeals.dev/vendor/qstash); [api-evangelist FinOps file](https://raw.githubusercontent.com/api-evangelist/qstash/refs/heads/main/finops/qstash-finops.yml); [buildmvpfast](https://www.buildmvpfast.com/alternatives/qstash); [apiscout](https://apiscout.dev/guides/upstash-qstash-vs-inngest-vs-aws-sqs-2026)
- **Inngest:** free plan about 50,000 runs/month, and retries count as runs. Pro reported at $25/month plus $0.40 per 1K runs. — [buildmvpfast – Inngest](https://www.buildmvpfast.com/alternatives/inngest); [apiscout](https://apiscout.dev/guides/upstash-qstash-vs-inngest-vs-aws-sqs-2026)
- **Vercel Cron:** jobs are defined in `vercel.json`/`vercel.ts` `crons` (production only) and secured with a `CRON_SECRET` sent as a Bearer token. Multiple schedules can target the same path, distinguished by the `x-vercel-cron-schedule` header. — [Vercel docs – manage cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs); [vercel.json reference](https://vercel.com/docs/project-configuration/vercel-json)
- **Payload limit:** a function's request or response body is limited to **4.5 MB**, and larger requests get 413 `FUNCTION_PAYLOAD_TOO_LARGE`. — [Vercel error docs](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)
- **Firewall rate limiting** in code is available via `checkRateLimit` from `@vercel/firewall` (useful to protect public webhook endpoints). — [Vercel WAF rate-limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk)

### Inferences (engineering recommendations; generic best practice, not separately sourced)
- Webhook handler steps:
  1. Read the raw body (do not JSON-parse before verifying).
  2. Verify the HMAC-SHA256 signature with a constant-time compare (for example Meta's `X-Hub-Signature-256`, or a per-source shared secret for website forms) and reject requests whose timestamp is older than about 5 minutes.
  3. `INSERT … ON CONFLICT (source, external_id) DO NOTHING` into `inbound_events`.
  4. Enqueue `{event_id}` with `idempotencyKey = source:external_id`.
  5. Return 200.
  Do not send SMS or push inside the request path.
- The current SQLite-in-`/tmp` design loses data on cold start or scale-out and is not shared across instances. It is incompatible with reliable ingestion, so B1 is a prerequisite.
- **Backfill or reconcile:**
  - On Pro, an every-5-minute cron that polls source APIs (for example Meta Lead Ads, portal APIs) for leads missed by webhooks.
  - On Hobby, cron frequency is limited (see Gaps), so use QStash schedules instead of Vercel Cron.
- Put the Queue region and function region next to the DB region (for example all `fra1`).

### Gaps
- Trigger.dev pricing and status were not researched.
- Vercel Queues retry and backoff semantics and dead-letter behaviour were not captured. Neither was a GA date (none found; still beta as of mid-2026).
- Hobby-plan cron limits (count and frequency) were not confirmed in this session. Prior knowledge, unverified: Hobby crons run at most once per day with imprecise timing.

---

## B3. Real-time updates to agents in a browser SPA; Web Push incl. iOS PWA

### Takeaway
Vercel functions cap connection lifetime (300s on Hobby, up to 800s on Pro), so SSE or long-polling from functions only works with frequent reconnects. Use a managed pub/sub service for in-app live updates: Ably's free tier is the most generous, Pusher has a free Sandbox, and Supabase Realtime comes with a Supabase DB. Add standard **Web Push** (VAPID plus service worker) for alerts when the tab is closed. On iOS, Web Push works only for sites the agent has **added to the Home Screen** (iOS/iPadOS 16.4+), with permission requested on a user gesture.

### Cited Findings
- **Function duration with Fluid compute:**
  - Hobby: 300s default and maximum.
  - Pro: 300s default, 800s maximum, and an opt-in 1800s (30 min) beta for Pro and Enterprise on Node.js and Python.
  - Fluid compute is the default for new projects since 23 Apr 2025.
  - **Conflict:** some third-party and legacy pages still cite 10s/60s Hobby limits, which apply only to non-Fluid functions.
  — [Vercel limits](https://vercel.com/docs/limits); [Vercel changelog – higher limits for Fluid compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute); [vercel.ts docs (fluid default date)](https://vercel.com/docs/project-configuration/vercel-ts); outdated: [TrueFoundry](https://www.truefoundry.com/blog/understanding-vercel-ai-gateway-pricing), [Vercel functions limitations (legacy)](https://vercel.com/docs/functions/limitations)
- **Ably:** free plan about 6M messages/month, 200 concurrent connections, 200 channels, no credit card. Standard $29/month, Pro $399/month. Usage meter about $2.50 per M messages, $1.00 per M connection-minutes, $1.00 per M channel-minutes (third-party). — [budgetforge.dev](https://www.budgetforge.dev/tools/ably-pricing-2026); [buildmvpfast – Pusher vs Ably](https://www.buildmvpfast.com/compare/pusher-vs-ably)
- **Pusher Channels:** free Sandbox reported at 100–200 concurrent connections, 200K messages/day, up to 100 channels. Startup about $49/month, Business about $299/month (third-party; sources vary). — [buildmvpfast – Pusher calculator](https://www.buildmvpfast.com/tools/api-pricing-estimator/pusher-channels); [buildmvpfast – realtime costs](https://www.buildmvpfast.com/api-costs/realtime); [Vendr](https://www.vendr.com/marketplace/pusher)
- **iOS Web Push:**
  - Supported for web apps **added to the Home Screen** on iOS/iPadOS **16.4+**; not available in a regular Safari tab.
  - The permission request must follow direct user interaction (for example a tap on "Enable alerts"); a prompt on page load is ignored.
  - A web app manifest is mandatory.
  - If the user denies permission, the Home Screen app must be removed and re-added before the prompt can appear again.
  — [WebKit blog](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); [Pushpad](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications); [OneSignal – Safari iOS](https://documentation.onesignal.com/docs/safari-web-push-for-ios); [OneSignal – requirements FAQ](https://documentation.onesignal.com/docs/web-push-setup-faq)

### Inferences
- **Recommended stack:**
  - The queue worker (B2) writes the lead.
  - It then publishes `lead.created` to Ably or Pusher on a private per-agent or per-team channel, using token auth issued by an AI-DATA API route.
  - The SPA subscribes and updates instantly.
  - In parallel, the worker sends Web Push via the `web-push` npm library with VAPID keys to every stored `PushSubscription` for the assigned agents, and deletes subscriptions that return 404/410.
- **Free-tier scale:** 200 concurrent connections (Ably free) comfortably covers a small brokerage's agents.
- **Onboarding UX for iPhone agents:** "Share → Add to Home Screen", then open the app from the Home Screen icon and tap "Enable lead alerts". Android Chrome and desktop do not need installation.
- **Fallback without a vendor:** an SSE endpoint with `maxDuration` 300s plus client auto-reconnect and a `?since=` cursor, plus 15–30s polling. This works but burns function time.

### Gaps
- Supabase Realtime and Liveblocks pricing not researched. Liveblocks targets collaborative state rather than notifications and is likely unnecessary.
- Declarative Web Push (Safari/iOS 18.4+) was not verified in this session.
- Official Ably and Pusher pricing pages not opened; figures are from third-party aggregators.

---

## B4. Instant alerting channels: SMS in UAE, email, WhatsApp utility templates

### Takeaway
SMS to UAE numbers needs a sender ID registered with both e& and du. Promotional traffic uses the "AD-" prefix and a TDRA consent list, while internal agent alerts are transactional. Email and WhatsApp provider specifics were not researched here (WhatsApp is covered by another researcher).

### Cited Findings
- Sender IDs must be registered with **e& and du** separately and match the company name. Unregistered or numeric sender IDs are blocked. Promotional SMS must use "AD-". Approval times are reported from 5–10 business days to 2–4 weeks. — [Telerivet](https://www.telerivet.com/blog/uae-sms-compliance-tdra-ad-prefix); [sent.dm](https://www.sent.dm/resources/ae-sms-guidance); [Clickatell](https://www.clickatell.com/sms-country-regulations/united-arab-emirates-uae/); [Wildix docs](https://wildix.atlassian.net/wiki/x/VQHOAQ)
- Promotional SMS without a consent list in TDRA's CMS is reportedly not delivered but still charged. — [D7 Networks](https://d7networks.com/blog/the-regulations-for-sending-sms-in-uae/)
- International sender IDs cost about USD 40/month each (vendor). — [MessageCentral](https://www.messagecentral.com/sms-guideline/uae)
- Res. 56/2024 covers marketing messages via social-media apps (which, per its plain wording, would include WhatsApp marketing to consumers). — [Clyde & Co](https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne)

### Inferences
- **Channel priority for agent alerts:**
  1. Web Push plus in-app realtime (free, instant).
  2. WhatsApp utility template to the agent (who has opted in as staff).
  3. SMS fallback via a provider with UAE sender-ID support (for example Twilio, Unifonic or Infobip), using a registered transactional sender ID. Budget weeks for registration.
  4. Email (for example Resend or Postmark) as a durable record.
- **Escalation:** if the lead is not acknowledged within N minutes, re-alert or reassign. This also supports the "call within working hours" constraint.
- **Customer-facing auto-replies** to the lead are consumer communications. Keep them transactional (acknowledging their own request) and within the consent captured.

### Gaps
- Twilio, Unifonic and Infobip UAE pricing and sender-ID processes were not researched individually.
- Resend, SendGrid and Postmark pricing were not researched.
- Whether TDRA classifies an "enquiry acknowledgement" SMS to a lead as promotional (AD-) or transactional: no source found.

---

## B5. Vercel plan limits relevant here: Hobby commercial restriction, duration, body size, Deployment Protection and webhooks, regions (dxb1)

### Takeaway
AI-DATA is a commercial product, and **Hobby is restricted to non-commercial, personal use**, so it should run on Pro. A **Dubai region (dxb1, on AWS me-central-1)** exists for Functions but had a multi-AZ outage in March 2026 and reports of being "currently unavailable" in October 2026. Use `fra1` (or `bom1`) co-located with the database. Standard Deployment Protection covers previews and generated production URLs but not the production custom domain, so point webhooks at the custom domain, or use Protection Bypass for Automation for previews.

### Cited Findings
- **Commercial use:** "the Hobby plan restricts users to non-commercial, personal use only". — [Vercel Hobby plan docs](https://vercel.com/docs/plans/hobby)
- **Durations:** Hobby 300s (default and max); Pro 300s default, 800s max, 1800s beta. — [Vercel limits](https://vercel.com/docs/limits); [Vercel changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)
- **Body size:** 4.5 MB request or response, returning 413 when exceeded. — [Vercel error docs](https://vercel.com/docs/errors/FUNCTION_PAYLOAD_TOO_LARGE)
- **Regions:**
  - Functions default to `iad1`. Hobby can select any single region; Pro and Enterprise can deploy to multiple regions.
  - `functionFailoverRegions` is Enterprise-only.
  — [vercel.ts docs](https://vercel.com/docs/project-configuration/vercel-ts); [Vercel – configuring function region](https://vercel.com/docs/functions/configuring-functions/region)
- **dxb1 (Dubai):**
  - Vercel introduced a Dubai Functions region (`dxb1`) on AWS `me-central-1`, supporting Fluid compute, aimed at the Middle East, Africa and Central Asia. It is not a default region.
  — [Vercel changelog – dxb1](https://vercel.com/changelog/introducing-the-dubai-vercel-region-dxb1); [comparedge](https://comparedge.com/tools/vercel/deployment-regions)
- **dxb1 outage, March 2026:**
  - From about 2 Mar 2026, dxb1 invocations and deployments failed, and Vercel rerouted traffic to `bom1`.
  - dxb1 was excluded from deployment targets for builds using Middleware or Edge, which affected projects outside the region.
  - Guillermo Rauch described a "full blown, multi-AZ outage", "possibly first ever of its kind … from a non-software root cause".
  - Sources conflict on duration: about 14 days versus same-day restoration.
  — [isdown.app](https://isdown.app/status/vercel/incidents/545104-dubai-region-dxb1-is-unavailable); [Rauch on X](https://x.com/rauchg/status/2028480284753375395); [autosmoke.dev](https://www.autosmoke.dev/blog/vercel-dubai-datacenter-outage-march-2026)
- **dxb1 in October 2026:** a GitHub PR dated 2 Oct 2026 reports the deploy error "region dxb1 is currently unavailable. Please select a different region". The Vercel status page has at other times shown DXB1 Operational. — [GitHub PR](https://github.com/xpexellent-dotcom/msrc-2027/pull/13); [Vercel Status](https://www.vercel-status.com/)
- **Deployment Protection:**
  - Vercel Authentication modes: `prod_deployment_urls_and_all_previews` (Standard Protection), `all`, `preview`.
  - With Standard Protection the production *generated* deployment URL is restricted, so code should use relative paths or the actual custom domain.
  — [Vercel Authentication docs](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication); [Deployment Protection docs](https://vercel.com/docs/deployment-protection)
- **Protection Bypass for Automation:** secrets are 32 alphanumeric characters and can be exposed as the `VERCEL_AUTOMATION_BYPASS_SECRET` env var. — [Vercel REST – update protection bypass](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation)

### Inferences
- Register third-party webhooks (Meta, portals, website forms) against the **production custom domain**, for example `https://app.ai-data.ae/api/webhooks/meta`, which Standard Protection does not gate. Never use `*.vercel.app` deployment URLs. For preview testing, append the automation-bypass secret header or query parameter, which the sender must support.
- **Region choice:**
  - Pin functions to `fra1` with Neon or Supabase in Frankfurt, or `bom1` with Supabase Mumbai.
  - Avoid `dxb1` as the sole region until its stability is proven, since multi-region failover is Enterprise-only.
  - If dxb1 is used, the DB must be near it, but no confirmed managed serverless DB exists in `me-central-1` (B1).
- On Pro, the 4.5 MB body limit is irrelevant for lead JSON. Attachments such as ID scans must go directly to Blob or S3.

### Gaps
- Exact Pro plan price and Hobby cron limits were not verified in this session (vercel.com could not be fetched directly).
- dxb1's live status as of 30 Oct 2026 was not established.
- Whether Vercel requires a Pro plan for Vercel Queues, or for more than one region with Queues, was not determined.
