"use strict";

/* ===================================================== views.js
   NAV, the table helper, and every v*() screen-render function,
   plus the account drawer and its sub-cards.                     */

/* ================================================================ VIEWS */
const NAV = [
  ["", "Monitoring"],
  ["dashboard",   "DB", "Dashboard"],
  ["register",    "LR", "Loan register"],
  ["performance", "PA", "Performance & aging"],
  ["acl",         "AC", "Impairment & ACL"],
  ["creditrisk",  "CR", "Credit risk rating"],
  ["collateral",  "CS", "Collateral & security"],
  ["housing",     "HS", "Housing"],
  ["", "Compliance"],
  ["afrd",        "AF", "AFRD compliance"],
  ["programs",    "GP", "Government programmes"],
  ["dosri",       "DR", "DOSRI & MSME"],
  ["remedial",    "RM", "Collection & remedial"],
  ["", "Control"],
  ["import",      "IM", "Import loan file"],
  ["validation",  "VC", "Validation centre"],
  ["reconcile",   "RC", "Reconciliation"],
  ["reports",     "RP", "Reports & workflow"],
  ["", "System"],
  ["params",      "PR", "Parameters"],
  ["storage",     "SV", "Data storage"],
  ["admin",       "AD", "Administration"]
];

function renderNav() {
  const t = totals();
  /* The register badge previously showed t.count — the recognised portfolio
     only — which read as though the register held that many rows when it
     actually holds every imported account. It now shows the true register
     population; the recognised/off-book split is disclosed by the
     reconciliation strip on the register and dashboard. */
  const badges = { validation: t.blocks + t.warns, import: S.imports.length, register: t.all.length };
  $("nav").innerHTML = NAV.map(item => {
    if (!item[0]) return `<div class="navgroup">${E(item[1])}</div>`;
    const [id, k, label] = item;
    if (!canAccess(id)) return "";
    const b = badges[id];
    return `<button data-nav="${id}" class="${S.screen === id ? "on" : ""}"><span class="k">${k}</span><span>${E(label)}</span>${b !== undefined ? `<span class="b ${b ? "" : "zero"}">${CNT(b)}</span>` : "<span></span>"}</button>`;
  }).join("");
  /* The running version is shown here because a stale service-worker cache
     is otherwise invisible: the application looks correct while serving
     superseded code, and the only way to tell was the developer console.
     Anyone reporting a defect can now read the build straight off the
     screen. */
  $("sidefoot").innerHTML = `<b>${E(activeProfile().label)}</b><br>App v${E(APP.version)} · rules ${E(S.rules.ruleVersion)}<br>${E(S.rules.approvalState.replace(/_/g, " ").toLowerCase())}<br>Storage: ${Vault.ready ? "OPFS ready" : "memory only"}`;
  const ub = $("userBadge"); if (ub && CURRENT_USER) ub.querySelector("span:last-child").innerHTML = `<b>${E(CURRENT_USER.username)}</b> · ${E(CURRENT_USER.role)}`;
}

/* ---------------------------------------------------------- table helper */
function T(cols, rows, opt) {
  opt = opt || {};
  const head = cols.map(c => `<th class="${c.n ? "n" : ""}">${E(c.h)}</th>`).join("");
  const body = rows.map((r, i) => `<tr ${opt.click ? `data-row="${i}"` : ""}>` + cols.map(c => {
    const v = c.v(r, i);
    return `<td class="${c.n ? "n" : ""}">${v === undefined || v === null ? "" : v}</td>`;
  }).join("") + "</tr>").join("");
  const tot = opt.total ? `<tr class="tot">` + cols.map(c => `<td class="${c.n ? "n" : ""}">${c.t ? c.t(rows) : ""}</td>`).join("") + "</tr>" : "";
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="mut">No records for this selection.</td></tr>`}${tot}</tbody></table></div>`;
}
const sev = s => s === "BLOCK" ? '<span class="tag t-bad">Blocking</span>' : '<span class="tag t-warn">Warning</span>';
const perfTag = c => {
  const m = { "Current": "t-ok", "Past-due performing": "t-warn", "NPL": "t-bad", "ITL": "t-bad", "ROPA": "t-info", "Written off / memorandum": "t-mute" };
  return `<span class="tag ${m[c] || "t-mute"}">${E(c)}</span>`;
};
function head(title, lede, actions) {
  $("topTitle").textContent = title;
  $("topSub").textContent = `${S.year} · ${S.view === "A" ? "Full year" : S.period} · cut-off ${S.cutoff} · ${CNT(S.accounts.length)} accounts`;
  return `<h2 class="page">${E(title)}</h2><p class="lede">${lede}</p>${actions ? `<div class="bar">${actions}</div>` : ""}`;
}
function empty(msg, action) {
  return `<div class="card" style="text-align:center;padding:40px"><h3>${E(msg)}</h3><p class="mut sm" style="max-width:520px;margin:6px auto 16px">Import the bank's loan extract, or load the sample loan book to see every calculation working.</p>${action || `<button class="btn" data-act="load-sample">Load sample loan book</button> <button class="btn sec" data-nav="import">Import a workbook</button>`}</div>`;
}

/* --------------------------------------------------- what to do next
   Written for someone who opens this once a month to produce a board
   report, not for someone who works in it daily. Each item names the
   screen, says why it matters in one line, and takes you there. Only
   things that actually need doing are listed, so an empty panel means
   there is genuinely nothing outstanding. */
function nextSteps() {
  const t = totals(), R = S.rules, x = afrdCompliance();
  const items = [];

  if (!S.accounts.length) {
    items.push(["Import this month's loan file", "Nothing has been loaded for " + periodKey() + " yet.", "import", "Go to Import"]);
  } else {
    if (t.blocks) items.push(["Clear " + CNT(t.blocks) + " blocking error(s)",
      "The period cannot be marked validated until these are dealt with.", "validation", "Review errors"]);
    if (!N(R.totalLoanableFunds)) items.push(["Enter total loanable funds",
      "Agricultural compliance cannot be worked out without it. It is not in the loan file \u2014 someone at the bank supplies the figure.", "afrd", "Go to AFRD"]);
    else if (!x.compliant) items.push(["Agricultural lending is below the required " + PCT(x.rate, 0),
      "Short by " + P0(Math.abs(x.variance)) + ". Check that every qualifying loan has been marked eligible.", "afrd", "Go to AFRD"]);
    if (t.collateral === 0) items.push(["No collateral values recorded",
      CNT(t.port.filter(c => c.security.declaredSecured).length) + " account(s) are booked as secured but have no appraised value, so they are treated as unsecured.", "collateral", "Go to Collateral"]);
    const wf0 = wf();
    if (!t.blocks && wf0.status === "DRAFT") items.push(["Mark the period validated",
      "No blocking errors remain, so this period is ready for review.", "validation", "Go to Validation"]);
    if (wf0.status === "VALIDATED") items.push(["Record maker, checker and approver",
      "Needed before the period can be locked.", "reports", "Go to Reports"]);
  }
  if (!items.length) return "";
  return `<div class="card" style="margin-top:14px;border-color:#e8cd94;background:#fffcf4">
    <h3>What to do next <span class="hint">${CNT(items.length)} item(s)</span></h3>
    <div class="steps">${items.map(([title, why, screen, label]) => `<li style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center">
      <span><b>${E(title)}</b><br><span class="mut sm">${E(why)}</span></span>
      <button class="btn sm sec" data-nav="${E(screen)}">${E(label)}</button></li>`).join("")}</div></div>`;
}

/* ------------------------------------------------------------- dashboard
   KPI registry. Each entry derives its value from the totals() object,
   which is computed from the whole register. Append here to add a card —
   the grid reflows automatically (spec section 2).                       */
const DASH_KPIS = [
  { lab: "Gross loan portfolio", act: "drill-port",
    val: t => P0(t.gross), sub: t => `${CNT(t.count)} recognised accounts` },
  { lab: "NPL ratio", act: "drill-npl",
    val: t => PCT(t.nplRatio), sub: t => `${P0(t.npl)} across ${CNT(t.nplCount)} accounts`,
    cls: t => t.nplRatio > 0.1 ? "bad" : t.nplRatio > 0.05 ? "warn" : "ok" },
  { lab: "Required ACL", act: "drill-acl",
    val: t => P0(t.required), sub: t => `Booked ${P0(t.booked)} · gap ${P0(t.aclGap)}`,
    cls: t => Math.abs(t.aclGap) > 1000 ? "warn" : "ok" },
  { lab: "Blocking exceptions", act: "goto-validation",
    val: t => CNT(t.blocks), sub: t => `${CNT(t.warns)} warnings outstanding`,
    cls: t => t.blocks ? "bad" : "ok" },
  { lab: "Past-due ratio",
    val: t => PCT(t.pastDueRatio), sub: t => P0(t.pastDue) + " in arrears",
    cls: t => t.pastDueRatio > 0.15 ? "warn" : "" },
  { lab: "NPL coverage",
    val: t => PCT(t.coverage), sub: () => "Allowance on non-performing exposure only",
    cls: t => t.coverage < 1 ? "warn" : "ok" },
  { lab: "Collateral recorded",
    val: t => P0(t.collateral),
    sub: t => `${CNT(t.port.filter(c => c.security.eligible).length)} of ${CNT(t.count)} accounts valued`,
    cls: t => t.collateral === 0 ? "bad" : "" },
  { lab: "Held off the portfolio", act: "drill-offbook",
    val: t => CNT(t.offBook), sub: t => `of ${CNT(t.all.length)} in the register · ROPA, written off, ₱1 memorandum` }
];

function vDashboard() {
  const t = totals();
  if (!S.accounts.length) return head("Dashboard", "Portfolio, performance, impairment, AFRD and exception position for the selected period.") + empty("No loan book in this period yet");
  const byClass = {};
  t.port.forEach(c => { const k = c.perf.cls; (byClass[k] = byClass[k] || { n: 0, b: 0, acl: 0 }); byClass[k].n++; byClass[k].b += c.balance; byClass[k].acl += c.acl.required; });
  const byProduct = {}; t.port.forEach(c => { (byProduct[c.product] = byProduct[c.product] || { n: 0, b: 0 }); byProduct[c.product].n++; byProduct[c.product].b += c.balance; });
  const bySec = {}; t.port.forEach(c => { (bySec[c.security.label] = bySec[c.security.label] || { n: 0, b: 0 }); bySec[c.security.label].n++; bySec[c.security.label].b += c.balance; });
  const offBook = t.all.filter(c => !c.inPortfolio);

  const k = (lab, val, sub, cls, act) => `<div class="kpi ${cls || ""}" data-act="${act || ""}"><span class="lab">${E(lab)}</span><span class="val">${val}</span><span class="sub">${sub}</span></div>`;
  const bar = (lab, v, tot) => `<div class="brow"><span>${E(lab)}</span><div class="track"><i style="width:${clamp(tot ? v / tot * 100 : 0, 0, 100)}%"></i></div><b class="mono">${PCT(tot ? v / tot : 0, 1)}</b></div>`;

  /* Every card is derived from totals(), which runs over the complete
     register — never over rendered or filtered rows. To add a KPI, append
     one entry to DASH_KPIS; nothing else needs to change (spec section 2). */
  const cards = DASH_KPIS.filter(d => !d.when || d.when(t)).map(d => k(d.lab, d.val(t), d.sub(t), d.cls ? d.cls(t) : "", d.act || ""));

  return head("Dashboard", "Every figure below is computed from the complete account register for the selected period — not from rendered, filtered or paginated rows — and drills through to the exact accounts behind it.")
  + reconStrip()
  + `<div class="bar"><button class="btn sec sm" data-act="goto-import">Import a source file</button>`
    + `<button class="btn ghost sm" data-act="backup-open">Download a copy</button>`
    + (S.accounts.length && !isLocked()
       ? `<button class="btn bad sm" data-act="clear-period-open">Clear period ${E(periodKey())}</button>` : "")
    + `</div>`
  + nextSteps()
  + `<div class="kpis">${cards.join("")}</div>`
  + `

  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Portfolio by performance class <span class="hint">source IV</span></h3>
      ${T([{ h: "Class", v: r => perfTag(r[0]) },
           { h: "Accounts", n: 1, v: r => CNT(r[1].n), t: rs => CNT(rs.reduce((a, x) => a + x[1].n, 0)) },
           { h: "Outstanding", n: 1, v: r => P(r[1].b), t: rs => P(rs.reduce((a, x) => a + x[1].b, 0)) },
           { h: "Share", n: 1, v: r => PCT(t.gross ? r[1].b / t.gross : 0, 1) },
           { h: "Required ACL", n: 1, v: r => P(r[1].acl), t: rs => P(rs.reduce((a, x) => a + x[1].acl, 0)) }],
          Object.entries(byClass), { total: true })}
    </div>
    <div class="card"><h3>Security status <span class="hint">source III</span></h3>
      ${T([{ h: "Status", v: r => E(r[0]) },
           { h: "Accounts", n: 1, v: r => CNT(r[1].n) },
           { h: "Outstanding", n: 1, v: r => P(r[1].b), t: rs => P(rs.reduce((a, x) => a + x[1].b, 0)) },
           { h: "Share", n: 1, v: r => PCT(t.gross ? r[1].b / t.gross : 0, 1) }],
          Object.entries(bySec), { total: true })}
      <div class="bars" style="margin-top:12px">
        ${Object.entries(byProduct).map(([p, v]) => bar(p, v.b, t.gross)).join("")}
      </div>
    </div>
  </div>

  <div class="note ${activeProfile().acpcInPortfolio ? "w" : ""}" style="margin-top:14px">
    <b>Active reporting-scope profile: ${E(activeProfile().label)}</b>
    ${E(activeProfile().text)} The source document carries both instructions; neither is deleted. Change the active profile on the Parameters screen.
  </div>`;
}

/* ------------------------------------------------- reconciliation control
   Spec section 1: source records detected, imported, rejected/excluded,
   displayed in the register, and any validation exceptions — one control,
   rendered identically wherever it appears so the numbers can never drift
   between screens. Every figure is derived from the live dataset.        */
function intakeStats() {
  const t = totals(), led = S.intake[periodKey()] || null;
  const shown = Math.min(t.all.length, renderLimit("register"));
  return {
    led,
    sourceRows: led ? led.sourceRows : t.all.length,
    imported: t.all.length,
    blank: led ? led.blank : 0,
    noKey: led ? led.noKey : 0,
    duplicates: led ? led.duplicates : 0,
    rejected: led ? (led.sourceRows - led.imported) : 0,
    displayed: shown,
    withheld: t.all.length - shown,
    recognised: t.count,
    offBook: t.offBook,
    blocks: t.blocks,
    warns: t.warns,
    reconciled: !led || led.sourceRows === led.imported
  };
}

function reconStrip() {
  const x = intakeStats();
  if (!S.accounts.length) return "";
  const cls = x.reconciled ? "ok" : "bad";
  return `<div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><span class="lab">Source records detected</span><span class="val">${CNT(x.sourceRows)}</span><span class="sub">rows below the header row</span></div>
    <div class="kpi ${cls}"><span class="lab">Records imported</span><span class="val">${CNT(x.imported)}</span><span class="sub">${x.reconciled ? "reconciles to source" : CNT(x.rejected) + " not imported"}</span></div>
    <div class="kpi ${x.rejected ? "bad" : "ok"}"><span class="lab">Rejected or excluded</span><span class="val">${CNT(x.rejected)}</span><span class="sub">${CNT(x.blank)} blank · ${CNT(x.noKey)} no key</span></div>
    <div class="kpi ${x.withheld ? "warn" : ""}"><span class="lab">Displayed in the register</span><span class="val">${CNT(x.displayed)}</span><span class="sub">${x.withheld ? CNT(x.withheld) + " above the display ceiling" : "the full population"}</span></div>
  </div>
  ${x.reconciled
    ? `<div class="note g"><b>Source reconciles to the loan register</b>All ${CNT(x.sourceRows)} source records are held in the register and are included in every calculation, filter and report. Of these, ${CNT(x.recognised)} are recognised loan receivables carried in the gross portfolio and ${CNT(x.offBook)} are held off the portfolio as ROPA, written-off or \u20b11 memorandum accounts — those remain fully visible here and in the reports, but are correctly excluded from gross loans, NPL ratios and ACL. ${CNT(x.blocks)} blocking and ${CNT(x.warns)} warning exceptions are open.</div>`
    : `<div class="note b"><b>Source does not reconcile to the loan register</b>${CNT(x.sourceRows)} records were detected in the source file but ${CNT(x.imported)} are held in the register — a difference of ${CNT(x.rejected)}. Every rejected row is listed on the Import &amp; mapping screen with its row number and reason. This period must not be certified until the difference is resolved or formally accepted.</div>`}`;
}

