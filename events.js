"use strict";

/* ===================================================== events.js
   SCREENS map, render()/go(), wire(), act(), the reset flow,
   storage panel, and boot() — including the Phase 2 screen-wiring
   overrides (regulatory nav entry, movement/amortisation/
   encryption additions to existing screens and actions).         */

/* ================================================================ RENDER */
/* Built defensively. Every value here comes from views.js, so if that file
   fails to load this line throws a ReferenceError, the rest of events.js never
   runs, and the module check further down - the thing whose whole job is to
   explain a missing file - never gets defined either. The operator then sees a
   blank page instead of the diagnosis. Falling back to an empty map keeps this
   file alive long enough to report the real problem. */
const SCREENS = (() => {
  try {
    return { dashboard: vDashboard, register: vRegister, performance: vPerformance, acl: vAcl,
      creditrisk: vCreditRisk, collateral: vCollateral, housing: vHousing, afrd: vAfrd, programs: vPrograms, dosri: vDosri,
      remedial: vRemedial, import: vImport, validation: vValidation, reconcile: vReconcile,
      reports: vReports, params: vParams, storage: vStorage, admin: vAdmin };
  } catch (e) { return {}; }
})();

function render() {
  try { return renderInner(); }
  catch (e) { reportFailure("Could not draw the " + (S.screen || "current") + " screen", e); }
}
function renderInner() {
  renderNav();
  $("lockTag").className = "tag " + (isLocked() ? "t-ok" : wf().status === "VALIDATED" ? "t-info" : "t-mute");
  $("lockTag").textContent = wf().status;
  const fn = SCREENS[S.screen] || vDashboard;
  $("view").innerHTML = fn();
  wire();
  if (S.screen === "storage") refreshStorage();
  window.scrollTo(0, 0);
}
function go(screen) {
  if (!canAccess(screen)) { toast("Your role does not have access to that module."); return; }
  S.screen = screen; S.filter = null; render(); saveState();
}

/* ================================================================ EVENTS */
function wire() {
  document.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => { go(b.dataset.nav); document.body.classList.remove("nav"); });
  document.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
  document.querySelectorAll("[data-row]").forEach(tr => tr.onclick = () => {
    const list = currentRows(); const c = list[+tr.dataset.row]; if (c && c.account) openAccount(c);
  });
  const q = $("q"); if (q) q.oninput = () => {
    const v = q.value.toLowerCase();
    document.querySelectorAll("#view tbody tr").forEach(tr => { tr.style.display = tr.textContent.toLowerCase().includes(v) ? "" : "none"; });
  };
  const f = $("file"); if (f) f.onchange = e => handleFiles([...e.target.files]);
  const dz = $("drop"); if (dz) {
    dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); handleFiles([...e.dataTransfer.files]); };
  }
  ["cutoff", "cutoff2"].forEach(id => { const el = $(id); if (el) el.onchange = () => { S.cutoff = el.value; invalidate(); audit("Changed cut-off", el.value); render(); saveState(); }; });
  const tlf = $("tlf"); if (tlf) tlf.onchange = () => { S.rules.totalLoanableFunds = N(tlf.value); audit("Set total loanable funds", tlf.value); render(); saveState(); };
  document.querySelectorAll("[data-rule]").forEach(el => el.onchange = () => setRule(el.dataset.rule, el.type === "checkbox" ? el.checked : el.value));
  document.querySelectorAll("[data-man]").forEach(el => el.onchange = () => {
    const [k, f] = el.dataset.man.split("|");
    S.manual[k] = S.manual[k] || {}; S.manual[k][f] = el.value;
    invalidate(); audit("Captured " + f, k + " = " + el.value); saveState();
    const c = book().find(x => x.key === k); if (c) openAccount(c); render();
  });
  document.querySelectorAll("[data-recon]").forEach(el => el.onchange = () => {
    const k = periodKey(); S.reconciliation[k][el.dataset.recon] = N(el.value); render(); saveState();
  });
  document.querySelectorAll("[data-src]").forEach(el => el.onchange = () => {
    const k = periodKey(); S.reconciliation[k].sources[el.dataset.src] = { total: N(el.value) }; render(); saveState();
  });

}
function currentRows() {
  const t = totals();
  if (S.screen === "register") return capRows(S.filter ? t.all.filter(S.filter.fn) : t.all, "register");
  if (S.screen === "acl") return capRows(t.all, "acl");
  if (S.screen === "collateral") return capRows(t.port, "collateral");
  if (S.screen === "housing") return capRows(t.port.filter(c => c.housing), "housing");
  if (S.screen === "programs") return capRows(t.all.filter(c => c.program.program !== "BANK"), "programs");
  if (S.screen === "remedial") return capRows(t.all.filter(c => c.perf.dpd > 0 || !c.inPortfolio), "remedial");
  if (S.screen === "afrd") return capRows(t.all.filter(c => c.afrd.eligible || Eng.isAgri(c.account) || c.afrd.status === "EXCLUDED_ACPC"), "afrd");
  return [];
}
function setRule(path, value) {
  const parts = path.split(".");
  let o = S.rules;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  const last = parts[parts.length - 1];
  const prev = o[last];
  o[last] = value === "true" ? true : value === "false" ? false : (typeof prev === "number" && value !== "" ? N(value) : value);
  if (S.rules.approvalState === "APPROVED") S.rules.approvalState = "PENDING_APPROVAL";
  invalidate(); audit("Changed parameter", `${path}: ${prev} -> ${o[last]}`);
  render(); saveState();
}

/* ------------------------------------------------------- import watchdog
   A thrown error is already caught and reported. What is not caught is work
   that simply takes a very long time: the browser stops repainting, the
   "Reading…" message stays on screen and the application appears frozen with
   nothing to report. The operator has no way to say where it stopped, and
   neither has anyone trying to help them.

   Each stage of the import therefore announces itself before it begins, and a
   timer fires if any single stage runs long. The message names the stage and
   the file, which turns "it froze" into something diagnosable. */
let IMPORT_STAGE = "";
let IMPORT_WATCHDOG = null;
const IMPORT_STAGE_LIMIT_MS = 20000;
const IMPORT_TOTAL_LIMIT_MS = 90000;

function importStage(name, file) {
  IMPORT_STAGE = name;
  if (IMPORT_WATCHDOG) clearTimeout(IMPORT_WATCHDOG);
  toast(name + "\u2026");
  IMPORT_WATCHDOG = setTimeout(() => {
    const box = document.getElementById("toast");
    if (!box) return;
    box.innerHTML = "<b>Still working on: " + E(IMPORT_STAGE) + "</b><br>"
      + "This is taking longer than expected for " + E(file || "this file") + ". "
      + "Large or unusual workbooks can take a while. If nothing changes in the next minute, "
      + "the file may be one the reader cannot handle."
      + "<br><span style='opacity:.8'>Version " + E(APP.version) + ". Please send this message, the file, and the stage name above.</span>";
    box.classList.add("on");
  }, IMPORT_STAGE_LIMIT_MS);
}
function importDone() {
  if (IMPORT_WATCHDOG) clearTimeout(IMPORT_WATCHDOG);
  IMPORT_WATCHDOG = null; IMPORT_STAGE = "";
}

async function handleFiles(files) {
  const est = await Vault.estimate();
  if (Vault.ready && est.available && est.available < S.rules.minFreeBytes) {
    toast(`Import blocked. Free storage is ${(est.available / 1048576).toFixed(1)} MB, below the ${(S.rules.minFreeBytes / 1048576).toFixed(0)} MB minimum.`, "err");
    return;
  }
  for (const file of files) {
    try {
      importStage("Reading " + file.name, file.name);
      /* Yield once so the browser paints the message before the parse begins;
         otherwise a slow parse blocks the very update that explains it. */
      await new Promise(r => setTimeout(r, 0));
      /* A ceiling on the whole read. Whatever the cause \u2014 a file the
         operating system is still fetching from cloud storage, a decoder that
         will not finish, an unusually large workbook \u2014 the operator gets a
         message that names the stage instead of a screen that never changes. */
      let killer;
      const parsed = await Promise.race([
        importFile(file),
        new Promise((_, rej) => { killer = setTimeout(() => rej(new Error(
          "Reading this file did not finish within " + Math.round(IMPORT_TOTAL_LIMIT_MS / 1000) + " seconds. "
          + "If the file is stored in OneDrive or SharePoint, right-click it in File Explorer and choose "
          + "\u201cAlways keep on this device\u201d, wait for the green tick to fill in, then try again. "
          + "Otherwise open it in Excel and save a fresh copy.")), IMPORT_TOTAL_LIMIT_MS); })
      ]).finally(() => clearTimeout(killer));
      const { rec, accounts, map, unmapped } = parsed;
      importStage("Mapping columns in " + file.name, file.name);
      rec.mapFields = map;
      rec.missingFields = FIELDS.map(f => f[0]).filter(f => map[f] === undefined &&
        ["collateralValue", "collateralPerfected", "sellingPrice", "programCode", "afrdStatus", "msmeSize",
         "msmeAssetEvidence", "dosriApproval", "cif", "firstUnpaidDate", "officer", "branch", "remedialStatus"].includes(f));
      rec.unmapped = unmapped.map(u => u.header);
      await Vault.put(`imports/${rec.id}_${file.name}`, "stored").catch(() => {});
      S.accounts = accounts;
      S.imports.unshift(rec);

      /* Intake reconciliation for this period (spec section 1). Recorded
         against the period, not the file, so a second import into the same
         period accumulates rather than overwrites. */
      const k = periodKey();
      const led = S.intake[k] = S.intake[k] || { sourceRows: 0, blank: 0, noKey: 0, duplicates: 0, imported: 0, files: [] };
      led.sourceRows += rec.intake.sourceRows;
      led.blank      += rec.intake.blank;
      led.noKey      += rec.intake.noKey;
      led.duplicates += rec.intake.duplicates;
      led.imported   += rec.intake.imported;
      led.files.push({ name: file.name, sheet: rec.sheet, hash: rec.hash, ...rec.intake, rejected: undefined });

      importStage("Classifying " + CNT(accounts.length) + " accounts", file.name);
      await new Promise(r => setTimeout(r, 0));
      invalidate();
      totals();                       /* do the heavy pass here, while the stage is named */
      importDone();
      audit("Imported file", `${file.name} — ${rec.intake.sourceRows} source rows, ${accounts.length} imported, ` +
        `${rec.intake.blank} blank, ${rec.intake.noKey} without a key, ${rec.intake.duplicates} duplicate account numbers`);
      const lost = rec.intake.sourceRows - rec.intake.imported;
      toast(`${file.name}: ${CNT(rec.intake.sourceRows)} source rows → ${CNT(accounts.length)} imported` +
        (lost ? `, ${CNT(lost)} not imported (see Reconciliation)` : "") + `. ${Object.keys(map).length} columns mapped.`,
        lost ? "err" : undefined);
      go("dashboard");
    } catch (e) {
      /* Always replace the "Reading…" message, so a failure can never leave
         the operator looking at a wait that will not end. */
      importDone();
      reportFailure("Could not import " + file.name + " (stage: " + (IMPORT_STAGE || "reading") + ")", e);
    }
  }
  saveState();
}

