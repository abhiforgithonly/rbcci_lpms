"use strict";

/* ===================================================== letters.js
   Collection and remedial correspondence (spec section 4).

   Templates are configuration held on the rule set, not code. Each one
   is a subject plus a body containing {{token}} placeholders which are
   resolved against the loan register at the moment of generation, so
   borrower and loan details are never re-keyed by an officer.

   Two output formats are produced from the same resolved text:
     - PDF  via the portrait mode of the Pdf writer in pdf.js
     - DOCX via a minimal WordprocessingML package built with ZipWrite
   Neither needs a library, which keeps the offline-first constraint.   */

/* ------------------------------------------------------------ templates */
const LETTER_TPL_SCHEMA = 4;   /* bump when default wording or control fields change */
function defaultLetterTemplates() {
  const head = "{{bankName}}\n{{bankAddress}}\n\n{{todayLong}}\n\n{{borrower}}\n{{borrowerAddress}}\n\n"
    + "Re: Account No. {{accountNo}}\nOur reference: {{letterRef}}\n";
  return [
    {
      id: "TPL-REMINDER", v: LETTER_TPL_SCHEMA, shippedDpd: [1, 30], recognisedOnly: true, excludeClasses: ["ITL"], name: "Payment Reminder", category: "REMINDER", active: true,
      minDpd: 1, maxDpd: 30, approvalState: "APPROVED",
      subject: "Payment reminder - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "This is a courtesy reminder that your account with {{bankName}} shows an outstanding balance of {{balance}} "
        + "and is {{dpd}} day(s) past due as of {{cutoff}}.\n\n"
        + "Amortisation amount: {{amortisation}}\nLast payment received: {{lastPaymentDate}}\n\n"
        + "Kindly settle the amount due at any of our branches at your earliest convenience. "
        + "If payment has already been made, please disregard this notice and accept our thanks.\n\n"
        + "For any concern regarding this account, you may contact the undersigned.\n\n"
        + "Very truly yours,\n\n\n{{officer}}\n{{officerTitle}}\n{{bankName}}"
    },
    {
      id: "TPL-PASTDUE", v: LETTER_TPL_SCHEMA, shippedDpd: [31, 90], recognisedOnly: true, excludeClasses: ["ITL"], name: "Past-Due Notice", category: "PASTDUE", active: true,
      minDpd: 31, maxDpd: 90, approvalState: "APPROVED",
      subject: "Past-due notice - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "Our records show that the above account is now {{dpd}} day(s) past due, with an outstanding balance of "
        + "{{balance}} as of {{cutoff}}. The account is presently classified as {{classification}}.\n\n"
        + "Continued non-payment will affect your credit standing with this institution and may require us to "
        + "endorse the account for further remedial action.\n\n"
        + "We request that you settle the past-due amount, or visit our office to discuss a workable payment "
        + "arrangement, within fifteen (15) days from the date of this notice.\n\n"
        + "Very truly yours,\n\n\n{{officer}}\n{{officerTitle}}\n{{bankName}}"
    },
    {
      id: "TPL-COLLECTION", v: LETTER_TPL_SCHEMA, shippedDpd: [31, 180], recognisedOnly: true, excludeClasses: ["ITL"], name: "Collection Letter", category: "COLLECTION", active: true,
      minDpd: 31, maxDpd: 180, approvalState: "APPROVED",
      subject: "Collection letter - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "Despite previous reminders, the above account remains unpaid. As of {{cutoff}} the account carries an "
        + "outstanding balance of {{balance}}, is {{dpd}} day(s) in arrears, and falls within the {{agingBand}} "
        + "aging bracket.\n\n"
        + "Original principal: {{principal}}\nMaturity date: {{maturityDate}}\n\n"
        + "We strongly urge you to settle this obligation or to contact the undersigned to arrange terms. "
        + "Your cooperation will allow us to resolve this matter without resorting to further measures.\n\n"
        + "Very truly yours,\n\n\n{{officer}}\n{{officerTitle}}\n{{bankName}}"
    },
    {
      id: "TPL-DEMAND", v: LETTER_TPL_SCHEMA, shippedDpd: [91, null], recognisedOnly: true, excludeClasses: ["ITL"], name: "Demand Letter", category: "DEMAND", active: true,
      minDpd: 91, maxDpd: null, approvalState: "APPROVED",
      subject: "FINAL DEMAND - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "FINAL DEMAND FOR PAYMENT\n\n"
        + "The above account is {{dpd}} day(s) past due with a total outstanding obligation of {{balance}} as of "
        + "{{cutoff}}, and is classified as {{classification}}.\n\n"
        + "Formal demand is hereby made for full payment of the said obligation within fifteen (15) days from "
        + "receipt of this letter. Failure to comply within the said period will constrain us to refer this matter "
        + "to our legal counsel for the filing of appropriate action, and to proceed against any security "
        + "constituted in favour of the Bank, without further notice.\n\n"
        + "This is our final demand.\n\n"
        + "Very truly yours,\n\n\n{{approver}}\n{{approverTitle}}\n{{bankName}}"
    },
    {
      id: "TPL-REMEDIAL", v: LETTER_TPL_SCHEMA, shippedDpd: [91, null], recognisedOnly: true, excludeClasses: ["ITL"], name: "Remedial Letter", category: "REMEDIAL", active: true,
      minDpd: 91, maxDpd: null, approvalState: "APPROVED",
      subject: "Restructuring / remedial options - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "We recognise that circumstances may have affected your ability to service the above account, which "
        + "currently carries an outstanding balance of {{balance}} and is {{dpd}} day(s) past due.\n\n"
        + "{{bankName}} is prepared to discuss remedial arrangements, which may include restructuring of the "
        + "remaining term, a revised amortisation schedule, or a settlement programme, subject to evaluation and "
        + "approval.\n\n"
        + "Please visit our office within fifteen (15) days so that we may discuss the options available to you. "
        + "Kindly bring proof of income and any supporting documents relevant to your present situation.\n\n"
        + "Very truly yours,\n\n\n{{officer}}\n{{officerTitle}}\n{{bankName}}"
    },
    {
      id: "TPL-PTP", v: LETTER_TPL_SCHEMA, shippedDpd: [null, null], recognisedOnly: true, excludeClasses: ["ITL"], name: "Promise-to-Pay Confirmation", category: "OTHER", active: true,
      minDpd: null, maxDpd: null, approvalState: "APPROVED",
      subject: "Confirmation of payment arrangement - Account {{accountNo}}",
      body: head + "\nDear {{salutation}},\n\n"
        + "This confirms the payment arrangement discussed in respect of the above account.\n\n"
        + "Amount committed: {{ptpAmount}}\nCommitted payment date: {{ptpDate}}\n"
        + "Outstanding balance as of {{cutoff}}: {{balance}}\n\n"
        + "Kindly ensure that payment is made on or before the committed date. Should circumstances prevent you "
        + "from meeting this arrangement, please advise the undersigned in advance.\n\n"
        + "Very truly yours,\n\n\n{{officer}}\n{{officerTitle}}\n{{bankName}}"
    }
  ];
}

