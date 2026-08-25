"use strict";

/* ===================================================== afrd.js
   AFRD qualifying investments register and the consolidated compliance
   computation (specification sections 5 and 6).

   Two rules shape everything here.

   First, recording an investment must never by itself make it
   AFRD-compliant. Every record is created PENDING regardless of what the
   encoder selects, and only an explicit validation — by a named user,
   against a stated supporting reference — moves it to a state that counts
   towards the numerator. Eligibility is therefore a decision that leaves a
   trail, not a field someone types.

   Second, manually encoded investments must stay distinguishable from
   imported loan records. They live in their own collection with their own
   source and validation metadata, and the compliance statement always
   shows the loan and investment contributions separately before adding
   them, so no figure is ever a mixture that cannot be taken apart.        */

/* ------------------------------------------------------------ helpers */
const afrdStateOf = code => (S.rules.afrdEligibilityStates || [])
  .find(s => s.code === code) || { code: code || "PENDING", label: code || "Pending validation", eligible: false, tag: "t-mute" };
const afrdTypeLabel = code => ((S.rules.afrdInvestmentTypes || [])
  .find(t => t.code === code) || { label: code || "" }).label;
const afrdClassLabel = code => ((S.rules.afrdInvestmentClasses || [])
  .find(t => t.code === code) || { label: code || "" }).label;

/* Only active records in an eligible state contribute, and never more than
   the carrying value: an eligible amount typed higher than the asset it
   sits on would inflate the numerator against nothing. */
function investmentEligibleAmount(inv) {
  if (!inv || inv.active === false) return 0;
  if (!afrdStateOf(inv.status).eligible) return 0;
  const cap = investmentRegulatoryAmount(inv);
  const claimed = N(inv.eligibleAmount);
  if (!claimed) return 0;
  return cap ? Math.min(claimed, cap) : claimed;
}

/* An investment that is recorded but cannot count, and why. Surfaced in the
   register so an encoder is never left wondering where their entry went. */
function investmentExclusionReason(inv) {
  if (inv.active === false) return "Marked inactive";
  const st = afrdStateOf(inv.status);
  if (!st.eligible) return st.label;
  if (!N(inv.eligibleAmount)) return "No AFRD-eligible amount entered";
  const carrying = N(inv.bookValue) || N(inv.faceValue);
  if (carrying && N(inv.eligibleAmount) > carrying) {
    return "Eligible amount exceeds carrying value; capped at " + P(carrying);
  }
  if (inv.maturityDate && inv.maturityDate < S.cutoff) return "Matured before the cut-off but still counted; confirm it is still held";
  return "";
}

/* ------------------------------------------------- priority sector (Stream A)
   The AFRD review separates three questions that were previously answered by
   one field: what activity is financed, who benefits, and how it was funded.
   Activity is settled by afrdActivity() in the engine. The other two are
   answered here, because both can disqualify or re-weight an exposure that
   the activity test has already passed.                                    */
function beneficiaryOf(a) {
  const code = String(Eng.get(a, "beneficiaryType") || "").toUpperCase();
  const flagged = ["arbFlag", "arcFlag", "otherPrioritySectorFlag"]
    .filter(f => String(Eng.get(a, f) || "").toUpperCase() === "Y");
  const t = (S.rules.afrdBeneficiaryTypes || []).find(x => x.code === code);
  if (t && t.code) return { code: t.code, label: t.label, priority: t.priority, flags: flagged };
  if (flagged.length) {
    const c = flagged[0] === "arbFlag" ? "ARB" : flagged[0] === "arcFlag" ? "ARC" : "OTHER_PRIORITY";
    const m = (S.rules.afrdBeneficiaryTypes || []).find(x => x.code === c) || {};
    return { code: c, label: m.label || c, priority: true, flags: flagged };
  }
  return { code: "", label: "Not recorded", priority: false, flags: [] };
}

function fundingOf(a) {
  const explicit = String(Eng.get(a, "afrdFundingSource") || "").toUpperCase();
  const prog = String(Eng.get(a, "programCode") || "").toUpperCase();
  const code = explicit || (prog && prog !== "BANK" ? prog : (prog === "BANK" ? "OWN" : ""));
  const f = (S.rules.afrdFundingSources || []).find(x => x.code === code);
  return f ? { code: f.code, label: f.label, countable: f.countable }
           : { code: code || "", label: code || "Not determined", countable: false };
}