/* -------------------------------------------------------- loan register */
function vRegister() {
  const t = totals();
  if (!S.accounts.length) return head("Loan register", "Account-level register with every classification dimension held independently.") + empty("No accounts loaded");
  const rows = (S.filter ? t.all.filter(S.filter.fn) : t.all);
  return head("Loan register",
    "One row per account. Product, security, performance, stage, AFRD, funding, borrower, relationship, enterprise size, contract, remedial and industry are stored as separate dimensions — no dimension overwrites another. Select a row to open the full classification set.",
    `${S.filter ? `<button class="btn gold sm" data-act="clear-filter">Clear filter: ${E(S.filter.label)}</button>` : ""}<input id="q" placeholder="Search borrower or account number" style="border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:280px">`)
    + reconStrip()
    + (S.filter ? `<div class="note w"><b>A filter is active: ${E(S.filter.label)}</b>${CNT(rows.length)} of ${CNT(t.all.length)} accounts are shown. Clear the filter above to see the full register.</div>` : "")
    + T([
      { h: "Account", v: c => `<b>${E(c.account.accountNo)}</b>` },
      { h: "Borrower", v: c => E(c.account.borrower) },
      { h: "Product", v: c => E(c.product) },
      { h: "Security", v: c => E(c.security.label) },
      { h: "DPD", n: 1, v: c => CNT(c.perf.dpd) },
      { h: "Performance", v: c => perfTag(c.perf.cls) },
      { h: "Classification", v: c => E(c.acl.cls) },
      { h: "Stage", n: 1, v: c => c.acl.stage || "—" },
      { h: "Outstanding", n: 1, v: c => P(c.balance), t: rs => P(rs.reduce((a, c) => a + (c.inPortfolio ? c.balance : 0), 0)) },
      { h: "Required ACL", n: 1, v: c => P(c.acl.required), t: rs => P(rs.reduce((a, c) => a + c.acl.required, 0)) },
      { h: "Programme", v: c => E(c.program.program) },
      { h: "Contract", v: c => E(c.contract.label) },
      { h: "Exceptions", v: c => c.exceptions.length ? `<span class="tag ${c.exceptions.some(e => e.sev === "BLOCK") ? "t-bad" : "t-warn"}">${c.exceptions.length}</span>` : `<span class="tag t-ok">clean</span>` }
    ], capRows(rows, "register"), { total: true, click: true })
    + (rows.length > renderLimit("register")
        ? `<p class="mut sm">Showing the first ${CNT(renderLimit("register"))} of ${CNT(rows.length)} rows. This is a display ceiling only — every calculation, ratio and report on every screen runs over all ${CNT(rows.length)}. Raise it on the Parameters screen, or export the workbook for the full register.</p>`
        : "");
}

/* -------------------------------------------------- performance and aging */
/* --------------------------------------------- secured / unsecured view
   RBCCI asked for aging, impairment and collateral to be viewable split by
   security, because the two populations behave differently and are reviewed
   by different people.

   The split is on how the loan is BOOKED (product type says secured), not on
   whether collateral has been valued. Those are different questions and
   conflating them would put every account in the unsecured column while
   appraisal data is missing, which is not what anyone means by "unsecured
   loans". Where a loan is booked secured but carries no eligible collateral
   value it still appears under Secured, and the gap is disclosed on screen.

   This changes presentation only. Aging bands, ACL rates and classification
   are untouched — RBCCI has aging under validation and asked that its
   business rules not be modified in the meantime. */
const SEC_TABS = [
  { code: "ALL", label: "All loans", fn: () => true },
  { code: "SEC", label: "Secured", fn: c => c.security.declaredSecured },
  { code: "UNSEC", label: "Unsecured", fn: c => !c.security.declaredSecured }
];
function secTab() { return SEC_TABS.find(x => x.code === S.securityTab) || SEC_TABS[0]; }
function secTabs(rows) {
  const cur = secTab();
  return `<div class="bar" style="margin-bottom:10px">${SEC_TABS.map(x => {
    const n = rows.filter(x.fn).length;
    const bal = rows.filter(x.fn).reduce((a, c) => a + c.balance, 0);
    return `<button class="btn sm ${x.code === cur.code ? "" : "ghost"}" data-act="sec-tab" data-code="${x.code}">${E(x.label)} &middot; ${CNT(n)} &middot; ${P0(bal)}</button>`;
  }).join("")}</div>`
  + (cur.code === "SEC"
      ? (() => {
          const noVal = rows.filter(c => c.security.declaredSecured && !c.security.eligible);
          return noVal.length
            ? `<div class="note w"><b>${CNT(noVal.length)} of these are booked as secured but have no appraised collateral value</b>They hold ${P0(noVal.reduce((a, c) => a + c.balance, 0))} and are provisioned on the unsecured matrix, which is the conservative treatment, until an appraisal is recorded.</div>`
            : "";
        })()
      : cur.code === "UNSEC"
        ? `<div class="note"><b>Loans not booked as secured</b>Clean and unsecured facilities. These are provisioned on the unsecured matrix throughout.</div>`
        : "");
}

