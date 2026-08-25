"use strict";

/* ===================================================== engine.js
   Eng: independent per-account classification engine.
   Portfolio roll-up, automatic period movement, amortisation
   schedules, and regulatory-return field mapping.                */

/* ============================================================== ENGINES
   Each dimension is computed independently. No dimension is allowed to
   silently determine another (source 2.1 and 2.3).
   ==================================================================== */
const Eng = (() => {
  const R = () => S.rules;

  /* ------------------------------------------- I. account normalisation */
  function key(a) { return a.accountNo || a.pnNo || a.id; }
  function man(a) { return S.manual[key(a)] || {}; }
  function get(a, field) { const m = man(a); return m[field] !== undefined && m[field] !== "" ? m[field] : a[field]; }

  /* ------------------------------------ X. memorandum / ROPA / write-off */
  /* ITL, foreclosure, dacion, written-off, P1-memo and ROPA are separate
     classifications (source X). Foreclosure and dacion are in-process legal
     states that do not by themselves remove an account from the portfolio,
     ACL or performance reports -- only completed write-off or a completed
     ROPA transfer does that (unchanged below). They are captured here so
     they show up wherever memo.label already renders (register, remedial,
     exports) without needing a separate screen. */
  function memoState(a) {
    const st = String(get(a, "sourceStatus") || "").toLowerCase();
    const rem = String(get(a, "remedialStatus") || "").toLowerCase();
    const bal = N(get(a, "balance"));
    const writtenOff = /write ?off|written off/.test(st) || rem === "wof";
    const ropa = rem === "ropa" || /ropa/.test(st);
    const peso1 = writtenOff && bal > 0 && bal <= R().memoBalance;
    const dacion = !writtenOff && !ropa && (rem === "dacion" || /dacion/.test(st));
    const foreclosure = !writtenOff && !ropa && !dacion && (rem === "foreclosure" || /foreclos/.test(st));
    const code = ropa ? "ROPA" : peso1 ? "P1_MEMO" : writtenOff ? "WRITTEN_OFF" : dacion ? "DACION" : foreclosure ? "FORECLOSURE" : "ACTIVE";
    const label = ropa ? "ROPA booked" : peso1 ? "\u20b11 memorandum account" : writtenOff ? "Written off"
      : dacion ? "Dacion en pago" : foreclosure ? "Foreclosure in process" : "Active";
    return { writtenOff, ropa, peso1, dacion, foreclosure, code, label };
  }
  /* An account is in the ordinary loan portfolio only if it is a recognised
     receivable. ROPA and written-off balances leave it (source X).          */
  function inPortfolio(a) {
    const m = memoState(a);
    if (m.ropa && R().ropaLeavesPortfolio) return false;
    if ((m.writtenOff || m.peso1) && R().writeOffLeavesPortfolio) return false;
    if (programOf(a) === "ACPC" && !activeProfile().acpcInPortfolio) return false;
    return true;
  }

  /* ---------------------------------------------- III. security status */
  function security(a) {
    const secDesc = String(get(a, "securityDesc") || "").trim();
    const prodType = String(get(a, "productType") || "").toLowerCase();
    const bal = N(get(a, "balance"));
    const appraised = N(get(a, "collateralValue"));
    const eligible = N(get(a, "eligibleCollateralValue")) || appraised;
    const perfected = String(get(a, "collateralPerfected") || "").toUpperCase() === "Y";
    const hasDesc = secDesc && !/^(clean|none|unsecured|n\/a)$/i.test(secDesc);
    const declaredSecured = /secured/.test(prodType) && !/unsecured/.test(prodType);

    let code, label, reason;
    if (!hasDesc && !eligible) { code = "US"; label = "Unsecured"; reason = "No collateral or security description."; }
    else if (!eligible) {
      code = "PP"; label = "Documentation / perfection pending";
      reason = "Security is described (" + (secDesc || "n/a") + ") but no eligible collateral value is recorded, so coverage cannot be computed.";
    } else if (!perfected) {
      code = "PP"; label = "Documentation / perfection pending";
      reason = "Collateral valued but perfection is not confirmed.";
    } else if (eligible >= bal) { code = "FS"; label = "Fully secured"; reason = "Eligible perfected collateral covers the exposure."; }
    else { code = "PS"; label = "Partially secured"; reason = "Eligible collateral covers part of the exposure."; }

    const coverage = bal > 0 ? eligible / bal : 0;
    return {
      code, label, reason, declaredSecured, secDesc,
      appraised, eligible, perfected,
      securedPortion: Math.min(eligible, bal),
      unsecuredPortion: Math.max(bal - eligible, 0),
      coverage,
      /* the favourable secured ACL rates require real, perfected collateral */
      aclUseSecured: (code === "FS" || code === "PS") && eligible > 0 && perfected && !R().securedRatesRequireCollateral ? true : (code === "FS" || code === "PS") && eligible > 0 && perfected
    };
  }

  /* ------------------------------- IV. performance, aging, 30-day curing */
  function performance(a, cutoff) {
    const dpdRaw = N(get(a, "dpd"));
    const firstUnpaid = dateISO(get(a, "firstUnpaidDate"));
    const lastPay = dateISO(get(a, "lastPaymentDate"));
    let dpd = dpdRaw;
    if (!dpd && firstUnpaid) dpd = Math.max(0, daysBetween(firstUnpaid, cutoff) || 0);

    /* Curing: aging is computed on the raw arrears clock; the 30-day cure
       controls the UPGRADE of the performance class only. Aging itself is
       never shortened, so provisioning cannot be softened by the cure.     */
    const cureStart = dateISO(get(a, "cureStartDate")) || (dpd === 0 && lastPay ? lastPay : "");
    const cureDays = cureStart ? (daysBetween(cureStart, cutoff) || 0) : 0;
    const cured = cureStart && cureDays >= R().curingDays;
    const curing = !!cureStart && !cured && dpd === 0;

    const m = memoState(a);
    const litig = /litig|itl|court|legal/i.test(String(get(a, "sourceStatus") || "") + " " + String(get(a, "remedialStatus") || ""));
    const prevNpl = String(get(a, "priorClass") || "") === "NPL";

    let cls, why;
    if (m.code === "ROPA") { cls = "ROPA"; why = "Recognised as an acquired asset."; }
    else if (m.code === "WRITTEN_OFF" || m.code === "P1_MEMO") { cls = "Written off / memorandum"; why = "No longer a recognised loan receivable."; }
    else if (litig) { cls = "ITL"; why = "Loan receivable under judicial recovery."; }
    else if (dpd >= R().nplDpdThreshold) { cls = "NPL"; why = `Days past due ${dpd} reached the ${R().nplDpdThreshold}-day non-performing threshold.`; }
    else if (dpd > 0) { cls = "Past-due performing"; why = `Days past due ${dpd}; below the non-performing threshold.`; }
    else if (prevNpl && !cured) { cls = "NPL"; why = `Zero days past due but the ${R().curingDays}-day curing period is not yet completed.`; }
    else { cls = "Current"; why = "No unpaid installment at cut-off."; }

    const band = R().agingBands.find(b => dpd >= b.min && dpd <= b.max) || R().agingBands[R().agingBands.length - 1];
    return { dpd, band: band.label, cls, why, cured, curing, cureStart, cureDays, firstUnpaid, missed: N(get(a, "missedInstallments")) };
  }

  /* ------------------------------------------ VII. programs and funding */
  function programOf(a) { return String(get(a, "programCode") || "BANK").toUpperCase(); }
  function programExposure(a) {
    const gross = N(get(a, "balance"));
    const prog = programOf(a);
    let retained = 1, basisNote = "Bank-funded. The full exposure carries RBCCI credit risk.";
    if (prog === "SBCORP") {
      const r = get(a, "retainedRiskPct");
      retained = r === undefined || r === "" ? R().sbcorpRetainedDefault : N(r);
      basisNote = R().sbcorpRiskTransferConfirmed
        ? `SBCorp programme. ACL is computed on the ${PCT(retained,0)} retained share confirmed by the signed agreement.`
        : `SBCorp programme. Funding is split ${PCT(1-retained,0)} / ${PCT(retained,0)} but risk transfer is NOT yet legally confirmed, so ACL is computed on the full exposure until Accounting and Legal sign off.`;
      if (!R().sbcorpRiskTransferConfirmed) retained = 1;
    } else if (prog === "ACPC") {
      retained = R().acpcRetainedRisk || 0;
      basisNote = activeProfile().acpcInAcl
        ? "ACPC programme included in ACL under the earlier instruction profile."
        : "ACPC programme excluded from ACL under the Final Controlling Rule. Facility records are retained in full.";
      if (activeProfile().acpcInAcl) retained = 1;
    }
    return {
      program: prog, gross, retained,
      atRisk: gross * retained,
      aclBasis: gross * retained,
      sbcorpFunded: N(get(a, "sbcorpFunded")),
      rbcciCounterpart: N(get(a, "rbcciCounterpart")),
      basisNote
    };
  }

  /* ---------------------------------------------- V. impairment and ACL */
  function acl(a, cutoff) {
    const perf = performance(a, cutoff);
    const sec = security(a);
    const prog = programExposure(a);
    const m = memoState(a);
    const bal = N(get(a, "balance"));

    /* Written-off and P1 memorandum accounts hold no recognised receivable,
       so no allowance is required. This is what prevents a P1,500 floor from
       landing on a P1 balance.                                            */
    if ((m.writtenOff || m.peso1 || m.ropa) && R().suppressFloorOnMemo) {
      return { skipped: true, reason: `${m.label}: no recognised loan receivable, so no allowance is computed.`,
               basis: 0, rate: 0, matrixAmount: 0, required: 0, floor: 0, floorApplied: false, overlay: 0,
               booked: N(get(a, "bookedAcl")), variance: N(get(a, "bookedAcl")),
               cls: m.label, stage: null, table: "n/a", perf, sec, prog };
    }
    if (prog.program === "ACPC" && !activeProfile().acpcInAcl) {
      return { skipped: true, reason: "ACPC-funded exposure. Excluded from the ACL computation under the active reporting-scope profile; the ACPC facility ledger retains the record.",
               basis: 0, rate: 0, matrixAmount: 0, required: 0, floor: 0, floorApplied: false, overlay: 0,
               booked: N(get(a, "bookedAcl")), variance: N(get(a, "bookedAcl")),
               cls: "Excluded - ACPC", stage: null, table: "ACPC", perf, sec, prog };
    }

    const useSecured = sec.aclUseSecured;
    const table = useSecured ? R().aclSecured : R().aclUnsecured;
    const tableName = useSecured ? "Secured matrix" : "Unsecured matrix";
    const band = table.find(b => perf.dpd >= b.min && perf.dpd <= b.max) || table[table.length - 1];

    let rate = band.rate, escalated = false;
    if (band.escalated && String(get(a, "foreclosureImminent") || "").toUpperCase() === "Y") { rate = band.escalated; escalated = true; }

    const basis = prog.aclBasis;
    const matrixAmount = basis * rate;

    /* Small-loan floor: max(rate x balance, P1,500) for balances under the
       threshold. This is exactly the convention used in the bank's own
       June 2026 workbook, and it is continuous at P150,000 (1% = P1,500). */
    let required = matrixAmount, floorApplied = false, floorAmount = 0;
    if (R().smallLoanFloorEnabled && basis > 0 && basis < R().smallLoanThreshold) {
      floorAmount = R().smallLoanMinimumAcl;
      if (floorAmount > matrixAmount) { required = floorAmount; floorApplied = true; }
    }

    const overlay = N(get(a, "managementOverlay"));
    required += overlay;

    /* Result-level override may never go below the matrix floor. */
    const ov = S.overrides[key(a) + "|acl"];
    let overridden = false, blocked = false;
    if (ov && ov.approver) {
      if (N(ov.to) < matrixAmount) blocked = true;
      else { required = N(ov.to); overridden = true; }
    }

    const booked = N(get(a, "bookedAcl"));
    return {
      skipped: false, table: tableName, cls: band.cls, stage: band.stage, note: band.note,
      basis, rate, escalated, matrixAmount, floor: floorAmount, floorApplied,
      overlay, required, booked, variance: booked - required,
      overridden, blocked, perf, sec, prog,
      why: `${tableName}, ${perf.dpd} days past due, band ${band.min}-${band.max === 999999 ? "over" : band.max}: ${PCT(rate,0)} of ${P(basis)}${floorApplied ? `, raised to the ${P(floorAmount)} small-loan minimum` : ""}${escalated ? ", escalated because foreclosure is imminent" : ""}.`
    };
  }

  /* --------------------------------------------------- II.A housing type */
  function housing(a) {
    if (String(get(a, "housingFlag") || "").toUpperCase() !== "Y") return null;
    const price = N(get(a, "sellingPrice"));
    const vertical = String(get(a, "housingUnitType") || "").toUpperCase() === "VERTICAL";
    const tbl = vertical ? R().housingVertical : R().housingHorizontal;
    if (!price) return { cls: "Pending validation", basis: "No selling price or contract price captured. Housing type cannot be assigned from the loan amount alone.", vertical, price: 0, pending: true };
    const b = tbl.find(x => price <= x.max) || tbl[tbl.length - 1];
    const ov = S.overrides[key(a) + "|housing"];
    if (ov && ov.approver) return { cls: ov.to, basis: `Approved override. System classification was ${ov.from}. Reason: ${ov.reason}`, vertical, price, overridden: true };
    return { cls: b.cls, basis: `${vertical ? "Vertical / condominium" : "Horizontal / house-and-lot"} ceiling table, selling price ${P(price)}.`, vertical, price };
  }

  /* --------------------------------------------------- VIII. borrower etc */
  function relationship(a) {
    const flag = String(get(a, "dosriFlag") || "N").toUpperCase();
    const type = get(a, "dosriType") || "";
    return { dosri: flag === "Y", code: flag === "Y" ? "DOSRI" : "NON_DOSRI", type, label: flag === "Y" ? ("DOSRI" + (type ? " - " + type : "")) : "Non-DOSRI" };
  }
  function msme(a) {
    const size = String(get(a, "msmeSize") || "").toUpperCase();
    const evidence = get(a, "msmeAssetEvidence") || "";
    if (!size || size === "NA") return { code: "NA", label: "Not applicable", valid: true };
    if (!evidence) return { code: size, label: size + " (unsupported)", valid: false, note: "Enterprise size must be based on qualifying assets, not the loan amount. No asset evidence reference is recorded." };
    return { code: size, label: size, valid: true, evidence };
  }
  function contract(a) {
    const t = String(get(a, "creationType") || "").toLowerCase();
    let base;
    if (/restructur/.test(t)) base = { code: "RSTR", label: "Restructured" };
    else if (/renew/.test(t)) base = { code: "RNW", label: "Renewed" };
    else if (/refinanc/.test(t)) base = { code: "RFN", label: "Refinanced" };
    else if (/reloan|additional/.test(t)) base = { code: "MOD", label: "Modified / additional" };
    else base = { code: "ORIG", label: "Original" };
    const hist = S.contractVersions[key(a)] || [];
    const restructures = hist.filter(v => v.eventType === "RESTRUCTURED").length;
    if (restructures > 1) return { ...base, code: "RSTR2", label: "Restructured more than once", versions: hist.length, restructures };
    if (hist.length) {
      const last = hist[hist.length - 1];
      const map = { ORIGINAL: "Original", RENEWED: "Renewed", REFINANCED: "Refinanced", MODIFIED: "Modified", RESTRUCTURED: "Restructured" };
      return { code: last.eventType === "RESTRUCTURED" ? "RSTR" : base.code, label: map[last.eventType] || base.label, versions: hist.length, restructures };
    }
    return { ...base, versions: 0, restructures: 0 };
  }
  function contractHistory(a) { return S.contractVersions[key(a)] || []; }

  /* --------------------------------------------- V.A internal risk rating */
  function riskRating(a) {
    const override = String(get(a, "riskTierOverride") || "").trim();
    const tiers = (S.rules.riskTiers || []).slice().sort((x, y) => y.min - x.min);
    if (override) {
      const t = tiers.find(x => x.code === override);
      if (t) return { code: t.code, label: t.label, desc: t.desc, score: null, overridden: true, approvalStatus: t.approvalStatus };
    }
    const score = get(a, "internalRiskScore");
    if (score === undefined || score === "" || score === null) return { code: null, label: "Not rated", desc: "No internal risk score captured for this account.", score: null };
    const n = N(score);
    const t = tiers.find(x => n >= x.min && n <= x.max);
    if (!t) return { code: null, label: "Out of range", desc: `Score ${n} does not fall within any configured tier band.`, score: n };
    return { code: t.code, label: t.label, desc: t.desc, score: n, approvalStatus: t.approvalStatus };
  }

  /* ------------------------------------------------ collection & remedial */
  function collectionActions(a) { return S.collectionActions[key(a)] || []; }
  /* PTP records written before the lifecycle existed carry ptpBroken /
     ptpKept booleans instead of a ptpStatus code. Normalise on read so
     both shapes behave identically and no migration pass is needed. */
  function ptpStatusOf(x) {
    if (x.ptpStatus) return x.ptpStatus;
    if (x.ptpBroken) return "BROKEN";
    if (x.ptpKept) return "KEPT";
    return "ACTIVE";
  }
  function ptpIsOpen(code) {
    const st = (S.rules.ptpStates || []).find(s => s.code === code);
    return st ? st.open : false;
  }
  function collectionSummary(a) {
    const acts = collectionActions(a);
    const letters = (S.letters || {})[key(a)] || [];
    if (!acts.length && !letters.length) {
      return { count: 0, lastAction: null, openPtp: null, brokenPtp: 0, ptpStatus: null,
               nextAction: null, nextTargetDate: null, actionStatus: null, remarks: "",
               totalCost: 0, totalRecovery: 0, letters: 0, lastLetter: null, overdue: false };
    }
    const sorted = acts.slice().sort((x, y) => (x.ts || "").localeCompare(y.ts || ""));
    const last = sorted[sorted.length - 1] || null;
    const ptps = acts.filter(x => x.type === "PTP");
    const openPtp = ptps.filter(x => ptpIsOpen(ptpStatusOf(x))).slice(-1)[0] || null;
    const lastPtp = ptps[ptps.length - 1] || null;
    /* The next action is the most recent one still outstanding, not simply
       the most recent action logged — a completed action does not leave an
       open item on the queue. */
    const openItem = sorted.filter(x => x.nextAction && (x.status || "OPEN") !== "COMPLETED" && (x.status || "OPEN") !== "CANCELLED").slice(-1)[0] || null;
    const lastLetter = letters.slice().sort((x, y) => (x.ts || "").localeCompare(y.ts || "")).slice(-1)[0] || null;
    return {
      count: acts.length, lastAction: last,
      openPtp, brokenPtp: ptps.filter(x => ptpStatusOf(x) === "BROKEN").length,
      ptpStatus: lastPtp ? ptpStatusOf(lastPtp) : null,
      nextAction: openItem ? openItem.nextAction : null,
      nextTargetDate: openItem ? openItem.targetDate : null,
      actionStatus: openItem ? (openItem.status || "OPEN") : (last ? (last.status || "COMPLETED") : null),
      remarks: (openItem && openItem.remarks) || (last && last.remarks) || "",
      overdue: !!(openItem && openItem.targetDate && openItem.targetDate < today()),
      totalCost: acts.reduce((s, x) => s + N(x.cost), 0),
      totalRecovery: acts.reduce((s, x) => s + N(x.recovery), 0),
      letters: letters.length, lastLetter
    };
  }

  /* ------------------------------------------------------ VI. AFRD status */
  /* ------------------------------------- AFRD financed-activity classifier
     RBCCI's AFRD review states that Loan Economic Activity is the primary
     and authoritative field for what activity a loan finances, and that
     Loan Purpose must not be reintroduced as a classification dependency.
     The field is therefore matched first, against a configurable rule
     repository, and the older keyword scan over MIS group and purpose is
     kept only as a fallback for extracts that do not carry the column.

     This classifies the ACTIVITY. Whether the bank complies is a separate
     question answered by the compliance engine, which is why an eligible
     activity still passes through the exclusions and overrides below. */
  function afrdActivity(a) {
    const raw = String(get(a, "economicActivity") || "").trim();
    const placeholder = (R().afrdActivityPlaceholders || []).includes(raw.toLowerCase());
    if (raw && !placeholder) {
      const rules = R().afrdActivityRules || [];
      const hay = raw.toLowerCase();
      for (const r of rules) {
        if ((r.match || []).some(m => hay.includes(m))) {
          return { category: r.category, label: r.label, eligible: !!r.eligible,
                   source: "Loan Economic Activity", raw };
        }
      }
      return { category: "NON_AFRD", label: "Not an AFRD activity", eligible: false,
               source: "Loan Economic Activity", raw };
    }
    /* No economic activity recorded. Fall back to the keyword scan, but never
       treat a guess as an eligible classification on its own. */
    const ind = isAgri(a);
    return { category: ind ? "FOR_REVIEW" : "UNCLASSIFIED",
             label: ind ? "Indicators present, activity not recorded" : "Activity not recorded",
             eligible: false, source: placeholder ? "recorded as \u201c" + raw + "\u201d" : "not recorded", raw: "" };
  }

  function afrd(a) {
    const prog = programOf(a);
    const bal = N(get(a, "balance"));
    const act = afrdActivity(a);
    if (prog === "ACPC") {
      return { status: "EXCLUDED_ACPC", label: "Excluded - ACPC-funded", eligible: 0, excluded: bal, activity: act,
               reason: "Hard rule: all ACPC-funded loans are AFRD-ineligible and their eligible amount is always zero." };
    }
    const declared = String(get(a, "afrdStatus") || "").toUpperCase();

    /* A recorded determination always wins over the automatic classification,
       so a reviewer can correct the engine on a specific account. */
    if (declared === "ELIGIBLE") {
      if (R().afrdRequireEvidence && !get(a, "afrdEvidence")) {
        return { status: "PENDING", label: "Pending validation", eligible: 0, excluded: 0, activity: act,
                 reason: "Marked eligible but no supporting document reference is recorded." };
      }
      return { status: "ELIGIBLE", label: "Eligible", eligible: bal, excluded: 0, activity: act,
               reason: "Reviewed and confirmed eligible." };
    }
    if (declared === "PARTIAL") {
      const e = N(get(a, "afrdEligibleAmount"));
      return { status: "PARTIAL", label: "Partially eligible", eligible: Math.min(e, bal), excluded: Math.max(bal - e, 0), activity: act,
               reason: "Split eligible and ineligible amounts." };
    }
    if (declared === "INELIGIBLE") {
      return { status: "INELIGIBLE", label: "Ineligible", eligible: 0, excluded: bal, activity: act,
               reason: get(a, "afrdReason") || "Reviewed and marked ineligible." };
    }

    /* No manual determination: classify from the financed economic activity. */
    if (act.eligible) {
      return { status: "ELIGIBLE", label: "Eligible - " + act.label, eligible: bal, excluded: 0, activity: act,
               reason: "Financed activity \u201c" + act.raw + "\u201d qualifies under the approved AFRD activity rules." };
    }
    if (act.category === "NON_AFRD") {
      return { status: "INELIGIBLE", label: "Not an AFRD activity", eligible: 0, excluded: bal, activity: act,
               reason: "Financed activity \u201c" + act.raw + "\u201d is outside the approved AFRD activity rules." };
    }
    return { status: "PENDING", label: "Pending validation", eligible: 0, excluded: 0, activity: act,
             reason: act.category === "FOR_REVIEW"
               ? "Agricultural indicators are present but Loan Economic Activity is blank in the source file, so the financed activity cannot be classified."
               : "Loan Economic Activity is not recorded in the source file, so the financed activity cannot be classified. These accounts need review \u2014 they are not treated as ineligible." };
  }

  function isAgri(a) {
    const s = (String(get(a, "misGroup") || "") + " " + String(get(a, "purpose") || "") + " " + String(get(a, "productLabel") || "")).toLowerCase();
    return /agri|agrarian|fisher|crop|livestock|poultry|aqua|farm/.test(s);
  }

  /* -------------------------------------------------- product / purpose */
  function product(a) {
    const s = (String(get(a, "misGroup") || "") + " " + String(get(a, "purpose") || "") + " " + String(get(a, "securityDesc") || "")).toLowerCase();
    if (String(get(a, "housingFlag") || "").toUpperCase() === "Y" || /housing|house and lot|residential/.test(s)) return "Housing";
    if (/agrarian|agri|fisher|crop|livestock|poultry|aqua|farm/.test(s)) return "Agricultural and fisheries";
    if (/salary|consumption/.test(s)) return "Salary";
    if (/micro|small scale|medium scale|sme|enterprise|business|commercial|trade/.test(s)) return "MSME / business";
    if (/vehicle|motor/.test(s)) return "Vehicle";
    if (/equipment|machinery/.test(s)) return "Equipment";
    if (/personal|other purposes|multipurpose|consumer/.test(s)) return "Personal / consumer";
    return "Other loans";
  }

  /* ------------------------------------------------- compute everything */
  function compute(a) {
    const cutoff = S.cutoff;
    const c = {
      key: key(a), account: a,
      product: product(a),
      security: security(a),
      perf: performance(a, cutoff),
      memo: memoState(a),
      acl: acl(a, cutoff),
      housing: housing(a),
      relationship: relationship(a),
      msme: msme(a),
      contract: contract(a),
      afrd: afrd(a),
      program: programExposure(a),
      risk: riskRating(a),
      collection: collectionSummary(a),
      inPortfolio: inPortfolio(a),
      balance: N(get(a, "balance"))
    };
    c.exceptions = validate(a, c);
    return c;
  }

  /* ------------------------------------------------- validation exceptions */
  function validate(a, c) {
    const x = [], add = (sev, code, msg, fix) => x.push({ sev, code, msg, fix, key: c.key, borrower: get(a, "borrower") });

    if (!get(a, "borrower")) add("BLOCK", "V-ID-01", "Borrower name is missing.", "Complete the borrower name before validation sign-off.");
    if (!get(a, "accountNo")) add("BLOCK", "V-ID-02", "Loan account number is missing.", "Supply the account or promissory-note number.");
    if (!get(a, "cif")) add("WARN", "V-ID-03", "No CIF or unique borrower number.", "Map the CIF so related-party grouping and DOSRI aggregation can work.");
    if (N(get(a, "balance")) < 0) add("BLOCK", "V-BAL-01", "Negative outstanding balance.", "Reconcile against payments, arrears and posting records.");

    /* security evidence */
    /* V-SEC-01 escalates to blocking once an account is well past due, on the
       reasoning that a secured booking with no appraisal has to be resolved
       before the exposure is certified. On an account written down to a P1
       memorandum that reasoning does not hold: there is no recognised
       receivable left to secure, and the rule was demanding an appraisal on a
       loan the bank has already written off. Every written-off account is by
       definition far past the escalation threshold, so the rule blocked the
       entire memorandum population and no period could ever be locked.

       The exception is now a parameter rather than a judgement made in code,
       matching suppressFloorOnMemo which already exempts the same population
       from the small-loan ACL floor. Suppressed, the finding is still raised
       as a warning so nothing disappears from the register; it simply stops
       blocking certification of a balance that no longer exists. */
    if (c.security.declaredSecured && !c.security.eligible) {
      const noRecognisedReceivable = !c.inPortfolio;
      const cfg = R();                       /* R is a getter, not the object */
      const escalates = c.perf.dpd > N(cfg.securedEvidenceBlockDpd);
      const sev = (escalates && !(cfg.suppressSecuredEvidenceBlockOnMemo && noRecognisedReceivable)) ? "BLOCK" : "WARN";
      add(sev, "V-SEC-01",
        "The account is booked as a secured loan but no collateral value or appraisal is recorded, so coverage cannot be computed."
          + (sev === "WARN" && escalates && noRecognisedReceivable
            ? " Held as a warning because the account carries no recognised receivable (" + c.memo.label + ")." : ""),
        "Capture appraised value, eligible value and perfection status. Until then the account is priced on the unsecured matrix.");
    }
    if (c.security.eligible && !c.security.perfected)
      add("WARN", "V-SEC-02", "Collateral is valued but perfection is not confirmed.", "Confirm registration, annotation and insurance before claiming secured ACL rates.");
    if (c.security.code === "FS" && c.security.coverage < 1)
      add("BLOCK", "V-SEC-03", "Classified fully secured while collateral coverage is below 100%.", "Reclassify as partially secured.");

    /* performance */
    if (/past due/i.test(String(get(a, "sourceStatus") || "")) && N(get(a, "dpd")) === 0)
      add("WARN", "V-PER-01", "Source status says past due but days past due is zero.", "Reconcile the arrears clock with the core banking status.");
    if (c.perf.dpd > 0 && !get(a, "lastPaymentDate"))
      add("WARN", "V-PER-02", "Past-due account with no last payment date.", "Supply the last payment date so the curing clock can run.");
    const srcCls = String(get(a, "sourceClassification") || "").trim();
    if (srcCls && srcCls.toLowerCase() !== "unclassified" && !c.acl.skipped &&
        srcCls.toLowerCase().split(" ")[0] !== String(c.acl.cls).toLowerCase().split(" ")[0])
      add("WARN", "V-CLS-01", `Core banking classifies this account as "${srcCls}" but the matrix computes "${c.acl.cls}".`, "Reconcile the two. The core banking classification is the record of account; document any approved difference.");

    /* interval vs matrix */
    const iv = N(String(get(a, "paymentInterval") || "").replace(/[^0-9]/g, ""));
    if (iv >= 90 && c.perf.dpd > 0)
      add("WARN", "V-PER-03", `Amortisation interval is ${get(a, "paymentInterval")}. A single missed payment moves days past due by a full cycle, which can jump several ACL bands at once.`, "Confirm the approved measure of delinquency for non-monthly schedules before finalising.");

    /* ACL */
    if (c.acl.blocked) add("BLOCK", "V-ACL-01", "An ACL override attempted to go below the matrix floor. The override was rejected.", "Withdraw the override or obtain approval to change the underlying policy parameter.");
    if (!c.acl.skipped && c.acl.booked && Math.abs(c.acl.variance) > 1)
      add(Math.abs(c.acl.variance) > c.acl.required * 0.1 ? "BLOCK" : "WARN", "V-ACL-02",
        `Booked allowance ${P(c.acl.booked)} differs from required ${P(c.acl.required)} by ${P(c.acl.variance)}.`, "Post the adjusting entry or document the approved difference.");

    /* AFRD */
    if (c.program.program === "ACPC" && N(get(a, "afrdEligibleAmount")) > 0)
      add("BLOCK", "V-AFRD-01", "An ACPC-funded account carries a positive AFRD eligible amount.", "The AFRD eligible amount of an ACPC-funded account must always be zero.");
    if (c.afrd.status === "PENDING" && Eng.isAgri(a))
      add("WARN", "V-AFRD-02", "Agricultural or fisheries loan with unvalidated AFRD eligibility.", "Validate the beneficiary, the activity and the supporting documents, or mark it ineligible with a reason.");

    /* MSME / DOSRI */
    if (!c.msme.valid) add("WARN", "V-MSME-01", c.msme.note, "Attach the qualifying-asset evidence reference.");
    if (c.relationship.dosri && !get(a, "dosriApproval"))
      add("BLOCK", "V-DOS-01", "DOSRI account without an approval reference.", "Record the board approval reference and terms.");

    /* housing */
    if (c.housing && c.housing.pending)
      add("WARN", "V-HSG-01", "Housing loan without a selling price, so the housing type cannot be assigned.", "Capture the contract or selling price, property type and floor area.");

    /* programme */
    if (c.program.program === "SBCORP" && !S.rules.sbcorpRiskTransferConfirmed)
      add("WARN", "V-SBC-01", "SBCorp risk transfer is not legally confirmed, so ACL is computed on the full exposure.", "Obtain the Legal and Accounting conclusion on whether RBCCI's loss is limited to its counterpart share.");

    /* industry */
    if (!get(a, "psic")) add("WARN", "V-IND-01", "No PSIC industry code (2019 update to the 2009 PSIC).", "Map the economic activity to a PSIC code for concentration reporting.");

    /* credit risk rating */
    if (!c.risk.code) add("WARN", "V-RSK-01", "No internal credit-risk rating captured.", "Capture the internal risk score, or an approved tier override, in the account drawer.");

    /* collection / remedial */
    if (c.collection.brokenPtp > 0 && c.perf.dpd > 0)
      add("WARN", "V-COL-01", `${c.collection.brokenPtp} broken promise-to-pay commitment(s) on record.`, "Escalate to the next remedial action per the collection queue.");
    if (c.perf.dpd > S.rules.nplDpdThreshold && c.collection.count === 0 && c.inPortfolio)
      add("WARN", "V-COL-02", "Non-performing account with no collection or remedial action logged.", "Record a contact, demand, visit or legal action in the account drawer.");

    return x;
  }

  return { compute, key, get, isAgri, programOf, memoState, inPortfolio, security, performance, acl, housing, afrd, product,
           afrdActivity, riskRating, contract, contractHistory, collectionActions, collectionSummary, ptpStatusOf, ptpIsOpen };
})();