async function act(a, el) {
  const t = () => totals();
  switch (a) {
    case "load-sample":
      S.accounts = sampleBook(); S.imports.unshift({ id: uid(), name: "sample loan book", ext: "internal", hash: "n/a", date: today(), period: periodKey(), sheet: "sample", records: S.accounts.length, mapped: 0, unmapped: [], status: "Sample loaded" });
      invalidate(); audit("Loaded sample loan book", S.accounts.length + " accounts"); go("dashboard"); break;
    case "clear-book":
      S.accounts = []; invalidate(); audit("Cleared working loan book"); render(); saveState(); break;
    case "goto-validation": go("validation"); break;
    case "drill-npl": S.filter = { label: "Non-performing", fn: c => ["NPL", "ITL"].includes(c.perf.cls) }; S.screen = "register"; render(); break;
    case "drill-acl": go("acl"); break;
    case "drill-all": S.filter = null; S.screen = "register"; render(); break;
    case "drill-port": S.filter = { label: "Recognised portfolio", fn: c => c.inPortfolio }; S.screen = "register"; render(); break;
    case "drill-offbook": S.filter = { label: "Held off the portfolio", fn: c => !c.inPortfolio }; S.screen = "register"; render(); break;
    case "clear-filter": S.filter = null; render(); break;
    case "close-drawer": $("drawer").classList.remove("on"); break;
    case "export-xlsx": exportWorkbook(); break;
    case "export-json": exportJson(); break;
    case "print": window.print(); break;
    case "approve-rules":
      S.rules.approvalState = "APPROVED"; audit("Approved parameter set", S.rules.ruleVersion + " by " + (S.rules.approver || S.role));
      toast("Parameter set approved. It applies prospectively from " + S.rules.effectiveDate + "."); render(); saveState(); break;
    case "reset-rules":
      S.rules = Object.assign(defaultRules(), { totalLoanableFunds: S.rules.totalLoanableFunds });
      invalidate(); audit("Restored document default parameters"); render(); saveState(); break;
    case "validate-period": {
      if (t().blocks) { toast("Clear the blocking exceptions first."); return; }
      wf().status = "VALIDATED"; audit("Period validated", periodKey());
      Vault.put(`loanbook/${periodKey()}/validated.json`, JSON.stringify(S)).catch(() => {});
      toast("Period marked validated."); render(); saveState(); break;
    }
    case "lock-period": {
      const w = wf();
      if (!w.maker || !w.checker || !w.approver) { toast("Maker, checker and approver names are all required before locking."); return; }
      const snap = snapshotNow();
      const snapJson = JSON.stringify(snap);
      const hashBuf = new TextEncoder().encode(snapJson);
      snap.hash = await sha256(hashBuf);
      w.status = "LOCKED"; w.lockedAt = new Date().toISOString().slice(0, 19).replace("T", " "); w.hash = snap.hash;
      S.snapshots = S.snapshots || {}; S.snapshots[periodKey()] = snap;
      Vault.put(`reports/${S.year}/${S.period}/locked.json`, JSON.stringify(S)).catch(() => {});
      audit("Period locked", periodKey() + " by " + w.approver + " · hash " + snap.hash.slice(0, 16));
      toast("Period locked. Corrections now require an amendment."); render(); saveState(); break;
    }
    case "amend-period": {
      const w = wf(); w.status = "DRAFT"; w.amendment = (w.amendment || 0) + 1;
      audit("Opened amendment", periodKey() + " amendment " + w.amendment);
      toast("Amendment " + w.amendment + " opened. The locked snapshot is retained."); render(); saveState(); break;
    }
    case "add-user": {
      if (!CURRENT_USER || CURRENT_USER.role !== "Administrator") { toast("Only an Administrator can add accounts."); return; }
      const uname = $("newUserName").value.trim(), pw = $("newUserPass").value, urole = $("newUserRole").value;
      if (!uname || !pw) { toast("Username and temporary password are required."); return; }
      if (pw.length < 6) { toast("Temporary password must be at least 6 characters."); return; }
      if (findUser(uname)) { toast("That username already exists."); return; }
      const nu = { username: uname, displayName: uname, role: urole, active: true, createdAt: today(), mustChangePassword: true, failedAttempts: 0, lockUntil: "" };
      await setUserPassword(nu, pw);
      S.users.push(nu);
      audit("Added user account", uname + " (" + urole + ")");
      toast(uname + " added. They must change their password on first login."); render(); saveState(); break;
    }
    case "toggle-user": {
      if (!CURRENT_USER || CURRENT_USER.role !== "Administrator") { toast("Only an Administrator can manage accounts."); return; }
      const u = findUser(el.dataset.username); if (!u) return;
      u.active = !u.active; audit(u.active ? "Enabled user account" : "Disabled user account", u.username);
      toast(u.username + (u.active ? " enabled." : " disabled.")); render(); saveState(); break;
    }
    case "set-security-questions": {
      if (!CURRENT_USER) return;
      const u = findUser(CURRENT_USER.username);
      const msg = t => { $("sqMsg").textContent = t; };
      if (!u) { msg("Your account could not be found."); return; }
      const pairs = [0, 1].map(i => ({ question: $("sqQ" + i).value, answer: $("sqA" + i).value }));
      if (pairs.some(p => !String(p.answer).trim())) { msg("Answer both questions."); return; }
      if (pairs.some(p => normaliseAnswer(p.answer).length < 2)) { msg("Answers must be at least 2 characters."); return; }
      if (pairs[0].question === pairs[1].question) { msg("Choose two different questions."); return; }
      /* Two identical answers halve the work needed to guess both, so they
         are rejected rather than quietly accepted. */
      if (normaliseAnswer(pairs[0].answer) === normaliseAnswer(pairs[1].answer)) { msg("Use a different answer for each question."); return; }
      await setSecurityQuestions(u, pairs);
      audit("Set password recovery questions", CURRENT_USER.username);
      await saveState();
      msg("");
      toast("Recovery questions saved. A forgotten password can now be reset from the login screen.");
      render();
      break;
    }
    case "change-my-password": {
      if (!CURRENT_USER) return;
      const cur = $("cpCurrent").value, n1 = $("cpNew1").value, n2 = $("cpNew2").value;
      const msg = t => { $("cpMsg").textContent = t; };
      const u = findUser(CURRENT_USER.username);
      if (!u) { msg("Your account could not be found."); return; }
      if (!cur) { msg("Enter your current password."); return; }
      if (n1.length < 6) { msg("The new password must be at least 6 characters."); return; }
      if (n1 !== n2) { msg("The new passwords do not match."); return; }
      if (n1 === cur) { msg("The new password must be different from the current one."); return; }
      /* The current password is verified even though the session is already
         open: without it, anyone who walks up to an unattended machine could
         change the password and lock the account holder out of their own
         audit trail. */
      if (!(await verifyPassword(u, cur))) {
        audit("Failed password change", CURRENT_USER.username + " — current password incorrect");
        await saveState();
        msg("That is not your current password.");
        return;
      }
      await setUserPassword(u, n1);
      u.mustChangePassword = false; u.failedAttempts = 0; u.lockUntil = "";
      audit("Changed own password", CURRENT_USER.username);
      await saveState();
      $("cpCurrent").value = ""; $("cpNew1").value = ""; $("cpNew2").value = "";
      msg("");
      toast("Password changed. Use it the next time you log in.");
      break;
    }
    case "reset-pw": {
      if (!CURRENT_USER || CURRENT_USER.role !== "Administrator") { toast("Only an Administrator can reset passwords."); return; }
      const u = findUser(el.dataset.username); if (!u) return;
      const temp = Math.random().toString(36).slice(2, 10);
      await setUserPassword(u, temp); u.mustChangePassword = true; u.failedAttempts = 0; u.lockUntil = "";
      audit("Reset password", u.username);
      alert("Temporary password for " + u.username + ": " + temp + "\n\nShare this with them securely. They must set a new password on next login.");
      saveState(); break;
    }
    case "record-wf": {
      const roleKey = el.dataset.wfRole; // maker | checker | approver
      const w = wf();
      if (w.status === "LOCKED") { toast("This period is locked."); return; }
      const name = CURRENT_USER.username;
      if (roleKey === "approver") {
        if (w.maker && w.maker === name) { toast("You are recorded as the maker for this period. A maker cannot also approve their own work.", "err"); return; }
        if (w.checker && w.checker === name) { toast("You are recorded as the checker for this period. A checker cannot also act as the approver for the same item.", "err"); return; }
      }
      if (roleKey === "checker" && w.maker && w.maker === name) {
        toast("You are recorded as the maker for this period. Segregation of duties requires a different reviewer.", "err"); return;
      }
      w[roleKey] = name;
      audit("Recorded as " + roleKey, periodKey() + " — " + name);
      toast(name + " recorded as " + roleKey + "."); render(); saveState(); break;
    }
    case "add-contract-version": {
      const k = el.dataset.key;
      const v = { id: uid(), ts: new Date().toISOString(), eventType: $("cvType").value, effectiveDate: $("cvDate").value || today(),
        originalTerms: $("cvOrig").value, newTerms: $("cvNew").value, concessions: $("cvConcessions").value,
        moratorium: $("cvMoratorium").value, cureDate: $("cvCure").value, reDefault: $("cvRedefault").value === "yes",
        evidenceRef: $("cvEvidence").value, approver: $("cvApprover").value };
      if (!v.evidenceRef || !v.approver) { toast("Evidence reference and approver name are required to add a contract version."); return; }
      S.contractVersions[k] = S.contractVersions[k] || []; S.contractVersions[k].push(v);
      audit("Added contract version", `${k}: ${v.eventType} effective ${v.effectiveDate}`);
      invalidate(); saveState();
      const c2 = book().find(x => x.key === k); render(); if (c2) openAccount(c2);
      toast("Contract version added.");
      break;
    }
    case "add-collection-action": {
      const k = el.dataset.key;
      const v = { id: uid(), ts: new Date().toISOString(), type: $("caType").value, officer: $("caOfficer").value,
        contactResult: $("caResult").value, ptpAmount: N($("caPtpAmount").value), ptpDate: $("caPtpDate").value,
        ptpStatus: $("caPtpStatus") ? $("caPtpStatus").value : "",
        nextAction: $("caNextAction").value, targetDate: $("caTargetDate").value,
        status: $("caStatus") ? $("caStatus").value : "OPEN",
        remarks: $("caRemarks") ? $("caRemarks").value : "",
        cost: N($("caCost").value), recovery: N($("caRecovery").value), legalCaseRef: $("caLegalRef").value };
      /* A promise to pay must carry a lifecycle state; anything else must not,
         so the PTP columns on the queue stay meaningful. */
      if (v.type === "PTP" && !v.ptpStatus) v.ptpStatus = "ACTIVE";
      if (v.type !== "PTP" && !v.ptpAmount && !v.ptpDate) v.ptpStatus = "";
      S.collectionActions[k] = S.collectionActions[k] || []; S.collectionActions[k].push(v);
      audit("Logged collection action", `${k}: ${v.type}`);
      invalidate(); saveState();
      const c2 = book().find(x => x.key === k); render(); if (c2) openAccount(c2);
      toast("Action logged.");
      break;
    }
    case "check-storage": refreshStorage(); break;
    case "request-persist": Vault.persist().then(ok => toast(ok ? "Persistent storage granted." : "The browser declined persistent storage. Data may be evicted under storage pressure.")); break;
    case "remedial-filter": S.remedialFilter = el.dataset.code; render(); break;
    case "open-letter": {
      const c = book().find(x => x.key === el.dataset.key);
      if (c) openLetterPicker(c);
      break;
    }
    case "issue-letter": {
      const c = book().find(x => x.key === el.dataset.key);
      if (!c) return;
      const tmplId = $("ltTemplate").value, fmt = el.dataset.format;
      const nm = $("ltOfficer") ? $("ltOfficer").value.trim() : "";
      if (!nm) { toast("Enter the name of the officer signing this letter before generating it.", "err"); return; }
      const title = $("ltTitle") ? $("ltTitle").value.trim() : "";
      const extra = { officer: nm, approver: nm, officerTitle: title, approverTitle: title };
      $("modal").classList.remove("on");
      issueLetter(c, tmplId, fmt, extra);
      break;
    }
    case "preview-letter": {
      const c = book().find(x => x.key === el.dataset.key);
      if (c) openLetterPicker(c, $("ltTemplate").value);
      break;
    }
    case "add-investment": openInvestmentForm(null); break;
    case "edit-tlf": openTlfForm(); break;
    case "save-tlf": {
      const amt = N($("tlfAmount").value), src = $("tlfSource").value.trim();
      const asOf = $("tlfAsOf").value, note = $("tlfNote").value.trim();
      if (!amt) { toast("Enter the total loanable funds amount.", "err"); return; }
      if (!src) { toast("Record which schedule the figure comes from.", "err"); return; }
      S.afrdTlf = { amount: amt, source: src, asOf, note,
        recordedBy: (CURRENT_USER && CURRENT_USER.username) || "", recordedAt: new Date().toISOString() };
      /* Kept in step so the plain Parameters figure and the sourced record
         can never disagree. */
      S.rules.totalLoanableFunds = amt;
      audit("Recorded total loanable funds", P(amt) + " as at " + asOf + " from " + src);
      $("modal").classList.remove("on");
      invalidate(); render(); saveState();
      toast("Total loanable funds recorded.");
      break;
    }
    case "priority-sector": {
      const c = book().find(x => x.key === el.dataset.key);
      if (c) openPrioritySectorForm(c);
      break;
    }
    case "save-priority-sector": {
      const k = el.dataset.key, c = book().find(x => x.key === k);
      if (!c) return;
      const type = $("psType").value, fund = $("psFunding").value;
      const ref = $("psRef").value.trim(), mult = $("psMult").value;
      const bt = (S.rules.afrdBeneficiaryTypes || []).find(x => x.code === type);
      if (bt && bt.priority && N(mult) && !ref) {
        toast("A priority-sector reference is required before a multiplier can be applied.", "err"); return;
      }
      if (N(mult) && (N(mult) <= 0 || N(mult) > 5)) {
        toast("The compliance multiplier must be greater than 0 and no more than 5.", "err"); return;
      }
      S.manual[k] = S.manual[k] || {};
      S.manual[k].beneficiaryType = type;
      S.manual[k].afrdFundingSource = fund;
      S.manual[k].prioritySectorReference = ref;
      if (N(mult)) S.manual[k].complianceMultiplier = N(mult); else delete S.manual[k].complianceMultiplier;
      audit("Recorded AFRD beneficiary and funding", `${c.account.accountNo} \u2014 ${type || "not recorded"} / ${fund || "not determined"}${ref ? " \u00b7 ref " + ref : ""}`);
      $("modal").classList.remove("on");
      invalidate(); render(); saveState();
      toast("Beneficiary and funding recorded for " + c.account.accountNo + ".");
      break;
    }
    case "edit-investment": openInvestmentForm(el.dataset.id); break;
    case "validate-investment": openInvestmentValidation(el.dataset.id); break;
    case "export-investments": {
      const rows = [["Type", "Issuer", "Instrument", "Reference", "Acquired", "Maturity",
        "Face value", "Carrying value", "AFRD-eligible", "Classification", "Status",
        "Encoded by", "Encoded at", "Validated by", "Validated at", "Supporting reference", "Remarks", "Active", "Source"]];
      (S.afrdInvestments || []).forEach(i => rows.push([
        afrdTypeLabel(i.type), i.issuer, i.instrument, i.referenceNo, i.acquisitionDate, i.maturityDate,
        N(i.faceValue), N(i.bookValue), investmentEligibleAmount(i), afrdClassLabel(i.classification),
        afrdStateOf(i.status).label, i.encodedBy, i.encodedAt, i.validatedBy, i.validatedAt,
        i.supportingRef, i.remarks, i.active === false ? "Inactive" : "Active", i.source || "MANUAL_ENTRY"
      ]));
      download("RBCCI_AFRD_investments_" + today().replace(/-/g, "") + ".csv", toCsvBlob(rows));
      audit("Exported AFRD investments register", CNT((S.afrdInvestments || []).length) + " record(s)");
      break;
    }
    case "save-investment": {
      const id = el.dataset.id;
      const existing = id ? afrdInvestmentById(id) : null;
      const inv = existing || newInvestment();
      const v = f => { const n = $("inv" + f); return n ? n.value : ""; };
      if (!v("Issuer").trim()) { toast("Enter the issuer.", "err"); return; }
      if (!v("Instrument").trim()) { toast("Enter the instrument or bond name.", "err"); return; }
      const face = N(v("Face")), book = N(v("Book")), elig = N(v("Eligible"));
      if (!face && !book) { toast("Enter a face value or a carrying value.", "err"); return; }
      const cap = N(v("Regulatory")) || Math.max((book || face) - N(v("Unamortized")), 0);
      if (cap && elig > cap) { toast("The AFRD-eligible amount cannot exceed the regulatory amount of " + P(cap) + ".", "err"); return; }
      if (v("Reporting") && v("Acq") && v("Reporting") < v("Acq")) { toast("The reporting date cannot fall before acquisition.", "err"); return; }
      if (v("Acq") && v("Mat") && v("Mat") < v("Acq")) { toast("Maturity cannot fall before acquisition.", "err"); return; }
      const money = z => JSON.stringify({ f: N(z.faceValue), b: N(z.bookValue), e: N(z.eligibleAmount),
        u: N(z.unamortized), r: N(z.regulatoryAmount) });
      const before = existing ? money(existing) : null;
      Object.assign(inv, {
        category: v("Category"), type: v("Type"),
        issuer: v("Issuer").trim(), instrument: v("Instrument").trim(),
        isin: v("Isin").trim().toUpperCase(), referenceNo: v("Ref").trim(),
        acquisitionDate: v("Acq"), reportingDate: v("Reporting"), maturityDate: v("Mat"),
        faceValue: face, bookValue: book, eligibleAmount: elig,
        unamortized: N(v("Unamortized")), regulatoryAmount: N(v("Regulatory")), acl: N(v("Acl")),
        classification: v("Class"), fundingSource: v("Funding"),
        useOfProceeds: v("Use").trim(), sustainableStandard: v("Standard"),
        greenClassification: v("Green"), offeringCircularRef: v("Circular").trim(),
        externalReviewRef: v("External").trim(), afrdRuleId: v("RuleId").trim(),
        supportingRef: v("Support").trim(),
        remarks: v("Remarks").trim(), active: $("invActive").checked
      });
      /* Changing the money on a validated record invalidates the validation:
         the eligibility decision was made against the old figures. */
      if (existing && afrdStateOf(inv.status).eligible && before !== money(inv)) {
        inv.status = "PENDING"; inv.validatedBy = ""; inv.validatedAt = "";
        inv.validationNote = "Reset to pending: amounts changed after validation";
        toast("Amounts changed, so this record has returned to pending and must be validated again.");
      }
      if (!existing) S.afrdInvestments.push(inv);
      audit(existing ? "Updated AFRD investment" : "Recorded AFRD investment",
        `${afrdTypeLabel(inv.type)} · ${inv.issuer} · ${inv.instrument} · face ${P(face)} · eligible ${P(elig)}`);
      $("modal").classList.remove("on");
      invalidate(); render(); saveState();
      break;
    }
    case "confirm-validate-investment": {
      const inv = afrdInvestmentById(el.dataset.id); if (!inv) return;
      if (!CURRENT_USER || !["Administrator", "Approver", "Checker"].includes(CURRENT_USER.role)) {
        toast("Validation requires a Checker, Approver or Administrator.", "err"); return;
      }
      const status = $("invVState").value, ref = $("invVRef").value.trim(), note = $("invVNote").value.trim();
      const st = afrdStateOf(status);
      /* An eligible outcome must name the document it rests on — this is the
         control the specification asks for, and it is why encoding alone
         cannot make an investment compliant. */
      if (st.eligible && !ref) { toast("A supporting reference is required to validate an investment as eligible.", "err"); return; }
      if (st.eligible && !N(inv.eligibleAmount)) { toast("This record has no AFRD-eligible amount. Edit it before validating.", "err"); return; }
      inv.status = status;
      inv.supportingRef = ref || inv.supportingRef;
      inv.validationNote = note;
      inv.validatedBy = CURRENT_USER.username;
      inv.validatedAt = new Date().toISOString();
      audit("Validated AFRD investment", `${inv.instrument} → ${st.label}${ref ? " · reference " + ref : ""}${note ? " · " + note : ""}`);
      $("modal").classList.remove("on");
      invalidate(); render(); saveState();
      toast(inv.instrument + " recorded as " + st.label + ".");
      break;
    }
    case "validate-loan-afrd": {
      const c = book().find(x => x.key === el.dataset.key); if (c) openLoanAfrdValidation(c);
      break;
    }
    case "save-loan-afrd": {
      const k = el.dataset.key;
      const c = book().find(x => x.key === k); if (!c) return;
      const status = $("laStatus").value, ref = $("laRef").value.trim(), amt = $("laAmount").value;
      if (status === "ELIGIBLE" || status === "PARTIAL") {
        if (!ref) { toast("A supporting document reference is required to mark a loan AFRD-eligible.", "err"); return; }
        if (status === "PARTIAL" && !N(amt)) { toast("Enter the partially eligible amount.", "err"); return; }
        if (N(amt) > c.balance) { toast("The eligible amount cannot exceed the outstanding balance of " + P(c.balance) + ".", "err"); return; }
      }
      S.manual[k] = S.manual[k] || {};
      S.manual[k].afrdStatus = status;
      S.manual[k].afrdEvidence = ref;
      if (status === "PARTIAL") S.manual[k].afrdEligibleAmount = N(amt);
      else delete S.manual[k].afrdEligibleAmount;
      audit("Validated loan AFRD eligibility",
        `${c.account.accountNo} → ${status}${ref ? " · reference " + ref : ""}`);
      $("modal").classList.remove("on");
      invalidate(); render(); saveState();
      toast("AFRD eligibility recorded for " + c.account.accountNo + ".");
      break;
    }
    case "reset-open": openReset(); break;
    case "clear-period-open": openClearPeriod(); break;
    case "backup-open": openBackupChoice(); break;
    case "diagnose-file": {
      const f = $("file");
      await runDiagnostic(f && f.files ? f.files : null);
      break;
    }
    case "sec-tab": S.securityTab = el.dataset.code; render(); break;
    case "goto-import": go("import"); break;
  }
}