function vPerformance() {
  const t = totals();
  if (!S.accounts.length) return head("Performance & aging", "") + empty("No accounts loaded");
  const scope = t.port.filter(secTab().fn);
  const bands = S.rules.agingBands.map(b => {
    const rows = scope.filter(c => c.perf.dpd >= b.min && c.perf.dpd <= b.max);
    return { label: b.label, n: rows.length, bal: rows.reduce((a, c) => a + c.balance, 0), acl: rows.reduce((a, c) => a + c.acl.required, 0) };
  });
  const curing = t.all.filter(c => c.perf.curing);
  return head("Performance & aging",
    `Aging runs on the raw arrears clock. The ${S.rules.curingDays}-day curing period controls when an account may be upgraded out of non-performing status — it never shortens the aging used for provisioning, because that would understate the allowance.`)
    + `<div class="note"><b>Aging bands follow the ACL matrices</b>The 91–120 and 121–180 splits exist because the unsecured matrix prices them differently (25% and 50%). The "over 1 to 5 years" and "over 5 years" splits exist because the secured matrix prices them at 50% and 100%.</div>`
    + secTabs(t.port)
    + T([{ h: "Aging band", v: r => E(r.label) },
         { h: "Accounts", n: 1, v: r => CNT(r.n), t: rs => CNT(rs.reduce((a, x) => a + x.n, 0)) },
         { h: "Outstanding", n: 1, v: r => P(r.bal), t: rs => P(rs.reduce((a, x) => a + x.bal, 0)) },
         { h: "Share", n: 1, v: r => { const tot = scope.reduce((a, c) => a + c.balance, 0); return PCT(tot ? r.bal / tot : 0, 1); } },
         { h: "Required ACL", n: 1, v: r => P(r.acl), t: rs => P(rs.reduce((a, x) => a + x.acl, 0)) }], bands, { total: true })
    + `<div class="card" style="margin-top:14px"><h3>Accounts inside the curing window <span class="hint">${CNT(curing.length)} accounts</span></h3>`
    + T([{ h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
         { h: "Cure started", v: c => E(c.perf.cureStart) }, { h: "Days cured", n: 1, v: c => CNT(c.perf.cureDays) },
         { h: "Days remaining", n: 1, v: c => CNT(Math.max(0, S.rules.curingDays - c.perf.cureDays)) },
         { h: "Class held", v: c => perfTag(c.perf.cls) }], capRows(curing, "register")) + `</div>`;
}

/* ------------------------------------------------------ impairment / ACL */
/* Accounts whose booked allowance was inferred from a provision rate rather
   than read from a booked amount column in the source. */
const derivedAcl = t => t.all.filter(c => c.account.bookedAclDerived).length;

function vAcl() {
  const t = totals();
  if (!S.accounts.length) return head("Impairment & ACL", "") + empty("No accounts loaded");
  const aclScope = t.all.filter(secTab().fn);
  const skipped = aclScope.filter(c => c.acl.skipped);
  const floored = aclScope.filter(c => c.acl.floorApplied);
  const byStage = [1, 2, 3].map(s => {
    const rows = aclScope.filter(c => c.acl.stage === s);
    return { s, n: rows.length, bal: rows.reduce((a, c) => a + c.balance, 0), acl: rows.reduce((a, c) => a + c.acl.required, 0) };
  });
  const matrix = (tbl, name) => `<div class="card"><h3>${name}</h3>${T([
    { h: "Days unpaid", v: b => `${b.min}${b.max === 999999 ? " and over" : "–" + b.max}` },
    { h: "Classification", v: b => E(b.cls) },
    { h: "Minimum ACL", n: 1, v: b => PCT(b.rate, 0) + (b.escalated ? " → " + PCT(b.escalated, 0) : "") },
    { h: "Stage", n: 1, v: b => b.stage },
    { h: "Accounts", n: 1, v: b => CNT(t.all.filter(c => !c.acl.skipped && c.acl.table === (name.includes("Unsecured") ? "Unsecured matrix" : "Secured matrix") && c.perf.dpd >= b.min && c.perf.dpd <= b.max).length) },
    { h: "Note", v: b => `<span class="mut sm">${E(b.note)}</span>` }
  ], tbl)}</div>`;

  return head("Impairment & ACL",
    "Required allowance is the higher of the approved matrix floor and any approved model result, plus management overlay. Stage is carried alongside aging and performance — never derived from days past due alone.")
    + secTabs(t.all)
    + `<div class="grid g4">
        <div class="kpi"><span class="lab">Required ACL</span><span class="val">${P0(aclScope.reduce((a, c) => a + c.acl.required, 0))}</span><span class="sub">across ${CNT(aclScope.filter(c => !c.acl.skipped).length)} provisioned accounts</span></div>
        <div class="kpi"><span class="lab">Booked ACL</span><span class="val">${P0(aclScope.reduce((a, c) => a + N(c.account.bookedAcl), 0))}</span><span class="sub">${derivedAcl(t) ? "derived from the provision rate" : "from the source extract"}</span></div>
        <div class="kpi ${Math.abs(t.aclGap) > 1000 ? "warn" : "ok"}"><span class="lab">Deficiency / excess</span><span class="val">${P0(aclScope.reduce((a, c) => a + c.acl.required - N(c.account.bookedAcl), 0))}</span><span class="sub">${t.aclGap > 0 ? "under-provisioned" : "adequately provisioned"}</span></div>
        <div class="kpi ${skipped.length ? "" : "ok"}"><span class="lab">Excluded from ACL</span><span class="val">${CNT(skipped.length)}</span><span class="sub">memorandum, ROPA and out-of-scope programmes</span></div>
      </div>
      ${derivedAcl(t) ? `<div class="note w" style="margin-top:14px"><b>Booked allowance derived, not read from the source</b>The extract carries a provision rate for each account but no booked provision amount. The booked figure shown is each account's own provision rate applied to its outstanding balance, across ${CNT(derivedAcl(t))} account(s), giving ${P(t.booked)}. This is an inference, and the resulting deficiency of ${P(t.aclGap)} depends on it being the right one. Confirm whether the booked provision is held this way or comes from the general ledger \u2014 the inference can be switched off on the Parameters screen.</div>` : ""}
      <div class="note g" style="margin-top:14px"><b>The \u20b11,500 small-loan rule</b>
        Required ACL = max(matrix rate × basis, ${P(S.rules.smallLoanMinimumAcl)}) where the basis is below ${P(S.rules.smallLoanThreshold)}. The floor is continuous at the threshold because 1% of ${P0(S.rules.smallLoanThreshold)} is exactly ${P0(S.rules.smallLoanMinimumAcl)}. It is currently <b>${S.rules.smallLoanFloorEnabled ? "enabled" : "disabled"}</b> and ${S.rules.suppressFloorOnMemo ? "suppressed on written-off and \u20b11 memorandum accounts, which hold no recognised receivable" : "<b>applied to memorandum accounts</b>, which will provision written-off balances"}. It is applied to ${CNT(floored.length)} accounts.</div>
      <div class="grid g3" style="margin-top:14px">
        ${byStage.map(s => `<div class="card"><h3>Stage ${s.s}</h3><div class="kv"><dt>Accounts</dt><dd>${CNT(s.n)}</dd><dt>Exposure</dt><dd>${P(s.bal)}</dd><dt>Required ACL</dt><dd>${P(s.acl)}</dd><dt>Effective rate</dt><dd>${PCT(s.bal ? s.acl / s.bal : 0)}</dd></div></div>`).join("")}
      </div>
      <div class="grid g2" style="margin-top:14px">${matrix(S.rules.aclUnsecured, "Unsecured matrix")}${matrix(S.rules.aclSecured, "Secured matrix")}</div>
      <div class="card" style="margin-top:14px"><h3>Account-level computation</h3>
      ${T([{ h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
           { h: "Basis", n: 1, v: c => P(c.acl.basis) }, { h: "DPD", n: 1, v: c => CNT(c.perf.dpd) },
           { h: "Table", v: c => E(c.acl.table) }, { h: "Classification", v: c => E(c.acl.cls) },
           { h: "Rate", n: 1, v: c => c.acl.skipped ? "—" : PCT(c.acl.rate, 0) },
           { h: "Floor", v: c => c.acl.floorApplied ? '<span class="tag t-info">applied</span>' : "" },
           { h: "Required", n: 1, v: c => P(c.acl.required), t: rs => P(rs.reduce((a, c) => a + c.acl.required, 0)) },
           { h: "Booked", n: 1, v: c => P(c.acl.booked), t: rs => P(rs.reduce((a, c) => a + c.acl.booked, 0)) },
           { h: "Variance", n: 1, v: c => c.acl.skipped ? "" : P(c.acl.variance) }],
          capRows(t.all, "acl"), { total: true, click: true })}</div>`;
}

/* ------------------------------------------------------ credit risk (R13) */
function vCreditRisk() {
  const t = totals(), R = S.rules;
  if (!S.accounts.length) return head("Credit risk rating", "") + empty("No accounts loaded");
  const byTier = R.riskTiers.map(tier => {
    const rows = t.port.filter(c => c.risk.code === tier.code);
    return { tier, n: rows.length, bal: rows.reduce((a, c) => a + c.balance, 0) };
  });
  /* Rated exposure was measured against t.gross (the recognised portfolio)
     while the unrated count was taken from t.all, so the KPI pair compared
     656 accounts against a 217-account denominator. Both now read on the
     recognised basis; memorandum and written-off accounts are excluded
     because they will never carry an internal rating. */
  const unrated = t.port.filter(c => !c.risk.code);
  return head("Credit risk rating",
    "Internal credit-risk rating is captured independently of aging, performance and ACL. Changing a tier's score band is effective-dated and does not rewrite a locked report.")
    + `<div class="grid g4">
        <div class="kpi"><span class="lab">Tiers configured</span><span class="val">${CNT(R.riskTiers.length)}</span><span class="sub">rule version ${E(R.ruleVersion)}</span></div>
        <div class="kpi ${unrated.length ? "warn" : "ok"}"><span class="lab">Unrated accounts</span><span class="val">${CNT(unrated.length)}</span><span class="sub">of ${CNT(t.count)} recognised · no internal score or approved override</span></div>
        <div class="kpi"><span class="lab">Tier table status</span><span class="val" style="font-size:18px">${E(R.riskTierApprovalState.replace(/_/g, " "))}</span><span class="sub">effective ${E(R.riskTierEffectiveDate)}</span></div>
        <div class="kpi"><span class="lab">Rated exposure</span><span class="val">${P0(t.port.filter(c => c.risk.code).reduce((a, c) => a + c.balance, 0))}</span><span class="sub">of ${P0(t.gross)} gross portfolio</span></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Risk rating tier table <span class="hint">configurable — code, description, score band, approval status, effective date</span></h3>${T([
        { h: "Tier", n: 1, v: (b, i) => `<input data-rule="riskTiers.${i}.code" value="${E(b.code)}" style="width:34px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Label", v: (b, i) => `<input data-rule="riskTiers.${i}.label" value="${E(b.label)}" style="width:120px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Description", v: (b, i) => `<input data-rule="riskTiers.${i}.desc" value="${E(b.desc)}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Min score", n: 1, v: (b, i) => `<input type="number" data-rule="riskTiers.${i}.min" value="${b.min}" style="width:60px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Max score", n: 1, v: (b, i) => `<input type="number" data-rule="riskTiers.${i}.max" value="${b.max}" style="width:60px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Approval", v: (b, i) => `<select data-rule="riskTiers.${i}.approvalStatus" ${isLocked() ? "disabled" : ""}><option ${b.approvalStatus === "APPROVED" ? "selected" : ""}>APPROVED</option><option ${b.approvalStatus === "PENDING_APPROVAL" ? "selected" : ""}>PENDING_APPROVAL</option></select>` },
        { h: "Effective date", v: (b, i) => `<input type="date" data-rule="riskTiers.${i}.effectiveDate" value="${E(b.effectiveDate)}" ${isLocked() ? "disabled" : ""}>` },
        { h: "Accounts", n: 1, v: (b, i) => CNT(byTier[i] ? byTier[i].n : 0) },
        { h: "Exposure", n: 1, v: (b, i) => P(byTier[i] ? byTier[i].bal : 0) }
      ], R.riskTiers)}</div>
      <p class="mut sm" style="margin:10px 0 0">Boundary bands must remain continuous and non-overlapping. Only the President/CEO or a specifically authorised officer may approve a tier-table change; changes are prospective and never rewrite a locked period.</p>
      <div class="card" style="margin-top:14px"><h3>Account-level rating</h3>${T([
        { h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
        { h: "Internal score", n: 1, v: c => c.risk.score === null ? "—" : CNT(c.risk.score) },
        { h: "Tier", v: c => c.risk.code ? `<span class="tag t-info">Tier ${E(c.risk.code)} — ${E(c.risk.label)}</span>` : '<span class="tag t-mute">Not rated</span>' },
        { h: "Override", v: c => c.risk.overridden ? '<span class="tag t-warn">manual override</span>' : "" },
        { h: "Outstanding", n: 1, v: c => P(c.balance), t: rs => P(rs.reduce((a, c) => a + c.balance, 0)) }
      ], capRows(t.port, "acl"), { total: true, click: true })}
      <p class="mut sm" style="margin:10px 0 0">Recognised loan receivables only, so the Outstanding total agrees with the dashboard. The ${CNT(t.offBook)} memorandum and written-off accounts are not internally rated.</p></div>`;
}

/* ------------------------------------------------------------ collateral */
function vCollateral() {
  const t = totals();
  if (!S.accounts.length) return head("Collateral & security", "") + empty("No accounts loaded");
  const missing = t.port.filter(c => c.security.declaredSecured && !c.security.eligible);
  return head("Collateral & security",
    "A loan is fully secured only when eligible, enforceable, perfected collateral covers the exposure. A security description alone never makes a loan secured.")
    + (missing.length ? `<div class="note b"><b>${CNT(missing.length)} accounts holding ${P0(missing.reduce((a, c) => a + c.balance, 0))} are booked as secured with no collateral value</b>Until an appraised and eligible value is captured, these accounts are priced on the unsecured matrix, which is the conservative treatment. The favourable secured rate at 91–180 days requires collateral that is legally perfected, liquid and recoverable.</div>` : "")
    + secTabs(t.port)
    + T([{ h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
         { h: "Security described", v: c => E(c.security.secDesc || "—") },
         { h: "Appraised", n: 1, v: c => c.security.appraised ? P(c.security.appraised) : '<span class="tag t-bad">none</span>' },
         { h: "Eligible", n: 1, v: c => P(c.security.eligible) },
         { h: "Exposure", n: 1, v: c => P(c.balance), t: rs => P(rs.reduce((a, c) => a + c.balance, 0)) },
         { h: "Coverage", n: 1, v: c => c.security.eligible ? PCT(c.security.coverage, 0) : "—" },
         { h: "Gap", n: 1, v: c => P(c.security.unsecuredPortion) },
         { h: "Perfected", v: c => c.security.perfected ? '<span class="tag t-ok">yes</span>' : '<span class="tag t-warn">not confirmed</span>' },
         { h: "Classification", v: c => E(c.security.label) },
         { h: "ACL table used", v: c => E(c.acl.table) }], capRows(t.port.filter(secTab().fn), "collateral"), { total: true, click: true });
}

/* --------------------------------------------------------------- housing */
function vHousing() {
  const t = totals();
  const h = t.port.filter(c => c.housing);
  if (!S.accounts.length) return head("Housing", "") + empty("No accounts loaded");
  const groups = {};
  h.forEach(c => { const k = c.housing.cls; (groups[k] = groups[k] || { n: 0, orig: 0, bal: 0 }); groups[k].n++; groups[k].bal += c.balance; groups[k].orig += N(c.account.principal); });
  const tot = h.reduce((a, c) => a + c.balance, 0);
  return head("Housing",
    "Housing type is assigned from the applicable selling price, property type and effective ceiling — never from the loan amount or the outstanding balance, because repayments would otherwise push a loan into a lower category.")
    + `<div class="grid g2"><div class="card"><h3>Horizontal / house-and-lot ceilings</h3>${T([{ h: "Classification", v: b => E(b.cls) }, { h: "Up to", n: 1, v: b => b.max === Infinity ? "no ceiling" : P0(b.max) }], S.rules.housingHorizontal)}</div>
      <div class="card"><h3>Vertical / condominium ceilings <span class="hint">JMC 2025-001</span></h3>${T([{ h: "Classification", v: b => E(b.cls) }, { h: "Up to", n: 1, v: b => b.max === Infinity ? "no ceiling" : P0(b.max) }], S.rules.housingVertical)}
      <p class="mut sm" style="margin:10px 0 0">A condominium unit is never classified as economic housing merely because its price exceeds ${P0(S.rules.housingHorizontal[0].max)}.</p></div></div>`
    + `<div class="card" style="margin-top:14px"><h3>Housing portfolio</h3>${T([
        { h: "Housing type", v: r => E(r[0]) }, { h: "Accounts", n: 1, v: r => CNT(r[1].n), t: rs => CNT(rs.reduce((a, x) => a + x[1].n, 0)) },
        { h: "Original amount", n: 1, v: r => P(r[1].orig) },
        { h: "Outstanding", n: 1, v: r => P(r[1].bal), t: rs => P(rs.reduce((a, x) => a + x[1].bal, 0)) },
        { h: "Share", n: 1, v: r => PCT(tot ? r[1].bal / tot : 0, 1) }], Object.entries(groups), { total: true })}</div>`
    + `<div class="card" style="margin-top:14px"><h3>Accounts</h3>${T([
        { h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
        { h: "Unit type", v: c => c.housing.vertical ? "Vertical" : "Horizontal" },
        { h: "Selling price", n: 1, v: c => c.housing.price ? P(c.housing.price) : '<span class="tag t-warn">missing</span>' },
        { h: "Outstanding", n: 1, v: c => P(c.balance) },
        { h: "Classification", v: c => E(c.housing.cls) },
        { h: "Basis", v: c => `<span class="mut sm">${E(c.housing.basis)}</span>` }], capRows(h, "housing"), { click: true })}</div>`;
}

/* ------------------------------------------------------------------ AFRD */
function vAfrd() {
  const t = totals(), R = S.rules, x = afrdCompliance();
  const locked = isLocked();
  const canValidate = CURRENT_USER && (CURRENT_USER.role === "Administrator" || CURRENT_USER.role === "Approver" || CURRENT_USER.role === "Checker");

  /* Activity classification summary, as required by the AFRD review's
     Engine A: every account resolves to eligible, not eligible, or for
     review, and the three always account for the whole register. */
  /* Built on the recognised portfolio, the same basis the compliance engine
     uses, so the Counted column agrees with line 3 of the computation. A
     written-off account carries a P1 balance and no recoverable receivable,
     so it cannot support a compliance claim; the count of those is disclosed
     beneath the table rather than folded into it. */
  const byAct = {};
  t.port.forEach(c => {
    const a = c.afrd.activity || { category: "UNCLASSIFIED", raw: "" };
    const k = a.raw || "(not recorded)";
    (byAct[k] = byAct[k] || { n: 0, bal: 0, elig: 0, cat: a.category, eligible: a.eligible });
    byAct[k].n++; byAct[k].bal += c.balance; byAct[k].elig += c.afrd.eligible;
  });
  const memoAgri = t.all.filter(c => !c.inPortfolio && c.afrd.activity && c.afrd.activity.eligible);
  const actRows = Object.entries(byAct).sort((a, b) => b[1].elig - a[1].elig || b[1].bal - a[1].bal);

  return head("AFRD compliance",
    "Republic Act No. 11901 requires at least 25% of <b>total loanable funds</b>, not 25% of the outstanding portfolio. The denominator is entered and reconciled here; it does not come from the loan extract. Eligible loans and separately encoded qualifying investments are consolidated below and remain traceable to their own records.")
    + `<div class="note w"><b>Denominator conflict retained for sign-off</b>The core design table in the source document says &ldquo;AFRD 25% of the loan Portfolio&rdquo;, while section VI of the same document states the statutory basis is total loanable funds. The engine uses total loanable funds. Correct the wording in the source document so the record and the software agree.</div>

    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="lab">Eligible loan portfolio</span><span class="val">${P0(x.loanEligible)}</span><span class="sub">${CNT(x.loanCount)} validated account(s)</span></div>
      <div class="kpi"><span class="lab">Eligible qualifying investments</span><span class="val">${P0(x.invAmount)}</span><span class="sub">${CNT(x.invEligible.length)} of ${CNT(x.invActive.length)} active record(s)</span></div>
      <div class="kpi ${x.determinable ? (x.compliant ? "ok" : "bad") : "warn"}"><span class="lab">Total AFRD-eligible exposure</span><span class="val">${P0(x.total)}</span><span class="sub">loans plus investments</span></div>
      <div class="kpi ${x.determinable ? (x.compliant ? "ok" : "bad") : "warn"}"><span class="lab">Compliance status</span><span class="val">${x.determinable ? (x.compliant ? "COMPLIANT" : "NON-COMPLIANT") : "—"}</span><span class="sub">${x.determinable ? PCT(x.ratio) + " against " + PCT(x.rate, 0) + " required" : "denominator not entered"}</span></div>
    </div>

    <div class="card"><h3>Consolidated compliance computation <span class="hint">every line traceable to its source records</span></h3>
      <div class="frow">
        <label class="f">Total loanable funds &mdash; type the figure here<input id="tlf" type="number" placeholder="e.g. 200000000" value="${R.totalLoanableFunds || ''}" ${locked ? "disabled" : ""}></label>
        <label class="f">Required by law<input value="${PCT(R.afrdRate, 0)} of total loanable funds" disabled></label>
        <label class="f">Amount you must lend<input value="${P(x.required)}" disabled></label>
        <label class="f">Where you stand now<input value="${x.determinable ? PCT(x.ratio) + ' of total loanable funds' : '\u2190 type the figure on the left first'}" disabled></label>
      </div>
      <p class="mut sm" style="margin:0 0 10px">${x.tlfRec && x.tlfRec.source
        ? `Source: <b>${E(x.tlfRec.source)}</b>, stated as at ${E(x.tlfRec.asOf || "?")}, recorded by ${E(x.tlfRec.recordedBy || "?")}.`
        : `<span style="color:var(--bad)">No source schedule recorded for this figure.</span>`}
        ${locked ? "" : `<button class="btn sm ghost" data-act="edit-tlf" style="margin-left:6px">${x.tlfRec ? "Edit source" : "Record the source"}</button>`}</p>
      ${T([{ h: "Step", v: r => r[2] ? `<b>${E(r[0])}</b>` : E(r[0]) },
           { h: "Source", v: r => `<span class="mut sm">${E(r[3] || "")}</span>` },
           { h: "Amount", n: 1, v: r => r[2] ? `<b>${r[1]}</b>` : r[1] }], [
        ["1. Total loanable funds (you enter this)", P(x.denominator), 0, "Entered here by the bank; not in the loan extract"],
        ["2. Of that, the law requires " + PCT(x.rate, 0), P(x.required), 0, "RA 11901"],
        ["C. Base eligible AFRD loans", P(x.baseEligible), 0, CNT(x.eligibleRows.length) + " account(s) qualifying by economic activity"],
        ["D. Priority-sector compliance adjustment", P(x.priorityAdj), 0, x.priorityRows.length ? CNT(x.priorityRows.length) + " verified priority-sector account(s), multiplier applied" : "no verified priority-sector exposure"],
        ["E. Other AFRD loan compliance", P(x.otherEligible), 0, "standard treatment"],
        ["3. Eligible loan portfolio (C + D)", P(x.loanCompliance), 0, "carried to the total below"],
        ["4. Less: ACPC-funded balances (always zero eligible)", P(x.loanExcludedAcpc.reduce((a, c) => a + c.balance, 0)), 0, "Hard exclusion rule"],
        ["5. Less: loans pending eligibility validation", P(x.loanPendingAmount), 0, CNT(x.loanPending.length) + " account(s) awaiting review below"],
        ["5a. Excluded: funding source cannot be counted", P(x.fundingBlocked.reduce((a, r) => a + r.base, 0)), 0, CNT(x.fundingBlocked.length) + " account(s) funded outside the bank's own loanable funds"],
        ["6. Eligible qualifying investments", P(x.invAmount), 0, CNT(x.invEligible.length) + " validated investment record(s)"],
        ["7. Total AFRD-eligible exposure", P(x.total), 1, "Line 3 plus line 6"],
        ["8. Required compliance amount", P(x.required), 0, "Line 2"],
        ["9. What you have actually lent, as a percentage", x.determinable ? PCT(x.ratio) : "—", 1, "Line 7 divided by line 1"],
        ["10. Above or (below) what is required", P(x.variance), 1, "Line 7 less line 8"],
        ["FRP net carrying amount (reported separately)", P(x.frpNetCarrying), 0, "gross less allowance \u2014 never merged with the compliance amount above"],
        ["11. Status", x.determinable ? (x.compliant ? '<span class="tag t-ok">COMPLIANT</span>' : '<span class="tag t-bad">NON-COMPLIANT</span>') : '<span class="tag t-warn">CANNOT BE DETERMINED</span>', 1, "Line 7 against line 8"]
      ])}
      ${x.determinable ? "" : `<div class="note w" style="margin-top:10px"><b>Compliance cannot be determined</b>Total loanable funds is the statutory denominator and has not been entered. The system reports this rather than showing a non-compliant result, because a zero denominator is missing data, not a failure to comply.</div>`}
    </div>

    ${x.loanPending.length ? `<div class="note w" style="margin-top:14px"><b>${CNT(x.loanPending.length)} loan account(s) holding ${P0(x.loanPendingAmount)} are pending eligibility validation</b>An agricultural or fisheries product does not by itself establish AFRD eligibility, so these contribute nothing until they are validated against a supporting document. Review them in the schedule below.</div>` : ""}

    <div class="card" style="margin-top:14px"><h3>Which loans count, and why <span class="hint">classified from the Loan Economic Activity column in the source file</span></h3>
      <p class="mut sm" style="margin:0 0 10px">This is the bank's authoritative record of what each loan actually finances. Every account falls into one of three outcomes and the three always add up to the whole register.</p>
      ${T([
        { h: "Economic activity in the loan file", v: r => E(r[0]) },
        { h: "Counts towards AFRD?", v: r => r[1].eligible
            ? '<span class="tag t-ok">Yes</span>'
            : r[1].cat === "NON_AFRD" ? '<span class="tag t-mute">No</span>'
            : '<span class="tag t-warn">Needs review</span>' },
        { h: "Accounts", n: 1, v: r => CNT(r[1].n), t: rs => CNT(rs.reduce((a, r) => a + r[1].n, 0)) },
        { h: "Outstanding", n: 1, v: r => P(r[1].bal), t: rs => P(rs.reduce((a, r) => a + r[1].bal, 0)) },
        { h: "Counted", n: 1, v: r => P(r[1].elig), t: rs => P(rs.reduce((a, r) => a + r[1].elig, 0)) }
      ], actRows, { total: true })}
      ${memoAgri.length ? `<div class="note" style="margin-top:10px"><b>${CNT(memoAgri.length)} further account(s) finance a qualifying activity but are written off</b>They are held at ${P(memoAgri.reduce((a, c) => a + c.balance, 0))} as memorandum records with no recoverable receivable, so they cannot support a compliance claim and are excluded from the figures above.</div>` : ""}
      ${(byAct["(not recorded)"] || {}).n ? `<div class="note w" style="margin-top:10px"><b>${CNT(byAct["(not recorded)"].n)} account(s) holding ${P0(byAct["(not recorded)"].bal)} have no economic activity recorded</b>The source file leaves the activity blank or writes a placeholder for these, so the system cannot tell what they finance. They are held for review rather than treated as ineligible — some may well qualify. Ask for the activity to be filled in at source, or set it account by account.</div>` : ""}
    </div>

    ${(function () {
      const ex = afrdExceptions();
      if (!ex.all.length) return `<div class="note g" style="margin-top:14px"><b>No AFRD exceptions open</b>Every account and holding passed the classification, beneficiary, funding and reconciliation checks.</div>`;
      const by = {};
      ex.all.forEach(e => { (by[e.code] = by[e.code] || { sev: e.sev, msg: e.msg, fix: e.fix, n: 0, amt: 0 }); by[e.code].n++; by[e.code].amt += e.amount; });
      const rows = Object.entries(by).sort((a, b) => (a[1].sev === "BLOCK" ? 0 : 1) - (b[1].sev === "BLOCK" ? 0 : 1) || b[1].amt - a[1].amt);
      return `<div class="card" style="margin-top:14px"><h3>AFRD exceptions <span class="hint">${CNT(ex.blocks)} blocking &middot; ${CNT(ex.warns)} warning &middot; ${CNT(ex.material.length)} material</span></h3>
        ${ex.finalBlocked
          ? `<div class="note b"><b>A final regulatory output cannot be produced yet</b>${CNT(ex.material.length)} material item(s) are unresolved. A draft or provisional figure may still be taken, provided the amounts at risk are disclosed. Clear or formally accept the items below before the final return.</div>`
          : `<div class="note g"><b>No material items outstanding</b>A final regulatory output may be produced.</div>`}
        ${T([
          { h: "Code", v: r => `<span class="mono">${E(r[0])}</span>` },
          { h: "Severity", v: r => r[1].sev === "BLOCK" ? '<span class="tag t-bad">Blocking</span>' : '<span class="tag t-warn">Warning</span>' },
          { h: "Items", n: 1, v: r => CNT(r[1].n) },
          { h: "Amount at risk", n: 1, v: r => P(r[1].amt), t: rs => P(rs.reduce((a, r) => a + r[1].amt, 0)) },
          { h: "Finding", v: r => E(r[1].msg) },
          { h: "Required correction", v: r => `<span class="mut sm">${E(r[1].fix)}</span>` }
        ], rows, { total: true })}</div>`;
    })()}

    ${afrdInvestmentsCard(x, locked, canValidate)}

    ${x.invActive.length ? (function () {
      const cats = R.afrdInstrumentCategories || [];
      const rows = cats.map(cat => {
        const held = x.invActive.filter(i => i.category === cat.code);
        return { cat, n: held.length,
                 reg: held.reduce((a, i) => a + investmentRegulatoryAmount(i), 0),
                 elig: held.reduce((a, i) => a + investmentEligibleAmount(i), 0) };
      }).filter(r => r.n);
      const b1 = rows.filter(r => r.cat.schedule === "B-1").reduce((a, r) => a + r.elig, 0);
      const b0 = rows.filter(r => r.cat.schedule === "B").reduce((a, r) => a + r.elig, 0);
      const recon = Math.abs((b1 + b0) - x.invAmount) <= 0.5;
      return `<div class="card" style="margin-top:14px"><h3>Regulatory schedule mapping <span class="hint">Schedule B-1 rolls into Schedule B, which carries into the numerator</span></h3>
        ${T([
          { h: "Schedule", v: r => `<span class="mono">${E(r.cat.schedule)}</span>` },
          { h: "Reporting line", v: r => E(r.cat.line) },
          { h: "Holdings", n: 1, v: r => CNT(r.n), t: rs => CNT(rs.reduce((a, r) => a + r.n, 0)) },
          { h: "Regulatory amount", n: 1, v: r => P(r.reg), t: rs => P(rs.reduce((a, r) => a + r.reg, 0)) },
          { h: "Eligible", n: 1, v: r => P(r.elig), t: rs => P(rs.reduce((a, r) => a + r.elig, 0)) }
        ], rows, { total: true })}
        <p class="mut sm" style="margin:10px 0 0">Schedule B-1 total ${P(b1)} plus Schedule B ${P(b0)} = ${P(b1 + b0)}, against eligible investments of ${P(x.invAmount)}. ${recon ? "Reconciled." : '<b style="color:var(--bad)">Difference \u2014 exception AFRD-I012 raised.</b>'}</p></div>`;
    })() : ""}

    <div class="note ${x.loanExcludedAcpc.length ? "g" : ""}" style="margin-top:14px"><b>ACPC hard rule enforced</b>${CNT(x.loanExcludedAcpc.length)} ACPC-funded accounts holding ${P0(x.loanExcludedAcpc.reduce((a, c) => a + c.balance, 0))} carry an AFRD-eligible amount of exactly zero. Any attempt to place a positive eligible amount on an ACPC account is a blocking exception.</div>

    <div class="card" style="margin-top:14px"><h3>Account-level AFRD schedule <span class="hint">select a row to validate eligibility on the account</span></h3>
    ${T([{ h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
         { h: "Product", v: c => E(c.product) }, { h: "Programme", v: c => E(c.program.program) },
         { h: "Gross", n: 1, v: c => P(c.balance) },
         { h: "Eligible", n: 1, v: c => P(c.afrd.eligible), t: rs => P(rs.reduce((a, c) => a + c.afrd.eligible, 0)) },
         { h: "Excluded", n: 1, v: c => P(c.afrd.excluded) },
         { h: "Status", v: c => `<span class="tag ${c.afrd.status === "ELIGIBLE" ? "t-ok" : c.afrd.status === "PARTIAL" ? "t-info" : c.afrd.status === "EXCLUDED_ACPC" ? "t-info" : c.afrd.status === "INELIGIBLE" ? "t-bad" : "t-warn"}">${E(c.afrd.label)}</span>` },
         { h: "Beneficiary", v: c => { const b = beneficiaryOf(c.account); return b.code
             ? `<span class="tag ${b.priority ? "t-info" : "t-mute"}">${E(b.label)}</span>` : '<span class="mut sm">not recorded</span>'; } },
         { h: "Multiplier", n: 1, v: c => { const m = multiplierOf(c.account, beneficiaryOf(c.account));
             return m.applied ? `<b>${m.value}\u00d7</b>` : m.value + "\u00d7"; } },
         { h: "Funding", v: c => { const f = fundingOf(c.account); return f.countable
             ? E(f.label) : `<span class="tag t-warn">${E(f.label)}</span>`; } },
         { h: "Evidence", v: c => Eng.get(c.account, "afrdEvidence") ? `<span class="mono sm">${E(Eng.get(c.account, "afrdEvidence"))}</span>` : `<span class="mut sm">none</span>` },
         { h: "Reason", v: c => `<span class="mut sm">${E(c.afrd.reason)}</span>` }],
        capRows(t.all.filter(c => c.afrd.eligible || Eng.isAgri(c.account) || c.afrd.status === "EXCLUDED_ACPC"), "afrd"), { total: true, click: true })}</div>`;
}

/* ------------------------------------------- AFRD investments register */
function afrdInvestmentsCard(x, locked, canValidate) {
  const invs = S.afrdInvestments || [];
  return `<div class="card" style="margin-top:14px"><h3>AFRD qualifying investments register <span class="hint">${CNT(invs.length)} record(s) &middot; manually encoded, held separately from the loan register</span></h3>
    <p class="mut sm" style="margin:0 0 10px">Investments recorded here are not derived from the loan extract. Recording one does <b>not</b> make it AFRD-compliant: every record is created pending and only contributes to the numerator once it has been separately validated against a supporting reference. Green or sustainable financing instruments can be recorded without assuming regulatory eligibility.</p>
    ${invs.length ? T([
      { h: "Type", v: i => E(afrdTypeLabel(i.type)) },
      { h: "Issuer", v: i => E(i.issuer) },
      { h: "Instrument", v: i => E(i.instrument) },
      { h: "Reference", v: i => `<span class="mono sm">${E(i.referenceNo)}</span>` },
      { h: "Acquired", v: i => E(i.acquisitionDate) },
      { h: "Maturity", v: i => E(i.maturityDate) },
      { h: "ISIN", v: i => i.isin ? `<span class="mono sm">${E(i.isin)}</span>` : '<span class="mut sm">none</span>' },
      { h: "Face value", n: 1, v: i => P(N(i.faceValue)), t: rs => P(rs.reduce((a, i) => a + N(i.faceValue), 0)) },
      { h: "Carrying value", n: 1, v: i => P(N(i.bookValue)), t: rs => P(rs.reduce((a, i) => a + N(i.bookValue), 0)) },
      { h: "Regulatory amount", n: 1, v: i => P(investmentRegulatoryAmount(i)), t: rs => P(rs.reduce((a, i) => a + investmentRegulatoryAmount(i), 0)) },
      { h: "AFRD-eligible", n: 1, v: i => P(investmentEligibleAmount(i)), t: rs => P(rs.reduce((a, i) => a + investmentEligibleAmount(i), 0)) },
      { h: "Schedule", v: i => { const c = (S.rules.afrdInstrumentCategories || []).find(x => x.code === i.category);
          return c ? `<span class="mono">${E(c.schedule)}</span>` : '<span class="mut sm">\u2014</span>'; } },
      { h: "Classification", v: i => E(afrdClassLabel(i.classification)) },
      { h: "Status", v: i => `<span class="tag ${afrdStateOf(i.status).tag}">${E(afrdStateOf(i.status).label)}</span>` },
      { h: "Validated by", v: i => i.validatedBy ? `${E(i.validatedBy)}<br><span class="mut sm">${E(String(i.validatedAt).slice(0, 10))}</span>` : `<span class="mut sm">not validated</span>` },
      { h: "Note", v: i => { const r = investmentExclusionReason(i); return r ? `<span class="mut sm">${E(r)}</span>` : ""; } },
      { h: "Active", v: i => i.active === false ? '<span class="tag t-mute">Inactive</span>' : '<span class="tag t-ok">Active</span>' },
      { h: "", v: i => locked ? "" : `<button class="btn sm ghost" data-act="edit-investment" data-id="${E(i.id)}">Edit</button>${
          canValidate ? ` <button class="btn sm ${afrdStateOf(i.status).eligible ? "ghost" : "gold"}" data-act="validate-investment" data-id="${E(i.id)}">${afrdStateOf(i.status).eligible ? "Re-validate" : "Validate"}</button>` : ""}` }
    ], invs, { total: true })
      : '<div class="note"><b>No qualifying investments recorded</b>Land Bank, DBP and other qualifying bonds or investments that form part of AFRD compliance but are not in the loan register are encoded here.</div>'}
    ${locked ? '<p class="mut sm">The period is locked. Open an amendment to add or change investment records.</p>'
      : `<div class="bar" style="margin-top:12px"><button class="btn" data-act="add-investment">Record a qualifying investment</button>${
          invs.length ? `<button class="btn sec" data-act="export-investments">Export register</button>` : ""}</div>`}
    ${!canValidate && invs.length ? '<p class="mut sm">Validation requires a Checker, Approver or Administrator. A Maker can encode records but cannot make them count towards compliance.</p>' : ""}</div>`;
}

/* -------------------------------------------------- government programmes */
function vPrograms() {
  const t = totals();
  /* Gross exposure and ACL must be read on the same basis, otherwise the
     ledger silently mixes populations: memorandum and written-off accounts
     carry a \u20b11 balance but no required allowance, so counting them in
     "gross" while the ACL column excludes them produced a ledger total that
     disagreed with the dashboard by exactly the number of memo accounts.
     Recognised exposure now drives the money columns; the memorandum
     population is disclosed in its own column instead of being folded in. */
  const groups = {};
  t.all.forEach(c => {
    const k = c.program.program;
    (groups[k] = groups[k] || { n: 0, recognised: 0, gross: 0, atRisk: 0, acl: 0, memo: 0, memoBal: 0 });
    groups[k].n++;
    if (c.inPortfolio) { groups[k].recognised++; groups[k].gross += c.balance; groups[k].atRisk += c.program.atRisk; }
    else { groups[k].memo++; groups[k].memoBal += c.balance; }
    groups[k].acl += c.acl.required;
  });
  return head("Government programmes",
    "ACPC, Small Business Corporation and other government facilities are tracked as separate ledgers with their own collection queues. Funding source alone never determines credit risk, MSME status or AFRD eligibility.")
    + `<div class="note ${S.rules.sbcorpRiskTransferConfirmed ? "g" : "w"}"><b>SBCorp 90 / 10 funding split</b>
      ${S.rules.sbcorpRiskTransferConfirmed
        ? `The signed agreement is confirmed to limit RBCCI's loss to its counterpart share, so ACL is computed on the ${PCT(S.rules.sbcorpRetainedDefault, 0)} retained exposure.`
        : `The instruction says only RBCCI's 10% share enters the ACL. That is correct <b>only if</b> the agreement legally transfers 90% of default loss. Until Legal and Accounting confirm it on the Parameters screen, ACL is computed on the full exposure — the conservative position. Provisioning on 10% of an exposure RBCCI still carries in full would understate the allowance.`}</div>
    <div class="note ${activeProfile().acpcInAcl ? "w" : ""}" style="margin-top:12px"><b>ACPC scope</b>${E(activeProfile().text)}</div>`
    + `<div class="card" style="margin-top:14px"><h3>Programme ledger <span class="hint">money columns are on the recognised portfolio, consistent with the dashboard</span></h3>${T([
        { h: "Programme", v: r => `<b>${E(r[0])}</b>` },
        { h: "Accounts", n: 1, v: r => CNT(r[1].n), t: rs => CNT(rs.reduce((a, x) => a + x[1].n, 0)) },
        { h: "Recognised", n: 1, v: r => CNT(r[1].recognised), t: rs => CNT(rs.reduce((a, x) => a + x[1].recognised, 0)) },
        { h: "Gross exposure", n: 1, v: r => P(r[1].gross), t: rs => P(rs.reduce((a, x) => a + x[1].gross, 0)) },
        { h: "RBCCI at risk", n: 1, v: r => P(r[1].atRisk), t: rs => P(rs.reduce((a, x) => a + x[1].atRisk, 0)) },
        { h: "Required ACL", n: 1, v: r => P(r[1].acl), t: rs => P(rs.reduce((a, x) => a + x[1].acl, 0)) },
        { h: "Memo / written off", n: 1, v: r => CNT(r[1].memo), t: rs => CNT(rs.reduce((a, x) => a + x[1].memo, 0)) }
      ], Object.entries(groups), { total: true })}
      <p class="mut sm" style="margin:10px 0 0">Gross exposure counts recognised loan receivables only, so this total agrees with the dashboard. The memorandum column carries accounts held off the portfolio — ${CNT(t.offBook)} accounts holding ${P(t.all.filter(c => !c.inPortfolio).reduce((a, c) => a + c.balance, 0))} in \u20b11 markers.</p></div>`
    + `<div class="card" style="margin-top:14px"><h3>Programme accounts</h3>${T([
        { h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
        { h: "Programme", v: c => E(c.program.program) },
        { h: "Gross", n: 1, v: c => P(c.program.gross) },
        { h: "Government share", n: 1, v: c => P(c.program.sbcorpFunded) },
        { h: "RBCCI counterpart", n: 1, v: c => P(c.program.rbcciCounterpart) },
        { h: "ACL basis", n: 1, v: c => P(c.program.aclBasis) },
        { h: "Basis note", v: c => `<span class="mut sm">${E(c.program.basisNote)}</span>` }
      ], capRows(t.all.filter(c => c.program.program !== "BANK"), "programs"), { click: true })}
      ${t.all.every(c => c.program.program === "BANK")
        ? `<div class="note" style="margin-top:10px"><b>No government-funded accounts in this extract</b>All ${CNT(t.all.length)} imported accounts are bank-funded, so this schedule is empty by design rather than by a filter fault. It populates automatically once the extract carries an ACPC, SBCorp or other programme funding source.</div>` : ""}</div>`;
}

/* ------------------------------------------------------------ DOSRI/MSME */
function vDosri() {
  const t = totals();
  const dos = t.all.filter(c => c.relationship.dosri);
  const sizes = {};
  t.port.forEach(c => { const k = c.msme.label; (sizes[k] = sizes[k] || { n: 0, b: 0 }); sizes[k].n++; sizes[k].b += c.balance; });
  return head("DOSRI & MSME",
    "Relationship and enterprise size are captured independently. Enterprise size must rest on qualifying assets — it is never inferred from the loan amount, and a Small Business Corporation loan is not MSME-qualified without supporting documents.")
    + (dos.length === 0 ? `<div class="note w"><b>No DOSRI accounts flagged in this loan book</b>The core banking extract carries a DOSRI flag of N on every record. Confirm against the board-approved DOSRI register before certifying any DOSRI report; an empty result is a data-capture finding, not a compliance conclusion.</div>` : "")
    + `<div class="grid g2"><div class="card"><h3>DOSRI and related-party exposure</h3>${T([
        { h: "Account", v: c => E(c.account.accountNo) }, { h: "Borrower", v: c => E(c.account.borrower) },
        { h: "Relationship", v: c => E(c.relationship.label) },
        { h: "Outstanding", n: 1, v: c => P(c.balance), t: rs => P(rs.reduce((a, c) => a + c.balance, 0)) },
        { h: "Approval ref.", v: c => Eng.get(c.account, "dosriApproval") ? E(Eng.get(c.account, "dosriApproval")) : '<span class="tag t-bad">missing</span>' }
      ], dos, { total: true })}</div>
      <div class="card"><h3>Enterprise size</h3>${T([
        { h: "Size", v: r => E(r[0]) }, { h: "Accounts", n: 1, v: r => CNT(r[1].n) },
        { h: "Outstanding", n: 1, v: r => P(r[1].b), t: rs => P(rs.reduce((a, x) => a + x[1].b, 0)) }
      ], Object.entries(sizes), { total: true })}</div></div>`;
}

/* --------------------------------------------------- collection / remedial */
/* Queue segments (spec section 4). Each is derived from the live register,
   so counts on the buttons always match the rows below them. */
const REMEDIAL_FILTERS = [
  { code: "ALL",      label: "Whole queue",     fn: t => t.all.filter(c => c.perf.dpd > 0 || !c.inPortfolio) },
  { code: "OVERDUE",  label: "Overdue actions", fn: t => t.all.filter(c => c.collection.overdue) },
  { code: "NOACTION", label: "No action yet",   fn: t => t.all.filter(c => (c.perf.dpd > 0 || !c.inPortfolio) && c.collection.count === 0) },
  { code: "PTP",      label: "Open PTP",        fn: t => t.all.filter(c => c.collection.openPtp) },
  { code: "BROKEN",   label: "Broken PTP",      fn: t => t.all.filter(c => c.collection.brokenPtp > 0) },
  { code: "NPL",      label: "Non-performing",  fn: t => t.all.filter(c => c.inPortfolio && c.perf.dpd > S.rules.nplDpdThreshold) }
];
const actionTypeLabel = code => ((S.rules.collectionActionTypes || []).find(x => x.code === code) || { label: code || "" }).label;
const statusTag = code => {
  if (!code) return "";
  const st = (S.rules.actionStatuses || []).find(x => x.code === code) || { label: code, tag: "t-mute" };
  return `<span class="tag ${st.tag}">${E(st.label)}</span>`;
};
const ptpTag = code => {
  if (!code) return "";
  const st = (S.rules.ptpStates || []).find(x => x.code === code) || { label: code, tag: "t-mute" };
  return `<span class="tag ${st.tag}">${E(st.label)}</span>`;
};

function vRemedial() {
  const t = totals();
  const seg = REMEDIAL_FILTERS.find(f => f.code === S.remedialFilter) || REMEDIAL_FILTERS[0];
  const work = seg.fn(t);
  const queueAll = REMEDIAL_FILTERS[0].fn(t);
  const states = {};
  t.all.forEach(c => { const k = c.memo.label; (states[k] = states[k] || { n: 0, b: 0 }); states[k].n++; states[k].b += c.balance; });
  const withActions = queueAll.filter(c => c.collection.count > 0);
  const openPtps = t.all.filter(c => c.collection.openPtp);
  const brokenPtps = t.all.reduce((a, c) => a + c.collection.brokenPtp, 0);
  const overdue = queueAll.filter(c => c.collection.overdue);
  return head("Collection & remedial",
    "ITL, foreclosure, dacion, write-off, \u20b11 memorandum and ROPA are separate states with their own dates and balances. Government-programme collection is queued separately from bank-funded collection. Every account carries its own contact, promise-to-pay, demand, visit, legal-action, target-date, cost and recovery history.")
    + `<div class="grid g4">
        <div class="kpi"><span class="lab">Accounts with logged action</span><span class="val">${CNT(withActions.length)}</span><span class="sub">of ${CNT(queueAll.length)} in the remedial queue</span></div>
        <div class="kpi ${openPtps.length ? "warn" : "ok"}"><span class="lab">Open promises to pay</span><span class="val">${CNT(openPtps.length)}</span><span class="sub">awaiting outcome</span></div>
        <div class="kpi ${brokenPtps ? "bad" : "ok"}"><span class="lab">Broken PTPs on record</span><span class="val">${CNT(brokenPtps)}</span><span class="sub">across all accounts</span></div>
        <div class="kpi ${overdue.length ? "warn" : "ok"}"><span class="lab">Overdue next actions</span><span class="val">${CNT(overdue.length)}</span><span class="sub">target date has passed</span></div>
      </div>
      <div class="grid g2" style="margin-top:14px"><div class="card"><h3>Memorandum, legal and acquired-asset states <span class="hint">source X</span></h3>${T([
        { h: "State", v: r => E(r[0]) }, { h: "Accounts", n: 1, v: r => CNT(r[1].n) },
        { h: "Balance", n: 1, v: r => P(r[1].b) },
        { h: "In loan portfolio", v: r => /ROPA|Written|memorandum/i.test(r[0]) ? '<span class="tag t-mute">removed</span>' : '<span class="tag t-ok">included</span>' }
      ], Object.entries(states))}</div>
      <div class="card"><h3>Collection queues by funding source</h3>${T([
        { h: "Queue", v: r => E(r[0]) }, { h: "Accounts in arrears", n: 1, v: r => CNT(r[1]) }
      ], Object.entries(queueAll.reduce((m, c) => { const k = c.program.program === "BANK" ? "Bank-funded collection" : c.program.program + " programme collection"; m[k] = (m[k] || 0) + 1; return m; }, {})))}
      <p class="mut sm" style="margin:10px 0 0">The Final Controlling Rule requires ACPC and SBCorp collection to be reported separately from the ordinary collection report.</p></div></div>`
    + `<div class="card" style="margin-top:14px"><h3>Remedial work queue <span class="hint">${CNT(work.length)} accounts · click a row to open the account, log an action or generate correspondence</span></h3>
      <div class="bar" style="margin:0 0 10px">
        ${REMEDIAL_FILTERS.map(f => `<button class="btn sm ${S.remedialFilter === f.code ? "" : "ghost"}" data-act="remedial-filter" data-code="${f.code}">${E(f.label)} (${CNT(f.fn(t).length)})</button>`).join("")}
      </div>
      ${T([
        { h: "Account", v: c => E(c.account.accountNo) },
        { h: "Borrower", v: c => E(c.account.borrower) },
        { h: "Status", v: c => E(c.memo.label) },
        { h: "Classification", v: c => perfTag(c.perf.cls) },
        { h: "DPD", n: 1, v: c => CNT(c.perf.dpd) },
        { h: "Aging", v: c => E(c.perf.band) },
        { h: "Outstanding", n: 1, v: c => P(c.balance), t: rs => P(rs.reduce((a, c) => a + c.balance, 0)) },
        { h: "Next action", v: c => c.collection.nextAction ? E(c.collection.nextAction) : '<span class="mut sm">none set</span>' },
        { h: "Action date", v: c => c.collection.nextTargetDate
            ? (c.collection.overdue ? `<span class="tag t-bad">${E(c.collection.nextTargetDate)}</span>` : E(c.collection.nextTargetDate))
            : "" },
        { h: "Last action type", v: c => c.collection.lastAction ? E(actionTypeLabel(c.collection.lastAction.type)) : "" },
        { h: "Letters", n: 1, v: c => c.collection.letters
            ? `<span class="tag t-info">${CNT(c.collection.letters)}</span>` : "" },
        { h: "Action status", v: c => statusTag(c.collection.actionStatus) },
        { h: "PTP status", v: c => ptpTag(c.collection.ptpStatus) },
        { h: "Remarks", v: c => c.collection.remarks ? `<span class="mut sm">${E(String(c.collection.remarks).slice(0, 60))}</span>` : "" }
      ], capRows(work, "remedial"), { total: true, click: true })}
      ${work.length > renderLimit("remedial") ? `<p class="mut sm">Showing the first ${CNT(renderLimit("remedial"))} of ${CNT(work.length)}. Raise the ceiling on Parameters.</p>` : ""}</div>`
    + `<div class="card" style="margin-top:14px"><h3>Correspondence issued this period <span class="hint">${CNT(allLetters().filter(l => l.period === periodKey()).length)}</span></h3>
      ${allLetters().length ? T([
        { h: "Reference", v: l => `<span class="mono">${E(l.ref)}</span>` },
        { h: "Issued", v: l => E(String(l.ts).replace("T", " ").slice(0, 16)) },
        { h: "Template", v: l => E(l.templateName) },
        { h: "Type", v: l => `<span class="tag t-info">${E(l.category)}</span>` },
        { h: "Format", v: l => E(String(l.format).toUpperCase()) },
        { h: "Issued by", v: l => E(l.issuedBy) }
      ], allLetters().sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 200))
        : '<p class="mut sm">No collection correspondence has been generated for this period yet. Open an account from the queue above and use <b>Generate letter</b>.</p>'}</div>`;
}
/* ------------------------------------------------------- import & mapping */
function vImport() {
  const last = S.imports[0];
  return head("Import & mapping",
    "Drop the bank's loan extract. The original file is hashed and kept, every sheet is listed, and columns are mapped onto the LPMRS account model. Nothing is overwritten — the parsed data is linked back to the source file by hash.")
    + `<div class="grid g2">
      <div class="card"><h3>Import a workbook</h3>
        <div class="frow" style="grid-template-columns:1fr 1fr">
          <label class="f">Reporting period<input value="${periodKey()}" disabled></label>
          <label class="f">Cut-off date<input type="date" id="cutoff" value="${S.cutoff}"></label>
        </div>
        <div class="drop" id="drop">
          <b>Drop an .xlsx or .csv file here</b>
          <p class="mut sm" style="margin:6px 0 12px">Read entirely inside this browser. No file leaves the machine.</p>
          <input type="file" id="file" accept=".xlsx,.xlsm,.csv,.txt" multiple>
          <p class="mut sm" style="margin:12px 0 0">A file will not import? <button class="btn sm ghost" data-act="diagnose-file">Check the file instead</button><br>
          <span class="mut sm">Choose the file above, then press this. It describes the file's structure so the problem can be found, and includes no borrower names, account numbers or balances.</span></p>
        </div>
        <div class="bar" style="margin-top:12px"><button class="btn sec" data-act="load-sample">Load sample loan book</button><button class="btn ghost" data-act="backup-open">Download a copy</button><button class="btn bad" data-act="clear-period-open">Clear period ${E(periodKey())}</button></div>
        <p class="mut sm" style="margin:8px 0 0">Clearing resets every period-dependent value — register, dashboard, ACL, AFRD, validation and staging data — so a new import cannot inherit stale figures. Parameters, users, templates and the audit trail are retained.</p>
      </div>
      <div class="card"><h3>What the import does</h3><ol class="steps">
        <li>Verifies free storage before writing anything.</li>
        <li>Hashes the original bytes with SHA-256 and keeps the file in the vault.</li>
        <li>Lists every worksheet and picks the one carrying a loan register.</li>
        <li>Maps recognised columns; keeps unrecognised columns verbatim so nothing is lost.</li>
        <li>Runs the validation rules and produces blocking errors and warnings.</li>
        <li>Writes a draft snapshot for this period. The dashboard updates only after the write is confirmed.</li>
      </ol></div>
    </div>`
    + (S.accounts.length ? `<div style="margin-top:14px">${reconStrip()}</div>` : "")
    + (last && last.intake ? `<div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Intake reconciliation <span class="hint">${E(last.name)}</span></h3>
        ${T([{ h: "Stage", v: r => E(r[0]) }, { h: "Records", n: 1, v: r => CNT(r[1]) }, { h: "", v: r => r[2] || "" }], [
          ["Source rows detected below the header", last.intake.sourceRows, ""],
          ["Skipped — entirely empty row", last.intake.blank, last.intake.blank ? '<span class="tag t-warn">excluded</span>' : ""],
          ["Rejected — no account number and no borrower", last.intake.noKey, last.intake.noKey ? '<span class="tag t-bad">excluded</span>' : ""],
          ["Records successfully imported", last.intake.imported, '<span class="tag t-ok">in the register</span>'],
          ["Duplicate account numbers (imported, flagged)", last.intake.duplicates, last.intake.duplicates ? '<span class="tag t-warn">review</span>' : ""]
        ])}
        <p class="mut sm" style="margin:10px 0 0">Sheet used: <b>${E(last.sheet)}</b> (header row ${CNT((last.headerRow || 0) + 1)}, match score ${CNT(last.score || 0)}).${
          last.runnerUp ? ` Runner-up: <b>${E(last.runnerUp.sheet)}</b> at ${CNT(last.runnerUp.score)}.${
            (last.score - last.runnerUp.score) <= 4 ? ' <span class="tag t-warn">narrow margin — confirm the correct sheet was chosen</span>' : ""}` : ""}</p>
        </div>
        <div class="card"><h3>Rows not imported <span class="hint">${CNT((last.intake.rejected || []).length)}</span></h3>
        ${(last.intake.rejected || []).length
          ? T([{ h: "Source row", n: 1, v: r => CNT(r.row) }, { h: "Reason", v: r => E(r.reason) }], (last.intake.rejected || []).slice(0, 500))
          : '<div class="note g"><b>Every source row was imported</b>No row was skipped, rejected or truncated.</div>'}
        </div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Sheets found in the source file</h3>${T([
        { h: "Sheet", v: r => E(r.name) }, { h: "Rows", n: 1, v: r => CNT(r.rows) },
        { h: "Used for the register", v: r => r.name === last.sheet ? '<span class="tag t-ok">yes</span>' : '<span class="tag t-mute">no</span>' }
      ], last.sheets || [])}</div>` : "")
    + `<div class="card" style="margin-top:14px"><h3>Import register</h3>${T([
        { h: "File", v: r => `<b>${E(r.name)}</b>` }, { h: "Sheet used", v: r => E(r.sheet) },
        { h: "Records", n: 1, v: r => CNT(r.records) }, { h: "Columns mapped", n: 1, v: r => CNT(r.mapped) },
        { h: "Unmapped", n: 1, v: r => CNT(r.unmapped.length) },
        { h: "SHA-256", v: r => `<span class="mono">${E(String(r.hash).slice(0, 16))}…</span>` },
        { h: "Period", v: r => E(r.period) }, { h: "Date", v: r => E(r.date) },
        { h: "Status", v: r => `<span class="tag t-ok">${E(r.status)}</span>` }
      ], S.imports)}</div>`
    + (last ? `<div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Mapped fields <span class="hint">${CNT(last.mapped)} of ${FIELDS.length}</span></h3>
          ${T([{ h: "LPMRS field", v: r => E(FIELD_LABEL[r] || r) }, { h: "Status", v: r => '<span class="tag t-ok">mapped</span>' }], Object.keys(last.mapFields || {}))}</div>
        <div class="card"><h3>Fields the extract does not supply</h3>
          <p class="mut sm">These dimensions are required by the source document but do not exist in the core banking extract. They must be captured in the LPMRS or supplied as an additional file before the related report can be certified.</p>
          ${T([{ h: "Field", v: r => E(FIELD_LABEL[r] || r) }], (last.missingFields || []))}</div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Columns kept but not mapped</h3><div>${(last.unmapped || []).map(u => `<span class="chip">${E(u)}</span>`).join("") || '<span class="mut sm">None.</span>'}</div></div>` : "");
}

/* ------------------------------------------------------- validation centre */
function vValidation() {
  const t = totals();
  const all = t.exceptions;
  const byCode = {};
  all.forEach(e => { (byCode[e.code] = byCode[e.code] || { sev: e.sev, msg: e.msg, fix: e.fix, n: 0 }); byCode[e.code].n++; });
  /* Spec section 7: a difference between the source record count and the
     register record count must automatically raise a visible exception.
     It is period-level rather than account-level, so it is raised here
     rather than inside the per-account rule engine. */
  const x = intakeStats();
  const intakeException = (S.rules.reconcileIntake && S.accounts.length && !x.reconciled)
    ? `<div class="note b"><b>RECON-01 (blocking) — source record count does not equal the loan register record count</b>
       The source file declared ${CNT(x.sourceRows)} records; the register holds ${CNT(x.imported)}. Difference: ${CNT(x.rejected)}
       (${CNT(x.blank)} blank row(s), ${CNT(x.noKey)} without an account number or borrower name).
       Every affected row is listed with its source row number on the Import &amp; mapping screen.
       Required correction: repair the source rows and re-import, or record a formal acceptance of the exclusion, before this period is validated.</div>`
    : "";

  return head("Validation centre",
    "Blocking errors must be cleared before a period can be validated and locked. Warnings must be reviewed and either fixed or accepted with a reason.")
    + intakeException
    + `<div class="grid g4">
      <div class="kpi ${t.blocks ? "bad" : "ok"}"><span class="lab">Blocking errors</span><span class="val">${CNT(t.blocks)}</span><span class="sub">must be corrected</span></div>
      <div class="kpi ${t.warns ? "warn" : "ok"}"><span class="lab">Warnings</span><span class="val">${CNT(t.warns)}</span><span class="sub">review and dispose</span></div>
      <div class="kpi"><span class="lab">Accounts with findings</span><span class="val">${CNT(new Set(all.map(e => e.key)).size)}</span><span class="sub">of ${CNT(S.accounts.length)}</span></div>
      <div class="kpi ${t.blocks ? "" : "ok"}"><span class="lab">Clean accounts</span><span class="val">${CNT(S.accounts.length - new Set(all.map(e => e.key)).size)}</span><span class="sub">no findings</span></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Findings by rule</h3>${T([
      { h: "Rule", v: r => `<span class="mono">${E(r[0])}</span>` },
      { h: "Severity", v: r => sev(r[1].sev) },
      { h: "Accounts", n: 1, v: r => CNT(r[1].n) },
      { h: "Finding", v: r => E(r[1].msg) },
      { h: "Required correction", v: r => `<span class="mut sm">${E(r[1].fix)}</span>` }
    ], Object.entries(byCode).sort((a, b) => (a[1].sev === "BLOCK" ? -1 : 1) - (b[1].sev === "BLOCK" ? -1 : 1) || b[1].n - a[1].n))}</div>
    <div class="card" style="margin-top:14px"><h3>Account-level exception list</h3>${T([
      { h: "Severity", v: e => sev(e.sev) }, { h: "Rule", v: e => `<span class="mono">${E(e.code)}</span>` },
      { h: "Account", v: e => E(e.key) }, { h: "Borrower", v: e => E(e.borrower) },
      { h: "Finding", v: e => E(e.msg) }, { h: "Correction", v: e => `<span class="mut sm">${E(e.fix)}</span>` }
    ], capRows(all, "register"))}</div>`;
}

/* --------------------------------------------------------- reconciliation */
function vReconcile() {
  const t = totals();
  const k = periodKey();
  const r = S.reconciliation[k] = S.reconciliation[k] || { beginning: 0, releases: 0, availments: 0, collections: 0, fullyPaid: 0, restructurings: 0, writeOffs: 0, ropa: 0, recoveries: 0, adjustments: 0, sources: {} };
  const computedEnding = N(r.beginning) + N(r.releases) + N(r.availments) - N(r.collections) - N(r.fullyPaid) - N(r.writeOffs) - N(r.ropa) + N(r.recoveries) + N(r.adjustments);
  const diff = computedEnding - t.gross;
  const src = [["Core banking loan report", "coreBanking"], ["Loan subsidiary ledger", "sl"], ["General ledger", "gl"], ["ACL schedule", "acl"], ["FRP", "frp"], ["AFRD report", "afrd"], ["SBLAF", "sblaf"], ["COCREE 2.0", "cocree"], ["CIC", "cic"], ["DOSRI report", "dosri"], ["ACPC", "acpc"], ["Small Business Corporation", "sbcorp"]];
  return head("Reconciliation",
    "Beginning balance plus movement must equal the ending balance, and the LPMRS must tie to every downstream report. Differences either resolve or are carried as approved exceptions.")
    + `<div class="card"><h3>Portfolio movement</h3>
      <div class="frow">${[["beginning", "Beginning balance"], ["releases", "Releases"], ["availments", "Additional availments"], ["collections", "Collections"], ["fullyPaid", "Fully paid"], ["restructurings", "Restructurings"], ["writeOffs", "Write-offs"], ["ropa", "ROPA transfers"], ["recoveries", "Recoveries"], ["adjustments", "Adjustments"]].map(([f, lab]) => `<label class="f">${lab}<input type="number" data-recon="${f}" value="${N(r[f])}" ${isLocked() ? "disabled" : ""}></label>`).join("")}</div>
      ${T([{ h: "Check", v: x => E(x[0]) }, { h: "Amount", n: 1, v: x => x[1] }], [
        ["Computed ending balance", P(computedEnding)],
        ["LPMRS register total", P(t.gross)],
        ["Difference", (Math.abs(diff) < 0.01 ? '<span class="tag t-ok">reconciled</span> ' : '<span class="tag t-bad">variance</span> ') + P(diff)]
      ])}</div>
      <div class="card" style="margin-top:14px"><h3>Cross-report reconciliation</h3>
      <p class="mut sm">Enter each source total. Any difference must carry a reason and an owner before the period can be locked.</p>
      ${T([
        { h: "Source report", v: s => E(s[0]) },
        { h: "Source total", v: s => `<input type="number" data-src="${s[1]}" value="${N((r.sources[s[1]] || {}).total)}" style="border:1px solid var(--line);border-radius:6px;padding:4px 6px;width:150px" ${isLocked() ? "disabled" : ""}>` },
        { h: "LPMRS total", n: 1, v: s => P(t.gross) },
        { h: "Difference", n: 1, v: s => P(N((r.sources[s[1]] || {}).total) ? N((r.sources[s[1]] || {}).total) - t.gross : 0) },
        { h: "Result", v: s => { const d = N((r.sources[s[1]] || {}).total); return !d ? '<span class="tag t-mute">not entered</span>' : Math.abs(d - t.gross) < 0.01 ? '<span class="tag t-ok">agrees</span>' : '<span class="tag t-warn">variance</span>'; } }
      ], src)}</div>`;
}

/* --------------------------------------------------------- reports & flow */
function vReports() {
  const t = totals();
  const w = wf();
  const canValidate = t.blocks === 0;
  return head("Reports & workflow",
    "Monthly M01–M12, quarterly Q1–Q4 and an annual view. A period moves draft → validated → locked, and a locked period can only be changed by a new amendment version.")
    + `<div class="grid g4">
      <div class="kpi"><span class="lab">Period</span><span class="val" style="font-size:19px">${E(periodKey())}</span><span class="sub">cut-off ${E(S.cutoff)}</span></div>
      <div class="kpi ${w.status === "LOCKED" ? "ok" : w.status === "VALIDATED" ? "" : "warn"}"><span class="lab">Workflow status</span><span class="val" style="font-size:19px">${E(w.status)}</span><span class="sub">${w.lockedAt ? "locked " + E(w.lockedAt) : "not locked"}</span></div>
      <div class="kpi ${canValidate ? "ok" : "bad"}"><span class="lab">Blocking errors</span><span class="val">${CNT(t.blocks)}</span><span class="sub">${canValidate ? "clear to validate" : "must be cleared first"}</span></div>
      <div class="kpi"><span class="lab">Rule version</span><span class="val" style="font-size:19px">${E(S.rules.ruleVersion)}</span><span class="sub">${E(activeProfile().label)}</span></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Maker – checker – approver</h3>
      <p class="mut sm">Each slot is stamped with the signed-in username, not typed freely, so segregation of duties can be enforced: a maker cannot also approve their own work, and whoever checked an item cannot also approve that same item.</p>
      <div class="frow" style="grid-template-columns:repeat(3,1fr)">
        ${["maker","checker","approver"].map(rk => {
          const names = { maker: "Prepared by (maker)", checker: "Reviewed by (checker)", approver: "Approved by (approver)" };
          const filled = w[rk];
          const roleForSlot = rk === "maker" ? "Maker" : rk === "checker" ? "Checker" : "Approver";
          const canRecord = w.status !== "LOCKED" && CURRENT_USER && (CURRENT_USER.role === roleForSlot || CURRENT_USER.role === "Administrator");
          return `<div><label class="f">${names[rk]}</label>
            <div style="padding:8px 0">${filled ? `<b>${E(filled)}</b>` : '<span class="mut sm">Not yet recorded</span>'}</div>
            ${canRecord ? `<button class="btn sm sec" data-act="record-wf" data-wf-role="${rk}">Record ${filled ? "(overwrite)" : "me"} as ${roleForSlot.toLowerCase()}</button>` : ""}
          </div>`;
        }).join("")}
      </div>
      <div class="bar" style="margin-top:10px">
        <button class="btn" data-act="validate-period" ${canValidate && w.status === "DRAFT" ? "" : "disabled"}>Mark validated</button>
        <button class="btn gold" data-act="lock-period" ${w.status === "VALIDATED" ? "" : "disabled"}>Lock period</button>
        <button class="btn ghost" data-act="amend-period" ${w.status === "LOCKED" ? "" : "disabled"}>Open amendment</button>
      </div>
      <p class="mut sm">${w.status === "DRAFT" ? "A period can only be validated once every blocking error is cleared." : w.status === "VALIDATED" ? "Checker and approver names are required before locking." : "This period is locked. Figures are frozen; corrections require an amendment version."}</p>
      ${w.status === "LOCKED" && w.hash ? `<div class="note g" style="margin-top:8px"><b>Locked snapshot verified</b>SHA-256 <span class="mono">${E(w.hash)}</span> was computed over the account snapshot at the moment of locking (${E(w.lockedAt)}). Any change to the underlying figures after this point will not match this hash.</div>` : ""}
      ${w.status === "LOCKED" && !w.hash ? `<div class="note w" style="margin-top:8px">This period was locked before snapshot hashing was enabled. No cryptographic hash is on record for it — open an amendment and re-lock to generate one.</div>` : ""}
    </div>
    <div class="card" style="margin-top:14px"><h3>Report pack</h3>
      <p class="mut sm">The exported workbook carries every schedule below, plus the rule version and the active policy profile on each sheet.</p>
      ${T([{ h: "Sheet", v: r => `<b>${E(r[0])}</b>` }, { h: "Content", v: r => E(r[1]) }], [
        ["Dashboard", "Period parameters, portfolio KPIs, performance and security segmentation, ACL position, AFRD summary."],
        ["Loan Register", "Every account with all classification dimensions and the computed ACL."],
        ["Aging & Classification", "Aging bands aligned to the ACL matrices, with counts, balances and required allowance."],
        ["Impairment & ACL", "Basis, table used, rate, floor, required, booked and variance for each account."],
        ["Collateral Register", "Appraised and eligible value, coverage, gap, perfection status."],
        ["AFRD Schedule", "Account-level eligibility, exclusions and the compliance computation."],
        ["Government Programmes", "ACPC, SBCorp and other facilities with funding split and ACL basis."],
        ["DOSRI_RPT", "Relationship exposures and approval references."],
        ["Collection & Remedial", "Arrears work queue segregated by funding source."],
        ["Exceptions", "Every blocking error and warning with the required correction."],
        ["Reconciliation", "Movement and cross-report reconciliation with variances."],
        ["Parameters", "Every threshold, matrix rate and policy profile in force, with the rule version."]
      ])}
      <div class="bar" style="margin-top:12px"><button class="btn" data-act="export-xlsx">Export workbook (.xlsx)</button><button class="btn sec" data-act="export-json">Export JSON backup</button><button class="btn ghost" data-act="print">Print / save as PDF</button></div>
    </div>`;
}

/* ------------------------------------------------------------- parameters */
function vParams() {
  const R = S.rules;
  const rateTable = (key, title) => `<div class="card"><h3>${title}</h3>${T([
    { h: "From", n: 1, v: (b, i) => `<input type="number" data-rule="${key}.${i}.min" value="${b.min}" style="width:70px;border:1px solid var(--line);border-radius:6px;padding:3px 5px">` },
    { h: "To", n: 1, v: (b, i) => `<input type="number" data-rule="${key}.${i}.max" value="${b.max}" style="width:80px;border:1px solid var(--line);border-radius:6px;padding:3px 5px">` },
    { h: "Classification", v: b => E(b.cls) },
    { h: "Rate %", n: 1, v: (b, i) => `<input type="number" step="0.01" data-rule="${key}.${i}.rate" value="${b.rate}" style="width:70px;border:1px solid var(--line);border-radius:6px;padding:3px 5px">` },
    { h: "Escalated", n: 1, v: b => b.escalated ? PCT(b.escalated, 0) : "" },
    { h: "Stage", n: 1, v: b => b.stage }
  ], R[key])}</div>`;

  return head("Parameters",
    "Every threshold in the source document lives here, not in the code. Changes take effect from their effective date and never reclassify a locked period.")
    + `<div class="note w"><b>Stage 4 does not exist in PFRS 9 or BSP reporting</b>The later instruction asks for a Stage 4. PFRS 9 recognises Stages 1 to 3 only. The system keeps the request as an internal recovery status (collection, legal/ITL, written-off, ROPA) shown on the remedial screen, and never exports it as an impairment stage. Confirm with Accounting that this is the intended meaning.</div>
    <div class="card"><h3>Impairment and ACL</h3><div class="frow">
      <label class="f">GLLP rate<input type="number" step="0.001" data-rule="gllpRate" value="${R.gllpRate}"></label>
      <label class="f">Small-loan threshold<input type="number" data-rule="smallLoanThreshold" value="${R.smallLoanThreshold}"></label>
      <label class="f">Small-loan minimum ACL<input type="number" data-rule="smallLoanMinimumAcl" value="${R.smallLoanMinimumAcl}"></label>
      <label class="f">Small-loan floor<select data-rule="smallLoanFloorEnabled"><option value="true" ${R.smallLoanFloorEnabled ? "selected" : ""}>Enabled</option><option value="false" ${!R.smallLoanFloorEnabled ? "selected" : ""}>Disabled</option></select></label>
      <label class="f">Suppress floor on written-off / \u20b11 accounts<select data-rule="suppressFloorOnMemo"><option value="true" ${R.suppressFloorOnMemo ? "selected" : ""}>Yes — no allowance on memorandum accounts</option><option value="false" ${!R.suppressFloorOnMemo ? "selected" : ""}>No — provision memorandum accounts</option></select></label>
      <label class="f">Derive booked ACL from the provision rate<select data-rule="deriveBookedAclFromRate" ${isLocked() ? "disabled" : ""}><option value="true" ${R.deriveBookedAclFromRate !== false ? "selected" : ""}>Yes — rate x balance when the extract has no booked amount</option><option value="false" ${R.deriveBookedAclFromRate === false ? "selected" : ""}>No — booked allowance comes from the general ledger</option></select></label>
      <label class="f">V-SEC-01 blocks from (days past due)<input type="number" data-rule="securedEvidenceBlockDpd" value="${R.securedEvidenceBlockDpd}" ${isLocked() ? "disabled" : ""}></label>
      <label class="f">V-SEC-01 on written-off / \u20b11 accounts<select data-rule="suppressSecuredEvidenceBlockOnMemo" ${isLocked() ? "disabled" : ""}><option value="true" ${R.suppressSecuredEvidenceBlockOnMemo ? "selected" : ""}>Warning only — no receivable left to secure</option><option value="false" ${!R.suppressSecuredEvidenceBlockOnMemo ? "selected" : ""}>Blocking — an appraisal is required regardless</option></select></label>
      <label class="f">Secured rates require collateral evidence<select data-rule="securedRatesRequireCollateral"><option value="true" ${R.securedRatesRequireCollateral ? "selected" : ""}>Yes — unsecured matrix until valued and perfected</option><option value="false" ${!R.securedRatesRequireCollateral ? "selected" : ""}>No</option></select></label>
      <label class="f">Curing period (days)<input type="number" data-rule="curingDays" value="${R.curingDays}"></label>
      <label class="f">NPL threshold (days)<input type="number" data-rule="nplDpdThreshold" value="${R.nplDpdThreshold}"></label>
    </div></div>
    <div class="grid g2" style="margin-top:14px">${rateTable("aclUnsecured", "ACL matrix — unsecured")}${rateTable("aclSecured", "ACL matrix — secured")}</div>
    <div class="card" style="margin-top:14px"><h3>Reporting-scope profile <span class="hint">the source document contains both instructions</span></h3>
      ${Object.entries(R.profiles).map(([k, p]) => `<label style="display:grid;grid-template-columns:24px 1fr;gap:8px;align-items:start;padding:10px;border:1px solid ${R.acpcScope === k ? "var(--brand3)" : "var(--line)"};border-radius:9px;margin-bottom:8px;background:${R.acpcScope === k ? "#f2faf6" : "#fff"}">
        <input type="radio" name="scope" data-rule="acpcScope" value="${k}" ${R.acpcScope === k ? "checked" : ""}>
        <span><b>${E(p.label)}</b><br><span class="mut sm">${E(p.text)}</span></span></label>`).join("")}
      <p class="mut sm">Whichever profile is active, ACPC records, facility ledgers, collection and reconciliation are retained in full. A report scope never deletes data.</p>
    </div>
    <div class="card" style="margin-top:14px"><h3>Government programmes and AFRD</h3><div class="frow">
      <label class="f">AFRD required rate<input type="number" step="0.01" data-rule="afrdRate" value="${R.afrdRate}"></label>
      <label class="f">Total loanable funds<input type="number" data-rule="totalLoanableFunds" value="${R.totalLoanableFunds}"></label>
      <label class="f">SBCorp retained risk share<input type="number" step="0.01" data-rule="sbcorpRetainedDefault" value="${R.sbcorpRetainedDefault}"></label>
      <label class="f">SBCorp risk transfer legally confirmed<select data-rule="sbcorpRiskTransferConfirmed"><option value="false" ${!R.sbcorpRiskTransferConfirmed ? "selected" : ""}>Not confirmed — provision the full exposure</option><option value="true" ${R.sbcorpRiskTransferConfirmed ? "selected" : ""}>Confirmed — provision the retained share only</option></select></label>
    </div></div>
    <div class="card" style="margin-top:14px"><h3>Housing ceilings</h3><div class="frow">
      ${R.housingHorizontal.slice(0, 4).map((b, i) => `<label class="f">${E(b.cls)} up to<input type="number" data-rule="housingHorizontal.${i}.max" value="${b.max === Infinity ? "" : b.max}"></label>`).join("")}
      <label class="f">Socialized vertical / condominium up to<input type="number" data-rule="housingVertical.0.max" value="${R.housingVertical[0].max}"></label>
    </div></div>
    <div class="card" style="margin-top:14px"><h3>Parameter governance</h3><div class="frow" style="grid-template-columns:repeat(4,1fr)">
      <label class="f">Rule version<input data-rule="ruleVersion" value="${E(R.ruleVersion)}"></label>
      <label class="f">Effective date<input type="date" data-rule="effectiveDate" value="${E(R.effectiveDate)}"></label>
      <label class="f">Prepared by<input data-rule="maker" value="${E(R.maker)}"></label>
      <label class="f">Approved by<input data-rule="approver" value="${E(R.approver)}"></label>
    </div>
    <div class="card" style="margin-top:14px"><h3>Register capacity <span class="hint">display ceilings only</span></h3>
      <p class="mut sm" style="margin:0 0 10px">These cap how many rows each screen renders at once. They never affect calculation: every ratio, total, allowance and report is computed over the complete register regardless of what is displayed. Minimum operating capacity is 1,000; set a value to <b>0</b> for no ceiling at all.</p>
      <div class="frow">
        ${Object.keys(R.renderLimits || {}).map(kk => `<label class="f">${E(kk.charAt(0).toUpperCase() + kk.slice(1))}<input type="number" min="0" step="500" data-rule="renderLimits.${kk}" value="${R.renderLimits[kk]}"></label>`).join("")}
      </div>
      <label class="f" style="max-width:520px"><span><input type="checkbox" data-rule="reconcileIntake" ${R.reconcileIntake ? "checked" : ""}> Raise a blocking exception when the source record count differs from the register record count</span></label>
    </div>
    <div class="card" style="margin-top:14px"><h3>Collection correspondence templates <span class="hint">spec section 4 — configurable, not hard-coded</span></h3>
      <p class="mut sm" style="margin:0 0 10px">Templates are offered on an account when its days past due fall inside the template's window. Placeholders in <span class="mono">{{double braces}}</span> are resolved from the loan register at generation time, so borrower and loan details are never re-keyed. Available tokens: ${Object.keys(LETTER_TOKENS).map(k => `<span class="mono">{{${E(k)}}}</span>`).join(" ")}.</p>
      ${T([
        { h: "ID", v: t => `<span class="mono">${E(t.id)}</span>` },
        { h: "Name", v: (t, i) => `<input data-rule="letterTemplates.${i}.name" value="${E(t.name)}" style="width:190px;border:1px solid var(--line);border-radius:6px;padding:3px 6px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Category", v: t => `<span class="tag t-info">${E(t.category)}</span>` },
        { h: "From DPD", n: 1, v: (t, i) => `<input type="number" data-rule="letterTemplates.${i}.minDpd" value="${t.minDpd ?? ""}" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "To DPD", n: 1, v: (t, i) => `<input type="number" data-rule="letterTemplates.${i}.maxDpd" value="${t.maxDpd ?? ""}" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:3px 5px" ${isLocked() ? "disabled" : ""}>` },
        { h: "Active", v: (t, i) => `<input type="checkbox" data-rule="letterTemplates.${i}.active" ${t.active !== false ? "checked" : ""} ${isLocked() ? "disabled" : ""}>` },
        { h: "Issued", n: 1, v: t => CNT(allLetters().filter(l => l.templateId === t.id).length) }
      ], S.rules.letterTemplates || [])}
      <p class="mut sm" style="margin:10px 0 0">Template wording itself is edited on the account, in the preview, before issuing. A template with both DPD bounds blank is offered on every account.</p>
    </div>
    <div class="bar"><button class="btn" data-act="approve-rules">Approve this parameter set</button><button class="btn ghost" data-act="reset-rules">Restore document defaults</button></div>
    <p class="mut sm">Status: <b>${E(R.approvalState.replace(/_/g, " "))}</b>. Only the President and CEO or a specifically authorised officer may approve threshold changes. Changes apply prospectively and do not reclassify finalised periods.</p></div>`;
}

/* ---------------------------------------------------------- storage vault */
function vStorage() {
  return head("Storage vault",
    "The Origin Private File System holds imported files, parsed data, drafts, locked reports, exports, backups and the audit trail. Nothing is written to a server.")
    + `<div id="storeStats" class="grid g4"><div class="kpi"><span class="lab">Checking storage…</span><span class="val">—</span><span class="sub"></span></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3>Directory structure</h3><div class="tree">/${APP.root}/
├── config/            parameters, policy profiles
├── imports/           original files, byte-for-byte
├── parsed/            per-file manifest and mapped accounts
├── loanbook/          draft, validated and locked snapshots
├── reports/           monthly, quarterly, annual
├── exports/           generated workbooks and backups
├── audit/             append-only NDJSON per day
├── backups/
└── temp/              staging only, cleared after commit</div>
        <div class="bar" style="margin-top:12px"><button class="btn sec" data-act="check-storage">Re-check capacity</button><button class="btn ghost" data-act="request-persist">Request persistent storage</button></div>
      </div>
      <div class="card"><h3>Files in the vault</h3><div id="vaultFiles"><span class="mut sm">Reading…</span></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Backup and restore</h3>
      <p class="mut sm">Export writes a full JSON copy of the working state — rules, accounts, workflow, contract history, collection log and audit trail. Restore reads that file back in, shows exactly what it contains, and only replaces the working state after you confirm.</p>
      <div class="bar"><button class="btn sec" data-act="export-json">Export JSON backup</button><button class="btn ghost" data-act="backup-restore-open">Restore from backup…</button></div>
    </div>`;
}

/* --------------------------------------------------------- administration */
function vAdmin() {
  const isAdmin = CURRENT_USER && CURRENT_USER.role === "Administrator";
  return head("Administration",
    "Role-gated controls, user accounts, the audit trail and the reset. Reset is deliberately hard to reach and impossible to trigger by accident.")
    + `<div class="card"><h3>Signed in</h3><div class="frow" style="grid-template-columns:repeat(3,1fr)">
      <label class="f">Username<input value="${E(CURRENT_USER.username)}" disabled></label>
      <label class="f">Role<input value="${E(CURRENT_USER.role)}" disabled></label>
      <label class="f">Reporting cut-off<input type="date" id="cutoff2" value="${S.cutoff}"></label>
    </div>
    <p class="mut sm">A single browser profile cannot enforce true segregation of duties against a determined insider. The identity and role recorded here are an accountability marker in the audit trail; the bank must still control the device, the operating-system account and the browser profile.</p></div>

    <div class="card" style="margin-top:14px"><h3>Change my password <span class="hint">${E(CURRENT_USER.username)}</span></h3>
    <p class="mut sm" style="margin:0 0 10px">Available to every role. The current password is required, so a session left unattended cannot be used to lock the account holder out.</p>
    <div class="frow" style="grid-template-columns:repeat(3,1fr)">
      <label class="f">Current password<input type="password" id="cpCurrent" autocomplete="current-password"></label>
      <label class="f">New password<input type="password" id="cpNew1" autocomplete="new-password"></label>
      <label class="f">Confirm new password<input type="password" id="cpNew2" autocomplete="new-password"></label>
    </div>
    <div class="bar"><button class="btn" data-act="change-my-password">Change password</button></div>
    <p class="mut sm" style="margin:6px 0 0" id="cpMsg"></p></div>

    ${(function () {
      const me = findUser(CURRENT_USER.username) || {};
      const set = hasSecurityQuestions(me);
      const picked = set ? me.securityQuestions.map(q => q.question) : [SECURITY_QUESTION_BANK[0], SECURITY_QUESTION_BANK[1]];
      return `<div class="card" style="margin-top:14px"><h3>Password recovery questions <span class="hint">${set ? "set " + E(String(me.securityQuestionsSetAt || "").slice(0, 10)) : "not set"}</span></h3>
      ${set
        ? `<div class="note g"><b>Recovery questions are set for ${E(CURRENT_USER.username)}</b>If this password is forgotten it can be reset from the login screen by answering these questions. Setting them again replaces the existing answers.</div>`
        : `<div class="note ${CURRENT_USER.role === "Administrator" ? "b" : "w"}"><b>No recovery questions are set for ${E(CURRENT_USER.username)}</b>${
            CURRENT_USER.role === "Administrator"
              ? "If this Administrator password is forgotten and no other Administrator account exists, this installation cannot be re-opened and would have to be rebuilt from the source file. Set them now."
              : "Without these, a forgotten password has to be reset by an Administrator."}</div>`}
      <div class="frow" style="grid-template-columns:1fr 1fr">
        ${[0, 1].map(i => `<label class="f">Question ${i + 1}<select id="sqQ${i}">${
          SECURITY_QUESTION_BANK.map(q => `<option value="${E(q)}" ${q === picked[i] ? "selected" : ""}>${E(q)}</option>`).join("")
        }</select></label>
        <label class="f">Answer ${i + 1}<input id="sqA${i}" autocomplete="off" placeholder="${set ? "Enter a new answer to replace the current one" : "Your answer"}"></label>`).join("")}
      </div>
      <div class="bar"><button class="btn" data-act="set-security-questions">${set ? "Replace recovery questions" : "Set recovery questions"}</button></div>
      <p class="mut sm" style="margin:6px 0 0" id="sqMsg"></p>
      <p class="mut sm" style="margin:8px 0 0">Capitalisation and extra spaces are ignored, so an answer typed months later still works. Choose answers a colleague could not guess — an answer that is public knowledge protects nothing. Answers are hashed and cannot be read back from the stored data, including by an Administrator.</p></div>`;
    })()}

    ${isAdmin ? `<div class="card" style="margin-top:14px"><h3>User accounts <span class="hint">${CNT(S.users.length)} total</span></h3>
    ${T([
      { h: "Username", v: u => `<b>${E(u.username)}</b>` },
      { h: "Role", v: u => E(u.role) },
      { h: "Status", v: u => u.active ? '<span class="tag t-ok">Active</span>' : '<span class="tag t-mute">Disabled</span>' },
      { h: "Created", v: u => E(u.createdAt) },
      { h: "", v: u => u.username === CURRENT_USER.username ? '<span class="mut sm">your account</span>' : `<button class="btn sm ghost" data-act="toggle-user" data-username="${E(u.username)}">${u.active ? "Disable" : "Enable"}</button> <button class="btn sm ghost" data-act="reset-pw" data-username="${E(u.username)}">Reset password</button>` }
    ], S.users)}

    <div class="frow" style="grid-template-columns:repeat(4,1fr);margin-top:12px">
      <label class="f">New username<input id="newUserName"></label>
      <label class="f">Temporary password<input id="newUserPass" type="password"></label>
      <label class="f">Role<select id="newUserRole">${["Maker","Checker","Approver","Administrator"].map(r => `<option>${r}</option>`).join("")}</select></label>
      <label class="f">&nbsp;<button class="btn" data-act="add-user" style="width:100%;justify-content:center">Add account</button></label>
    </div>
    <p class="mut sm">New accounts must change their temporary password on first login.</p></div>` : `<div class="card" style="margin-top:14px"><p class="mut sm">Only an Administrator can manage user accounts.</p></div>`}

    <div class="card" style="margin-top:14px"><h3>Audit trail <span class="hint">${CNT(S.audit.length)} entries</span></h3>
    ${T([{ h: "Timestamp", v: a => `<span class="mono">${E(a.ts.replace("T", " ").slice(0, 19))}</span>` },
         { h: "User", v: a => E(a.user || "—") }, { h: "Role", v: a => E(a.role) }, { h: "Action", v: a => E(a.action) }, { h: "Detail", v: a => `<span class="mut sm">${E(a.detail)}</span>` }], S.audit.slice(0, 250))}</div>

    ${isAdmin ? `<div class="card" style="margin-top:14px;border-color:#e6b4b4">
      <h3 style="color:var(--bad)">Reset</h3>
      <p class="sm">This erases every loan record, import, parsed file, draft, report, export and audit entry in the vault, and returns the application to its initial state. Locked reports are erased as well, so take a backup first if retention rules require one. User accounts are kept.</p>
      <div class="bar"><button class="btn sec" data-act="export-json">Back up everything first</button><button class="btn bad" data-act="reset-open">Reset the system</button></div>
    </div>` : ""}`;
}

/* ----------------------------------------------------------- account drawer */
/* ---------------------------------------------- contract version history */
function contractHistoryCard(c) {
  const hist = Eng.contractHistory(c.account);
  return `<div class="card" style="margin-top:12px"><h3>Contract version history <span class="hint">R16 — each restructuring creates a new linked version; the original is never overwritten</span></h3>
    ${hist.length ? T([
      { h: "Date", v: v => E(v.effectiveDate) },
      { h: "Event", v: v => E(v.eventType) },
      { h: "Original terms", v: v => E(v.originalTerms || "") },
      { h: "New terms", v: v => E(v.newTerms || "") },
      { h: "Concessions", v: v => E(v.concessions || "") },
      { h: "Moratorium", v: v => E(v.moratorium || "") },
      { h: "Cure date", v: v => E(v.cureDate || "") },
      { h: "Re-default", v: v => v.reDefault ? '<span class="tag t-bad">yes</span>' : "" },
      { h: "Evidence", v: v => E(v.evidenceRef || "") },
      { h: "Approved by", v: v => E(v.approver || "") }
    ], hist) : '<p class="mut sm">No restructuring, renewal or modification events recorded. The account remains on its original contract.</p>'}
    ${isLocked() ? '<p class="mut sm">Period is locked. Open an amendment to record a new contract event.</p>' : `
    <div class="frow" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      <label class="f">Event type<select id="cvType">
        <option value="RENEWED">Renewed</option><option value="REFINANCED">Refinanced</option>
        <option value="MODIFIED">Modified / additional</option><option value="RESTRUCTURED">Restructured</option>
      </select></label>
      <label class="f">Effective date<input type="date" id="cvDate" value="${today()}"></label>
      <label class="f">Re-default since prior version<select id="cvRedefault"><option value="">No</option><option value="yes">Yes</option></select></label>
      <label class="f">Original terms<input id="cvOrig" placeholder="e.g. 5yr, 12% p.a., monthly"></label>
      <label class="f">New terms<input id="cvNew" placeholder="e.g. 7yr, 10% p.a., monthly"></label>
      <label class="f">Concessions granted<input id="cvConcessions" placeholder="e.g. rate reduction"></label>
      <label class="f">Moratorium<input id="cvMoratorium" placeholder="e.g. 6 months on principal"></label>
      <label class="f">Cure date (if applicable)<input type="date" id="cvCure"></label>
      <label class="f">Evidence reference<input id="cvEvidence" placeholder="board/credit committee minute no."></label>
      <label class="f">Approved by<input id="cvApprover" placeholder="approver name"></label>
    </div>
    <div class="bar" style="margin-top:8px"><button class="btn sec sm" data-act="add-contract-version" data-key="${E(c.key)}">Add contract version</button></div>`}
  </div>`;
}

/* ----------------------------------------------- collection & remedial log */
function collectionCard(c) {
  const acts = Eng.collectionActions(c.account);
  const letters = (S.letters || {})[c.key] || [];
  return `<div class="card" style="margin-top:12px"><h3>Collection & remedial actions <span class="hint">R18 — contacts, promises, demands, visits, legal action, targets, costs and recoveries</span></h3>
    ${acts.length ? T([
      { h: "Date", v: v => E((v.ts || "").slice(0, 10)) },
      { h: "Type", v: v => E(v.type) },
      { h: "Officer", v: v => E(v.officer || "") },
      { h: "Result / notes", v: v => E(v.contactResult || v.notes || "") },
      { h: "PTP amount", n: 1, v: v => v.ptpAmount ? P(v.ptpAmount) : "" },
      { h: "PTP date", v: v => E(v.ptpDate || "") },
      { h: "PTP status", v: v => v.type !== "PTP" && !v.ptpStatus ? "" : ptpTag(Eng.ptpStatusOf(v)) },
      { h: "Action status", v: v => statusTag(v.status || "COMPLETED") },
      { h: "Remarks", v: v => v.remarks ? `<span class="mut sm">${E(String(v.remarks).slice(0, 50))}</span>` : "" },
      { h: "Next action", v: v => E(v.nextAction || "") },
      { h: "Target date", v: v => E(v.targetDate || "") },
      { h: "Cost", n: 1, v: v => v.cost ? P(v.cost) : "" },
      { h: "Recovery", n: 1, v: v => v.recovery ? P(v.recovery) : "" },
      { h: "Legal case ref.", v: v => E(v.legalCaseRef || "") }
    ], acts) : '<p class="mut sm">No collection or remedial action logged for this account yet.</p>'}
    ${isLocked() ? '<p class="mut sm">Period is locked. Open an amendment to log a new action.</p>' : `
    <div class="frow" style="grid-template-columns:repeat(4,1fr);margin-top:10px">
      <label class="f">Action type<select id="caType">
        ${(S.rules.collectionActionTypes || []).map(x => `<option value="${E(x.code)}">${E(x.label)}</option>`).join("")}
      </select></label>
      <label class="f">Officer<input id="caOfficer" value="${E(Eng.get(c.account, "officer") || "")}"></label>
      <label class="f">Contact result<input id="caResult" placeholder="e.g. spoke to borrower's spouse"></label>
      <label class="f">Action status<select id="caStatus">
        ${(S.rules.actionStatuses || []).map(x => `<option value="${E(x.code)}">${E(x.label)}</option>`).join("")}
      </select></label>
      <label class="f">PTP amount<input type="number" id="caPtpAmount"></label>
      <label class="f">PTP date<input type="date" id="caPtpDate"></label>
      <label class="f">PTP status<select id="caPtpStatus">
        <option value="">Not a promise to pay</option>
        ${(S.rules.ptpStates || []).map(x => `<option value="${E(x.code)}">${E(x.label)}</option>`).join("")}
      </select></label>
      <label class="f">Next action<input id="caNextAction" placeholder="e.g. send second demand letter"></label>
      <label class="f">Action date (target)<input type="date" id="caTargetDate"></label>
      <label class="f">Cost incurred<input type="number" id="caCost"></label>
      <label class="f">Recovery amount<input type="number" id="caRecovery"></label>
      <label class="f">Legal case reference<input id="caLegalRef"></label>
      <label class="f" style="grid-column:1/-1">Remarks / notes<textarea id="caRemarks" rows="2" placeholder="Free-text notes carried onto the work queue"></textarea></label>
    </div>
    <div class="bar" style="margin-top:8px">
      <button class="btn sec sm" data-act="add-collection-action" data-key="${E(c.key)}">Log action</button>
      <button class="btn gold sm" data-act="open-letter" data-key="${E(c.key)}">Generate letter</button>
    </div>`}
    ${letters.length ? `<h3 style="margin:14px 0 8px;font-size:13.5px">Correspondence issued</h3>${T([
      { h: "Reference", v: l => `<span class="mono">${E(l.ref)}</span>` },
      { h: "Date", v: l => E(String(l.ts).replace("T", " ").slice(0, 16)) },
      { h: "Template", v: l => E(l.templateName) },
      { h: "Format", v: l => E(String(l.format).toUpperCase()) },
      { h: "Issued by", v: l => E(l.issuedBy) }
    ], letters.slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts))))}` : ""}
  </div>`;
}

function openAccount(c) {
  const a = c.account;
  const row = (k, v) => `<dt>${E(k)}</dt><dd>${v}</dd>`;
  $("drawer").innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">
      <div style="flex:1"><h2 style="margin:0;font-size:18px">${E(a.borrower || "Unnamed borrower")}</h2>
      <p class="mut sm" style="margin:3px 0 0">${E(a.accountNo)} · ${E(c.product)} · ${E(Eng.get(a, "branch") || "")}</p></div>
      <button class="btn ghost sm" data-act="close-drawer">Close</button>
    </div>
    <div class="card"><h3>Classification set <span class="hint">every dimension held independently</span></h3><dl class="kv">
      ${row("Product or purpose", E(c.product))}
      ${row("Security status", E(c.security.label) + `<br><span class="mut sm">${E(c.security.reason)}</span>`)}
      ${row("Performance status", perfTag(c.perf.cls) + `<br><span class="mut sm">${E(c.perf.why)}</span>`)}
      ${row("Aging band", E(c.perf.band) + ` <span class="mut sm">(${CNT(c.perf.dpd)} days past due)</span>`)}
      ${row("Loan classification", E(c.acl.cls))}
      ${row("Impairment stage", c.acl.stage ? "Stage " + c.acl.stage : "not applicable")}
      ${row("AFRD", E(c.afrd.label) + `<br><span class="mut sm">${E(c.afrd.reason)}</span>`
        + (Eng.get(c.account, "afrdEvidence") ? `<br><span class="mut sm">Reference: <span class="mono">${E(Eng.get(c.account, "afrdEvidence"))}</span></span>` : "")
        + (isLocked() ? "" : `<br><button class="btn sm ghost" data-act="validate-loan-afrd" data-key="${E(c.key)}" style="margin-top:6px">Validate eligibility</button>`
            + ` <button class="btn sm ghost" data-act="priority-sector" data-key="${E(c.key)}" style="margin-top:6px">Beneficiary &amp; funding</button>`))}
      ${row("Government financing", E(c.program.program) + `<br><span class="mut sm">${E(c.program.basisNote)}</span>`)}
      ${row("Borrower relationship", E(c.relationship.label))}
      ${row("Enterprise size", E(c.msme.label) + (c.msme.valid ? "" : `<br><span class="mut sm">${E(c.msme.note)}</span>`))}
      ${row("Contract status", E(c.contract.label) + (c.contract.versions ? ` <span class="mut sm">(${CNT(c.contract.versions)} version${c.contract.versions === 1 ? "" : "s"} on file${c.contract.restructures > 1 ? ", restructured " + c.contract.restructures + " times" : ""})</span>` : ""))}
      ${row("Credit risk rating", c.risk.code ? `<span class="tag t-info">Tier ${E(c.risk.code)} — ${E(c.risk.label)}</span><br><span class="mut sm">${E(c.risk.desc)}${c.risk.overridden ? " (manual override)" : ""}</span>` : '<span class="tag t-mute">Not rated</span>')}
      ${row("Memorandum / acquired asset", E(c.memo.label))}
      ${row("Industry (PSIC)", E(Eng.get(a, "psic") || "not mapped"))}
      ${row("In loan portfolio", c.inPortfolio ? '<span class="tag t-ok">yes</span>' : '<span class="tag t-mute">no — held off the ordinary portfolio</span>')}
    </dl></div>
    <div class="card" style="margin-top:12px"><h3>Allowance computation</h3><dl class="kv">
      ${row("Outstanding principal", P(c.balance))}
      ${row("ACL basis", P(c.acl.basis))}
      ${row("Matrix used", E(c.acl.table))}
      ${row("Rate applied", c.acl.skipped ? "—" : PCT(c.acl.rate, 0))}
      ${row("Matrix amount", P(c.acl.matrixAmount || 0))}
      ${row("Small-loan floor", c.acl.floorApplied ? P(c.acl.floor) + " applied" : "not applicable")}
      ${row("Management overlay", P(c.acl.overlay || 0))}
      ${row("Required allowance", "<b>" + P(c.acl.required) + "</b>")}
      ${row("Booked allowance", P(c.acl.booked))}
      ${row("Variance", P(c.acl.variance || 0))}
      ${row("How it was derived", `<span class="mut sm">${E(c.acl.skipped ? c.acl.reason : c.acl.why)}</span>`)}
    </dl></div>
    <div class="card" style="margin-top:12px"><h3>Findings <span class="hint">${CNT(c.exceptions.length)}</span></h3>
      ${c.exceptions.length ? c.exceptions.map(e => `<div class="note ${e.sev === "BLOCK" ? "b" : "w"}" style="margin-bottom:8px"><b>${E(e.code)} — ${e.sev === "BLOCK" ? "blocking" : "warning"}</b>${E(e.msg)}<br><span class="mut sm">${E(e.fix)}</span></div>`).join("") : '<p class="mut sm">No findings on this account.</p>'}
    </div>
    ${contractHistoryCard(c)}
    ${collectionCard(c)}
    <div class="card" style="margin-top:12px"><h3>Capture missing information</h3>
      <p class="mut sm">These fields are required by the source document but are not supplied by the core banking extract. Values entered here are stored against the account and used in every calculation.</p>
      <div class="frow" style="grid-template-columns:1fr 1fr">
        ${[["collateralValue", "Collateral appraised value", "number"], ["eligibleCollateralValue", "Eligible collateral value", "number"],
           ["collateralPerfected", "Collateral perfected (Y/N)", "text"], ["sellingPrice", "Housing selling price", "number"],
           ["housingUnitType", "Housing unit type (HORIZONTAL/VERTICAL)", "text"], ["programCode", "Programme (BANK/ACPC/SBCORP/DBP/DA)", "text"],
           ["afrdStatus", "AFRD status (ELIGIBLE/PARTIAL/INELIGIBLE)", "text"], ["afrdEvidence", "AFRD evidence reference", "text"],
           ["msmeSize", "Enterprise size (MICRO/SMALL/MEDIUM/LARGE)", "text"], ["msmeAssetEvidence", "Qualifying-asset evidence", "text"],
           ["dosriApproval", "DOSRI approval reference", "text"], ["managementOverlay", "Management overlay", "number"],
           ["foreclosureImminent", "Foreclosure imminent (Y/N)", "text"], ["cureStartDate", "Cure start date", "date"],
           ["psic", "PSIC code", "text"], ["officer", "Assigned officer", "text"],
           ["internalRiskScore", "Internal credit-risk score (0-100)", "number"], ["riskTierOverride", "Risk tier override code (1-8)", "text"]
        ].map(([f, lab, ty]) => `<label class="f">${lab}<input type="${ty}" data-man="${E(c.key)}|${f}" value="${E(Eng.get(a, f) || "")}" ${isLocked() ? "disabled" : ""}></label>`).join("")}
      </div>
    </div>
    <div class="card" style="margin-top:12px"><h3>Result overrides <span class="hint">housing type and required ACL only</span></h3>
      <p class="mut sm">These two results feed regulatory reports directly, so an override needs the revised value, a reason and an approving officer before it takes effect. The system-derived value keeps computing underneath and is shown for comparison; an ACL override can never go below the matrix floor.</p>
      <div class="frow" style="grid-template-columns:1fr 1fr 1fr 1fr">
        <label class="f">Housing classification, system value<input value="${E(c.housing ? c.housing.cls : "n/a")}" disabled></label>
        <label class="f">Revised classification<input type="text" id="ovHousingTo" value="${E((S.overrides[c.key + "|housing"] || {}).to || "")}" ${isLocked() ? "disabled" : ""}></label>
        <label class="f">Reason<input type="text" id="ovHousingReason" value="${E((S.overrides[c.key + "|housing"] || {}).reason || "")}" ${isLocked() ? "disabled" : ""}></label>
        <label class="f">Approving officer<input type="text" id="ovHousingApprover" value="${E((S.overrides[c.key + "|housing"] || {}).approver || "")}" ${isLocked() ? "disabled" : ""}></label>
      </div>
      <div class="frow" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-top:6px">
        <label class="f">Required ACL, system value<input value="${c.acl.skipped ? "n/a" : P(c.acl.required)}" disabled></label>
        <label class="f">Revised required ACL<input type="number" id="ovAclTo" value="${E((S.overrides[c.key + "|acl"] || {}).to || "")}" ${isLocked() ? "disabled" : ""}></label>
        <label class="f">Reason<input type="text" id="ovAclReason" value="${E((S.overrides[c.key + "|acl"] || {}).reason || "")}" ${isLocked() ? "disabled" : ""}></label>
        <label class="f">Approving officer<input type="text" id="ovAclApprover" value="${E((S.overrides[c.key + "|acl"] || {}).approver || "")}" ${isLocked() ? "disabled" : ""}></label>
      </div>
      <div class="bar" style="margin-top:8px"><button class="btn sec sm" id="btnSaveOverrides" ${isLocked() ? "disabled" : ""}>Save overrides</button></div>
    </div>`;
  const d = $("drawer");
  d.classList.add("on");
  d.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
  d.querySelectorAll("[data-man]").forEach(el => el.onchange = () => {
    const [k, f] = el.dataset.man.split("|");
    S.manual[k] = S.manual[k] || {}; S.manual[k][f] = el.value;
    invalidate(); audit("Captured " + f, k + " = " + el.value); saveState();
    render();
    const c = book().find(x => x.key === k); if (c) openAccount(c);
  });
  const btnOv = d.querySelector("#btnSaveOverrides");
  if (btnOv) btnOv.onclick = () => {
    const k = c.key;
    const hTo = ($("ovHousingTo") || {}).value, hReason = ($("ovHousingReason") || {}).value, hApprover = ($("ovHousingApprover") || {}).value;
    const aTo = ($("ovAclTo") || {}).value, aReason = ($("ovAclReason") || {}).value, aApprover = ($("ovAclApprover") || {}).value;
    let wrote = false;
    if (hTo || hReason || hApprover) {
      if (!hTo || !hReason || !hApprover) { toast("Housing override needs a revised classification, a reason and an approving officer.", "err"); return; }
      S.overrides[k + "|housing"] = { from: c.housing ? c.housing.cls : "", to: hTo, reason: hReason, approver: hApprover, at: new Date().toISOString(), by: CURRENT_USER ? CURRENT_USER.username : "" };
      wrote = true;
    } else delete S.overrides[k + "|housing"];
    if (aTo || aReason || aApprover) {
      if (!aTo || !aReason || !aApprover) { toast("ACL override needs a revised amount, a reason and an approving officer.", "err"); return; }
      S.overrides[k + "|acl"] = { from: c.acl.skipped ? 0 : c.acl.required, to: aTo, reason: aReason, approver: aApprover, at: new Date().toISOString(), by: CURRENT_USER ? CURRENT_USER.username : "" };
      wrote = true;
    } else delete S.overrides[k + "|acl"];
    invalidate(); audit("Saved result override(s)", k); saveState(); render();
    const c2 = book().find(x => x.key === k); if (c2) openAccount(c2);
    if (wrote) toast("Override saved.");
  };
}

/* ------------------------------------------------------- regulatory screen */
function vRegulatory() {
  const rows = regulatoryMap(), pending = rows.filter(r => !r.ready);
  return head("Regulatory report mapping",
    "Every regulatory return named in the source document, mapped to the field that feeds it. A ready line computes now. A pending line has its source identified but needs the official return template before the layout can be fixed.")
    + '<div class="grid g4">'
    + '<div class="kpi ok"><span class="lab">Lines computing now</span><span class="val">' + CNT(rows.length - pending.length) + '</span><span class="sub">values produced from the register</span></div>'
    + '<div class="kpi warn"><span class="lab">Awaiting official template</span><span class="val">' + CNT(pending.length) + '</span><span class="sub">source identified, layout not fixed</span></div>'
    + '<div class="kpi"><span class="lab">Returns covered</span><span class="val">' + CNT(new Set(rows.map(r => r.report)).size) + '</span><span class="sub">FRP, AFRD, DOSRI, SBLAF, COCREE, CIC, Board</span></div>'
    + '<div class="kpi"><span class="lab">Rule set</span><span class="val" style="font-size:19px">' + E(S.rules.ruleVersion) + '</span><span class="sub">' + E(activeProfile().label) + '</span></div></div>'
    + '<div class="note w" style="margin-top:14px"><b>What "awaiting official template" means</b>'
    + 'SBLAF, COCREE 2.0 and CIC each have a prescribed file layout published by the regulator. Those layouts are not in the documents supplied, and a wrong layout is worse than none, so the column order, codes and field lengths are not invented here. The underlying data is ready and identified below. Loading the official template is a configuration step, not development.</div>'
    + '<div class="card" style="margin-top:14px"><h3>Mapping</h3>' + T([
      { h: "Return", v: r => "<b>" + E(r.report) + "</b>" },
      { h: "Line item", v: r => E(r.line) },
      { h: "Source in the LPMRS", v: r => '<span class="mut sm">' + E(r.src) + '</span>' },
      { h: "Value now", n: 1, v: r => P(r.val) },
      { h: "Status", v: r => r.ready ? '<span class="tag t-ok">computing</span>' : '<span class="tag t-warn">awaiting template</span>' }
    ], rows) + '</div>';
}