/* --------------------------------------------------------- name handling
   The register stores borrowers surname-first in upper case, which is
   right for a loan record and wrong in the opening line of a letter:
   "Dear DIONGZON, GREGORIO JR. G." reads as an unfinished mail merge.

   Only the salutation is reformatted. The Re: line and the address block
   keep the register string verbatim, because those must match the loan
   record exactly for the letter to be evidence of anything.

   Anything that cannot be parsed with confidence falls back to
   "Sir/Madam" rather than risking a mangled name in front of a customer. */
const NAME_PARTICLES = ["DE", "DELA", "DELOS", "DEL", "DE LA", "DE LOS", "SAN", "STA", "STO", "VDA"];

/* Roman-numeral suffixes stay in capitals; Jr. and Sr. are ordinary words
   and read as shouting if left upper case. */
const ROMAN_SUFFIXES = ["II", "III", "IV", "V", "VI"];
const WORD_SUFFIXES = { JR: "Jr.", SR: "Sr." };

function titleCaseName(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])([a-z'’-]*)/g, (m, a, b) => {
    const up = (a + b).toUpperCase().replace(/\./g, "");
    if (ROMAN_SUFFIXES.includes(up)) return up;
    if (WORD_SUFFIXES[up]) return WORD_SUFFIXES[up];
    return a.toUpperCase() + b;
  }).replace(/\b([A-Z])\b(?!\.)/g, "$1.").replace(/\.\.+/g, ".").replace(/\s+/g, " ").trim();
}