/* ---------------------------------------------------- portfolio roll-up */
function book() {
  if (!book._c || book._k !== JSON.stringify([S.accounts.length, S.cutoff, S.rules.acpcScope, S.rules.ruleVersion, S.rules.sbcorpRiskTransferConfirmed, S.rules.smallLoanFloorEnabled, S.rules.suppressFloorOnMemo, Object.keys(S.manual).length, Object.keys(S.overrides).length])) {
    book._k = JSON.stringify([S.accounts.length, S.cutoff, S.rules.acpcScope, S.rules.ruleVersion, S.rules.sbcorpRiskTransferConfirmed, S.rules.smallLoanFloorEnabled, S.rules.suppressFloorOnMemo, Object.keys(S.manual).length, Object.keys(S.overrides).length]);
    book._c = S.accounts.map(Eng.compute);
  }
  return book._c;
}
const invalidate = () => { book._c = null; };

function totals() {
  const all = book();
  const port = all.filter(c => c.inPortfolio);
  const sum = (arr, f) => arr.reduce((t, c) => t + f(c), 0);
  const gross = sum(port, c => c.balance);
  const npl = port.filter(c => ["NPL", "ITL"].includes(c.perf.cls));
  const pd = port.filter(c => c.perf.dpd > 0);
  const required = sum(all, c => c.acl.required);
  const booked = sum(all, c => c.acl.booked);
  const exceptions = all.flatMap(c => c.exceptions);
  return {
    all, port, gross, count: port.length, offBook: all.length - port.length,
    npl: sum(npl, c => c.balance), nplCount: npl.length,
    nplRatio: gross ? sum(npl, c => c.balance) / gross : 0,
    pastDue: sum(pd, c => c.balance), pastDueRatio: gross ? sum(pd, c => c.balance) / gross : 0,
    required, booked, aclGap: required - booked,
    coverage: sum(npl, c => c.balance) ? sum(npl, c => c.acl.required) / sum(npl, c => c.balance) : 0,
    collateral: sum(port, c => c.security.eligible),
    exceptions, blocks: exceptions.filter(e => e.sev === "BLOCK").length, warns: exceptions.filter(e => e.sev === "WARN").length
  };
}