/* --------------------------------------------------------- clear period
   Spec section 7. Resets every period-dependent artefact so a fresh
   import cannot inherit stale values, while deliberately preserving
   master and reference data: rule/parameter sets, user accounts, the
   audit trail, letter templates and the AFRD investments register are
   institutional records, not period data, and survive untouched.        */
const PERIOD_SCOPED = [
  ["Imported source data", () => S.imports.filter(r => r.period === periodKey()).length + " import record(s)"],
  ["Loan register records", () => CNT(S.accounts.length) + " account(s)"],
  ["Intake reconciliation", () => S.intake[periodKey()] ? "recorded" : "none"],
  ["Movement reconciliation", () => S.reconciliation[periodKey()] ? "recorded" : "none"],
  ["Period snapshot", () => (S.snapshots || {})[periodKey()] ? "recorded" : "none"],
  ["Maker / checker / approver workflow", () => (S.workflow[periodKey()] || {}).status || "DRAFT"],
  ["Captured manual fields", () => CNT(Object.keys(S.manual).length) + " account(s)"],
  ["Approved field overrides", () => CNT(Object.keys(S.overrides).length) + " account(s)"],
  ["Logged collection actions", () => CNT(Object.values(S.collectionActions).reduce((a, x) => a + x.length, 0)) + " action(s)"],
  ["Correspondence issued", () => CNT(allLetters().length) + " letter(s)"],
  ["AFRD qualifying investments", () => CNT((S.afrdInvestments || []).length) + " record(s)"],
  ["Contract event history", () => CNT(Object.values(S.contractVersions).reduce((a, x) => a + x.length, 0)) + " event(s)"]
];