/* "DIONGZON, GREGORIO JR. G." -> "Gregorio Jr. G. Diongzon" */
function flipOneName(raw) {
  const t = String(raw || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const parts = t.split(",").map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return titleCaseName(t);          // no comma: leave the order alone
  const surname = parts[0];
  const given = parts.slice(1).join(" ");
  return titleCaseName(given) + " " + titleCaseName(surname);
}

function salutationFor(c) {
  const raw = String(c.account.borrower || "").trim();
  if (!raw) return "Sir/Madam";

  /* A corporate borrower recorded with a named representative: address the
     representative, since a letter opens to a person, not to an entity. */
  const rep = /REP(?:RESENTED)?\.?\s*BY\s*:?\s*(.+)$/i.exec(raw);
  if (rep) {
    const who = flipOneName(rep[1]);
    return who ? who : "Sir/Madam";
  }
  /* Corporate names with no representative get a neutral opening. */
  if (/\b(CORP|CORPORATION|INC|OPC|COMPANY|CO|ENTERPRISES|SUPPLY|CONSTRUCTIONS?|TRADING|VENTURES|HOLDINGS|LTD)\b/i.test(raw)) {
    return "Sir/Madam";
  }
  /* Joint accounts: "SURNAME, GIVEN AND, SURNAME, GIVEN". Split on the
     conjunction, flip each side, then rejoin. */
  const joint = raw.split(/\s+AND,?\s+|\s*&\s*/i).map(x => x.trim()).filter(Boolean);
  if (joint.length > 1) {
    const names = joint.map(flipOneName).filter(Boolean);
    if (!names.length) return "Sir/Madam";
    return names.length === 2 ? names[0] + " and " + names[1]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }
  const one = flipOneName(raw);
  return one || "Sir/Madam";
}

/* Security description for correspondence. The engine's status label
   ("Documentation / perfection pending") is an internal control finding
   and must never be disclosed to a borrower — telling a defaulting
   customer that the bank's own security is unperfected is a gift to the
   other side. Only genuinely perfected, valued security is named; anything
   else returns blank so the line can be omitted entirely. */
function disclosableSecurity(c) {
  const perfected = String(Eng.get(c.account, "collateralPerfected") || "").toUpperCase() === "Y";
  const value = N(Eng.get(c.account, "eligibleCollateralValue")) || N(Eng.get(c.account, "collateralValue"));
  if (!perfected || !value) return "";
  return String(Eng.get(c.account, "securityDesc") || "").trim();
}

/* ------------------------------------------------------ token resolution */
/* Every token resolves from the computed account record, so a letter can
   never disagree with the register it was generated from. Unknown tokens
   are left visible as [token not available] rather than silently blanked,
   because a letter with a missing borrower name must be obvious. */
const LETTER_TOKENS = {
  bankName:        () => "Rural Bank of Calbayog City, Inc.",
  bankAddress:     () => "Calbayog City, Samar",
  today:           () => today(),
  todayLong:       () => longDate(today()),
  letterRef:       () => "(assigned on issue)",
  officerTitle:    () => S.rules.officerTitle || "Account Officer",
  approverTitle:   () => S.rules.approverTitle || "Branch Manager",
  cutoff:          () => longDate(S.cutoff),
  cutoffIso:       () => S.cutoff,
  salutation:      c => salutationFor(c),
  period:          () => periodKey(),
  accountNo:       c => c.account.accountNo || "",
  pnNo:            c => c.account.pnNo || "",
  borrower:        c => c.account.borrower || "",
  borrowerAddress: c => Eng.get(c.account, "address") || "",
  contactNo:       c => Eng.get(c.account, "contactNo") || "",
  cif:             c => c.account.cif || "",
  branch:          c => Eng.get(c.account, "branch") || "",
  product:         c => c.product || "",
  principal:       c => P(N(c.account.principal)),
  balance:         c => P(c.balance),
  amortisation:    c => P(N(Eng.get(c.account, "amortisationAmount"))),
  dpd:             c => CNT(c.perf.dpd),
  agingBand:       c => c.perf.band || "",
  performance:     c => c.perf.cls || "",
  classification:  c => c.perf.cls || "",
  security:        c => disclosableSecurity(c),
  maturityDate:    c => longDate(Eng.get(c.account, "maturityDate")) || "",
  grantDate:       c => longDate(Eng.get(c.account, "grantDate")) || "",
  lastPaymentDate: c => longDate(Eng.get(c.account, "lastPaymentDate")) || "not on record",
  interestRate:    c => Eng.get(c.account, "rate") ? PCT(N(Eng.get(c.account, "rate")) / 100, 2) : "",
  officer:         c => Eng.get(c.account, "officer") || (CURRENT_USER && CURRENT_USER.displayName) || (CURRENT_USER && CURRENT_USER.username) || "",
  approver:        () => wf().approver || (CURRENT_USER && CURRENT_USER.username) || "",
  ptpAmount:       c => c.collection.openPtp ? P(N(c.collection.openPtp.ptpAmount)) : "",
  ptpDate:         c => c.collection.openPtp ? (c.collection.openPtp.ptpDate || "") : ""
};

/* Tokens that carry money or a rate. A blank source field resolves to zero
   and formats as a real amount, so "Amortisation amount: PHP 0.00" reads
   as a fact rather than as missing data. These are treated as absent when
   they come out at zero, both in the gap warning and in the letter body. */
const ZERO_IS_MISSING = ["amortisation", "principal", "interestRate", "ptpAmount"];
const tokenMissing = (k, v) =>
  v === "" || v === null || v === undefined ||
  (ZERO_IS_MISSING.includes(k) && /^[^\d]*0(\.0+)?%?$/.test(String(v).replace(/[,\s]/g, "")));

function resolveLetter(tmpl, c, extra) {
  const fill = str => String(str || "").replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (extra && extra[k] !== undefined && extra[k] !== "") return String(extra[k]);
    const fn = LETTER_TOKENS[k];
    if (!fn) return "[" + k + " not available]";
    const v = fn(c);
    return tokenMissing(k, v) ? "[" + k + " not available]" : String(v);
  });
  /* A line whose only substantive content is an unavailable field is
     dropped rather than printed — a letter to a borrower should omit what
     the bank does not know, not announce it. */
  const body = fill(tmpl.body).split("\n")
    .filter(l => !/^\s*[A-Za-z][\w\s/()-]*:\s*\[\w+ not available\]\s*$/.test(l))
    .join("\n");
  return { subject: fill(tmpl.subject), body };
}