/* ---------------------------------------- automatic portfolio movement */
/* ------------------------------------------ automatic portfolio movement */
function priorPeriodKey() {
  if (S.view === "A") return (S.year - 1) + "-FY";
  if (S.view === "Q") { const q = +S.period.slice(1); return q === 1 ? (S.year - 1) + "-Q4" : S.year + "-Q" + (q - 1); }
  const m = +S.period.slice(1);
  return m === 1 ? (S.year - 1) + "-M12" : S.year + "-M" + String(m - 1).padStart(2, "0");
}
function snapshotNow() {
  const t = totals();
  return {
    ts: new Date().toISOString(), gross: t.gross, count: t.count,
    accounts: t.all.map(c => ({ k: c.key, b: c.balance, cls: c.perf.cls, memo: c.memo.code, inP: c.inPortfolio }))
  };
}
function deriveMovement() {
  const prior = (S.snapshots || {})[priorPeriodKey()], t = totals();
  if (!prior) return { available: false, priorKey: priorPeriodKey(), lines: [], difference: 0 };
  const pm = new Map(prior.accounts.map(a => [a.k, a])), cm = new Map(t.all.map(c => [c.key, c]));
  let releases = 0, releasesN = 0, fullyPaid = 0, fullyPaidN = 0, collections = 0, availments = 0;
  let writeOffs = 0, writeOffsN = 0, ropa = 0, ropaN = 0;
  let toPastDue = 0, toPastDueN = 0, toNpl = 0, toNplN = 0, toItl = 0, toItlN = 0, cured = 0, curedN = 0;

  cm.forEach((c, k) => {
    const p = pm.get(k);
    if (!p) { if (c.inPortfolio) { releases += c.balance; releasesN++; } return; }
    const diff = c.balance - p.b;
    if (diff < 0) collections += -diff; else if (diff > 0) availments += diff;
    if (p.memo === "ACTIVE" && (c.memo.code === "WRITTEN_OFF" || c.memo.code === "P1_MEMO")) { writeOffs += p.b; writeOffsN++; }
    if (p.memo !== "ROPA" && c.memo.code === "ROPA") { ropa += p.b; ropaN++; }
    if (p.cls === "Current" && c.perf.cls === "Past-due performing") { toPastDue += c.balance; toPastDueN++; }
    if (p.cls !== "NPL" && c.perf.cls === "NPL") { toNpl += c.balance; toNplN++; }
    if (p.cls !== "ITL" && c.perf.cls === "ITL") { toItl += c.balance; toItlN++; }
    if (p.cls !== "Current" && c.perf.cls === "Current") { cured += c.balance; curedN++; }
  });
  pm.forEach((p, k) => { if (!cm.has(k) && p.inP) { fullyPaid += p.b; fullyPaidN++; } });

  const ending = prior.gross + releases + availments - collections - fullyPaid - writeOffs - ropa;
  return {
    available: true, priorKey: priorPeriodKey(), difference: ending - t.gross,
    lines: [
      ["Beginning balance (" + priorPeriodKey() + ")", prior.count, prior.gross],
      ["Releases and new accounts", releasesN, releases],
      ["Additional availments", 0, availments],
      ["Collections and amortisation", 0, -collections],
      ["Fully paid and closed accounts", fullyPaidN, -fullyPaid],
      ["Write-offs", writeOffsN, -writeOffs],
      ["ROPA transfers", ropaN, -ropa],
      ["Computed ending balance", t.count, ending],
      ["LPMRS register total", t.count, t.gross],
      ["Unexplained difference", 0, ending - t.gross],
      ["Transfers to past due", toPastDueN, toPastDue],
      ["Transfers to NPL", toNplN, toNpl],
      ["Transfers to ITL", toItlN, toItl],
      ["Cured accounts", curedN, cured]
    ]
  };
}


