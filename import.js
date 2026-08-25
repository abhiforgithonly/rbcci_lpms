"use strict";

/* ===================================================== import.js
   Column mapping, row-to-account conversion, sample data,
   workbook / JSON export, backup restore, and the extended
   (16-schedule) workbook export used by events.js.               */

/* ============================================================== IMPORT
   Maps the bank's own core-banking extract columns (as used in
   "RBCCI Loan Report June 30 2026") onto the LPMRS account model.
   Unrecognised columns are retained verbatim under raw{}.
   ==================================================================== */
const FIELDS = [
  ["accountNo",        "Loan account number",        ["loan product number", "loan account number", "account number", "account no"]],
  ["pnNo",             "PN number",                  ["loan extra number", "pn number", "promissory note"]],
  ["borrower",         "Borrower name",              ["loan customer effective name", "borrower name", "borrower", "customer name"]],
  ["cif",              "CIF / borrower number",      ["cif", "cif number", "customer number", "borrower id"]],
  ["grantDate",        "Date granted",               ["loan grant date", "date granted", "release date"]],
  ["maturityDate",     "Maturity date",              ["loan maturity date", "maturity date"]],
  ["principal",        "Original principal",         ["loan principal amount", "original principal", "original amount"]],
  ["balance",          "Outstanding principal",      ["loan principal balance", "principal balance", "outstanding balance", "outstanding principal"]],
  ["rate",             "Interest rate",              ["loan interest rate", "interest rate"]],
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
  /* Present in the raw core-banking export; carried so nothing in the source
     file is silently discarded, even where no computation uses it yet. */
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
  /* fields that the core extract does not supply — captured manually */
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

function rowsToAccounts(headers, rows, source) {
  const { map, unmapped } = mapHeaders(headers);
  /* Intake funnel. Every row leaving the source file is accounted for at
     one of these stages, so a source-vs-register difference can always be
     explained rather than silently absorbed (spec section 1 and the
     "No Silent Data Loss" principle). */
  const intake = {
    sourceRows: rows.length,   // rows below the header row
    blank: 0,                  // entirely empty rows, skipped
    noKey: 0,                  // no account number and no borrower name
    duplicates: 0,             // repeated account number, still imported
    imported: 0,
    rejected: []               // {row, reason} for every row not imported
  };
  const nonBlank = rows.filter((r, i) => {
    const has = r.some(v => String(v ?? "").trim() !== "");
    if (!has) { intake.blank++; intake.rejected.push({ row: i + 2, reason: "Row is entirely empty" }); }
    return has;
  });
  const accounts = nonBlank.map(r => {
    const a = { id: uid(), source, raw: {} };
    for (const [f, i] of Object.entries(map)) a[f] = r[i] ?? "";
    unmapped.forEach(u => { const v = r[u.index]; if (String(v ?? "").trim() !== "") a.raw[u.header] = v; });
    /* normalise */
    a.balance = N(a.balance); a.principal = N(a.principal); a.dpd = N(a.dpd);
    a.grantDate = dateISO(a.grantDate); a.maturityDate = dateISO(a.maturityDate);
    a.lastPaymentDate = dateISO(a.lastPaymentDate); a.firstAmortDue = dateISO(a.firstAmortDue);
    a.firstUnpaidDate = dateISO(a.firstUnpaidDate);
    a.dosriFlag = String(a.dosriFlag || "N").trim().toUpperCase().startsWith("Y") ? "Y" : "N";
    a.programCode = String(a.programCode || "").trim().toUpperCase() || "BANK";
    if (!a.housingFlag) a.housingFlag = /hous/i.test(String(a.misGroup) + String(a.purpose)) ? "Y" : "N";
    a.accountNo = String(a.accountNo || "").trim();
    a.borrower = String(a.borrower || "").trim();
    /* the workbook's computed provision is the BOOKED figure, not required */
    a.bookedAcl = N(a.bookedAcl);
    /* The bank's raw core-banking export carries a provision *rate* per
       account but no booked provision *amount*; the previously supplied
       workbook had been pre-processed to add one. Without this the booked
       allowance reads as zero and the entire required balance is reported
       as a deficiency, which would misstate the ACL position on a board
       report. Where a rate is present and no amount was mapped, the amount
       is derived and flagged, so the figure is never silently presented as
       something the source stated outright. */
    if (S.rules.deriveBookedAclFromRate !== false
        && !a.bookedAcl && map.bookedAcl === undefined && map.sourceProvisionRate !== undefined) {
      const rate = RATE(a.sourceProvisionRate);
      if (rate > 0) {
        a.bookedAcl = rate * N(a.balance);
        a.bookedAclDerived = true;
      }
    }
    return a;
  }).filter((a, i) => {
    if (a.accountNo || a.borrower) return true;
    intake.noKey++;
    intake.rejected.push({ row: i + 2, reason: "No account number and no borrower name" });
    return false;
  });
  /* Duplicate account numbers are reported but NOT dropped — the bank may
     legitimately carry more than one facility under one number, and
     deleting rows here would be exactly the silent truncation the
     specification prohibits. */
  const seen = new Map();
  accounts.forEach(a => {
    const k = String(a.accountNo || "").trim();
    if (!k) return;
    if (seen.has(k)) { intake.duplicates++; a.duplicateOf = seen.get(k); }
    else seen.set(k, a.id);
  });
  intake.imported = accounts.length;
  return { accounts, map, unmapped, intake };
}

async function importFile(file) {
  const name = file.name, ext = name.split(".").pop().toLowerCase();
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  let sheets = [];
  if (ext === "xlsx" || ext === "xlsm") sheets = await Xlsx.read(buf);
  else if (ext === "csv" || ext === "txt") {
    const rows = parseCsv(new TextDecoder().decode(buf));
    sheets = [{ name: name.replace(/\.[^.]+$/, ""), rows }];
  } else throw new Error("Import accepts .xlsx and .csv files. " + name + " is not supported.");

  /* Pick the sheet with the most mapped loan columns.

     A raw core-banking export commonly carries the full loan listing and a
     filtered extract of the same columns on a second sheet — in the July
     file "Loan listing" (654 rows) and "NPL" (58 rows) map identically and
     score identically. On score alone the winner was whichever sheet came
     first in the workbook, so re-ordering the tabs would have silently
     imported the NPL extract as the entire register. Ties are therefore
     broken on the number of data rows below the header: between two sheets
     the application maps equally well, the fuller one is the register. */
  let best = null;
  for (const sh of sheets) {
    if (!sh.rows.length) continue;
    for (let hr = 0; hr < Math.min(6, sh.rows.length); hr++) {
      const headers = sh.rows[hr].map(String);
      const { map } = mapHeaders(headers);
      const score = Object.keys(map).length + (map.balance !== undefined ? 8 : 0) + (map.accountNo !== undefined ? 8 : 0);
      const depth = sh.rows.length - hr - 1;
      if (!best || score > best.score || (score === best.score && depth > best.depth)) {
        best = { sheet: sh, headerRow: hr, headers, score, depth };
      }
    }
  }
  if (!best || best.score < 6) {
    /* Say what was actually found. "No register recognised" on its own gives
       the operator nothing to act on, and points at the mapping when the real
       cause is often an empty or unreadable sheet. */
    const seen = sheets.map(s => s.name + " (" + s.rows.length + " row" + (s.rows.length === 1 ? "" : "s") + ")").join(", ");
    const anyRows = sheets.some(s => s.rows.length);
    throw new Error("No loan register could be recognised in " + name + ". "
      + (anyRows
          ? "A register sheet needs a column for the account number and one for the outstanding balance. Sheets found: " + seen + "."
          : "None of the sheets returned any rows: " + seen + ". Open the file in Excel and save a fresh copy, then import that.")
      + (best ? " Best match was \u201c" + best.sheet.name + "\u201d with " + Object.keys(mapHeaders(best.headers).map).length + " recognised column(s)." : ""));
  }

  const dataRows = best.sheet.rows.slice(best.headerRow + 1);
  const { accounts, map, unmapped, intake } = rowsToAccounts(best.headers, dataRows, name);

  /* Runner-up sheet score. A narrow margin means the sheet chosen for the
     register was nearly something else, which is worth surfacing rather
     than discovering after a period has been certified. */
  const ranked = [];
  for (const sh of sheets) {
    if (!sh.rows.length) continue;
    for (let hr = 0; hr < Math.min(6, sh.rows.length); hr++) {
      const m = mapHeaders(sh.rows[hr].map(String)).map;
      ranked.push({ sheet: sh.name, headerRow: hr, depth: sh.rows.length - hr - 1,
        score: Object.keys(m).length + (m.balance !== undefined ? 8 : 0) + (m.accountNo !== undefined ? 8 : 0) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || b.depth - a.depth);
  const runnerUp = ranked.find(r => r.sheet !== best.sheet.name) || null;

  const rec = {
    id: uid(), name, ext, hash, date: today(), period: periodKey(),
    sheet: best.sheet.name, headerRow: best.headerRow, score: best.score,
    runnerUp, sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length })),
    intake, records: accounts.length, mapped: Object.keys(map).length,
    unmapped: unmapped.map(u => u.header), status: "Parsed and mapped"
  };
  await Vault.put(`parsed/${rec.id}/manifest.json`, JSON.stringify(rec, null, 2)).catch(() => {});
  await Vault.put(`parsed/${rec.id}/accounts.json`, JSON.stringify(accounts)).catch(() => {});
  return { rec, accounts, map, unmapped, sheets, intake };
}

/* -------------------------------------------------------- sample loan book */
function sampleBook() {
  const mk = (o) => Object.assign({
    id: uid(), source: "sample", cif: "", programCode: "BANK", dosriFlag: "N",
    housingFlag: "N", productType: "", securityDesc: "", collateralValue: "", collateralPerfected: "",
    creationType: "New loan", paymentInterval: "Every 30 days", grantDate: "2024-03-01",
    maturityDate: "2029-03-01", sourceStatus: "Active", psic: "A0111", officer: "A. Dela Cruz",
    branch: "Main Office - Calbayog City"
  }, o);
  return [
    mk({ accountNo: "001-100-00101-2", borrower: "SANTOS, MARIA CLARA", cif: "CIF-10021", principal: 750000, balance: 618000, dpd: 0, misGroup: "Loans to Individual for Housing", purpose: "Purchase of House and Lot", productType: "Secured Loan", securityDesc: "REM - Residential", housingFlag: "Y", sellingPrice: 920000, housingUnitType: "HORIZONTAL", collateralValue: 980000, eligibleCollateralValue: 880000, collateralPerfected: "Y", sourceClassification: "Unclassified", lastPaymentDate: "2026-06-20", bookedAcl: 6180 }),
    mk({ accountNo: "001-100-00114-9", borrower: "REYES AGRI SUPPLY", cif: "CIF-10044", principal: 500000, balance: 421000, dpd: 45, misGroup: "Other Agricultural Credit Loans", purpose: "Crop production", productType: "Unsecured Loan", securityDesc: "", sourceClassification: "Especially mentioned", lastPaymentDate: "2026-05-02", afrdStatus: "ELIGIBLE", afrdEvidence: "AFRD-DOC-2026-0044", bookedAcl: 21050, paymentInterval: "Every 180 days" }),
    mk({ accountNo: "001-100-00120-4", borrower: "LUNA FARMS COOPERATIVE", cif: "CIF-10061", principal: 900000, balance: 742000, dpd: 100, misGroup: "Other Agricultural Credit Loans", purpose: "Farm inputs", productType: "Secured Loan", securityDesc: "REM - Agricultural land", collateralValue: 1200000, eligibleCollateralValue: 900000, collateralPerfected: "Y", sourceClassification: "Substandard", programCode: "ACPC", bookedAcl: 0, paymentInterval: "Every 360 Days" }),
    mk({ accountNo: "001-100-00133-7", borrower: "CALBAYOG HARDWARE DEPOT", cif: "CIF-10077", principal: 1500000, balance: 1180000, dpd: 200, misGroup: "Small Scale Enterprises", purpose: "Working capital", productType: "Secured Loan", securityDesc: "REM - Commercial", collateralValue: 1400000, eligibleCollateralValue: 1200000, collateralPerfected: "Y", msmeSize: "SMALL", msmeAssetEvidence: "FS-2025-AUD", sourceClassification: "Substandard", programCode: "SBCORP", sbcorpFunded: 1062000, rbcciCounterpart: 118000, bookedAcl: 118000 }),
    mk({ accountNo: "001-100-00147-1", borrower: "DELA PENA, ROBERTO", cif: "CIF-10090", principal: 90000, balance: 62000, dpd: 15, misGroup: "Salary Based General Purpose Consumption Loans", purpose: "Personal", productType: "Unsecured Loan", sourceClassification: "Especially mentioned", bookedAcl: 620 }),
    mk({ accountNo: "001-100-00158-5", borrower: "VILLAMOR, ANA", cif: "CIF-10102", principal: 250000, balance: 1, dpd: 3056, misGroup: "Other Microenterprise Loans", purpose: "Sari-sari store", productType: "Unsecured Loan", sourceStatus: "Past due write off", sourceClassification: "Loss", remedialStatus: "WOF", bookedAcl: 0 }),
    mk({ accountNo: "001-100-00161-8", borrower: "OQUENDO TRADING CORP.", cif: "CIF-10118", principal: 4000000, balance: 3250000, dpd: 400, misGroup: "Loans to Corporations", purpose: "Business expansion", productType: "Secured Loan", securityDesc: "REM - Commercial", collateralValue: 4500000, eligibleCollateralValue: 3800000, collateralPerfected: "Y", sourceStatus: "Past due litigation", remedialStatus: "ITL", sourceClassification: "Doubtful", foreclosureImminent: "Y", msmeSize: "MEDIUM", msmeAssetEvidence: "FS-2025-COR", bookedAcl: 800000 }),
    mk({ accountNo: "001-100-00170-3", borrower: "TAN, GLENN (DIRECTOR)", cif: "CIF-10130", principal: 600000, balance: 512000, dpd: 0, misGroup: "Loans to Individual for Other Purposes", purpose: "Personal", productType: "Unsecured Loan", dosriFlag: "Y", dosriType: "Director", sourceClassification: "Unclassified", bookedAcl: 5120 })
  ];
}

/* =============================================================== EXPORTS */
async function buildWorkbook() {
  const t = totals(), R = S.rules, w = wf();
  const stamp = [["RBCCI Loan Portfolio Management and Reporting System"],
                 ["Period", periodKey(), "Cut-off", S.cutoff, "Status", w.status],
                 ["Rule version", R.ruleVersion, "Policy profile", activeProfile().label],
                 ["Prepared by", w.maker, "Reviewed by", w.checker, "Approved by", w.approver],
                 ["Generated", new Date().toISOString().slice(0, 19).replace("T", " ")], []];
  const sheets = [];

  const byClass = {}; t.port.forEach(c => { (byClass[c.perf.cls] = byClass[c.perf.cls] || [0, 0, 0]); byClass[c.perf.cls][0]++; byClass[c.perf.cls][1] += c.balance; byClass[c.perf.cls][2] += c.acl.required; });
  const bySec = {}; t.port.forEach(c => { (bySec[c.security.label] = bySec[c.security.label] || [0, 0]); bySec[c.security.label][0]++; bySec[c.security.label][1] += c.balance; });
  const byProd = {}; t.port.forEach(c => { (byProd[c.product] = byProd[c.product] || [0, 0]); byProd[c.product][0]++; byProd[c.product][1] += c.balance; });

  sheets.push({ name: "Dashboard", headRows: 1, widths: [42, 22, 18, 18, 16, 16], rows: [
    ["Measure", "Value", "Basis", "", "", ""], ...stamp.slice(1),
    ["Gross loan portfolio", t.gross, "Recognised loan receivables only"],
    ["Number of accounts", t.count, "Excludes ROPA, written-off and memorandum accounts"],
    ["Accounts held off the portfolio", t.offBook, "ROPA, written off, \u20b11 memorandum, out-of-scope programmes"],
    ["Past-due exposure", t.pastDue, "Days past due greater than zero"],
    ["Past-due ratio", t.pastDueRatio, "Past-due exposure / gross portfolio"],
    ["Non-performing exposure", t.npl, "NPL and items in litigation"],
    ["NPL ratio", t.nplRatio, "Non-performing / gross portfolio"],
    ["Required ACL", t.required, "Higher of matrix floor and model, plus overlay"],
    ["Booked ACL", t.booked, "From the source extract"],
    ["ACL deficiency / (excess)", t.aclGap, "Required less booked"],
    ["NPL coverage", t.coverage, "Allowance on non-performing exposure only"],
    ["Eligible collateral recorded", t.collateral, "Perfected, eligible value"],
    ["Blocking exceptions", t.blocks, "Must be cleared before locking"],
    ["Warnings", t.warns, "Review and dispose"],
    [], ["Portfolio by performance class", "Accounts", "Outstanding", "Required ACL", "Share"],
    ...Object.entries(byClass).map(([k, v]) => [k, v[0], v[1], v[2], t.gross ? v[1] / t.gross : 0]),
    [], ["Portfolio by security status", "Accounts", "Outstanding", "Share"],
    ...Object.entries(bySec).map(([k, v]) => [k, v[0], v[1], t.gross ? v[1] / t.gross : 0]),
    [], ["Portfolio by product", "Accounts", "Outstanding", "Share"],
    ...Object.entries(byProd).map(([k, v]) => [k, v[0], v[1], t.gross ? v[1] / t.gross : 0])
  ]});

  sheets.push({ name: "Loan Register", headRows: 1, rows: [
    ["Account", "PN", "Borrower", "CIF", "Branch", "Product", "Security status", "Coverage", "DPD", "Aging band",
     "Performance", "Classification", "Stage", "Original", "Outstanding", "ACL basis", "Rate", "Required ACL",
     "Booked ACL", "Variance", "Programme", "AFRD status", "AFRD eligible", "Relationship", "Enterprise size",
     "Contract", "Memorandum state", "Housing type", "PSIC", "In portfolio", "Exceptions"],
    ...t.all.map(c => [c.account.accountNo, c.account.pnNo || "", c.account.borrower, c.account.cif || "",
      Eng.get(c.account, "branch") || "", c.product, c.security.label, c.security.coverage, c.perf.dpd, c.perf.band,
      c.perf.cls, c.acl.cls, c.acl.stage || "", N(c.account.principal), c.balance, c.acl.basis, c.acl.rate,
      c.acl.required, c.acl.booked, c.acl.variance || 0, c.program.program, c.afrd.label, c.afrd.eligible,
      c.relationship.label, c.msme.label, c.contract.label, c.memo.label, c.housing ? c.housing.cls : "",
      Eng.get(c.account, "psic") || "", c.inPortfolio ? "Yes" : "No", c.exceptions.length])
  ]});

  sheets.push({ name: "Aging and Classification", headRows: 1, rows: [
    ["Aging band", "Accounts", "Outstanding", "Share of portfolio", "Required ACL", "Effective rate"],
    ...R.agingBands.map(b => {
      const rows = t.port.filter(c => c.perf.dpd >= b.min && c.perf.dpd <= b.max);
      const bal = rows.reduce((a, c) => a + c.balance, 0), acl = rows.reduce((a, c) => a + c.acl.required, 0);
      return [b.label, rows.length, bal, t.gross ? bal / t.gross : 0, acl, bal ? acl / bal : 0];
    }),
    ["Total", t.count, t.gross, 1, t.required, t.gross ? t.required / t.gross : 0]
  ]});

  sheets.push({ name: "Impairment and ACL", headRows: 1, rows: [
    ["Account", "Borrower", "Outstanding", "ACL basis", "DPD", "Matrix used", "Classification", "Stage", "Rate",
     "Matrix amount", "Small-loan floor", "Floor applied", "Overlay", "Required", "Booked", "Variance", "Derivation"],
    ...t.all.map(c => [c.account.accountNo, c.account.borrower, c.balance, c.acl.basis, c.perf.dpd, c.acl.table,
      c.acl.cls, c.acl.stage || "", c.acl.rate, c.acl.matrixAmount || 0, c.acl.floor || 0,
      c.acl.floorApplied ? "Yes" : "No", c.acl.overlay || 0, c.acl.required, c.acl.booked, c.acl.variance || 0,
      c.acl.skipped ? c.acl.reason : c.acl.why])
  ]});

  sheets.push({ name: "Collateral Register", headRows: 1, rows: [
    ["Account", "Borrower", "Security described", "Appraised value", "Eligible value", "Exposure", "Coverage",
     "Secured portion", "Unsecured portion", "Perfected", "Classification", "ACL table used", "Finding"],
    ...t.port.map(c => [c.account.accountNo, c.account.borrower, c.security.secDesc || "", c.security.appraised,
      c.security.eligible, c.balance, c.security.coverage, c.security.securedPortion, c.security.unsecuredPortion,
      c.security.perfected ? "Yes" : "No", c.security.label, c.acl.table, c.security.reason])
  ]});

  const req = R.totalLoanableFunds * R.afrdRate;
  const elig = t.all.reduce((a, c) => a + c.afrd.eligible, 0);
  sheets.push({ name: "AFRD Schedule", headRows: 1, rows: [
    ["Step", "Amount", "Note"],
    ["Total loanable funds", R.totalLoanableFunds, "Denominator. Statutory basis under RA 11901."],
    ["Mandatory requirement", req, "25% of total loanable funds"],
    ["Net AFRD-eligible amount", elig, "Validated eligible less exclusions"],
    ["Compliance percentage", R.totalLoanableFunds ? elig / R.totalLoanableFunds : 0, ""],
    ["Excess / (deficiency)", elig - req, ""],
    [], ["Account", "Borrower", "Product", "Programme", "Gross", "Eligible", "Excluded", "Status", "Reason"],
    ...t.all.map(c => [c.account.accountNo, c.account.borrower, c.product, c.program.program, c.balance,
      c.afrd.eligible, c.afrd.excluded, c.afrd.label, c.afrd.reason])
  ]});

  sheets.push({ name: "Government Programmes", headRows: 1, rows: [
    ["Account", "Borrower", "Programme", "Gross exposure", "Government share", "RBCCI counterpart",
     "Retained risk", "RBCCI at risk", "ACL basis", "Required ACL", "Basis note"],
    ...t.all.filter(c => c.program.program !== "BANK").map(c => [c.account.accountNo, c.account.borrower,
      c.program.program, c.program.gross, c.program.sbcorpFunded, c.program.rbcciCounterpart, c.program.retained,
      c.program.atRisk, c.program.aclBasis, c.acl.required, c.program.basisNote])
  ]});

  sheets.push({ name: "DOSRI_RPT", headRows: 1, rows: [
    ["Account", "Borrower", "Relationship", "DOSRI type", "Outstanding", "Approval reference", "Performance", "Finding"],
    ...t.all.filter(c => c.relationship.dosri).map(c => [c.account.accountNo, c.account.borrower,
      c.relationship.label, c.relationship.type || "", c.balance, Eng.get(c.account, "dosriApproval") || "",
      c.perf.cls, Eng.get(c.account, "dosriApproval") ? "" : "Missing approval reference"])
  ]});

  sheets.push({ name: "Collection and Remedial", headRows: 1, rows: [
    ["Queue", "Account", "Borrower", "DPD", "Aging band", "Performance", "State", "Outstanding", "Officer"],
    ...t.all.filter(c => c.perf.dpd > 0 || !c.inPortfolio).map(c => [
      c.program.program === "BANK" ? "Bank-funded" : c.program.program + " programme",
      c.account.accountNo, c.account.borrower, c.perf.dpd, c.perf.band, c.perf.cls, c.memo.label, c.balance,
      Eng.get(c.account, "officer") || ""])
  ]});

  sheets.push({ name: "Exceptions", headRows: 1, rows: [
    ["Severity", "Rule", "Account", "Borrower", "Finding", "Required correction", "Owner", "Status"],
    ...t.exceptions.map(e => [e.sev === "BLOCK" ? "Blocking" : "Warning", e.code, e.key, e.borrower, e.msg, e.fix, "Loans Department", "Open"])
  ]});

  const rc = S.reconciliation[periodKey()] || {};
  const ending = N(rc.beginning) + N(rc.releases) + N(rc.availments) - N(rc.collections) - N(rc.fullyPaid) - N(rc.writeOffs) - N(rc.ropa) + N(rc.recoveries) + N(rc.adjustments);
  sheets.push({ name: "Reconciliation", headRows: 1, rows: [
    ["Movement", "Amount"],
    ["Beginning balance", N(rc.beginning)], ["Releases", N(rc.releases)], ["Additional availments", N(rc.availments)],
    ["Collections", -N(rc.collections)], ["Fully paid", -N(rc.fullyPaid)], ["Write-offs", -N(rc.writeOffs)],
    ["ROPA transfers", -N(rc.ropa)], ["Recoveries", N(rc.recoveries)], ["Adjustments", N(rc.adjustments)],
    ["Computed ending balance", ending], ["LPMRS register total", t.gross], ["Difference", ending - t.gross]
  ]});

  sheets.push({ name: "Parameters", headRows: 1, rows: [
    ["Parameter", "Value", "Source"],
    ["Rule version", R.ruleVersion, "Parameter governance"],
    ["Effective date", R.effectiveDate, ""],
    ["Approval state", R.approvalState, ""],
    ["Active reporting-scope profile", activeProfile().label, "Source conflict held as a profile"],
    ["Profile treatment", activeProfile().text, ""],
    ["Curing period (days)", R.curingDays, "Source IV"],
    ["NPL threshold (days)", R.nplDpdThreshold, "Source IV"],
    ["GLLP rate", R.gllpRate, "ACL instruction"],
    ["Small-loan threshold", R.smallLoanThreshold, "ACL instruction"],
    ["Small-loan minimum ACL", R.smallLoanMinimumAcl, "ACL instruction"],
    ["Floor suppressed on memorandum accounts", R.suppressFloorOnMemo ? "Yes" : "No", "No recognised receivable"],
    ["Secured rates require collateral evidence", R.securedRatesRequireCollateral ? "Yes" : "No", "Source III"],
    ["AFRD required rate", R.afrdRate, "RA 11901"],
    ["AFRD denominator", "Total loanable funds", "Source VI"],
    ["SBCorp retained risk share", R.sbcorpRetainedDefault, "Programme agreement"],
    ["SBCorp risk transfer confirmed", R.sbcorpRiskTransferConfirmed ? "Yes" : "No", "Legal and Accounting"],
    [], ["Unsecured ACL matrix", "From", "To", "Classification", "Rate", "Stage"],
    ...R.aclUnsecured.map(b => ["", b.min, b.max, b.cls, b.rate, b.stage]),
    [], ["Secured ACL matrix", "From", "To", "Classification", "Rate", "Escalated", "Stage"],
    ...R.aclSecured.map(b => ["", b.min, b.max, b.cls, b.rate, b.escalated || "", b.stage]),
    [], ["Housing ceiling (horizontal)", "Up to"],
    ...R.housingHorizontal.map(b => ["", b.cls, b.max === Infinity ? "no ceiling" : b.max]),
    [], ["Housing ceiling (vertical)", "Up to"],
    ...R.housingVertical.map(b => ["", b.cls, b.max === Infinity ? "no ceiling" : b.max])
  ]});

  return await Xlsx.write(sheets);
}

async function exportWorkbook() {
  try {
    toast("Building workbook…");
    const blob = await buildWorkbook();
    const name = `RBCCI_LPMRS_${periodKey()}_${today().replace(/-/g, "")}.xlsx`;
    download(name, blob);
    await Vault.put(`exports/${name}.meta.json`, JSON.stringify({ name, period: periodKey(), generated: new Date().toISOString(), rules: S.rules.ruleVersion })).catch(() => {});
    audit("Exported workbook", name);
    toast("Workbook exported: " + name);
  } catch (e) { toast("Export failed: " + e.message, "err"); }
}
function exportJson() {
  const name = `RBCCI_LPMRS_backup_${periodKey()}_${today().replace(/-/g, "")}.json`;
  download(name, new Blob([JSON.stringify(S, null, 2)], { type: "application/json" }));
  audit("Exported JSON backup", name);
  toast("Backup exported.");
}

/* --------------------------------------------------------- backup restore */
let _restorePayload = null;
function openRestore() {
  _restorePayload = null;
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:18px">Restore from a JSON backup</h2>
    <p class="sm">Choose a backup file exported from this application. Nothing is changed until you review the summary and confirm.</p>
    <div class="note w"><b>Restoring replaces the current working state</b>Take a fresh export of the current data first if you might need it.</div>
    <label class="f">Backup file (.json)<input type="file" id="restoreFile" accept=".json,application/json"></label>
    <div id="restorePreview"></div>
    <div class="bar" style="margin-top:14px">
      <button class="btn ghost" id="restoreCancel">Cancel</button>
      <button class="btn bad" id="restoreGo" disabled>Restore this backup</button>
    </div>`;
  $("modal").classList.add("on");
  $("restoreCancel").onclick = () => { _restorePayload = null; $("modal").classList.remove("on"); };
  const go = $("restoreGo");
  $("restoreFile").onchange = async (e) => {
    const f = e.target.files[0];
    const prev = $("restorePreview");
    go.disabled = true; _restorePayload = null;
    if (!f) { prev.innerHTML = ""; return; }
    prev.innerHTML = '<p class="mut sm">Reading file…</p>';
    try {
      const text = await f.text();
      const p = JSON.parse(text);
      if (!p || typeof p !== "object" || !Array.isArray(p.accounts)) {
        prev.innerHTML = '<div class="note b"><b>Not a recognised RBCCI LPMRS backup.</b>The file does not contain the expected structure (an "accounts" array).</div>';
        return;
      }
      _restorePayload = p;
      const periods = Object.keys(p.workflow || {});
      const locked = periods.filter(k => (p.workflow[k] || {}).status === "LOCKED");
      const contractEvents = Object.values(p.contractVersions || {}).reduce((a, v) => a + v.length, 0);
      const collectionEvents = Object.values(p.collectionActions || {}).reduce((a, v) => a + v.length, 0);
      prev.innerHTML = `<div class="card" style="margin-top:10px"><h3>Backup contents</h3><dl class="kv">
          <dt>Accounts</dt><dd>${CNT(p.accounts.length)}</dd>
          <dt>Rule version</dt><dd>${E(p.rules ? p.rules.ruleVersion : "unknown")}</dd>
          <dt>Periods with workflow data</dt><dd>${CNT(periods.length)} (${CNT(locked.length)} locked)</dd>
          <dt>Contract version events</dt><dd>${CNT(contractEvents)}</dd>
          <dt>Collection / remedial actions</dt><dd>${CNT(collectionEvents)}</dd>
          <dt>Audit entries</dt><dd>${CNT((p.audit || []).length)}</dd>
        </dl></div>`;
      go.disabled = false;
    } catch (err) {
      prev.innerHTML = `<div class="note b"><b>Could not read this file.</b>${E(err.message)}</div>`;
    }
  };
  go.onclick = () => {
    if (!_restorePayload) return;
    $("modalBody").innerHTML = `<h2 style="margin:0 0 8px;font-size:18px;color:var(--bad)">Confirm restore</h2>
      <p class="sm">This replaces every account, rule, workflow status and audit entry currently in this browser profile with the contents of the backup. This cannot be undone from inside the application.</p>
      <div class="bar"><button class="btn ghost" id="rc2">Cancel</button><button class="btn bad" id="rg2">Yes, restore this backup</button></div>`;
    $("rc2").onclick = () => { _restorePayload = null; $("modal").classList.remove("on"); };
    $("rg2").onclick = () => { confirmRestore(); };
  };
}
function confirmRestore() {
  const p = _restorePayload;
  if (!p) { $("modal").classList.remove("on"); return; }
  S = Object.assign(initialState(), p);
  S.rules = Object.assign(defaultRules(), p.rules || {});
  restoreHousingCeilings(p);
  S.rules.riskTiers = (p.rules && p.rules.riskTiers) ? p.rules.riskTiers : defaultRules().riskTiers;
  /* A backup taken before the account-state controls existed carries the
     old templates with it, so restoring one must migrate them too. */
  if (typeof migrateLetterTemplates === "function") migrateLetterTemplates();
  S.letters = p.letters || {};
  S.contractVersions = p.contractVersions || {};
  S.collectionActions = p.collectionActions || {};
  S.snapshots = p.snapshots || {};
  _restorePayload = null;
  invalidate();
  audit("Restored from backup", `${(p.accounts || []).length} accounts, rule version ${S.rules.ruleVersion}`);
  $("modal").classList.remove("on");
  toast("Backup restored.");
  go("dashboard");
}


/* ------------------------------------------- extended workbook export */
/* --------------------------------------------- extended workbook export */
function extraSheets() {
  const t = totals(), mv = deriveMovement();
  const amRows = [["Account", "Borrower", "Instalment no.", "Due date", "Payment", "Principal", "Interest", "Balance"]];
  t.port.slice(0, 120).forEach(function (c) {
    amortisation(c.account).rows.slice(0, 60).forEach(function (r) {
      amRows.push([c.account.accountNo, c.account.borrower, r.k, r.due, r.payment, r.principal, r.interest, r.balance]);
    });
  });
  return [
    { name: "Amortisation Schedules", headRows: 1, rows: amRows },
    { name: "Portfolio Movement", headRows: 1, rows: [["Movement", "Accounts", "Amount"]].concat(
      mv.available ? mv.lines : [["No prior snapshot available for " + mv.priorKey, "", 0]]) },
    { name: "Regulatory Mapping", headRows: 1, rows: [["Return", "Line item", "Source in the LPMRS", "Value", "Status"]].concat(
      regulatoryMap().map(r => [r.report, r.line, r.src, r.val, r.ready ? "Computing" : "Awaiting official template"])) },
    { name: "Audit Trail", headRows: 1, rows: [["Timestamp", "Role", "Action", "Detail"]].concat(
      S.audit.slice(0, 2000).map(a => [a.ts.replace("T", " ").slice(0, 19), a.role, a.action, a.detail])) }
  ];
}
exportWorkbook = async function () {
  const orig = Xlsx.write;
  try {
    toast("Building workbook...");
    const extra = extraSheets();
    Xlsx.write = function (sheets) { return orig(sheets.concat(extra)); };
    const blob = await buildWorkbook();
    Xlsx.write = orig;
    const name = "RBCCI_LPMRS_" + periodKey() + "_" + today().replace(/-/g, "") + ".xlsx";
    download(name, blob);
    await Vault.put("exports/" + name + ".meta.json", JSON.stringify({ name: name, period: periodKey(), generated: new Date().toISOString(), rules: S.rules.ruleVersion })).catch(() => {});
    audit("Exported workbook", name + ", 16 schedules");
    toast("Workbook exported with 16 schedules: " + name);
  } catch (e) {
    Xlsx.write = orig;
    toast("Export failed: " + e.message, "err");
  }
};

/* ==================================================================== */
/*  File diagnostic                                                     */
/*  When an import fails on one workbook but works on another, the file */
/*  itself is the only way to find out why — and a loan report cannot   */
/*  usually be emailed, because it carries borrower names and balances. */
/*  This inspects the file in the browser and produces a short report    */
/*  describing its STRUCTURE only: package parts, sheet names, row and   */
/*  column counts, header text and cell types. No borrower name, no      */
/*  account number and no balance is included, so it can be sent on      */
/*  without disclosing customer data.                                    */
/* ==================================================================== */
async function diagnoseFile(file) {
  const L = [];
  const say = (k, v) => L.push(String(k).padEnd(30) + " " + v);
  say("Diagnostic for", file.name);
  say("Size", (file.size / 1024).toFixed(1) + " KB");
  say("Last modified", new Date(file.lastModified).toISOString().slice(0, 19).replace("T", " "));
  say("Application version", APP.version);
  say("Browser", (navigator.userAgent || "").slice(0, 110));
  say("Decompression available", typeof DecompressionStream !== "undefined" ? "yes" : "NO - cannot read .xlsx");
  L.push("");

  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { say("FAILED", "could not read the file at all: " + e.message); return L.join("\n"); }

  const head = new Uint8Array(buf.slice(0, 8));
  const magic = Array.from(head).map(b => b.toString(16).padStart(2, "0")).join(" ");
  say("First bytes", magic);
  /* PK.. is a zip, which every .xlsx is. D0 CF 11 E0 is the old binary .xls
     format, which this reader cannot open however the file is named. */
  if (head[0] === 0xD0 && head[1] === 0xCF)
    say("Format", "OLD BINARY .xls - this is not an .xlsx and cannot be read. Re-save as .xlsx.");
  else if (head[0] !== 0x50 || head[1] !== 0x4B)
    say("Format", "NOT A ZIP - the file is not a readable .xlsx.");
  else say("Format", "zip container, as expected for .xlsx");
  L.push("");

  let z;
  try { z = await ZipRead.entries(buf); }
  catch (e) { say("FAILED at", "reading the package directory: " + e.message); return L.join("\n"); }
  const names = Object.keys(z);
  say("Package parts", names.length);
  const methods = {};
  Object.values(z).forEach(e => { const m = e.method; methods[m] = (methods[m] || 0) + 1; });
  say("Compression methods", Object.entries(methods).map(([m, n]) =>
    m + (m === "0" ? " (stored)" : m === "8" ? " (deflate)" : " (UNSUPPORTED)") + " x" + n).join(", "));
  ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/styles.xml"].forEach(n =>
    say("  " + n, names.includes(n) ? "present" : "MISSING"));
  say("  worksheets", names.filter(n => /^xl\/worksheets\/.*\.xml$/.test(n)).length);
  L.push("");

  let sheets;
  const t0 = Date.now();
  try { sheets = await Xlsx.read(buf); }
  catch (e) { say("FAILED at", "parsing the sheets: " + e.message); return L.join("\n"); }
  say("Parse time", (Date.now() - t0) + " ms");
  say("Sheets found", sheets.length);
  L.push("");

  /* Only the row identified as the header is ever printed. Column labels are
     not customer data; anything else on the sheet may be. Where no header can
     be identified, the shape of the row is reported and its contents are not.
     An earlier version printed the first two rows of every sheet, which on a
     workbook whose first row is a title meant printing a borrower's name,
     telephone number and address. */
  const looksLikeHeader = cells => {
    const filled = cells.filter(v => String(v ?? "").trim() !== "");
    if (filled.length < 3) return false;
    /* Header cells are short labels: mostly letters, few digits, no dates. */
    const labelish = filled.filter(v => {
      const t = String(v).trim();
      return t.length <= 60 && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isFinite(+t)
        && (t.match(/\d/g) || []).length <= 2;
    });
    return labelish.length >= filled.length * 0.8;
  };

  sheets.forEach(sh => {
    const widest = sh.rows.reduce((a, r) => Math.max(a, r.length), 0);
    say("SHEET " + JSON.stringify(sh.name), sh.rows.length + " rows, widest " + widest + " columns");
    if (!sh.rows.length) { L.push("    (no rows returned - this sheet could not be read)"); return; }

    /* Find the header row the importer would choose. */
    let hdrIdx = -1, hdrScore = -1;
    for (let i = 0; i < Math.min(6, sh.rows.length); i++) {
      const cells = sh.rows[i].map(String);
      if (!looksLikeHeader(cells)) continue;
      const m = mapHeaders(cells).map;
      const sc = Object.keys(m).length + (m.balance !== undefined ? 8 : 0) + (m.accountNo !== undefined ? 8 : 0);
      if (sc > hdrScore) { hdrScore = sc; hdrIdx = i; }
    }

    for (let i = 0; i < Math.min(4, sh.rows.length); i++) {
      const cells = sh.rows[i].map(v => String(v ?? ""));
      const filled = cells.filter(v => v.trim() !== "").length;
      L.push("    row " + (i + 1) + ": " + filled + " non-empty of " + cells.length
        + (i === hdrIdx ? "   <- header row" : ""));
    }
    if (hdrIdx >= 0) {
      L.push("    header labels: " + JSON.stringify(sh.rows[hdrIdx].map(String).slice(0, 16)));
      const m = mapHeaders(sh.rows[hdrIdx].map(String));
      say("    columns mapped", Object.keys(m.map).length + " of " + sh.rows[hdrIdx].length
        + "   score " + hdrScore);
      say("      account number found", m.map.accountNo !== undefined ? "yes" : "NO");
      say("      balance found", m.map.balance !== undefined ? "yes" : "NO");
      if (m.unmapped.length)
        L.push("    unmapped headers: " + JSON.stringify(m.unmapped.map(u => u.header).slice(0, 12)));
    } else {
      L.push("    no header row identified in the first 6 rows; contents not shown");
    }
    /* Cell shapes only, never cell contents. */
    const dataIdx = hdrIdx >= 0 ? hdrIdx + 1 : Math.min(1, sh.rows.length - 1);
    const sample = sh.rows[dataIdx] || [];
    L.push("    first data row cell types: " + JSON.stringify(sample.slice(0, 16).map(v => {
      const t = String(v ?? "");
      if (t === "") return "empty";
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return "date";
      if (Number.isFinite(+t)) return "number";
      return "text(" + t.length + ")";
    })));
    L.push("");
  });

  say("End of diagnostic", "no borrower names, account numbers or balances are included above");
  return L.join("\n");
}

async function runDiagnostic(files) {
  if (!files || !files.length) { toast("Choose a file to check first.", "err"); return; }
  toast("Checking " + files[0].name + "\u2026");
  let text;
  try { text = await diagnoseFile(files[0]); }
  catch (e) { text = "Diagnostic itself failed: " + (e && e.message); }
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:18px">File check</h2>
    <p class="mut sm" style="margin:0 0 10px">This describes the structure of the file only. It contains no borrower names, account numbers or balances, so it is safe to send on.</p>
    <div class="tree" style="max-height:340px;white-space:pre">${E(text)}</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="dgClose">Close</button>
      <button class="btn" id="dgSave">Save as a text file</button>
    </div>`;
  $("modal").classList.add("on");
  $("dgClose").onclick = () => $("modal").classList.remove("on");
  $("dgSave").onclick = () => download("file-check-" + today().replace(/-/g, "") + ".txt",
    new Blob([text], { type: "text/plain" }));
}
