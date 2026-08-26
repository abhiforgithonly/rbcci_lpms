"use strict";

/* ===================================================== shared/schema.js
   The column field list and header-mapping logic, factored out of
   import.js so the exact same rules can run in two places:

     - the browser (import.js, views.js, events.js reference FIELDS
       and mapHeaders as globals, exactly as before this file existed)
     - the backend structure-verification function (api/verify-import.js),
       which requires this file as a plain CommonJS module.

   This file must stay the single source of truth for "what counts as
   a recognised loan register". If the field list changes, it changes
   here once, and both the browser check and the backend check pick it
   up together. Do not fork a second copy of FIELDS/mapHeaders anywhere. */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    Object.assign(root, api);       // FIELDS, mapHeaders etc. as bare globals, browser-side
    root.Schema = api;              // also namespaced, for anything that prefers that
  }
})(typeof self !== "undefined" ? self : this, function () {

  /* Maps the bank's own core-banking extract columns (as used in
     "RBCCI Loan Report June 30 2026") onto the LPMRS account model.
     Unrecognised columns are retained verbatim under raw{}. */
  const FIELDS = [
    ["accountNo",        "Loan account number",        ["loan product number", "loan account number", "account number", "account no"]],
    ["pnNo",             "PN number",                  ["loan extra number", "pn number", "promissory note"]],
    ["borrower",         "Borrower name",              ["loan customer effective name", "borrower name", "borrower", "customer name"]],
    ["cif",              "CIF / borrower number",      ["cif", "cif number", "customer number", "borrower id"]],
    ["grantDate",        "Date granted",               ["loan grant date", "date granted", "release date"]],
    ["maturityDate",     "Maturity date",              ["loan maturity date", "maturity date"]],
    ["principal",        "Original principal",         ["loan principal amount", "original principal", "original amount"]],
    ["balance",          "Outstanding principal",      ["loan principal balance", "principal balance", "outstanding balance", "outstanding principal"]],
    ["rate",             "Interest rate",               ["loan interest rate", "interest rate"]],
    ["eir",              "Effective interest rate",    ["loan eir annual", "eir"]],
    ["term",             "Term",                       ["loan term", "term"]],
    ["dosriFlag",        "DOSRI flag",                 ["loan customer dosri", "dosri flag", "dosri"]],
    ["dosriType",        "DOSRI type",                 ["loan customer dosri type", "dosri type"]],
    ["creationType",     "Contract / creation type",   ["loan creation type", "contract status", "creation type"]],
    ["productType",      "Product type",               ["product type"]],
    ["securityDesc",     "Security description",       ["security", "collateral type", "security type"]],
    ["misGroup",         "MIS group",                  ["mis group", "loan type"]],
    ["purpose",          "Loan purpose",               ["loan purpose", "purpose"]],
    ["sourceStatus",     "Source loan status",         ["loan status", "account status"]],
    ["dpd",              "Days past due",              ["past due days", "days past due", "dpd"]],
    ["sourceClassification", "Source classification",  ["loan past due classification", "classification", "past due classification"]],
    ["lastStatusChange", "Last status change",         ["last status change"]],
    ["penalty",          "Outstanding penalty",        ["outstanding penalty balance", "penalty"]],
    ["pdi",              "Past due interest",          ["outstanding pdi balance", "pdi"]],
    ["amortization",     "Amortisation amount",        ["max amortization amount", "amortization", "amortisation"]],
    ["cycle",            "Loan cycle",                 ["loan cycle"]],
    ["contact",          "Contact number",             ["contact numbers", "contact number"]],
    ["birthDate",        "Date of birth / registration", ["loan customer individual data birth date", "loan customer individual date of birth", "date of birth", "birth date"]],
    ["address",          "Address",                    ["address"]],
    ["psic",             "PSIC / industry",            ["loan purpose to industry", "psic", "industry", "loan economic activity"]],
    ["paymentInterval",  "Payment interval",           ["payment interval", "payment frequency"]],
    ["sourceProvisionRate", "Source provision rate",   ["loan provision rate", "provision rate"]],
    ["penaltyMaturityBalance", "Outstanding penalty at maturity", ["outstanding penalty maturity balance"]],
    ["pdiMaturityBalance",  "Outstanding PDI at maturity",  ["outstanding pdi maturity balance"]],
    ["asEarnedInterest",    "As-earned interest balance",   ["as earned interest balance"]],
    ["interestAmount",      "Loan interest amount",         ["loan interest amount"]],
    ["manualMetadata",      "Loan manual metadata",         ["loan manual metadata"]],
    ["accruedInterest",  "Accrued interest",           ["loan accrued interest"]],
    ["lastPaymentDate",  "Last payment date",          ["last payment date", "date paid"]],
    ["lastPrincipalPay", "Last principal payment",     ["last principal payment"]],
    ["lastInterestPay",  "Last interest payment",      ["last interest payment"]],
    ["sourceEclBucket",  "Source ECL bucket",          ["ecl bucket"]],
    ["economicActivity", "Economic activity",          ["loan economic activity"]],
    ["totalAmortNo",     "Total amortisations",        ["loan total amortization number"]],
    ["firstAmortDue",    "First amortisation due",     ["loan first amortization due date", "loan first amortization due"]],
    ["firstUnpaidDate",  "First unpaid installment",   ["first unpaid installment", "first unpaid date"]],
    ["spouse",           "Spouse name",                ["spouse name", "spouse"]],
    ["housingFlag",      "Housing loan flag",          ["housing loan flag"]],
    ["bookedAcl",        "Booked ACL",                 ["booked acl", "source provision amount", "computed expected provision amount"]],
    ["collateralValue",  "Collateral appraised value", ["collateral value / appraisal", "appraised value", "collateral value"]],
    ["eligibleCollateralValue", "Eligible collateral value", ["eligible collateral value"]],
    ["collateralPerfected", "Collateral perfected (Y/N)", ["collateral perfected", "perfection"]],
    ["sellingPrice",     "Housing selling price",      ["selling price", "contract price"]],
    ["housingUnitType",  "Housing unit type",          ["housing unit type", "property type"]],
    ["programCode",      "Government programme",       ["program code", "programme", "funding program", "funding source"]],
    ["sbcorpFunded",     "SBCorp funded share",        ["sbcorp funded", "sbcorp share"]],
    ["rbcciCounterpart", "RBCCI counterpart",          ["rbcci counterpart", "rbcci share"]],
    ["retainedRiskPct",  "Retained credit risk %",     ["retained risk", "credit risk retained"]],
    ["internalRiskScore", "Internal credit-risk score (0-100)", ["internal risk score", "credit risk score", "risk score"]],
    ["riskTierOverride", "Risk tier override code",    ["risk tier override"]],
    ["afrdStatus",       "AFRD status",                ["afrd status", "afrd eligibility"]],
    ["afrdEligibleAmount", "AFRD eligible amount",     ["afrd eligible amount"]],
    ["afrdEvidence",     "AFRD evidence reference",    ["afrd evidence", "afrd supporting document"]],
    ["msmeSize",         "Enterprise size",            ["msme size", "enterprise size"]],
    ["msmeAssetEvidence","MSME asset evidence",        ["msme asset evidence", "qualifying assets"]],
    ["remedialStatus",   "Remedial status",            ["remedial status"]],
    ["dosriApproval",    "DOSRI approval reference",   ["dosri approval", "approval reference"]],
    ["managementOverlay","Management overlay",         ["management overlay", "overlay"]],
    ["foreclosureImminent", "Foreclosure imminent (Y/N)", ["foreclosure imminent"]],
    ["cureStartDate",    "Cure start date",            ["cure start date"]],
    ["priorClass",       "Prior performance class",    ["prior class", "previous classification"]],
    ["missedInstallments", "Missed installments",      ["number of missed installments", "missed installments"]],
    ["officer",          "Loan officer",               ["loan officer", "assigned officer", "officer"]],
    ["branch",           "Branch / booking office",    ["branch", "booking office"]]
  ];
  const FIELD_MAP = (() => { const m = {}; for (const [f, lab, al] of FIELDS) for (const a of al) m[a] = f; return m; })();
  const FIELD_LABEL = Object.fromEntries(FIELDS.map(([f, lab]) => [f, lab]));
  const norm = h => String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function mapHeaders(headers) {
    const map = {}, unmapped = [];
    headers.forEach((h, i) => {
      const n = norm(h);
      let f = FIELD_MAP[n];
      if (!f) { const hit = Object.keys(FIELD_MAP).find(k => n.startsWith(k) || k.startsWith(n)); if (hit && n.length > 5) f = FIELD_MAP[hit]; }
      if (f && map[f] === undefined) map[f] = i; else unmapped.push({ header: h, index: i });
    });
    return { map, unmapped };
  }

  /* Exactly the score importFile() uses to decide whether a sheet is a
     recognised loan register: every mapped column counts once, and the
     two columns nothing else can substitute for — account number and
     outstanding balance — count for an extra 8 each. */
  function scoreMapping(map) {
    return Object.keys(map).length + (map.balance !== undefined ? 8 : 0) + (map.accountNo !== undefined ? 8 : 0);
  }

  /* importFile() rejects a candidate sheet below this score. Kept here so
     the backend pre-check and the client's real import agree on the same
     cut-off instead of two numbers that can drift apart. */
  const REQUIRED_SCORE_THRESHOLD = 6;

  return { FIELDS, FIELD_MAP, FIELD_LABEL, norm, mapHeaders, scoreMapping, REQUIRED_SCORE_THRESHOLD };
});
