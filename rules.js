"use strict";

/* ===================================================== rules.js
   Default rule pack, initial app state, and the local login /
   session / audit-trail accountability layer.                    */

/* =========================================================== RULES PACK
   Every threshold in the source document lives here. Nothing is hard-coded
   in the engines. Changes are effective-dated, maker-checker-approver, and
   never rewrite a locked period.
   ==================================================================== */
function defaultRules() {
  return {
    ruleVersion: APP.ruleVersion,
    effectiveDate: "2026-01-01",
    approvalState: "PENDING_APPROVAL",
    maker: "", checker: "", approver: "",

    /* --- IV. Performance, aging, delinquency ------------------------- */
    curingDays: 30,                       // "MUST INCLUDE THE 30 DAYS CURING PERIOD"
    curingPaymentsRequired: 0,            // set >0 if RBCCI adopts a payments-made cure rule (D-04)
    nplDpdThreshold: 91,                  // past-due performing -> NPL
    agingBands: [
      { min: 0,    max: 0,      label: "Current" },
      { min: 1,    max: 30,     label: "001-030 Days" },
      { min: 31,   max: 60,     label: "031-060 Days" },
      { min: 61,   max: 90,     label: "061-090 Days" },
      { min: 91,   max: 120,    label: "091-120 Days" },
      { min: 121,  max: 180,    label: "121-180 Days" },
      { min: 181,  max: 365,    label: "181-365 Days" },
      { min: 366,  max: 1825,   label: "Over 1 to 5 Years" },
      { min: 1826, max: 999999, label: "Over 5 Years" }
    ],

    /* --- V. Impairment and ACL -------------------------------------- */
    gllpRate: 0.01,
    smallLoanThreshold: 150000,           // instruction: "less than 150,000 loan"
    smallLoanMinimumAcl: 1500,            // instruction: "threshold of P1,500"
    smallLoanFloorEnabled: true,
    suppressFloorOnMemo: true,            // do not provision written-off / P1 memo accounts
    /* The raw core-banking export carries a provision rate per account but no
       booked provision amount. Where that is so, the booked allowance is
       derived as rate x outstanding balance and marked as derived wherever it
       is shown. Switch off if the bank's booked provision comes from the
       general ledger instead and should not be inferred from the extract. */
    deriveBookedAclFromRate: true,
    /* V-SEC-01 escalation. A secured booking with no appraisal becomes a
       blocking finding once an account is this far past due, except on
       accounts holding no recognised receivable, where there is nothing left
       to secure and the block would prevent any period being certified. */
    securedEvidenceBlockDpd: 90,
    suppressSecuredEvidenceBlockOnMemo: true,
    aclUnsecured: [
      { min: 0,    max: 0,      cls: "Pass",                            rate: 0.01, stage: 1, note: "GLLP floor or approved Stage 1 ECL, whichever is higher." },
      { min: 1,    max: 30,     cls: "Especially Mentioned",            rate: 0.05, stage: 2, note: "Early weakness; management monitoring required." },
      { min: 31,   max: 90,     cls: "Substandard - Underperforming",   rate: 0.10, stage: 2, note: "Specific allowance; verify repayment plan." },
      { min: 91,   max: 120,    cls: "Substandard - Non-Performing",    rate: 0.25, stage: 3, note: "NPL / Stage 3 unless an approved contrary basis exists." },
      { min: 121,  max: 180,    cls: "Doubtful",                        rate: 0.50, stage: 3, note: "Severe weakness; collection highly improbable." },
      { min: 181,  max: 999999, cls: "Loss",                            rate: 1.00, stage: 3, note: "Full allowance; write-off / legal recovery tracking." }
    ],
    aclSecured: [
      { min: 0,    max: 0,      cls: "Pass",                          rate: 0.01, stage: 1, note: "Collateral complete; normal monitoring." },
      { min: 1,    max: 30,     cls: "Especially Mentioned",          rate: 0.05, stage: 2, note: "Verify collateral documents remain valid." },
      { min: 31,   max: 90,     cls: "Substandard - Underperforming", rate: 0.10, stage: 2, note: "Flag defective or stale collateral." },
      { min: 91,   max: 180,    cls: "Substandard - Non-Performing",  rate: 0.10, escalated: 0.25, trigger: "foreclosureImminent", stage: 3, note: "10% only when collateral is perfected, liquid and recoverable; 25% when foreclosure or loss is imminent." },
      { min: 181,  max: 365,    cls: "Substandard - Non-Performing",  rate: 0.25, stage: 3, note: "Specific allowance; remedial / legal action required." },
      { min: 366,  max: 1825,   cls: "Doubtful",                      rate: 0.50, stage: 3, note: "Foreclosure / recovery status must be documented." },
      { min: 1826, max: 999999, cls: "Loss",                          rate: 1.00, stage: 3, note: "Full allowance unless a supported recoverable portion is approved." }
    ],
    securedRatesRequireCollateral: true,  // no appraisal evidence -> price as unsecured

    /* --- V.A Internal credit-risk rating tiers (R13) ------------------ */
    riskTierEffectiveDate: "2026-01-01",
    riskTierApprovalState: "PENDING_APPROVAL",
    riskTiers: [
      { code: "1", label: "Excellent",     min: 90,  max: 100, desc: "Superior capacity to meet obligations; minimal risk.",              approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "2", label: "Strong",        min: 80,  max: 89,  desc: "Strong capacity; low risk with normal monitoring.",                  approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "3", label: "Good",          min: 70,  max: 79,  desc: "Adequate capacity; acceptable risk, ordinary monitoring.",           approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "4", label: "Satisfactory",  min: 60,  max: 69,  desc: "Some vulnerability to adverse conditions; watch list candidate.",    approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "5", label: "Watchlist",     min: 50,  max: 59,  desc: "Emerging weakness; increased monitoring frequency required.",        approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "6", label: "Substandard",   min: 40,  max: 49,  desc: "Well-defined weakness; repayment source under pressure.",            approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "7", label: "Doubtful",      min: 20,  max: 39,  desc: "Collection or liquidation in full is highly questionable.",          approvalStatus: "APPROVED", effectiveDate: "2026-01-01" },
      { code: "8", label: "Loss",          min: 0,   max: 19,  desc: "Considered uncollectible; continuance as a bankable asset unwarranted.", approvalStatus: "APPROVED", effectiveDate: "2026-01-01" }
    ],

    /* --- II.A Housing thresholds (DHSUD / JMC 2025-001) -------------- */
    housingHorizontal: [
      { max: 950000,  cls: "Socialized Housing" },
      { max: 2500000, cls: "Economic Housing" },
      { max: 4900000, cls: "Low-Cost Housing" },
      { max: 6600000, cls: "Medium-Cost Housing" },
      { max: Infinity, cls: "Open-Market / Other Housing" }
    ],
    housingVertical: [
      { max: 1800000, cls: "Socialized Vertical / Condominium Housing" },
      { max: 2500000, cls: "Economic Housing" },
      { max: 4900000, cls: "Low-Cost Housing" },
      { max: 6600000, cls: "Medium-Cost Housing" },
      { max: Infinity, cls: "Open-Market / Other Housing" }
    ],

    /* --- VI. AFRD ---------------------------------------------------- */
    afrdRate: 0.25,
    afrdDenominator: "TOTAL_LOANABLE_FUNDS",  // statute: 25% of total loanable funds
    totalLoanableFunds: 0,                    // entered on the AFRD screen
    acpcAfrdEligible: false,                  // hard rule: always zero

    /* --- VII. Government programs ------------------------------------ */
    sbcorpRetainedDefault: 0.10,   // RBCCI 10% share; ACL basis only if the agreement transfers risk
    sbcorpRiskTransferConfirmed: false,
    acpcScope: "FINAL_CONTROLLING_RULE",  // or EARLIER_SECTION_2_2
    acpcRetainedRisk: 0,

    /* --- Report scope profiles (source conflict held, not erased) ----- */
    profiles: {
      FINAL_CONTROLLING_RULE: {
        label: "Final Controlling Rule (default)",
        text: "ACPC-funded loans are excluded from the ordinary loan portfolio, agricultural product, performance, impairment and ACL reports. ACPC and SBCorp collection is reported separately. AFRD eligibility is always zero.",
        acpcInPortfolio: false, acpcInProduct: false, acpcInPerformance: false, acpcInAcl: false
      },
      EARLIER_SECTION_2_2: {
        label: "Section 2.2 (earlier instruction)",
        text: "ACPC-funded loans remain included in the gross loan portfolio, product and agricultural reports, performance and aging, ACL and impairment, collection and remedial, government-funded and FRP reports. Only AFRD eligibility is zero.",
        acpcInPortfolio: true, acpcInProduct: true, acpcInPerformance: true, acpcInAcl: true
      }
    },

    /* --- X. Memorandum / ROPA ---------------------------------------- */
    memoBalance: 1,                 // P1 memorandum account marker
    ropaLeavesPortfolio: true,      // source X: ROPA is removed from the loan portfolio
    writeOffLeavesPortfolio: true,  // written off = removed from recognised receivables

    /* --- Collection & remedial (spec section 4) -----------------------
       Action types, PTP states, action statuses and letter templates are
       all configuration, not code. Templates use {{token}} placeholders
       resolved against the loan register at generation time, so borrower
       and loan details are never re-keyed.                               */
    collectionActionTypes: [
      { code: "CONTACT", label: "Contact / call" },
      { code: "VISIT",   label: "Field visit" },
      { code: "LETTER",  label: "Letter issued" },
      { code: "DEMAND",  label: "Demand letter" },
      { code: "PTP",     label: "Promise to pay" },
      { code: "RESTRUCTURE", label: "Restructuring discussion" },
      { code: "LEGAL",   label: "Legal action" },
      { code: "OTHER",   label: "Other" }
    ],
    /* PTP now has an explicit lifecycle instead of two loose booleans.
       OPEN and ACTIVE are outstanding commitments; KEPT and COMPLETED are
       satisfied; BROKEN and CANCELLED are closed without payment. */
    ptpStates: [
      { code: "PENDING",   label: "Pending",   open: true,  tag: "t-mute" },
      { code: "ACTIVE",    label: "Active",    open: true,  tag: "t-warn" },
      { code: "KEPT",      label: "Kept",      open: false, tag: "t-ok" },
      { code: "BROKEN",    label: "Broken",    open: false, tag: "t-bad" },
      { code: "COMPLETED", label: "Completed", open: false, tag: "t-ok" },
      { code: "CANCELLED", label: "Cancelled", open: false, tag: "t-mute" }
    ],
    actionStatuses: [
      { code: "OPEN",        label: "Open",        tag: "t-warn" },
      { code: "IN_PROGRESS", label: "In progress", tag: "t-info" },
      { code: "COMPLETED",   label: "Completed",   tag: "t-ok" },
      { code: "CANCELLED",   label: "Cancelled",   tag: "t-mute" }
    ],
    letterTemplates: defaultLetterTemplates(),

    /* --- AFRD qualifying investments (spec sections 5 and 6) ----------
       Investment types and AFRD classifications are configuration. The
       eligibility states are deliberately NOT free text: the specification
       is explicit that merely recording an investment must not make it
       AFRD-compliant, so only an investment explicitly validated into the
       ELIGIBLE state contributes to the numerator, and that transition is
       recorded with who validated it and against what reference.          */
    afrdInvestmentTypes: [
      { code: "LBP",   label: "Land Bank bonds / investments" },
      { code: "DBP",   label: "DBP bonds / investments" },
      { code: "OTHER", label: "Other qualifying bonds / investments" }
    ],
    afrdInvestmentClasses: [
      { code: "AGRI",    label: "Agricultural credit" },
      { code: "FISH",    label: "Fisheries credit" },
      { code: "AGRARIAN", label: "Agrarian reform credit" },
      { code: "GREEN",   label: "Green / sustainable financing instrument" },
      { code: "UNCLASSIFIED", label: "Not yet classified" }
    ],
    afrdEligibilityStates: [
      { code: "PENDING",    label: "Pending validation", eligible: false, tag: "t-warn" },
      { code: "ELIGIBLE",   label: "Validated eligible", eligible: true,  tag: "t-ok" },
      { code: "PARTIAL",    label: "Partially eligible", eligible: true,  tag: "t-info" },
      { code: "INELIGIBLE", label: "Not eligible",       eligible: false, tag: "t-bad" }
    ],

    /* --- AFRD financed-activity rules (RBCCI AFRD review, section 2) ---
       Loan Economic Activity is the authoritative classifier. Each rule
       matches on lower-cased substrings of that field, so it survives minor
       wording changes in the core banking export. Order matters: the first
       match wins. Editable on the Parameters screen, because the activity
       list is a bank and regulator decision, not a coding one.            */
    afrdActivityRules: [
      { category: "AGRI",     label: "Agriculture, forestry and fishing", eligible: true,
        match: ["agriculture", "forestry", "fishing", "fisher", "crop", "livestock", "poultry", "aqua", "farm"] },
      { category: "AGRARIAN", label: "Agrarian reform beneficiaries", eligible: true,
        match: ["agrarian"] },
      { category: "RURAL",    label: "Rural development activity", eligible: true,
        match: ["rural development"] },
      { category: "AGRI_VALUE", label: "Agricultural value chain", eligible: true,
        match: ["agri-processing", "agri processing", "food processing", "agribusiness"] }
    ],
    /* Values the core banking export writes when the activity was never
       captured. They are placeholders, not a finding that the loan is
       non-agricultural, so they route to review rather than to ineligible.
       Treating "None" as a decision would silently exclude loans that may
       well qualify. */
    afrdActivityPlaceholders: ["none", "n/a", "na", "-", "--", "not applicable", "unknown", "null"],
    /* When true, an account manually marked eligible must also carry a
       document reference. Activity-based classification is unaffected. */
    afrdRequireEvidence: true,

    /* --- AFRD, RBCCI review V2 ------------------------------------------
       Three data streams feed one compliance engine:
         A  loan classification, from the loan report
         B  total loanable funds, from the financial/AFRD source schedule
         C  eligible investments, from the investment ledger
       Streams B and C do not come from the loan file and never can, which is
       why each carries its own source and reconciliation fields.            */

    /* Beneficiary and priority-sector treatment. The multiplier is stored on
       the account rather than inferred, because it is a regulatory parameter
       that changes independently of the software. */
    afrdBeneficiaryTypes: [
      { code: "ARB",   label: "Agrarian reform beneficiary", priority: true },
      { code: "ARC",   label: "Agrarian reform community", priority: true },
      { code: "SF",    label: "Small farmer or fisherfolk", priority: true },
      { code: "OTHER_PRIORITY", label: "Other recognised priority sector", priority: true },
      { code: "GENERAL", label: "General agricultural borrower", priority: false },
      { code: "",      label: "Not recorded", priority: false }
    ],
    afrdDefaultMultiplier: 1,
    afrdPriorityMultiplier: 1,   /* set by regulation; 1 until RBCCI confirms */
    /* Funding sources that cannot be counted towards AFRD because the funds
       did not originate from the bank's own loanable funds. */
    afrdFundingSources: [
      { code: "OWN",     label: "Bank's own loanable funds", countable: true },
      { code: "ACPC",    label: "ACPC-funded", countable: false },
      { code: "SBCORP",  label: "SB Corporation", countable: false },
      { code: "REDISCOUNT", label: "Rediscounted with another institution", countable: false },
      { code: "OTHER_GOVT", label: "Other government programme funds", countable: false },
      { code: "",        label: "Not determined", countable: false }
    ],
    /* Instrument categories and where each is reported. Schedule B-1 feeds
       Schedule B; Schedule B carries into the compliance numerator. */
    afrdInstrumentCategories: [
      { code: "AGRI_DEBT",  label: "AFRD-specific / agricultural debt security (DBP, LBP)",
        schedule: "B-1", line: "Investments in debt securities issued by DBP/LBP" },
      { code: "GREEN",      label: "Green / sustainable finance instrument",
        schedule: "B-1", line: "Investments in sustainable finance instruments" },
      { code: "OTHER_DEBT", label: "Other AFRD-specific debt security",
        schedule: "B-1", line: "Other debt securities, AFRD-exclusive purpose established" },
      { code: "DEPOSIT",    label: "Eligible deposit or placement",
        schedule: "B",   line: "Eligible investments and deposits" }
    ],
    afrdSustainableStandards: ["ASEAN Green Bond Standards", "ASEAN Social Bond Standards",
      "ASEAN Sustainability Bond Standards", "ICMA Green Bond Principles",
      "ICMA Social Bond Principles", "ICMA Sustainability Bond Guidelines",
      "SEC Sustainable Finance Framework", "Other / internal framework"],
    /* A final regulatory output may not be produced while material items are
       unresolved. Draft output may. */
    afrdMaterialityThreshold: 100000,
    afrdBlockFinalOnUnresolved: true,

    /* --- Storage ------------------------------------------------------ */
    minFreeBytes: 50 * 1024 * 1024,

    /* --- Render capacity (spec section 1 and 8) -----------------------
       These were hard-coded slice() limits scattered across views.js and
       events.js. They are display ceilings only — every computation runs
       over the full population regardless of what is rendered. 1,000 is
       the stated minimum operating capacity, so the defaults sit above
       it and are editable from Parameters. Set any of them to 0 for no
       ceiling at all.                                                     */
    renderLimits: {
      register:   5000,
      acl:        5000,
      collateral: 5000,
      housing:    5000,
      programs:   5000,
      remedial:   5000,
      afrd:       5000
    },
    /* Raise a visible exception whenever source rows and register rows
       disagree. Spec section 7: "Any difference between source record
       count and Loan Register record count must automatically generate a
       visible exception."                                                 */
    reconcileIntake: true
  };
}
/* Display ceiling for a screen. 0 or missing means render everything. */
function renderLimit(screen) {
  const n = ((S.rules || {}).renderLimits || {})[screen];
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}
const capRows = (rows, screen) => {
  const n = renderLimit(screen);
  return n === Infinity ? rows : rows.slice(0, n);
};