/* ------------------------------------------------- amortisation schedule */
/* ------------------------------------------------- amortisation schedule */
function intervalDays(a) {
  const s = String(Eng.get(a, "paymentInterval") || "").toLowerCase();
  const n = N(s.replace(/[^0-9]/g, ""));
  if (n >= 1) return n;
  if (/semi.?month/.test(s)) return 15;
  if (/month/.test(s)) return 30;
  if (/quarter/.test(s)) return 90;
  if (/semi.?annual/.test(s)) return 180;
  if (/annual|year/.test(s)) return 360;
  if (/week/.test(s)) return 7;
  if (/dai?ly/.test(s)) return 1;
  return 30;
}
function amortisation(a) {
  const basis = N(Eng.get(a, "principal")) || N(Eng.get(a, "balance"));
  const annual = (() => { const v = N(String(Eng.get(a, "rate") || "").replace("%", "")); return v > 1 ? v / 100 : v; })();
  const d = intervalDays(a);
  const start = dateISO(Eng.get(a, "firstAmortDue")) || dateISO(Eng.get(a, "grantDate")) || today();
  const mat = dateISO(Eng.get(a, "maturityDate"));
  let n = N(Eng.get(a, "totalAmortNo"));
  if (!n && mat) n = Math.max(1, Math.round((daysBetween(start, mat) || 0) / d) + 1);
  if (!n) n = 12;
  n = Math.min(n, 600);
  const i = annual * d / 360;
  const pay = i > 0 ? basis * i / (1 - Math.pow(1 + i, -n)) : basis / n;
  const rows = []; let bal = basis, due = start;
  for (let k = 1; k <= n; k++) {
    const int = bal * i;
    let prin = pay - int;
    if (k === n || prin > bal) prin = bal;
    bal = Math.max(0, bal - prin);
    rows.push({ k, due, payment: prin + int, principal: prin, interest: int, balance: bal });
    due = addDays(due, d);
    if (bal <= 0) break;
  }
  return { rows, payment: pay, periodic: i, n, intervalDays: d, annual, basis };
}