function clearPeriodData() {
  const k = periodKey();
  if (isLocked()) { toast("This period is locked. Unlock it before clearing.", "err"); return false; }
  S.accounts = [];
  S.imports = S.imports.filter(r => r.period !== k);
  delete S.intake[k];
  delete S.reconciliation[k];
  if (S.snapshots) delete S.snapshots[k];
  delete S.workflow[k];
  S.manual = {}; S.overrides = {};
  S.collectionActions = {}; S.contractVersions = {};
  S.letters = {};                     // issued correspondence is period data
  S.afrdInvestments = [];             // holdings are declared per reporting period
  S.filter = null; S.remedialFilter = "ALL";
  invalidate();                       // drops the memoised computed book
  audit("Cleared reporting period", k + " — every period-dependent value reset; parameters, users, letter templates and audit trail retained");
  return true;
}

/* ------------------------------------------------------------ backups
   Two different things were both called "backup", which caused an operator
   to open the restore file in a text editor and reasonably conclude the
   backup was broken. They are now named for what they are and what each is
   for: a workbook to read and file, and a restore file the application can
   read back. The workbook is offered first because that is what is wanted
   nine times out of ten. */
function openBackupChoice() {
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:18px">Download a copy of this period</h2>
    <p class="sm">Two formats, for two different purposes.</p>
    <div class="grid g2" style="margin-top:10px">
      <div class="card"><h3>Excel workbook <span class="hint">.xlsx</span></h3>
        <p class="mut sm">The full report: loan register, aging, ACL, AFRD, collateral, DOSRI, collection, exceptions, movement and parameters, one sheet each. Opens in Excel and is the copy to file or send.</p>
        <div class="bar"><button class="btn" id="bkXlsx">Download Excel workbook</button></div></div>
      <div class="card"><h3>Restore file <span class="hint">.json</span></h3>
        <p class="mut sm">A machine-readable copy the application can load back to rebuild this period exactly, including parameters and the audit trail. It is not meant to be opened or read directly \u2014 it will look like program text in a text editor.</p>
        <div class="bar"><button class="btn sec" id="bkJson">Download restore file</button></div></div>
    </div>
    <div class="bar" style="margin-top:12px"><button class="btn ghost" id="bkClose">Close</button></div>`;
  $("modal").classList.add("on");
  $("bkClose").onclick = () => $("modal").classList.remove("on");
  $("bkXlsx").onclick = () => { exportWorkbook(); };
  $("bkJson").onclick = () => { exportJson(); };
}

function openClearPeriod() {
  const k = periodKey();
  /* This previously required the operator to type "CLEAR <period>" exactly,
     including the hyphen and the case, before the button would enable. The
     intent was to make an irreversible action deliberate; the effect was that
     the button appeared permanently dead and the period could not be cleared
     at all. Deliberateness is now carried by the summary of what will be lost
     and by a plain two-step confirmation, which does the same job without
     making the control unusable. */
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:18px">Clear reporting period ${E(k)}</h2>
    <p class="sm">This empties the period so the next import starts clean. No other period is affected.</p>
    ${T([{ h: "Will be cleared", v: r => E(r[0]) }, { h: "Currently held", v: r => `<span class="mut">${E(r[1]())}</span>` }], PERIOD_SCOPED)}
    <div class="note g" style="margin-top:12px"><b>Kept</b>Parameters and rules, user accounts, the audit trail, letter templates, and every reporting period other than ${E(k)}.</div>
    <div class="bar" style="margin-top:14px">
      <button class="btn sec" id="cpBackup">Download a copy first</button>
      <button class="btn ghost" id="cpCancel">Cancel</button>
      <button class="btn bad" id="cpGo">Clear period ${E(k)}</button>
    </div>`;
  $("modal").classList.add("on");
  $("cpCancel").onclick = () => $("modal").classList.remove("on");
  $("cpBackup").onclick = openBackupChoice;
  $("cpGo").onclick = () => {
    /* Second click confirms. Two clicks on a labelled button is enough
       friction for an action that is announced this plainly. */
    const g = $("cpGo");
    if (g.dataset.armed !== "1") {
      g.dataset.armed = "1";
      g.textContent = "Click again to confirm \u2014 this cannot be undone";
      setTimeout(() => { if (g && g.dataset.armed === "1") { g.dataset.armed = ""; g.textContent = "Clear period " + k; } }, 6000);
      return;
    }
    const done = clearPeriodData();
    $("modal").classList.remove("on");
    if (done) { render(); saveState(); toast("Period " + k + " cleared. Import a source file to rebuild it."); }
  };
}

/* -------------------------------------------------------- letter picker
   Spec section 4: authorised users initiate collection or remedial
   communication directly from the account. The preview is rendered from
   the same resolveLetter() the exporters use, so what is shown is exactly
   what is written to the PDF or DOCX. */