/* ------------------------------------------------------------ app state */
function initialState() {
  return {
    schema: 1,
    year: new Date().getFullYear(),
    view: "M",
    period: "M" + String(new Date().getMonth() + 1).padStart(2, "0"),
    cutoff: today(),
    screen: "dashboard",
    rules: defaultRules(),
    accounts: [],
    imports: [],
    overrides: {},           // accountKey -> {field, from, to, reason, maker, checker, approver, date}
    manual: {},              // accountKey -> manually captured fields not in the core extract
    workflow: {},            // periodKey -> {status, maker, checker, approver, lockedAt, hash}
    reconciliation: {},      // periodKey -> movement figures
    intake: {},              // periodKey -> {sourceRows, parsed, blank, noKey, duplicates, imported, files:[]}
    contractVersions: {},    // accountKey -> [{id, ts, eventType, effectiveDate, originalTerms, newTerms, concessions, moratorium, cureDate, paymentsSinceEvent, reDefault, evidenceRef, approver}]
    collectionActions: {},   // accountKey -> [{id, ts, type, officer, contactResult, ptpAmount, ptpDate, ptpStatus, nextAction, targetDate, status, remarks, cost, recovery, legalCaseRef, notes}]
    remedialFilter: "ALL",
    securityTab: "ALL",       // secured / unsecured view on aging, ACL and collateral
    afrdInvestments: [],     // manually encoded qualifying investments (spec section 5)
    afrdTlf: null,           // Stream B: total loanable funds with its own source record
    letters: {},             // accountKey -> [{id, ts, templateId, templateName, category, ref, issuedBy, format}]
    audit: [],
    role: "Maker",
    users: [],                // {username, passHash, passSalt, role, active, displayName, createdAt, failedAttempts, lockUntil}
    filter: null
  };
}
let S = initialState();