/* --------------------------------------------------- regulatory mapping */
/* --------------------------------------------------- regulatory mapping */
function regulatoryMap() {
  const t = totals();
  const sum = f => t.port.filter(f).reduce((a, c) => a + c.balance, 0);
  return [
    { report: "FRP", line: "Loans and receivables, gross", src: "Outstanding principal of recognised accounts", val: t.gross, ready: true },
    { report: "FRP", line: "Allowance for credit losses", src: "Required ACL after floor and overlay", val: t.required, ready: true },
    { report: "FRP", line: "Loans and receivables, net", src: "Gross less allowance", val: t.gross - t.required, ready: true },
    { report: "FRP", line: "Past due loans", src: "Days past due above zero", val: t.pastDue, ready: true },
    { report: "FRP", line: "Non-performing loans", src: "NPL and items in litigation", val: t.npl, ready: true },
    { report: "FRP", line: "Restructured loans", src: "Contract status restructured", val: sum(c => c.contract.code === "RSTR"), ready: true },
    { report: "FRP", line: "ROPA", src: "Acquired-asset register", val: t.all.filter(c => c.memo.code === "ROPA").reduce((a, c) => a + c.balance, 0), ready: true },
    { report: "AFRD", line: "Total loanable funds", src: "Entered and reconciled on the AFRD screen", val: S.rules.totalLoanableFunds, ready: true },
    { report: "AFRD", line: "Net eligible amount", src: "Validated eligible less exclusions", val: t.all.reduce((a, c) => a + c.afrd.eligible, 0), ready: true },
    { report: "AFRD", line: "ACPC amount excluded", src: "Hard exclusion rule", val: t.all.filter(c => c.afrd.status === "EXCLUDED_ACPC").reduce((a, c) => a + c.balance, 0), ready: true },
    { report: "DOSRI", line: "Total DOSRI exposure", src: "Relationship classification", val: sum(c => c.relationship.dosri), ready: true },
    { report: "DOSRI", line: "Unsecured DOSRI exposure", src: "Relationship and security classification", val: sum(c => c.relationship.dosri && c.security.code === "US"), ready: true },
    { report: "SBLAF", line: "Agriculture and fisheries exposure", src: "Product classification", val: sum(c => Eng.isAgri(c.account)), ready: false },
    { report: "SBLAF", line: "Small business exposure", src: "Enterprise-size classification", val: sum(c => ["MICRO", "SMALL"].indexOf(c.msme.code) >= 0), ready: false },
    { report: "COCREE 2.0", line: "MSME lending compliance", src: "Enterprise size plus qualifying-asset evidence", val: sum(c => ["MICRO", "SMALL", "MEDIUM"].indexOf(c.msme.code) >= 0), ready: false },
    { report: "CIC", line: "Borrower and contract submission set", src: "Borrower master and contract version history", val: t.count, ready: false },
    { report: "ICAC / Board", line: "Portfolio quality summary", src: "Dashboard KPI set", val: t.gross, ready: true }
  ];
}