/* The multiplier is only ever applied to an exposure that is both eligible by
   activity and verified as priority-sector. An unverified claim carries the
   standard multiplier and raises an exception, so a missing evidence
   reference can never quietly inflate compliance. */
function multiplierOf(a, ben) {
  const stored = N(Eng.get(a, "complianceMultiplier"));
  const verified = !!String(Eng.get(a, "prioritySectorReference") || "").trim();
  const base = N(S.rules.afrdDefaultMultiplier) || 1;
  if (!ben.priority) return { value: base, verified: false, applied: false, reason: "Not a priority-sector exposure." };
  if (!verified) return { value: base, verified: false, applied: false,
    reason: "Priority-sector status claimed but no supporting reference is recorded, so the standard multiplier applies." };
  const m = stored || N(S.rules.afrdPriorityMultiplier) || base;
  return { value: m, verified: true, applied: m !== base,
    reason: "Verified " + ben.label + ", multiplier " + m + "x." };
}

/* Critical control from the review: a single loan amount must not be forced
   to serve both AFRD compliance measurement and FRP carrying value. They are
   different figures for different returns and are kept apart. */
function loanAmounts(c) {
  const gross = N(Eng.get(c.account, "grossOutstanding")) || c.balance;
  const net = c.balance - N(c.acl.required);
  return { complianceGross: gross, frpNetCarrying: Math.max(net, 0) };
}

/* --------------------------------------------------------- Stream A rows */
function afrdLoanRows() {
  const t = totals();
  return t.port.map(c => {
    const ben = beneficiaryOf(c.account);
    const fund = fundingOf(c.account);
    const mult = multiplierOf(c.account, ben);
    const amt = loanAmounts(c);
    const activityEligible = c.afrd.status === "ELIGIBLE" || c.afrd.status === "PARTIAL";
    const base = c.afrd.status === "PARTIAL" ? N(c.afrd.eligible) : (activityEligible ? amt.complianceGross : 0);
    /* Funding source is a hard gate: money the bank did not lend from its own
       loanable funds cannot be counted towards its own requirement. */
    const counted = (activityEligible && fund.countable) ? base * mult.value : 0;
    return { c, ben, fund, mult, amt, activityEligible, base, counted,
             blockedByFunding: activityEligible && !fund.countable };
  });
}

/* ------------------------------------------------------- consolidation */
/* Formula A to H of the AFRD review. Each step is separately reportable and
   traceable to the records behind it. */