/* --------------------------------------------- password recovery questions
   There is no server here, so there is no address to send a reset link to.
   Security questions are the one recovery mechanism that works entirely
   offline and that a non-technical user can actually use: nothing to print,
   nothing to keep in a safe, nothing to lose.

   The trade-off is stated plainly rather than hidden. Answers are hashed
   with the same PBKDF2 used for passwords, so the stored state does not
   reveal them, and attempts share the account lockout. But an answer that
   a colleague could guess protects nothing, which is why the setup screen
   says so and recommends answers that are not publicly knowable. On a
   machine the bank does not control, this is a convenience feature, not a
   defence — the same caveat that already applies to the login itself. */
const SECURITY_QUESTION_BANK = [
  "In which town or city were you born?",
  "What was the name of your first school?",
  "What is your mother's maiden name?",
  "What was the name of your first pet?",
  "What is the name of your favourite childhood teacher?",
  "On which street did you live as a child?",
  "What was the make of your first vehicle?",
  "What is your father's middle name?"
];
const REQUIRED_SECURITY_QUESTIONS = 2;
/* Case and surrounding spaces are ignored: an answer typed months later
   should not fail because it was capitalised differently. */
const normaliseAnswer = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

async function setSecurityQuestions(u, pairs) {
  const out = [];
  for (const p of pairs) {
    const { hash, salt } = await PwHash.hash(normaliseAnswer(p.answer));
    out.push({ question: p.question, answerHash: hash, answerSalt: salt });
  }
  u.securityQuestions = out;
  u.securityQuestionsSetAt = new Date().toISOString();
}
async function verifySecurityAnswers(u, answers) {
  const qs = (u && u.securityQuestions) || [];
  if (qs.length < REQUIRED_SECURITY_QUESTIONS) return false;
  if (answers.length !== qs.length) return false;
  /* Every answer is checked even after one fails, so the time taken does
     not reveal which one was wrong. */
  let ok = true;
  for (let i = 0; i < qs.length; i++) {
    const match = await PwHash.verify(normaliseAnswer(answers[i]), qs[i].answerSalt, qs[i].answerHash);
    if (!match) ok = false;
  }
  return ok;
}
const hasSecurityQuestions = u => !!(u && (u.securityQuestions || []).length >= REQUIRED_SECURITY_QUESTIONS);