/* Tokens with no value on this account. Surfaced before generation so an
   officer is not the one to discover a blank in front of a borrower. */
function letterGaps(tmpl, c) {
  const used = new Set();
  (String(tmpl.subject) + " " + String(tmpl.body)).replace(/\{\{(\w+)\}\}/g, (m, k) => { used.add(k); return m; });
  return [...used].filter(k => {
    const fn = LETTER_TOKENS[k];
    if (!fn) return true;
    return tokenMissing(k, fn(c));
  });
}

/* ------------------------------------------------------- state gating
   Days past due alone is not a sufficient control on correspondence.
   An account already in litigation is past the demand stage — the case
   is with counsel and a fresh demand from the bank is procedurally wrong
   and may prejudice the pending action. An account written down to a P1
   memorandum no longer carries a recognised receivable, so a demand on it
   would formally claim one peso. Both must be blocked at the point of
   generation, not left to the officer to notice.

   Each template declares the states it may be used in. Anything a
   template does not permit is reported with a reason rather than being
   silently hidden, so the officer understands why an option is missing
   and can route the account correctly instead.                          */
function letterBlockReason(tmpl, c) {
  if (tmpl.recognisedOnly !== false && !c.inPortfolio) {
    return "Account holds no recognised receivable (" + c.memo.label + "). Its carrying balance is "
      + P(c.balance) + ", so a demand or collection notice would claim that amount. "
      + "Recovery on written-off accounts is handled outside ordinary collection correspondence.";
  }
  const cls = String(c.perf.cls || "").toUpperCase();
  const excl = (tmpl.excludeClasses || []).map(x => String(x).toUpperCase());
  if (excl.includes(cls)) {
    if (cls === "ITL") {
      return "Account is in litigation. The matter is with the bank's counsel; a further demand from the "
        + "bank direct to the borrower is a pre-litigation step and may prejudice the pending action. "
        + "Route correspondence through counsel.";
    }
    return "Template is not permitted on accounts classified " + c.perf.cls + ".";
  }
  const d = c.perf.dpd, lo = bound(tmpl.minDpd), hi = bound(tmpl.maxDpd);
  if (lo !== null && d < lo) return "Account is " + CNT(d) + " days past due; this template applies from " + CNT(lo) + " days.";
  if (hi !== null && d > hi) return "Account is " + CNT(d) + " days past due; this template applies up to " + CNT(hi) + " days.";
  return null;
}