function openLetterPicker(c, selectedId) {
  const avail = templatesFor(c);
  const blocked = templatesBlockedFor(c);
  if (!(S.rules.letterTemplates || []).filter(t => t.active !== false).length) {
    toast("No letter templates are configured. Add one on the Parameters screen.", "err"); return;
  }
  /* No fallback to the full template list. If every template is blocked it
     is because the account's state forbids ordinary collection
     correspondence, and offering one anyway would defeat the control. */
  if (!avail.length) {
    $("modalBody").innerHTML = `
      <h2 style="margin:0 0 4px;font-size:18px">Correspondence not available on this account</h2>
      <p class="mut sm" style="margin:0 0 12px">${E(c.account.borrower || "Unnamed borrower")} · ${E(c.account.accountNo)} · ${E(c.perf.cls)} · ${CNT(c.perf.dpd)} days past due · ${P(c.balance)}</p>
      <div class="note b"><b>No collection template may be issued on this account</b>Each configured template is withheld for the reason shown below. This is a control, not a fault — route the account through the appropriate channel instead.</div>
      ${T([{ h: "Template", v: b => E(b.tmpl.name) }, { h: "Reason withheld", v: b => `<span class="sm">${E(b.reason)}</span>` }], blocked)}
      <div class="bar" style="margin-top:12px"><button class="btn ghost" id="ltCancel">Close</button></div>`;
    $("modal").classList.add("on");
    $("ltCancel").onclick = () => $("modal").classList.remove("on");
    return;
  }
  const list = avail;
  const tmpl = list.find(t => t.id === selectedId) || list[0];
  const preview = resolveLetter(tmpl, c, { letterRef: "LTR-" + periodKey().replace(/-/g, "") + "-" + String(allLetters().length + 1).padStart(4, "0") });
  const gaps = letterGaps(tmpl, c);
  const officerNow = LETTER_TOKENS.officer(c);
  const generic = /^(admin|administrator|test|user)$/i.test(String(officerNow).trim());

  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">Generate correspondence</h2>
    <p class="mut sm" style="margin:0 0 12px">${E(c.account.borrower || "Unnamed borrower")} · ${E(c.account.accountNo)} · ${E(c.perf.cls)} · ${CNT(c.perf.dpd)} days past due · ${P(c.balance)}</p>
    <div class="frow" style="grid-template-columns:2fr 1fr 1fr">
      <label class="f">Template<select id="ltTemplate">
        ${list.map(t => `<option value="${E(t.id)}" ${t.id === tmpl.id ? "selected" : ""}>${E(t.name)}</option>`).join("")}
      </select></label>
      <label class="f">Signing officer<input id="ltOfficer" value="${E(generic ? "" : officerNow)}" placeholder="Full name"></label>
      <label class="f">Title<input id="ltTitle" value="${E(tmpl.category === "DEMAND" ? (S.rules.approverTitle || "Branch Manager") : (S.rules.officerTitle || "Account Officer"))}"></label>
    </div>
    ${generic ? `<div class="note b"><b>Signatory is a system account</b>The logged-in user resolves to "${E(officerNow)}", which must not appear on correspondence sent to a borrower. Enter the responsible officer's full name above, or create named user accounts under Administration.</div>` : ""}
    ${blocked.length ? `<p class="mut sm">${CNT(blocked.length)} other template(s) withheld on this account: ${blocked.map(b => E(b.tmpl.name)).join(", ")}.</p>` : ""}
    ${(function(){ const w = templateToneWarning(tmpl, c); return w ? `<div class="note w"><b>Template widened beyond its intended arrears range</b>${E(w)} Check the DPD window on the Parameters screen if this was not intended.</div>` : ""; })()}
    ${gaps.length ? `<div class="note w"><b>${CNT(gaps.length)} field(s) not available on this account</b>${gaps.map(g => E(g)).join(", ")} — these appear in the letter marked as unavailable. Capture them in the account drawer first if the letter must be complete.</div>` : ""}
    <div class="card" style="margin-top:10px">
      <h3>Preview <span class="hint">${E(preview.subject)}</span></h3>
      <div class="tree" style="max-height:300px;background:#f7faf8;color:var(--ink);white-space:pre-wrap;font:12px/1.5 var(--sans)">${E(preview.body)}</div>
    </div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="ltCancel">Cancel</button>
      <button class="btn sec" data-act="preview-letter" data-key="${E(c.key)}">Refresh preview</button>
      <button class="btn" data-act="issue-letter" data-format="pdf" data-key="${E(c.key)}">Generate PDF</button>
      <button class="btn gold" data-act="issue-letter" data-format="docx" data-key="${E(c.key)}">Generate DOCX</button>
    </div>
    <p class="mut sm" style="margin:8px 0 0">Issuing a letter logs it against the account and the audit trail, and places it on the work queue as a completed action.</p>`;
  $("modal").classList.add("on");
  $("ltCancel").onclick = () => $("modal").classList.remove("on");
  $("ltTemplate").onchange = () => openLetterPicker(c, $("ltTemplate").value);
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

/* ------------------------------------------- AFRD investment encoding
   The form deliberately has no eligibility control on it. An encoder
   records what the instrument is and what the bank believes is eligible;
   whether that amount counts is decided separately, by someone with a
   review role, against a named document. */
function openInvestmentForm(id) {
  const inv = id ? afrdInvestmentById(id) : newInvestment();
  if (!inv) { toast("That investment record no longer exists.", "err"); return; }
  const R = S.rules;
  const opts = (list, cur, blank) => (blank ? `<option value="">${E(blank)}</option>` : "")
    + list.map(t => `<option value="${E(t.code !== undefined ? t.code : t)}" ${(t.code !== undefined ? t.code : t) === cur ? "selected" : ""}>${E(t.label !== undefined ? t.label : t)}</option>`).join("");
  /* Grouped the way the AFRD review lists them: what it is, what it is worth,
     what it finances, and what proves it. An encoder works down the form in
     that order and the exceptions map onto the same four groups. */
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">${id ? "Edit" : "Record"} a qualifying investment</h2>
    <p class="mut sm" style="margin:0 0 12px">Reference <span class="mono">${E(inv.investmentRef || "")}</span>. Held separately from the loan register. ${id ? "" : "Created pending validation."}</p>

    <h3 style="font-size:12.5px;margin:0 0 6px">Identification</h3>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <label class="f">Instrument category<select id="invCategory">${opts(R.afrdInstrumentCategories || [], inv.category)}</select></label>
      <label class="f">Issuer name<input id="invIssuer" value="${E(inv.issuer)}" placeholder="e.g. Land Bank of the Philippines"></label>
      <label class="f">Issue / security name<input id="invInstrument" value="${E(inv.instrument)}"></label>
      <label class="f">ISIN / security identifier<input id="invIsin" value="${E(inv.isin || "")}" placeholder="e.g. PHY0000000000"></label>
      <label class="f">Internal reference number<input id="invRef" value="${E(inv.referenceNo)}"></label>
      <label class="f">Investment type<select id="invType">${opts(R.afrdInvestmentTypes || [], inv.type)}</select></label>
    </div>

    <h3 style="font-size:12.5px;margin:10px 0 6px">Dates</h3>
    <div class="frow" style="grid-template-columns:1fr 1fr 1fr">
      <label class="f">Acquisition date<input type="date" id="invAcq" value="${E(inv.acquisitionDate)}"></label>
      <label class="f">Reporting date<input type="date" id="invReporting" value="${E(inv.reportingDate || S.cutoff)}"></label>
      <label class="f">Maturity date<input type="date" id="invMat" value="${E(inv.maturityDate)}"></label>
    </div>

    <h3 style="font-size:12.5px;margin:10px 0 6px">Amounts</h3>
    <div class="frow" style="grid-template-columns:1fr 1fr 1fr">
      <label class="f">Face value<input type="number" id="invFace" value="${N(inv.faceValue)}"></label>
      <label class="f">Book / carrying value<input type="number" id="invBook" value="${N(inv.bookValue)}"></label>
      <label class="f">Unamortized premium / (discount)<input type="number" id="invUnamortized" value="${N(inv.unamortized)}"></label>
      <label class="f">Regulatory amount<input type="number" id="invRegulatory" value="${N(inv.regulatoryAmount)}" placeholder="blank = carrying less unamortized"></label>
      <label class="f">Allowance for credit losses<input type="number" id="invAcl" value="${N(inv.acl)}"></label>
      <label class="f">AFRD-eligible amount<input type="number" id="invEligible" value="${N(inv.eligibleAmount)}"></label>
    </div>
    <p class="mut sm" style="margin:0 0 4px">The allowance is stored separately and is not deducted from the AFRD reportable amount — it applies to the FRP carrying figure. Leaving the regulatory amount blank derives it as carrying value less unamortized premium or discount.</p>

    <h3 style="font-size:12.5px;margin:10px 0 6px">What the proceeds finance</h3>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <label class="f">AFRD activity / project category<select id="invClass">${opts(R.afrdInvestmentClasses || [], inv.classification)}</select></label>
      <label class="f">Funding source<select id="invFunding">${opts(R.afrdFundingSources || [], inv.fundingSource)}</select></label>
      <label class="f" style="grid-column:1/-1">Use-of-proceeds description<textarea id="invUse" rows="2" placeholder="How the proceeds finance a qualifying AFRD activity">${E(inv.useOfProceeds || "")}</textarea></label>
      <label class="f">Sustainable finance standard / framework<select id="invStandard">${opts(R.afrdSustainableStandards || [], inv.sustainableStandard, "Not applicable")}</select></label>
      <label class="f">Green / sustainable classification<select id="invGreen">${opts(["Green", "Social", "Sustainability", "Sustainability-linked"], inv.greenClassification, "Not applicable")}</select></label>
    </div>

    <h3 style="font-size:12.5px;margin:10px 0 6px">Evidence</h3>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <label class="f">Offering circular / prospectus reference<input id="invCircular" value="${E(inv.offeringCircularRef || "")}"></label>
      <label class="f">Supporting certification / external review<input id="invExternal" value="${E(inv.externalReviewRef || "")}"></label>
      <label class="f">AFRD rule ID<input id="invRuleId" value="${E(inv.afrdRuleId || "")}" placeholder="Approved rule this holding qualifies under"></label>
      <label class="f">Supporting reference<input id="invSupport" value="${E(inv.supportingRef)}" placeholder="Certificate, board approval, custodian statement"></label>
      <label class="f">Active<span style="display:block;padding-top:6px"><input type="checkbox" id="invActive" ${inv.active === false ? "" : "checked"}> Include in AFRD reporting</span></label>
      <label class="f" style="grid-column:1/-1">Remarks<textarea id="invRemarks" rows="2">${E(inv.remarks)}</textarea></label>
    </div>

    <div class="note"><b>Recording this does not make it AFRD-compliant</b>The eligible amount entered here is the bank's claim. It contributes nothing to the compliance ratio until a Checker, Approver or Administrator validates the record against a supporting document.${
      id && afrdStateOf(inv.status).eligible ? " This record is already validated; changing any of the amounts will return it to pending." : ""}</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="invCancel">Cancel</button>
      <button class="btn" data-act="save-investment" data-id="${E(id || "")}">${id ? "Save changes" : "Record investment"}</button>
    </div>`;
  $("modal").classList.add("on");
  $("invCancel").onclick = () => $("modal").classList.remove("on");
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

/* ------------------------------------------------- Stream B: total loanable funds
   The AFRD review treats the denominator as its own data stream, sourced from
   the financial or AFRD source schedule rather than the loan file. It is
   captured with the schedule it came from and the date it is stated as at,
   because a denominator without a provenance cannot be reconciled and a
   denominator from the wrong period silently misstates the ratio. */
function openTlfForm() {
  const rec = S.afrdTlf || { amount: N(S.rules.totalLoanableFunds), source: "", asOf: S.cutoff, note: "", components: [] };
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">Total loanable funds</h2>
    <p class="mut sm" style="margin:0 0 12px">The statutory base for the 25% requirement under RA 11901. This does not come from the loan file \u2014 it is taken from the applicable financial or AFRD source schedule.</p>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <label class="f">Amount<input type="number" id="tlfAmount" value="${N(rec.amount)}" placeholder="e.g. 200000000"></label>
      <label class="f">Stated as at<input type="date" id="tlfAsOf" value="${E(rec.asOf || S.cutoff)}"></label>
      <label class="f" style="grid-column:1/-1">Source schedule<input id="tlfSource" value="${E(rec.source || "")}" placeholder="e.g. FRP Schedule, Statement of Condition, AFRD source schedule for the quarter"></label>
      <label class="f" style="grid-column:1/-1">Basis of computation<textarea id="tlfNote" rows="2" placeholder="Which components were included, and any adjustments">${E(rec.note || "")}</textarea></label>
    </div>
    <div class="note"><b>Recorded against your name</b>The figure, its source and the date it is stated as at are written to the audit trail. If the date differs from the reporting cut-off the system raises an exception rather than using it silently.</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="tlfCancel">Cancel</button>
      <button class="btn" data-act="save-tlf">Save</button>
    </div>`;
  $("modal").classList.add("on");
  $("tlfCancel").onclick = () => $("modal").classList.remove("on");
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

/* --------------------------------------- priority sector and funding (Stream A) */
function openPrioritySectorForm(c) {
  const R = S.rules, g = f => Eng.get(c.account, f) || "";
  const opts = (list, cur) => list.map(t => `<option value="${E(t.code)}" ${t.code === cur ? "selected" : ""}>${E(t.label)}</option>`).join("");
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">Beneficiary and funding \u2014 ${E(c.account.accountNo)}</h2>
    <p class="mut sm" style="margin:0 0 12px">${E(c.account.borrower)} &middot; outstanding ${P(c.balance)} &middot; ${E(c.afrd.label)}</p>
    <p class="mut sm" style="margin:0 0 10px">The AFRD review separates three questions. <b>What activity is financed</b> comes from Loan Economic Activity and is answered automatically. <b>Who benefits</b> and <b>how it was funded</b> are recorded here, because either can re-weight or disqualify an exposure the activity test has already passed.</p>
    <div class="frow" style="grid-template-columns:1fr 1fr">
      <label class="f">Beneficiary type<select id="psType">${opts(R.afrdBeneficiaryTypes || [], String(g("beneficiaryType")).toUpperCase())}</select></label>
      <label class="f">Funding source<select id="psFunding">${opts(R.afrdFundingSources || [], String(g("afrdFundingSource")).toUpperCase())}</select></label>
      <label class="f">Priority-sector reference<input id="psRef" value="${E(g("prioritySectorReference"))}" placeholder="Required before any multiplier applies"></label>
      <label class="f">Compliance multiplier<input type="number" step="0.1" id="psMult" value="${N(g("complianceMultiplier")) || ""}" placeholder="blank = ${N(R.afrdPriorityMultiplier) || 1}"></label>
    </div>
    <div class="note w"><b>A claim without evidence carries no weight</b>If the beneficiary is flagged as priority-sector but no reference is recorded, the standard multiplier is applied and an exception is raised. The multiplier can never quietly increase compliance.</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="psCancel">Cancel</button>
      <button class="btn" data-act="save-priority-sector" data-key="${E(c.key)}">Save</button>
    </div>`;
  $("modal").classList.add("on");
  $("psCancel").onclick = () => $("modal").classList.remove("on");
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

function openInvestmentValidation(id) {
  const inv = afrdInvestmentById(id);
  if (!inv) { toast("That investment record no longer exists.", "err"); return; }
  const carrying = N(inv.bookValue) || N(inv.faceValue);
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">Validate AFRD eligibility</h2>
    <p class="mut sm" style="margin:0 0 12px">${E(afrdTypeLabel(inv.type))} &middot; ${E(inv.issuer)} &middot; ${E(inv.instrument)}</p>
    <dl class="kv">
      <dt>Reference number</dt><dd>${E(inv.referenceNo) || "<span class='mut'>none</span>"}</dd>
      <dt>Face value</dt><dd>${P(N(inv.faceValue))}</dd>
      <dt>Book / carrying value</dt><dd>${P(N(inv.bookValue))}</dd>
      <dt>Claimed AFRD-eligible</dt><dd><b>${P(N(inv.eligibleAmount))}</b>${N(inv.eligibleAmount) > carrying && carrying ? ` <span class="tag t-bad">exceeds carrying value</span>` : ""}</dd>
      <dt>Classification</dt><dd>${E(afrdClassLabel(inv.classification))}</dd>
      <dt>Encoded by</dt><dd>${E(inv.encodedBy) || "—"} on ${E(String(inv.encodedAt).slice(0, 10))}</dd>
      <dt>Current status</dt><dd><span class="tag ${afrdStateOf(inv.status).tag}">${E(afrdStateOf(inv.status).label)}</span></dd>
    </dl>
    <div class="frow" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <label class="f">Determination<select id="invVState">${(S.rules.afrdEligibilityStates || []).map(s => `<option value="${E(s.code)}" ${s.code === inv.status ? "selected" : ""}>${E(s.label)}</option>`).join("")}</select></label>
      <label class="f">Supporting document reference<input id="invVRef" value="${E(inv.supportingRef)}" placeholder="Required to mark eligible"></label>
      <label class="f" style="grid-column:1/-1">Validation note<textarea id="invVNote" rows="2" placeholder="Basis for the determination">${E(inv.validationNote)}</textarea></label>
    </div>
    <div class="note w"><b>This determination is recorded against your name</b>Marking a record eligible adds ${P(investmentEligibleAmount(inv) || N(inv.eligibleAmount))} to the AFRD numerator. It is logged in the audit trail with your username and the reference given.</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="invVCancel">Cancel</button>
      <button class="btn" data-act="confirm-validate-investment" data-id="${E(inv.id)}">Record determination</button>
    </div>`;
  $("modal").classList.add("on");
  $("invVCancel").onclick = () => $("modal").classList.remove("on");
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

/* Loan-level eligibility. Writes afrdStatus / afrdEvidence into the manual
   capture layer, which is the same field the import reads — so if the bank
   later supplies these determinations as a file, the importer populates the
   identical fields and this screen becomes a review tool rather than the
   only route in. */
function openLoanAfrdValidation(c) {
  const cur = Eng.get(c.account, "afrdStatus") || "PENDING";
  const isAgri = Eng.isAgri(c.account);
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 4px;font-size:18px">AFRD eligibility &mdash; ${E(c.account.accountNo)}</h2>
    <p class="mut sm" style="margin:0 0 12px">${E(c.account.borrower)} &middot; ${E(c.product)} &middot; outstanding ${P(c.balance)}</p>
    <dl class="kv">
      <dt>Purpose / MIS group</dt><dd>${E(Eng.get(c.account, "purpose") || Eng.get(c.account, "misGroup") || "—")}</dd>
      <dt>Agricultural or fisheries indicators</dt><dd>${isAgri ? '<span class="tag t-info">present</span>' : '<span class="tag t-mute">none detected</span>'}</dd>
      <dt>Funding programme</dt><dd>${E(c.program.program)}</dd>
      <dt>Current determination</dt><dd><span class="tag ${c.afrd.status === "ELIGIBLE" ? "t-ok" : c.afrd.status === "EXCLUDED_ACPC" ? "t-info" : "t-warn"}">${E(c.afrd.label)}</span> &mdash; <span class="mut sm">${E(c.afrd.reason)}</span></dd>
    </dl>
    ${c.afrd.status === "EXCLUDED_ACPC" ? `<div class="note b" style="margin-top:12px"><b>ACPC-funded: eligibility is fixed at zero</b>This is a hard exclusion rule and cannot be overridden here.</div>` : `
    <div class="frow" style="grid-template-columns:1fr 1fr;margin-top:12px">
      <label class="f">Determination<select id="laStatus">
        <option value="PENDING" ${cur === "PENDING" ? "selected" : ""}>Pending validation</option>
        <option value="ELIGIBLE" ${cur === "ELIGIBLE" ? "selected" : ""}>Eligible in full</option>
        <option value="PARTIAL" ${cur === "PARTIAL" ? "selected" : ""}>Partially eligible</option>
        <option value="INELIGIBLE" ${cur === "INELIGIBLE" ? "selected" : ""}>Not eligible</option>
      </select></label>
      <label class="f">Supporting document reference<input id="laRef" value="${E(Eng.get(c.account, "afrdEvidence") || "")}" placeholder="Required for an eligible determination"></label>
      <label class="f">Partially eligible amount<input type="number" id="laAmount" value="${N(Eng.get(c.account, "afrdEligibleAmount"))}" placeholder="Only for a partial determination"></label>
    </div>
    <div class="note"><b>An agricultural product does not establish eligibility</b>The determination recorded here is what the compliance computation uses, and it is logged against your name with the reference given.</div>
    <div class="bar" style="margin-top:12px">
      <button class="btn ghost" id="laCancel">Cancel</button>
      <button class="btn" data-act="save-loan-afrd" data-key="${E(c.key)}">Record determination</button>
    </div>`}`;
  $("modal").classList.add("on");
  if ($("laCancel")) $("laCancel").onclick = () => $("modal").classList.remove("on");
  $("modalBody").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b));
}