/* ---------------------------------------------------------------- AUTH
   Local, client-side login. This is an accountability control — it records
   who did what in the audit trail and enforces basic segregation of duties
   in the UI. It is NOT network authentication: anyone with access to this
   browser profile and the vault can, in principle, edit the stored user
   list. Real security still depends on controlling the device, the OS
   account and the browser profile (see Administration).

   Passwords are hashed with PwHash (core.js) — PBKDF2, 250,000 iterations,
   a random salt per user — the same primitive already used for the vault's
   own encryption key. A handful of accounts created before this existed may
   still carry an old-style unsalted single-round SHA-256 passHash with no
   passSalt; verifyPassword() checks that case too and silently upgrades the
   record to the salted hash on the next successful login, so nothing needs
   a manual migration.

   IDLE_TIMEOUT_MS logs a session out automatically after inactivity.
   LOCKOUT_THRESHOLD / LOCKOUT_MS throttle repeated failed logins per
   account instead of only logging them. */
let CURRENT_USER = null;
const SESSION_KEY = "rbcci-lpmrs-session";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
async function sha256Str(s) { return sha256(new TextEncoder().encode(s)); }
async function setUserPassword(u, plainPassword) {
  const { hash, salt } = await PwHash.hash(plainPassword);
  u.passHash = hash; u.passSalt = salt;
}
async function verifyPassword(u, plainPassword) {
  if (u.passSalt) return PwHash.verify(plainPassword, u.passSalt, u.passHash);
  /* Pre-existing account from before salted hashing: fall back to the old
     unsalted check, then upgrade it so this branch is never hit again for
     this user. */
  const legacyOk = (await sha256Str(plainPassword)) === u.passHash;
  if (legacyOk) await setUserPassword(u, plainPassword);
  return legacyOk;
}
function findUser(username) {
  const u = String(username || "").trim().toLowerCase();
  return S.users.find(x => x.username.toLowerCase() === u);
}
async function ensureSeedUser() {
  if (S.users.length) return;
  const seed = { username: "admin", displayName: "Administrator", role: "Administrator",
    active: true, createdAt: today(), mustChangePassword: true, failedAttempts: 0, lockUntil: "" };
  await setUserPassword(seed, "admin123");
  S.users.push(seed);
}
function restoreSession() {
  let raw = null;
  try { raw = sessionStorage.getItem(SESSION_KEY); } catch (e) {}
  if (!raw) return false;
  const u = findUser(raw);
  if (!u || !u.active) { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} return false; }
  CURRENT_USER = u; S.role = u.role;
  if (typeof startIdleTimer === "function") startIdleTimer();
  return true;
}
function startSession(u) {
  CURRENT_USER = u; S.role = u.role;
  try { sessionStorage.setItem(SESSION_KEY, u.username); } catch (e) {}
  if (typeof startIdleTimer === "function") startIdleTimer();
}
function endSession(reason) {
  const who = CURRENT_USER ? CURRENT_USER.username : "";
  if (who) audit(reason === "idle" ? "Logged out (inactivity)" : "Logged out", who);
  saveState();
  CURRENT_USER = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  if (typeof stopIdleTimer === "function") stopIdleTimer();
  /* returnToLoginScreen (events.js) swaps straight to the login screen
     without a page reload, so there's nothing for a service worker, cache,
     or slow in-flight save to delay. Fall back to a reload only if it's
     somehow unavailable. */
  if (typeof returnToLoginScreen === "function") returnToLoginScreen(reason === "idle" ? "You were logged out after 15 minutes of inactivity." : null);
  else location.reload();
}
/* Route/module access by role. null = every screen. */
const ROLE_ACCESS = {
  Administrator: null,
  Approver: ["dashboard","register","performance","acl","creditrisk","collateral","housing","afrd","programs","dosri","remedial","validation","reconcile","reports"],
  Checker:  ["dashboard","register","performance","acl","creditrisk","collateral","housing","afrd","programs","dosri","remedial","validation","reconcile","reports"],
  Maker:    ["dashboard","register","performance","acl","creditrisk","collateral","housing","afrd","programs","dosri","remedial","import","validation","reconcile","reports"]
};
function canAccess(screen) {
  if (!CURRENT_USER) return false;
  const list = ROLE_ACCESS[CURRENT_USER.role];
  return !list || list.includes(screen);
}