/* Templates whose DPD window and state rules both permit this account. A
   bound that is blank, null or undefined means "no limit on that side" —
   the Parameters screen writes an empty string when a bound is cleared,
   and an empty string compared numerically would otherwise silently
   exclude every account. */
const bound = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
function templatesFor(c) {
  return (S.rules.letterTemplates || []).filter(t => t.active !== false)
    .filter(t => letterBlockReason(t, c) === null);
}
/* Every active template this account cannot use, with the reason. */
function templatesBlockedFor(c) {
  return (S.rules.letterTemplates || []).filter(t => t.active !== false)
    .map(t => ({ tmpl: t, reason: letterBlockReason(t, c) }))
    .filter(x => x.reason !== null);
}

/* ------------------------------------------------------------ PDF output */
function letterPdf(tmpl, c, extra) {
  const r = resolveLetter(tmpl, c, extra);
  const d = Pdf.doc({ portrait: true, plainFooter: true, noPageNumber: true });
  const paras = r.body.split("\n");
  paras.forEach(p => {
    if (!p.trim()) { d.line(11); return; }
    const bold = /^(FINAL DEMAND|Re:)/.test(p.trim()) || p.trim() === p.trim().toUpperCase() && p.trim().length > 12;
    d.wrap(p, 10.5, bold, 0, null, 14);
  });
  return d.finish();
}

/* ----------------------------------------------------------- DOCX output */
/* Minimal, valid WordprocessingML. Word, LibreOffice and Google Docs all
   open this; it is deliberately plain so there is nothing to go stale.   */
const xe = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