/* ------------------------------------------------------------ reset flow */
function openReset() {
  $("modalBody").innerHTML = `
    <h2 style="margin:0 0 6px;font-size:18px;color:var(--bad)">Reset the system</h2>
    <p class="sm">This permanently erases:</p>
    <ul class="sm">
      <li>every loan account, import and parsed file</li>
      <li>every draft, validated and locked report in this period and all others</li>
      <li>every export record, reconciliation entry and captured field</li>
      <li>the entire audit trail</li>
    </ul>
    <div class="note b"><b>Take a backup first if retention rules require one.</b>Once this completes there is nothing to recover from inside the application.</div>
    <div class="bar" style="margin-top:14px">
      <button class="btn sec" id="resetBackup">Download a copy first</button>
      <button class="btn ghost" id="resetCancel">Cancel</button>
      <button class="btn bad" id="resetGo">Erase everything</button>
    </div>`;
  $("modal").classList.add("on");
  const g = $("resetGo");
  $("resetCancel").onclick = () => $("modal").classList.remove("on");
  $("resetBackup").onclick = openBackupChoice;
  g.onclick = () => {
    $("modalBody").innerHTML = `<h2 style="margin:0 0 8px;font-size:18px;color:var(--bad)">Confirm once more</h2>
      <p class="sm">This is the final confirmation. Everything listed will be erased.</p>
      <div class="bar"><button class="btn ghost" id="c2">Keep my data</button><button class="btn bad" id="g2">Yes, erase everything</button></div>`;
    $("c2").onclick = () => $("modal").classList.remove("on");
    $("g2").onclick = async () => {
      await Vault.purge();
      try { localStorage.removeItem("rbcci-lpmrs-state"); } catch (e) {}
      S = initialState(); invalidate();
      $("modal").classList.remove("on");
      audit("System reset completed", "all vault content erased");
      render(); toast("Reset complete. Every value is back to zero.");
    };
  };
}

/* ---------------------------------------------------------- storage panel */
async function refreshStorage() {
  const est = await Vault.estimate();
  const persisted = await Vault.persisted();
  const mb = b => (b / 1048576).toFixed(1) + " MB";
  const gate = est.available >= S.rules.minFreeBytes;
  const el = $("storeStats");
  if (el) el.innerHTML = `
    <div class="kpi ${Vault.ready ? "ok" : "bad"}"><span class="lab">Vault</span><span class="val" style="font-size:19px">${Vault.ready ? "OPFS ready" : "Unavailable"}</span><span class="sub">${E(Vault.reason)}</span></div>
    <div class="kpi"><span class="lab">Used</span><span class="val" style="font-size:19px">${mb(est.usage)}</span><span class="sub">of ${mb(est.quota)} granted</span></div>
    <div class="kpi ${gate ? "ok" : "warn"}"><span class="lab">Available</span><span class="val" style="font-size:19px">${mb(est.available)}</span><span class="sub">${gate ? "above" : "below"} the ${mb(S.rules.minFreeBytes)} import gate</span></div>
    <div class="kpi ${persisted ? "ok" : "warn"}"><span class="lab">Persistence</span><span class="val" style="font-size:19px">${persisted ? "Granted" : "Best effort"}</span><span class="sub">${persisted ? "data survives storage pressure" : "request persistence to reduce eviction risk"}</span></div>`;
  const files = await Vault.list();
  const fe = $("vaultFiles");
  if (fe) fe.innerHTML = files.length ? T([
    { h: "Path", v: f => `<span class="mono">${E(f.path)}</span>` },
    { h: "Size", n: 1, v: f => (f.size / 1024).toFixed(1) + " KB" },
    { h: "Modified", v: f => E(f.modified) }], files.slice(0, 200)) : '<p class="mut sm">No files written yet. Import a workbook or save a draft.</p>';
}

/* ================================================================== BOOT */
/* The "set new password" branch below replaces #loginForm's markup and
   submit handler in place. LOGIN_FORM_HTML/bindLoginForm() are how the
   normal username/password view gets put back afterwards -- without this,
   logging out after a first-login password change left the login screen
   permanently stuck on the password-change form with nothing to restore it,
   since the original inputs and handler had been overwritten with no way
   back. Captured once, before anything can mutate it. */
let LOGIN_FORM_HTML = null;
function bindLoginForm() {
  const box = document.getElementById("loginForm");
  if (LOGIN_FORM_HTML === null) LOGIN_FORM_HTML = box.innerHTML;
  box.innerHTML = LOGIN_FORM_HTML;
  box.onsubmit = e => { e.preventDefault(); attemptLogin($("loginUser").value, $("loginPass").value); };
  /* Shown before login so a stale cached build can be spotted without
     opening the developer console. */
  const lv = $("loginVersion");
  if (lv) lv.textContent = "Version " + APP.version;
  const fl = $("forgotLink");
  if (fl) fl.onclick = e => { e.preventDefault(); showForgotPassword(); };
}

/* --------------------------------------------------- forgotten password
   Three steps: name the account, answer its security questions, set a new
   password. An account with no questions on file falls back to asking an
   Administrator, which is also the only route for a user who has forgotten
   the answers as well. */
let RECOVER_USER = null;

function showForgotPassword(msg) {
  RECOVER_USER = null;
  const box = document.getElementById("loginForm");
  box.innerHTML = `
    <div class="brandmark" style="border:0;padding:0 0 16px"><div class="sq">RB</div><div><b>RBCCI LPMRS</b><span>Forgotten password</span></div></div>
    <p class="mut sm">Enter your username. If recovery questions have been set for the account, you will be asked to answer them and can then choose a new password.</p>
    <label class="f">Username<input id="recUser" autocomplete="username"></label>
    <div class="bar" style="margin-top:6px"><button class="btn" type="submit" style="width:100%;justify-content:center">Continue</button></div>
    <p class="mut sm" id="loginError" style="color:var(--bad);min-height:1.4em">${msg ? E(msg) : ""}</p>
    <p class="mut sm"><a href="#" id="backToLogin" style="color:var(--brand2);font-weight:600">Back to log in</a></p>`;
  $("backToLogin").onclick = e => { e.preventDefault(); bindLoginForm(); };
  box.onsubmit = e => {
    e.preventDefault();
    const name = $("recUser").value.trim();
    if (!name) { $("loginError").textContent = "Enter your username."; return; }
    const u = findUser(name);
    if (!u || !u.active || !hasSecurityQuestions(u)) return showRecoveryUnavailable(name, u);
    RECOVER_USER = u.username;
    showRecoveryQuestions();
  };
}

/* No questions on file, or no such account. The two cases read the same to
   avoid confirming which usernames exist. */
function showRecoveryUnavailable(name, u) {
  const box = document.getElementById("loginForm");
  const admins = (S.users || []).filter(x => x.active && x.role === "Administrator" && x.username !== name);
  box.innerHTML = `
    <div class="brandmark" style="border:0;padding:0 0 16px"><div class="sq">RB</div><div><b>RBCCI LPMRS</b><span>Forgotten password</span></div></div>
    <div class="note w"><b>No recovery questions are set for this account</b>The password cannot be reset from this screen.</div>
    ${admins.length
      ? `<p class="mut sm">Ask an Administrator to issue a temporary password from the Administration screen. You will set your own password on the next login. Administrator account(s) here: <b>${admins.map(x => E(x.displayName || x.username)).join(", ")}</b>.</p>`
      : `<div class="note b"><b>No other Administrator account exists</b>Nobody on this installation can issue a temporary password. The application would have to be reinstalled and the data re-imported from the source file.</div>`}
    <p class="mut sm">Once logged in, set recovery questions from the Administration screen so this cannot happen again.</p>
    <p class="mut sm"><a href="#" id="backToLogin" style="color:var(--brand2);font-weight:600">Back to log in</a></p>`;
  $("backToLogin").onclick = e => { e.preventDefault(); bindLoginForm(); };
  document.getElementById("loginForm").onsubmit = e => e.preventDefault();
}