const periodKey = () => `${S.year}-${S.view === "A" ? "FY" : S.period}`;
const wf = () => (S.workflow[periodKey()] = S.workflow[periodKey()] || { status: "DRAFT", maker: "", checker: "", approver: "", lockedAt: "" });
const isLocked = () => wf().status === "LOCKED";
const activeProfile = () => S.rules.profiles[S.rules.acpcScope] || S.rules.profiles.FINAL_CONTROLLING_RULE;

function audit(action, detail) {
  S.audit.unshift({ ts: new Date().toISOString(), user: CURRENT_USER ? CURRENT_USER.username : "system", role: S.role, action, detail: detail || "" });
  if (S.audit.length > 4000) S.audit.length = 4000;
  Vault.put(`audit/${today()}.ndjson`, S.audit.slice(0, 500).map(a => JSON.stringify(a)).join("\n")).catch(() => {});
}

async function saveState() {
  const payload = JSON.stringify(S);
  const okv = await Vault.put(`loanbook/${periodKey()}/draft.json`, payload).catch(() => false);
  try { localStorage.setItem("rbcci-lpmrs-state", payload); } catch (e) {}
  return okv;
}
/* Infinity does not survive JSON, so the open-ended housing ceiling comes
   back as null and has to be reinstated on load. Shared by both loadState
   definitions below. */