async function letterDocx(tmpl, c, extra) {
  const r = resolveLetter(tmpl, c, extra);
  const para = line => {
    const txt = line.trim();
    if (!txt) return '<w:p/>';
    const bold = /^(FINAL DEMAND|Re:)/.test(txt) || (txt === txt.toUpperCase() && txt.length > 12);
    return '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>'
      + (bold ? '<w:rPr><w:b/></w:rPr>' : "")
      + '<w:t xml:space="preserve">' + xe(line) + '</w:t></w:r></w:p>';
  };
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + r.body.split("\n").map(para).join("")
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    + '</w:body></w:document>';

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  return ZipWrite.build([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document }
  ], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

/* --------------------------------------------------------- issue a letter */
/* Generating correspondence is itself a collection action: it is written to
   the account's action history and the letter register, so the work queue
   reflects it immediately and the audit trail carries who issued what. */
async function issueLetter(c, tmplId, format, extra) {
  const tmpl = (S.rules.letterTemplates || []).find(t => t.id === tmplId);
  if (!tmpl) { toast("That template no longer exists.", "err"); return; }
  if (isLocked()) { toast("This period is locked. Open an amendment before issuing correspondence.", "err"); return; }
  /* Re-checked here, not only in the picker. The picker is a convenience;
     this is the control. */
  const blocked = letterBlockReason(tmpl, c);
  if (blocked) { toast("Cannot issue " + tmpl.name + " on this account. " + blocked, "err"); return; }

  /* The reference is assigned before the text is resolved so that the
     letter itself carries the same reference that is logged against the
     account — otherwise a borrower reply could not be matched back. */
  const ref = "LTR-" + periodKey().replace(/-/g, "") + "-" + String((allLetters().length + 1)).padStart(4, "0");
  extra = Object.assign({}, extra, { letterRef: ref });
  const safe = String(c.account.accountNo || "account").replace(/[^\w.-]/g, "_");
  const base = tmpl.category + "_" + safe + "_" + today().replace(/-/g, "");

  try {
    if (format === "docx") download(base + ".docx", await letterDocx(tmpl, c, extra));
    else download(base + ".pdf", letterPdf(tmpl, c, extra));
  } catch (e) { toast("Could not generate the letter: " + e.message, "err"); return; }

  const rec = { id: uid(), ts: new Date().toISOString(), ref, templateId: tmpl.id,
    templateName: tmpl.name, category: tmpl.category, format: format || "pdf",
    issuedBy: (CURRENT_USER && CURRENT_USER.username) || "", period: periodKey() };
  S.letters[c.key] = S.letters[c.key] || [];
  S.letters[c.key].push(rec);

  S.collectionActions[c.key] = S.collectionActions[c.key] || [];
  S.collectionActions[c.key].push({
    id: uid(), ts: rec.ts, type: tmpl.category === "DEMAND" ? "DEMAND" : "LETTER",
    officer: LETTER_TOKENS.officer(c), contactResult: tmpl.name + " issued (" + ref + ")",
    nextAction: "", targetDate: "", status: "COMPLETED",
    remarks: "Generated from template " + tmpl.id + " as " + String(format || "pdf").toUpperCase(),
    letterRef: ref, cost: 0, recovery: 0
  });

  invalidate();
  audit("Issued collection letter", `${ref} — ${tmpl.name} to ${c.account.borrower} (${c.account.accountNo})`);
  saveState();
  toast(tmpl.name + " generated and logged as " + ref + ".");
  render();
}

function allLetters() {
  return Object.values(S.letters || {}).reduce((a, x) => a.concat(x), []);
}

/* ------------------------------------------------- template migration
   Templates live on the rule set, which is persisted. A browser that has
   already run the application restores its saved rule set, so new control
   fields and corrected wording shipped in a later build would never reach
   it — the account state gating below was added after first release and
   would have stayed inert on every existing installation.

   Each default carries a schema version. Any stored template at an older
   version is replaced wholesale, and its operator-set fields (DPD window,
   active flag, name) are carried across so local configuration survives.
   Templates the bank added itself are left untouched.                    */
function migrateLetterTemplates() {
  const R = S.rules;
  if (!R) return 0;
  const defs = defaultLetterTemplates();
  R.letterTemplates = R.letterTemplates || [];
  let changed = 0;
  defs.forEach(def => {
    const i = R.letterTemplates.findIndex(t => t.id === def.id);
    if (i < 0) { R.letterTemplates.push(def); changed++; return; }
    const old = R.letterTemplates[i];
    if ((old.v || 0) >= def.v) return;
    /* shippedDpd is provenance, not configuration — always taken from the
       default so a stored copy cannot misreport what the wording assumes. */
    R.letterTemplates[i] = Object.assign({}, def, {
      name:   old.name !== undefined ? old.name : def.name,
      minDpd: old.minDpd !== undefined ? old.minDpd : def.minDpd,
      maxDpd: old.maxDpd !== undefined ? old.maxDpd : def.maxDpd,
      active: old.active !== undefined ? old.active : def.active
    });
    changed++;
  });
  return changed;
}

/* A widened DPD window is legitimate configuration, but it can put a
   courtesy reminder in front of a borrower five months in arrears. The
   picker reports the drift rather than preventing it — the bank owns the
   policy, the software owns making the consequence visible. */
function templateToneWarning(tmpl, c) {
  if (!tmpl.shippedDpd) return null;
  const [lo, hi] = tmpl.shippedDpd;
  const d = c.perf.dpd;
  if (hi !== null && hi !== undefined && d > hi) {
    return tmpl.name + " was written for accounts up to " + CNT(hi) + " days past due; this account is "
      + CNT(d) + ". Its wording will read as too mild for the arrears.";
  }
  if (lo !== null && lo !== undefined && d < lo) {
    return tmpl.name + " was written for accounts from " + CNT(lo) + " days past due; this account is "
      + CNT(d) + ". Its wording will read as too severe.";
  }
  return null;
}