function showRecoveryQuestions(msg) {
  const u = findUser(RECOVER_USER);
  if (!u) return showForgotPassword();
  const box = document.getElementById("loginForm");
  if (u.lockUntil && Date.now() < Date.parse(u.lockUntil)) {
    return showForgotPassword("Too many attempts on that account. Try again after " + new Date(u.lockUntil).toLocaleTimeString() + ".");
  }
  box.innerHTML = `
    <div class="brandmark" style="border:0;padding:0 0 16px"><div class="sq">RB</div><div><b>RBCCI LPMRS</b><span>Recovery questions</span></div></div>
    <p class="mut sm">Answering as <b>${E(u.displayName || u.username)}</b>. Capitalisation and extra spaces do not matter.</p>
    ${u.securityQuestions.map((q, i) => `<label class="f">${E(q.question)}<input id="recAns${i}" autocomplete="off"></label>`).join("")}
    <label class="f" style="margin-top:6px">New password<input type="password" id="recPass1" autocomplete="new-password"></label>
    <label class="f">Confirm new password<input type="password" id="recPass2" autocomplete="new-password"></label>
    <div class="bar" style="margin-top:6px"><button class="btn" type="submit" style="width:100%;justify-content:center">Set new password</button></div>
    <p class="mut sm" id="loginError" style="color:var(--bad);min-height:1.4em">${msg ? E(msg) : ""}</p>
    <p class="mut sm"><a href="#" id="backToLogin" style="color:var(--brand2);font-weight:600">Back to log in</a></p>`;
  $("backToLogin").onclick = e => { e.preventDefault(); bindLoginForm(); };
  box.onsubmit = async e => {
    e.preventDefault();
    const fail = m => { $("loginError").textContent = m; };
    const answers = u.securityQuestions.map((q, i) => $("recAns" + i).value);
    const p1 = $("recPass1").value, p2 = $("recPass2").value;
    if (answers.some(a => !String(a).trim())) return fail("Answer every question.");
    if (p1.length < 6) return fail("The new password must be at least 6 characters.");
    if (p1 !== p2) return fail("The passwords do not match.");
    if (await verifySecurityAnswers(u, answers)) {
      await setUserPassword(u, p1);
      u.mustChangePassword = false; u.failedAttempts = 0; u.lockUntil = "";
      audit("Password reset by recovery questions", u.username);
      await saveState();
      RECOVER_USER = null;
      bindLoginForm();
      $("loginUser").value = u.username;
      toast("Password reset for " + u.username + ". Log in with the new password.");
      return;
    }
    /* Wrong answers count towards the same lockout as wrong passwords, so
       the questions cannot be brute-forced faster than the login itself. */
    u.failedAttempts = (u.failedAttempts || 0) + 1;
    if (u.failedAttempts >= LOCKOUT_THRESHOLD) {
      u.lockUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      u.failedAttempts = 0;
      audit("Locked account after failed recovery attempts", u.username);
      await saveState();
      return showForgotPassword("Too many incorrect answers. That account is locked for a few minutes.");
    }
    audit("Failed password recovery", u.username + " — incorrect answers");
    await saveState();
    showRecoveryQuestions("Those answers do not match. " + CNT(LOCKOUT_THRESHOLD - u.failedAttempts) + " attempt(s) left before the account is locked.");
  };
}

function showLogin(errorMsg, forcePasswordChangeFor) {
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.add("on");
  const box = document.getElementById("loginForm");
  if (LOGIN_FORM_HTML === null) LOGIN_FORM_HTML = box.innerHTML;
  if (forcePasswordChangeFor) {
    box.innerHTML = `
      <div class="brandmark" style="border:0;padding:0 0 16px"><div class="sq">RB</div><div><b>RBCCI LPMRS</b><span>Set a new password</span></div></div>
      <p class="mut sm">First login for <b>${E(forcePasswordChangeFor)}</b>. Choose a new password before continuing.</p>
      <label class="f">New password<input id="newPass1" type="password" autocomplete="new-password" required></label>
      <label class="f">Confirm new password<input id="newPass2" type="password" autocomplete="new-password" required></label>
      <div class="bar" style="margin-top:6px"><button class="btn" type="submit" style="width:100%;justify-content:center">Set password and continue</button></div>
      <p class="mut sm" id="loginError" style="color:var(--bad);min-height:1.4em"></p>`;
    box.onsubmit = async e => {
      e.preventDefault();
      const p1 = $("newPass1").value, p2 = $("newPass2").value;
      if (p1.length < 6) { $("loginError").textContent = "Password must be at least 6 characters."; return; }
      if (p1 !== p2) { $("loginError").textContent = "Passwords do not match."; return; }
      const u = findUser(forcePasswordChangeFor);
      await setUserPassword(u, p1); u.mustChangePassword = false; u.failedAttempts = 0; u.lockUntil = "";
      startSession(u); audit("Set password", u.username);
      saveState();
      finishBoot();
    };
    return;
  }
  bindLoginForm();
  if (errorMsg) $("loginError").textContent = errorMsg;
  $("loginUser").focus();
}

async function attemptLogin(username, password) {
  const u = findUser(username);
  if (!u || !u.active) return showLogin("Invalid username or password.");
  if (u.lockUntil && new Date(u.lockUntil) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(u.lockUntil) - new Date()) / 60000));
    return showLogin("Too many failed attempts. Try again in about " + mins + " minute" + (mins === 1 ? "" : "s") + ".");
  }
  const ok = await verifyPassword(u, password);
  if (!ok) {
    u.failedAttempts = (u.failedAttempts || 0) + 1;
    audit("Failed login attempt", username + " (attempt " + u.failedAttempts + " of " + LOCKOUT_THRESHOLD + ")");
    if (u.failedAttempts >= LOCKOUT_THRESHOLD) {
      u.lockUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      audit("Account temporarily locked", username + " (" + LOCKOUT_THRESHOLD + " failed attempts)");
      saveState();
      return showLogin("Too many failed attempts. This account is locked for 5 minutes.");
    }
    saveState();
    return showLogin("Invalid username or password.");
  }
  u.failedAttempts = 0; u.lockUntil = "";
  if (u.mustChangePassword) { saveState(); return showLogin(null, u.username); }
  startSession(u);
  audit("Logged in", u.username + " (" + u.role + ")");
  saveState();
  finishBoot();
}

/* Idle-session timeout: 15 minutes with no click/keypress while logged in
   ends the session automatically, same as clicking Log out. Listeners are
   attached once, unconditionally, in boot(); resetIdleTimer() is a no-op
   whenever nobody is logged in. */
let idleTimer = null;
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!CURRENT_USER) return;
  idleTimer = setTimeout(() => { if (CURRENT_USER) endSession("idle"); }, IDLE_TIMEOUT_MS);
}
function startIdleTimer() { resetIdleTimer(); }
function stopIdleTimer() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

/* Logging out used to rely on location.reload() to drop back to the login
   screen. On some browsers/PWA install modes a reload can be intercepted or
   delayed (service worker, back-forward cache, a slow in-flight saveState()
   write racing the navigation) and the app appears to "not log out" until
   the person does a hard refresh. This does the same job without any
   navigation at all: it clears rendered content out of the DOM (so no
   account data is left sitting in the page behind the login overlay) and
   flips straight to the login screen, purely in JS. Nothing to intercept. */
function returnToLoginScreen(message) {
  const view = $("view"); if (view) view.innerHTML = "";
  const drawer = $("drawer"); if (drawer) { drawer.innerHTML = ""; drawer.classList.remove("on"); }
  const modal = $("modal"); if (modal) modal.classList.remove("on");
  document.body.classList.remove("nav");
  S.screen = "dashboard";
  showLogin(message || null);
}