function restoreHousingCeilings(p) {
  const d = defaultRules();
  S.rules.housingHorizontal = d.housingHorizontal.map((b, i) => Object.assign(b, (p.rules?.housingHorizontal || [])[i] ? { max: (p.rules.housingHorizontal[i].max === null ? Infinity : p.rules.housingHorizontal[i].max) } : {}));
  S.rules.housingVertical = d.housingVertical.map((b, i) => Object.assign(b, (p.rules?.housingVertical || [])[i] ? { max: (p.rules.housingVertical[i].max === null ? Infinity : p.rules.housingVertical[i].max) } : {}));
}

async function loadState() {
  let raw = null;
  try { raw = localStorage.getItem("rbcci-lpmrs-state"); } catch (e) {}
  if (!raw) raw = await Vault.get(`loanbook/${periodKey()}/draft.json`);
  if (!raw) return false;
  try {
    const p = JSON.parse(raw);
    S = Object.assign(initialState(), p);
    S.rules = Object.assign(defaultRules(), p.rules || {});
    restoreHousingCeilings(p);
    /* Correspondence templates are persisted configuration, so control
       fields added in a later build have to be migrated into rule sets
       that already exist rather than only appearing on fresh installs. */
    const migrated = (typeof migrateLetterTemplates === "function") ? migrateLetterTemplates() : 0;
    if (migrated) audit("Migrated letter templates", migrated + " template(s) updated to schema " + LETTER_TPL_SCHEMA);
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------ encryption-aware persistence */
/* Overrides the saveState/loadState above once core.js's Crypt module is
   available, so state is transparently encrypted at rest when configured. */
saveState = async function () {
  const payload = await Crypt.encrypt(JSON.stringify(S));
  const okv = await Vault.put("loanbook/" + periodKey() + "/draft.json", payload).catch(() => false);
  try { localStorage.setItem("rbcci-lpmrs-state", payload); } catch (e) {}
  return okv;
};
loadState = async function () {
  let raw = null;
  try { raw = localStorage.getItem("rbcci-lpmrs-state"); } catch (e) {}
  if (!raw) raw = await Vault.get("loanbook/" + periodKey() + "/draft.json");
  if (!raw) return false;
  try {
    if (String(raw).startsWith("ENC1:")) {
      if (!Crypt.on) return "locked";
      raw = await Crypt.decrypt(raw);
    }
    const p = JSON.parse(raw);
    S = Object.assign(initialState(), p);
    S.rules = Object.assign(defaultRules(), p.rules || {});
    S.snapshots = p.snapshots || {};
    /* This function overrides the plain loadState defined above, so every
       post-load fix-up has to live here too — anything placed only in the
       earlier definition is dead code once core.js has loaded. */
    restoreHousingCeilings(p);
    const migrated = (typeof migrateLetterTemplates === "function") ? migrateLetterTemplates() : 0;
    if (migrated) audit("Migrated letter templates", migrated + " template(s) updated to schema " + LETTER_TPL_SCHEMA);
    return true;
  } catch (e) { return false; }
};