function afrdCompliance() {
  const t = totals(), R = S.rules;
  const rows = afrdLoanRows();

  const eligibleRows = rows.filter(r => r.counted > 0);
  const baseEligible = rows.reduce((a, r) => a + (r.activityEligible && r.fund.countable ? r.base : 0), 0);
  const priorityRows = rows.filter(r => r.counted > 0 && r.mult.applied);
  const priorityAdj = priorityRows.reduce((a, r) => a + (r.counted - r.base), 0);
  const otherEligible = rows.filter(r => r.counted > 0 && !r.mult.applied).reduce((a, r) => a + r.counted, 0);
  const loanCompliance = rows.reduce((a, r) => a + r.counted, 0);
  const fundingBlocked = rows.filter(r => r.blockedByFunding);

  const loanPending = t.port.filter(c => c.afrd.status === "PENDING");
  const loanExcludedAcpc = t.port.filter(c => c.afrd.status === "EXCLUDED_ACPC");

  /* Stream C */
  const invAll = S.afrdInvestments || [];
  const invActive = invAll.filter(i => i.active !== false);
  const invEligible = invActive.filter(i => afrdStateOf(i.status).eligible && investmentEligibleAmount(i) > 0);
  const invAmount = invActive.reduce((a, i) => a + investmentEligibleAmount(i), 0);
  const invPending = invActive.filter(i => i.status === "PENDING");
  const invByType = {};
  invActive.forEach(i => {
    const k = i.category || i.type || "OTHER";
    (invByType[k] = invByType[k] || { n: 0, face: 0, book: 0, eligible: 0 });
    invByType[k].n++; invByType[k].face += N(i.faceValue);
    invByType[k].book += N(i.bookValue); invByType[k].eligible += investmentEligibleAmount(i);
  });
  /* Schedule B-1 rolls into Schedule B, which carries into the numerator. */
  const schedule = {};
  invActive.forEach(i => {
    const cat = (R.afrdInstrumentCategories || []).find(x => x.code === i.category);
    const k = cat ? cat.schedule : "B";
    (schedule[k] = schedule[k] || { n: 0, eligible: 0, lines: {} });
    schedule[k].n++; schedule[k].eligible += investmentEligibleAmount(i);
    const ln = cat ? cat.line : "Unclassified";
    schedule[k].lines[ln] = (schedule[k].lines[ln] || 0) + investmentEligibleAmount(i);
  });

  /* Stream B */
  const tlfRec = S.afrdTlf;
  const denominator = tlfRec ? N(tlfRec.amount) : N(R.totalLoanableFunds);
  const required = denominator * N(R.afrdRate);
  const total = loanCompliance + invAmount;
  const ratio = denominator ? total / denominator : null;
  const variance = total - required;

  return {
    rows, eligibleRows, baseEligible, priorityRows, priorityAdj, otherEligible,
    loanCompliance, fundingBlocked, loanPending, loanExcludedAcpc,
    loanPendingAmount: loanPending.reduce((a, c) => a + c.balance, 0),
    frpNetCarrying: rows.reduce((a, r) => a + (r.counted > 0 ? r.amt.frpNetCarrying : 0), 0),
    invAmount, invEligible, invPending, invAll, invActive, invByType, schedule,
    invFace: invActive.reduce((a, i) => a + N(i.faceValue), 0),
    invBook: invActive.reduce((a, i) => a + N(i.bookValue), 0),
    tlfRec, denominator, rate: N(R.afrdRate), required, total, ratio, variance,
    /* Kept for the existing screen bindings. */
    loanEligible: loanCompliance, loanCount: eligibleRows.length,
    compliant: denominator > 0 && total >= required,
    determinable: denominator > 0
  };
}

/* ------------------------------------------------------------ CRUD */
function newInvestment() {
  /* Field set per the AFRD review's required-fields table. Regulatory amount,
     unamortized premium/discount and allowance are held separately from the
     carrying value, so the AFRD reportable amount can be validated and can
     remain distinct from the FRP figure. */
  return {
    id: uid(),
    investmentRef: "INV-" + periodKey().replace(/-/g, "") + "-" + String(((S.afrdInvestments || []).length + 1)).padStart(3, "0"),
    category: (S.rules.afrdInstrumentCategories[0] || {}).code || "AGRI_DEBT",
    type: (S.rules.afrdInvestmentTypes[0] || {}).code || "OTHER",
    issuer: "", instrument: "", isin: "", referenceNo: "",
    acquisitionDate: "", reportingDate: S.cutoff, maturityDate: "",
    faceValue: 0, bookValue: 0, regulatoryAmount: 0, unamortized: 0, acl: 0,
    eligibleAmount: 0,
    useOfProceeds: "", classification: "UNCLASSIFIED",
    sustainableStandard: "", greenClassification: "",
    offeringCircularRef: "", externalReviewRef: "",
    fundingSource: "OWN", afrdRuleId: "",
    status: "PENDING", supportingRef: "", remarks: "", active: true,
    source: "MANUAL_ENTRY",
    encodedBy: (CURRENT_USER && CURRENT_USER.username) || "",
    encodedAt: new Date().toISOString(),
    validatedBy: "", validatedAt: "", validationNote: ""
  };
}

/* The AFRD reportable amount is the regulatory amount where one is recorded,
   otherwise carrying value net of unamortized premium or discount. The
   allowance is deliberately not deducted here: it is stored separately and
   applies to the FRP carrying figure, not to the AFRD reportable amount. */
function investmentRegulatoryAmount(inv) {
  const reg = N(inv.regulatoryAmount);
  if (reg) return reg;
  const carrying = N(inv.bookValue) || N(inv.faceValue);
  return Math.max(carrying - N(inv.unamortized), 0);
}
function investmentFrpAmount(inv) {
  return Math.max((N(inv.bookValue) || N(inv.faceValue)) - N(inv.acl), 0);
}