function finishBoot() {
  $("loginScreen").classList.remove("on");
  $("appShell").classList.remove("hidden");
  if (!canAccess(S.screen)) S.screen = "dashboard";
  /* period selectors */
  const y = new Date().getFullYear();
  $("selYear").innerHTML = [y - 2, y - 1, y, y + 1].map(v => `<option ${v === S.year ? "selected" : ""}>${v}</option>`).join("");
  $("selView").value = S.view;
  const fillPeriods = () => {
    const opts = S.view === "M" ? Array.from({ length: 12 }, (_, i) => ["M" + String(i + 1).padStart(2, "0"), new Date(2000, i, 1).toLocaleString("en", { month: "long" })])
      : S.view === "Q" ? [["Q1", "Q1 (Jan–Mar)"], ["Q2", "Q2 (Apr–Jun)"], ["Q3", "Q3 (Jul–Sep)"], ["Q4", "Q4 (Oct–Dec)"]]
      : [["FY", "Full year"]];
    $("selPeriod").innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === S.period ? "selected" : ""}>${l}</option>`).join("");
    if (!opts.some(o => o[0] === S.period)) S.period = opts[0][0];
  };
  fillPeriods();
  $("selYear").onchange = e => { S.year = +e.target.value; render(); saveState(); };
  $("selView").onchange = e => { S.view = e.target.value; S.period = S.view === "M" ? "M01" : S.view === "Q" ? "Q1" : "FY"; fillPeriods(); render(); saveState(); };
  $("selPeriod").onchange = e => { S.period = e.target.value; render(); saveState(); };
  $("btnPrint").onclick = () => window.print();
  $("btnXlsx").onclick = exportWorkbook;
  $("btnLogout").onclick = () => { if (confirm("Log out of RBCCI LPMRS?")) endSession(); };
  $("menuBtn").onclick = () => document.body.classList.toggle("nav");
  $("modal").onclick = e => { if (e.target.id === "modal") $("modal").classList.remove("on"); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") { $("modal").classList.remove("on"); $("drawer").classList.remove("on"); } });
  if (!S.audit.length) audit("Application started", "version " + APP.version);
  render();
  if (!Vault.ready) toast("Working in memory for this session. " + Vault.reason);
}

/* ------------------------------------------------------- failure reporting
   Without this, any thrown error stops the render mid-way and leaves whatever
   toast was last shown sitting on screen. To an operator that is
   indistinguishable from the application hanging: "Reading <file>…" stays up,
   nothing else happens, and the page appears frozen. An error the user can
   read and send on is worth far more than a silent stall. */
function reportFailure(where, err) {
  const msg = (err && err.message) || String(err || "unknown error");
  try { audit("Application error", where + ": " + msg); } catch (e) {}
  const box = document.getElementById("toast");
  if (box) {
    box.innerHTML = "<b>Something went wrong and the screen could not finish loading.</b><br>"
      + E(where) + ": " + E(msg)
      + "<br><span style='opacity:.8'>Version " + E(APP.version) + ". Please send this message and the screen you were on.</span>";
    box.classList.add("on");
    box.style.pointerEvents = "auto";
    box.style.maxWidth = "520px";
    box.onclick = () => { box.classList.remove("on"); box.onclick = null; };
  }
  if (window.console && console.error) console.error("[LPMRS]", where, err);
}

window.addEventListener("error", e => reportFailure("Unexpected error", e.error || e.message));
window.addEventListener("unhandledrejection", e => reportFailure("Background task failed", e.reason));

/* Every script must be present for the application to work. A partial copy —
   one file missed, or a stale file served from cache after an update — leaves
   functions undefined and produces failures far from the real cause, which is
   the hardest kind of fault to diagnose remotely. */
/* Each entry probes the identifier directly rather than looking it up on
   window. A top-level `const` or `let` is scoped to the script and never
   becomes a window property, so testing window[name] reported every
   const-declared module as missing even when it had loaded correctly.
   `typeof` on an undeclared identifier is safe and yields "undefined", which
   is exactly the signal wanted when a file genuinely failed to load. */
const REQUIRED_GLOBALS = [
  ["core.js", () => typeof Xlsx],
  ["letters.js", () => typeof defaultLetterTemplates],
  ["rules.js", () => typeof defaultRules],
  ["engine.js", () => typeof Eng],
  ["afrd.js", () => typeof afrdCompliance],
  ["import.js", () => typeof importFile],
  /* SCREENS is built in this file, so it proves nothing about views.js.
     Probe a view function, which is only ever declared there. */
  ["views.js", () => typeof vDashboard],
  ["pdf.js", () => typeof Pdf]
];
function checkModules() {
  const missing = REQUIRED_GLOBALS.filter(([, probe]) => {
    try { return probe() === "undefined"; }
    catch (e) { return true; }        /* not declared at all */
  }).map(([f]) => f);
  if (!missing.length) return true;
  /* This screen must not depend on anything from the files it is reporting as
     missing. It previously used E() and APP, both defined in core.js, so when
     core.js was the file that failed the message itself threw and the operator
     saw a blank page \u2014 the worst possible outcome for a diagnostic. */
  const esc = t => String(t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const ver = (typeof APP !== "undefined" && APP && APP.version) ? APP.version : "unknown";
  document.body.innerHTML = '<div style="max-width:640px;margin:60px auto;font:15px/1.6 system-ui,Arial,sans-serif;color:#12271f">'
    + '<h2 style="color:#9c2f2f;margin:0 0 10px">The application is incomplete</h2>'
    + "<p>" + missing.length + " file(s) did not load: <b>" + missing.map(esc).join(", ") + "</b></p>"
    + "<p>Every file must sit in the same folder as index.html. If the files were replaced recently, the browser may still be using an older copy.</p>"
    + "<ol><li>Confirm all twelve files are in the folder</li>"
    + "<li>Hold <b>Ctrl</b> and press <b>Shift + R</b> to reload without the cache</li>"
    + "<li>If it persists, open the browser settings and clear the site data for this address</li></ol>"
    + '<p style="color:#5d7169;font-size:13px">Version ' + esc(ver) + "</p></div>";
  return false;
}

(async function boot() {
  if (!checkModules()) return;
  await Vault.init();
  await loadState();
  /* Run unconditionally rather than relying on loadState alone: state can
     arrive by restore-from-backup or an unlock path too, and a template
     that misses migration silently loses its account-state controls. The
     migration is idempotent, so calling it twice costs nothing. */
  if (typeof migrateLetterTemplates === "function") migrateLetterTemplates();
  await ensureSeedUser();
  bindLoginForm();
  ["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, resetIdleTimer, { passive: true }));
  if (restoreSession()) { finishBoot(); return; }
  showLogin();
})();


/* ------------------------------------------------------ screen wiring */
/* ------------------------------------------------------ screen wiring */
try {
  NAV.splice(NAV.findIndex(function (n) { return n[0] === "remedial"; }) + 1, 0, ["regulatory", "RG", "Regulatory mapping"]);
  SCREENS.regulatory = vRegulatory;
} catch (e) { /* views.js absent; the module check reports it */ }

const _vReconcile = vReconcile;
SCREENS.reconcile = function () {
  const mv = deriveMovement();
  return _vReconcile() + (mv.available
    ? '<div class="card" style="margin-top:14px"><h3>Movement derived automatically <span class="hint">this period against '
      + E(mv.priorKey) + '</span></h3>'
      + T([{ h: "Movement", v: r => /balance|difference/i.test(r[0]) ? "<b>" + E(r[0]) + "</b>" : E(r[0]) },
           { h: "Accounts", n: 1, v: r => r[1] ? CNT(r[1]) : "" },
           { h: "Amount", n: 1, v: r => P(r[2]) }], mv.lines)
      + '<p class="mut sm" style="margin-top:10px">' + (Math.abs(mv.difference) < 1
        ? "Beginning balance plus movement equals the ending balance. No unexplained difference."
        : "There is an unexplained difference of " + P(mv.difference) + ". Investigate before locking the period.")
      + '</p></div>'
    : '<div class="note" style="margin-top:14px"><b>No prior snapshot for ' + E(mv.priorKey) + '</b>'
      + 'Movement is derived by comparing this period with the previous one. Lock a period, or press "Save period snapshot" on the Reports screen, and the next period fills this in automatically. Until then use the manual figures above.</div>');
};

const _vReports = vReports;
SCREENS.reports = function () {
  return _vReports().replace(
    '<button class="btn" data-act="export-xlsx">Export workbook (.xlsx)</button>',
    '<button class="btn" data-act="export-xlsx">Export workbook (.xlsx)</button><button class="btn gold" data-act="export-pdf">Export formatted PDF report</button><button class="btn sec" data-act="snapshot-period">Save period snapshot</button>'
  ) + '<div class="card" style="margin-top:14px"><h3>Deployment package</h3>'
    + '<p class="mut sm">A single HTML file cannot register a service worker, so on its own it is offline-capable but not an installable Progressive Web Application. This packages the application with a standards-compliant service worker, a web manifest and an icon. Unzip the folder onto the internal server and it becomes installable and fully offline.</p>'
    + '<div class="bar"><button class="btn gold" data-act="export-deploy">Export deployment package (.zip)</button></div>'
    + '<p class="mut sm">Service worker: ' + (("serviceWorker" in navigator)
      ? (location.protocol === "file:" ? "not registered, because the application is running from a file. Deploy the package to enable it." : "registration attempted for this origin.")
      : "not supported by this browser.") + '</p></div>';
};

const _vAdmin = vAdmin;
SCREENS.admin = function () {
  return _vAdmin().replace('<div class="card" style="margin-top:14px;border-color:#e6b4b4">',
    '<div class="card" style="margin-top:14px"><h3>Encryption at rest</h3>'
    + '<p class="mut sm">Loan data held in this browser profile can be encrypted with AES-256-GCM using a key derived from a passphrase. Browser storage is not encrypted by default, which matters on any shared or portable machine.</p>'
    + '<div class="bar">' + (Crypt.configured
      ? '<span class="tag t-ok" style="align-self:center">Encryption enabled</span><button class="btn ghost" data-act="encrypt-off">Turn encryption off</button>'
      : '<button class="btn" data-act="encrypt-open">Encrypt local data</button>') + '</div>'
    + '<p class="mut sm">Device encryption, the operating-system account, the browser profile and physical access remain the bank\'s responsibility.</p>'
    + '</div><div class="card" style="margin-top:14px;border-color:#e6b4b4">');
};


/* ------------------------------------------- amortisation in the drawer */
const _openAccount = openAccount;
openAccount = function (c) {
  _openAccount(c);
  const am = amortisation(c.account), shown = am.rows.slice(0, 24);
  const html = '<div class="card" style="margin-top:12px"><h3>Amortisation schedule <span class="hint">'
    + CNT(am.n) + ' instalments every ' + CNT(am.intervalDays) + ' days</span></h3>'
    + '<dl class="kv" style="margin-bottom:10px">'
    + '<dt>Basis</dt><dd>' + P(am.basis) + '</dd>'
    + '<dt>Nominal rate</dt><dd>' + PCT(am.annual) + ' per annum</dd>'
    + '<dt>Periodic rate</dt><dd>' + PCT(am.periodic, 4) + ' per instalment</dd>'
    + '<dt>Computed instalment</dt><dd><b>' + P(am.payment) + '</b></dd></dl>'
    + T([{ h: "No.", n: 1, v: r => r.k }, { h: "Due date", v: r => E(r.due) },
         { h: "Payment", n: 1, v: r => P(r.payment) }, { h: "Principal", n: 1, v: r => P(r.principal) },
         { h: "Interest", n: 1, v: r => P(r.interest) }, { h: "Balance", n: 1, v: r => P(r.balance) }], shown)
    + (am.rows.length > shown.length ? '<p class="mut sm">Showing the first ' + CNT(shown.length) + ' of ' + CNT(am.rows.length) + ' instalments. The full schedule is in the exported workbook.</p>' : "")
    + '<p class="mut sm">Reconstructed from the approved terms in the register. Where the instalment count is absent it is derived from the grant and maturity dates.</p></div>';
  $("drawer").insertAdjacentHTML("beforeend", html);
};


/* ------------------------------------------------------------ new actions */
/* ------------------------------------------------------------ new actions */
const _act = act;
act = async function (a, el) {
  switch (a) {
    case "export-pdf":
      try {
        toast("Building the report...");
        const name = "RBCCI_LPMRS_" + periodKey() + "_" + today().replace(/-/g, "") + ".pdf";
        download(name, buildPdfReport());
        audit("Exported PDF report", name);
        toast("Report exported: " + name);
      } catch (e) { toast("PDF export failed: " + e.message, "err"); }
      return;
    case "export-deploy": exportDeployment(); return;
    case "snapshot-period":
      S.snapshots = S.snapshots || {};
      S.snapshots[periodKey()] = snapshotNow();
      audit("Saved period snapshot", periodKey());
      toast("Snapshot saved. The next period derives its movement automatically.");
      render(); saveState(); return;
    case "encrypt-open": openEncrypt(); return;
    case "encrypt-off":
      Crypt.disable(); audit("Disabled encryption at rest");
      toast("Encryption disabled. Local data is stored in clear text again.");
      saveState(); render(); return;
    case "backup-restore-open": openRestore(); return;
  }
  return await _act(a, el);
};

function openEncrypt() {
  $("modalBody").innerHTML =
    '<h2 style="margin:0 0 6px;font-size:18px">Encrypt the local data</h2>'
    + '<p class="sm">Loan records held in this browser profile will be encrypted with AES-256-GCM. The key is derived from your passphrase and is never stored; only a random salt is kept.</p>'
    + '<div class="note b"><b>There is no recovery.</b>If the passphrase is lost the data cannot be read by anyone, including the bank. Export a backup first and keep the passphrase with the bank\'s other credentials.</div>'
    + '<label class="f">Passphrase<input type="password" id="pw1" placeholder="at least 12 characters"></label>'
    + '<label class="f" style="margin-top:10px">Confirm passphrase<input type="password" id="pw2"></label>'
    + '<div class="bar" style="margin-top:14px"><button class="btn ghost" id="encCancel">Cancel</button>'
    + '<button class="btn sec" id="encBackup">Export backup first</button>'
    + '<button class="btn" id="encGo" disabled>Encrypt</button></div>';
  $("modal").classList.add("on");
  const p1 = $("pw1"), p2 = $("pw2"), g = $("encGo");
  const check = function () { g.disabled = !(p1.value.length >= 12 && p1.value === p2.value); };
  p1.oninput = check; p2.oninput = check;
  $("encCancel").onclick = function () { $("modal").classList.remove("on"); };
  $("encBackup").onclick = exportJson;
  g.onclick = async function () {
    await Crypt.enable(p1.value);
    await saveState();
    audit("Enabled encryption at rest", "AES-256-GCM, PBKDF2 250,000 iterations");
    $("modal").classList.remove("on");
    toast("Encryption enabled. The passphrase is required after every reload.");
    render();
  };
}
function openUnlock() {
  $("modalBody").innerHTML =
    '<h2 style="margin:0 0 6px;font-size:18px">Unlock the loan book</h2>'
    + '<p class="sm">The data in this browser profile is encrypted. Enter the passphrase to continue.</p>'
    + '<label class="f">Passphrase<input type="password" id="pwu"></label>'
    + '<div class="bar" style="margin-top:14px"><button class="btn ghost" id="unSkip">Start with an empty book</button>'
    + '<button class="btn" id="unGo">Unlock</button></div>';
  $("modal").classList.add("on");
  $("unSkip").onclick = function () { $("modal").classList.remove("on"); render(); };
  $("unGo").onclick = async function () {
    try {
      await Crypt.unlock($("pwu").value);
      const ok = await loadState();
      if (ok !== true) throw new Error("bad passphrase");
      invalidate(); $("modal").classList.remove("on");
      audit("Unlocked encrypted loan book");
      toast("Unlocked."); render();
    } catch (e) { toast("That passphrase does not open this data."); }
  };
}

/* ------------------------------------------------------------ final wiring */
setTimeout(function () {
  const bx = $("btnXlsx"); if (bx) bx.onclick = exportWorkbook;
  if (Crypt.configured && !Crypt.on) openUnlock(); else render();
}, 0);