function afrdInvestmentById(id) { return (S.afrdInvestments || []).find(i => i.id === id) || null; }

/* ==================================================================== */
/*  AFRD exception framework                                            */
/*  Codes AFRD-E001..E018 cover the loan stream, AFRD-I001..I012 the    */
/*  investment stream. Each carries a severity and a materiality        */
/*  amount, because the review distinguishes between a draft output,    */
/*  which may carry unresolved items, and a final regulatory output,    */
/*  which may not carry material ones.                                  */
/* ==================================================================== */
function afrdExceptions() {
  const R = S.rules, x = afrdCompliance(), out = [];
  const add = (code, sev, msg, fix, amount, ref) =>
    out.push({ code, sev, msg, fix, amount: N(amount), ref: ref || "" });

  /* ---- Stream A: loans ---- */
  const seen = new Map();
  x.rows.forEach(r => {
    const c = r.c, no = String(c.account.accountNo || "").trim(), act = c.afrd.activity || {};
    if (!act.raw && act.source === "not recorded")
      add("AFRD-E001", "WARN", "Loan Economic Activity is missing.", "Populate the activity in the source extract or record it on the account.", c.balance, no);
    else if (act.category === "FOR_REVIEW" || act.category === "UNCLASSIFIED")
      add("AFRD-E002", "WARN", "Economic activity is recorded but cannot be interpreted.", "Confirm the activity and add it to the approved rule list if it qualifies.", c.balance, no);
    else if (act.category === "NON_AFRD" && !(R.afrdActivityRules || []).length)
      add("AFRD-E003", "WARN", "Economic activity is not mapped to any AFRD rule.", "Extend the activity rules on the Parameters screen.", c.balance, no);

    if (no) { if (seen.has(no)) add("AFRD-E005", "BLOCK", "Duplicate loan account number in the AFRD population.", "Remove or merge the duplicate before reporting.", c.balance, no); else seen.set(no, 1); }
    if (!N(c.balance) && c.inPortfolio)
      add("AFRD-E006", "BLOCK", "Gross outstanding balance is missing or zero on a recognised account.", "Correct the balance in the source extract.", 0, no);

    if (r.activityEligible) {
      if (!r.ben.code) add("AFRD-E008", "WARN", "Beneficiary type is not recorded on an AFRD-eligible loan.", "Record the beneficiary type on the account.", r.base, no);
      if (r.ben.priority && !r.mult.verified)
        add("AFRD-E009", "WARN", "Priority-sector status is claimed but not verified, so the standard multiplier was applied.", "Record the supporting reference, or clear the priority-sector flag.", r.base, no);
      if (r.mult.verified && (r.mult.value <= 0 || r.mult.value > 5))
        add("AFRD-E010", "BLOCK", "Compliance multiplier is outside the permitted range.", "Correct the multiplier to the approved regulatory value.", r.base, no);
      if (!r.fund.code) add("AFRD-E011", "WARN", "Funding source is not determined on an AFRD-eligible loan.", "Record the funding source so double-counting can be tested.", r.base, no);
      if (r.blockedByFunding)
        add("AFRD-E012", "WARN", "Excluded from compliance: funded from " + r.fund.label + ", which cannot count towards the bank's own requirement.", "Confirm the funding source. Funds not from the bank's own loanable funds are excluded.", r.base, no);
      if (Math.abs(r.amt.complianceGross - r.amt.frpNetCarrying) > 0 && !N(c.acl.required))
        add("AFRD-E014", "WARN", "FRP net carrying amount could not be derived because no allowance is computed.", "Confirm the allowance for this account.", r.base, no);
    }
  });

  /* ---- Stream B: total loanable funds ---- */
  if (!x.denominator)
    add("AFRD-E015", "BLOCK", "Total loanable funds has not been recorded, so the statutory requirement cannot be computed.", "Enter the figure from the applicable financial or AFRD source schedule.", 0, "");
  else if (!x.tlfRec || !x.tlfRec.source)
    add("AFRD-E015", "WARN", "Total loanable funds has been entered but its source schedule is not recorded.", "Record which schedule and period the figure came from.", x.denominator, "");
  if (x.tlfRec && x.tlfRec.asOf && x.tlfRec.asOf !== S.cutoff)
    add("AFRD-E016", "WARN", "Total loanable funds is stated as at " + x.tlfRec.asOf + " but the reporting cut-off is " + S.cutoff + ".", "Use the figure for the reporting period.", x.denominator, "");

  /* ---- Stream C: investments ---- */
  const invSeen = new Map();
  (S.afrdInvestments || []).filter(i => i.active !== false).forEach(i => {
    const amt = investmentEligibleAmount(i) || N(i.bookValue);
    const ref = i.referenceNo || i.instrument || "";
    if (!String(i.issuer || "").trim() || !String(i.instrument || "").trim())
      add("AFRD-I001", "BLOCK", "Issuer or security name is missing.", "Complete the issuer and instrument name.", amt, ref);
    if (!String(i.isin || "").trim())
      add("AFRD-I002", "WARN", "ISIN or security identifier is not recorded.", "Record the ISIN so the holding can be matched to the official issue.", amt, ref);
    if (!String(i.useOfProceeds || "").trim())
      add(i.category === "GREEN" ? "AFRD-I006" : "AFRD-I003", "WARN",
        "Use of proceeds is not documented, so the financed activity cannot be established.", "Record the use-of-proceeds description and the supporting document.", amt, ref);
    if (i.category === "OTHER_DEBT" && !String(i.afrdRuleId || "").trim())
      add("AFRD-I004", "WARN", "AFRD-exclusive purpose is not established for an instrument outside the recognised categories.", "Record the approved rule under which this instrument qualifies.", amt, ref);
    if (i.category === "GREEN" && !String(i.sustainableStandard || "").trim())
      add("AFRD-I005", "WARN", "Green or sustainable instrument has no standard or framework recorded.", "Record the framework the issue was certified against.", amt, ref);
    if (i.maturityDate && i.maturityDate < S.cutoff)
      add("AFRD-I007", "WARN", "Instrument matured before the reporting date; holding at the reporting date cannot be validated.", "Confirm whether the instrument was still held, and remove it if not.", amt, ref);
    const carrying = N(i.bookValue) || N(i.faceValue);
    if (N(i.regulatoryAmount) && carrying && Math.abs(N(i.regulatoryAmount) - (carrying - N(i.unamortized))) > 0.5)
      add("AFRD-I008", "WARN", "Regulatory amount does not agree with carrying value less unamortized premium or discount.", "Reconcile the regulatory amount to the investment ledger.", amt, ref);
    if (!N(i.unamortized) && N(i.faceValue) && N(i.bookValue) && N(i.faceValue) !== N(i.bookValue))
      add("AFRD-I011", "WARN", "Face and carrying values differ but no premium or discount is recorded.", "Record the unamortized premium or discount.", amt, ref);
    const key = String(i.isin || i.referenceNo || "").trim().toUpperCase();
    if (key) { if (invSeen.has(key)) add("AFRD-I009", "BLOCK", "The same security appears more than once in the register.", "Remove the duplicate holding.", amt, ref); else invSeen.set(key, 1); }
    const f = (R.afrdFundingSources || []).find(z => z.code === String(i.fundingSource || "").toUpperCase());
    if (i.fundingSource && f && !f.countable)
      add("AFRD-I010", "WARN", "Instrument was funded from " + f.label + ", which may not be counted towards the bank's own requirement.", "Confirm the funding source before including this holding.", amt, ref);
  });
  /* Schedule B-1 must reconcile into Schedule B. */
  const b1 = (x.schedule["B-1"] || {}).eligible || 0, bTot = (x.schedule["B"] || {}).eligible || 0;
  if (Math.abs((b1 + bTot) - x.invAmount) > 0.5)
    add("AFRD-I012", "BLOCK", "Schedule B and Schedule B-1 do not reconcile to the eligible investment total.", "Check the instrument categories; every holding must map to a schedule line.", x.invAmount, "");

  const material = out.filter(e => e.sev === "BLOCK" || e.amount >= N(R.afrdMaterialityThreshold));
  return { all: out, material,
    blocks: out.filter(e => e.sev === "BLOCK").length,
    warns: out.filter(e => e.sev === "WARN").length,
    /* A final regulatory output is withheld while material items are open;
       a draft may still be produced, which is the review's distinction. */
    finalBlocked: !!(R.afrdBlockFinalOnUnresolved && material.length) };
}
