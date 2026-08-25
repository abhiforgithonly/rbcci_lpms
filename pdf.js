"use strict";

/* ===================================================== pdf.js
   Minimal PDF 1.4 generator (core Helvetica, no embedded fonts
   or libraries needed) and the formatted PDF report builder.     */
/* ==================================================================== */
/*  PHASE 2                                                             */
/*  Formatted PDF reporting · installable-PWA packaging · amortisation  */
/*  schedules · automatic period movement · encryption at rest ·        */
/*  regulatory report mapping.                                          */
/* ==================================================================== */

/* ---------------------------------------------------------- PDF writer */
/* Minimal PDF 1.4 generator. Core Helvetica only, so no font is embedded */
/* and no library is required. Produces a real .pdf that opens anywhere.  */
const Pdf = (() => {
  const LANDSCAPE = { W: 842, H: 595, M: 34 };    // A4 landscape, points
  const PORTRAIT  = { W: 595, H: 842, M: 56 };    // A4 portrait, wider margin for letters
  const esc = s => String(s ?? "")
    .replace(/\u20b1/g, "PHP ")                   // peso sign is outside WinAnsi
    .replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/([\\()])/g, "\\$1");
  const wid = (s, size) => String(s ?? "").length * size * 0.5;
  const fit = (s, size, max) => {
    s = String(s ?? "");
    if (wid(s, size) <= max) return s;
    return s.slice(0, Math.max(1, Math.floor(max / (size * 0.5)) - 1)) + "...";
  };

  /* opt.portrait switches the page box. Regulatory tables want the wide
     landscape box; borrower correspondence wants portrait with a letter
     margin, so the same writer serves both instead of a second one. */
  function doc(opt) {
    const { W, H, M } = (opt && opt.portrait) ? PORTRAIT : LANDSCAPE;
    const pages = [];
    let ops = [], y = H - M;
    const flush = () => { pages.push(ops.join("\n")); ops = []; y = H - M; };

    const api = {
      text(s, size, bold, dx, colour) {
        const c = colour || [0.07, 0.15, 0.12];
        ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${c[0]} ${c[1]} ${c[2]} rg 1 0 0 1 ${M + (dx || 0)} ${y} Tm (${esc(s)}) Tj ET`);
      },
      line(gap) { y -= (gap || 14); },
      rule() { ops.push(`0.83 0.88 0.86 RG 0.6 w ${M} ${y + 4} m ${W - M} ${y + 4} l S`); },
      band(h, c) { ops.push(`${c[0]} ${c[1]} ${c[2]} rg ${M} ${y - 4} ${W - 2 * M} ${h} re f`); },
      pageBreak() {
        if (!(opt && opt.plainFooter)) {
          ops.push(`BT /F1 7 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${M} ${M - 12} Tm (${esc("RBCCI LPMRS   " + periodKey() + "   rule set " + S.rules.ruleVersion + "   " + activeProfile().label)}) Tj ET`);
        }
        if (!(opt && opt.noPageNumber)) {
          ops.push(`BT /F1 7 Tf 0.45 0.45 0.45 rg 1 0 0 1 ${W - M - 55} ${M - 12} Tm (${esc("page " + (pages.length + 1))}) Tj ET`);
        }
        flush();
      },
      wrap(s, size, bold, dx, colour, lead) {
        /* Word-wraps a paragraph into the page box. Letters are prose, not
           table cells, so they need wrapping rather than truncation. */
        const max = W - 2 * M - (dx || 0);
        const words = String(s ?? "").split(/\s+/);
        let cur = "";
        const out = [];
        words.forEach(w => {
          if (cur && wid(cur + " " + w, size) > max) { out.push(cur); cur = w; }
          else cur = cur ? cur + " " + w : w;
        });
        if (cur) out.push(cur);
        out.forEach(l => { api.need(lead || size + 4); api.text(l, size, bold, dx, colour); y -= (lead || size + 4); });
        return out.length;
      },
      need(h) { if (y - h < M + 26) api.pageBreak(); },
      heading(s, sub) {
        api.need(54);
        api.band(20, [0.06, 0.24, 0.18]);
        api.text(s, 11, true, 6, [1, 1, 1]);
        y -= 20;
        if (sub) { api.text(sub, 7.5, false, 0, [0.36, 0.44, 0.41]); y -= 12; }
        y -= 4;
      },
      table(cols, rows, opt) {
        opt = opt || {};
        const avail = W - 2 * M, tot = cols.reduce((a, c) => a + c.w, 0);
        const xs = []; let x = 0;
        cols.forEach(c => { xs.push(x); x += c.w / tot * avail; });
        const cw = cols.map(c => c.w / tot * avail - 6);
        const header = () => {
          api.band(13, [0.90, 0.94, 0.92]);
          cols.forEach((c, i) => {
            const t = fit(c.h, 7, cw[i]);
            api.text(t, 7, true, (c.n ? xs[i] + cw[i] - wid(t, 7) : xs[i]) + 2, [0.16, 0.27, 0.23]);
          });
          y -= 15;
        };
        header();
        rows.forEach((r, ri) => {
          if (y < M + 30) { api.pageBreak(); header(); }
          if (ri % 2 === 1) api.band(11, [0.975, 0.985, 0.98]);
          const bold = !!opt.boldRow && opt.boldRow(r);
          cols.forEach((c, i) => {
            const t = fit(c.v(r), 7, cw[i]);
            api.text(t, 7, bold, (c.n ? xs[i] + cw[i] - wid(t, 7) : xs[i]) + 2);
          });
          y -= 11.5;
        });
        y -= 6;
      },
      kpis(list) {
        const per = 4, bw = (W - 2 * M) / per;
        for (let i = 0; i < list.length; i += per) {
          api.need(50);
          list.slice(i, i + per).forEach((k, j) => {
            ops.push(`0.98 0.99 0.985 rg ${M + j * bw + 2} ${y - 26} ${bw - 6} 34 re f`);
            ops.push(`0.83 0.88 0.86 RG 0.5 w ${M + j * bw + 2} ${y - 26} ${bw - 6} 34 re S`);
            api.text(fit(k[0], 6.5, bw - 14), 6.5, false, j * bw + 8, [0.36, 0.44, 0.41]);
            ops.push(`BT /F2 12 Tf 0.06 0.24 0.18 rg 1 0 0 1 ${M + j * bw + 8} ${y - 14} Tm (${esc(fit(k[1], 12, bw - 14))}) Tj ET`);
            if (k[2]) ops.push(`BT /F1 6 Tf 0.36 0.44 0.41 rg 1 0 0 1 ${M + j * bw + 8} ${y - 24} Tm (${esc(fit(k[2], 6, bw - 14))}) Tj ET`);
          });
          y -= 44;
        }
      },
      note(title, body) {
        const lines = []; let cur = "";
        String(body).split(/\s+/).forEach(w => {
          if (wid(cur + " " + w, 7.5) > W - 2 * M - 18) { lines.push(cur); cur = w; }
          else cur = cur ? cur + " " + w : w;
        });
        if (cur) lines.push(cur);
        const h = 15 + lines.length * 9.5;
        api.need(h + 16);
        ops.push(`0.98 0.96 0.90 rg ${M} ${y - h + 10} ${W - 2 * M} ${h} re f`);
        ops.push(`0.72 0.55 0.16 rg ${M} ${y - h + 10} 3 ${h} re f`);
        api.text(title, 8, true, 9, [0.42, 0.31, 0.05]); y -= 11;
        lines.forEach(l => { api.text(l, 7.5, false, 9, [0.28, 0.24, 0.14]); y -= 9.5; });
        y -= 8;
      },
      finish() {
        api.pageBreak();
        const objs = [], boldId = 3 + pages.length * 2 + 1;
        objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
        objs[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`;
        objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
        pages.forEach((content, i) => {
          objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 ${boldId} 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
          objs[5 + i * 2] = { stream: content };
        });
        objs[boldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
        let out = "%PDF-1.4\n"; const off = [];
        for (let i = 1; i < objs.length; i++) {
          if (objs[i] === undefined) continue;
          off[i] = out.length;
          out += typeof objs[i] === "object"
            ? `${i} 0 obj\n<< /Length ${objs[i].stream.length} >>\nstream\n${objs[i].stream}\nendstream\nendobj\n`
            : `${i} 0 obj\n${objs[i]}\nendobj\n`;
        }
        const xref = out.length, max = objs.length;
        out += `xref\n0 ${max}\n0000000000 65535 f \n`;
        for (let i = 1; i < max; i++) out += String(off[i] || 0).padStart(10, "0") + " 00000 n \n";
        out += `trailer\n<< /Size ${max} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        const bytes = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
        return new Blob([bytes], { type: "application/pdf" });
      }
    };
    return api;
  }
  return { doc };
})();

function buildPdfReport() {
  const t = totals(), R = S.rules, w = wf(), d = Pdf.doc();

  d.text("Rural Bank of Calbayog City, Inc.", 9, false, 0, [0.42, 0.50, 0.47]); d.line(17);
  d.text("Loan Portfolio Management and Reporting System", 19, true); d.line(20);
  d.text(`${periodKey()}    cut-off ${S.cutoff}    ${w.status}    rule set ${R.ruleVersion}`, 9, false, 0, [0.36, 0.44, 0.41]); d.line(11);
  d.text(`Prepared by ${w.maker || "-"}     Reviewed by ${w.checker || "-"}     Approved by ${w.approver || "-"}`, 8, false, 0, [0.36, 0.44, 0.41]);
  d.line(18); d.rule(); d.line(16);

  d.kpis([
    ["Gross loan portfolio", P0(t.gross), CNT(t.count) + " recognised accounts"],
    ["NPL ratio", PCT(t.nplRatio), P0(t.npl)],
    ["Required ACL", P0(t.required), "booked " + P0(t.booked)],
    ["ACL deficiency", P0(t.aclGap), t.aclGap > 0 ? "under-provisioned" : "adequate"],
    ["Past-due ratio", PCT(t.pastDueRatio), P0(t.pastDue)],
    ["NPL coverage", PCT(t.coverage), "on non-performing exposure only"],
    ["Held off the portfolio", CNT(t.offBook), "ROPA, written off, memorandum"],
    ["Open exceptions", CNT(t.blocks) + " / " + CNT(t.warns), "blocking / warning"]
  ]);

  d.note("Active reporting-scope profile: " + activeProfile().label, activeProfile().text);

  d.heading("Portfolio by performance class", "Source section IV. Recognised loan receivables only.");
  const byC = {};
  t.port.forEach(c => { const k = c.perf.cls; (byC[k] = byC[k] || [0, 0, 0]); byC[k][0]++; byC[k][1] += c.balance; byC[k][2] += c.acl.required; });
  d.table([
    { h: "Performance class", w: 30, v: r => r[0] },
    { h: "Accounts", w: 12, n: 1, v: r => CNT(r[1][0]) },
    { h: "Outstanding", w: 22, n: 1, v: r => P(r[1][1]) },
    { h: "Share", w: 12, n: 1, v: r => PCT(t.gross ? r[1][1] / t.gross : 0, 1) },
    { h: "Required ACL", w: 22, n: 1, v: r => P(r[1][2]) }
  ], Object.entries(byC).concat([["Total", [t.count, t.gross, t.required]]]), { boldRow: r => r[0] === "Total" });

  d.heading("Aging and classification", "Bands are aligned to the approved ACL matrices.");
  const inBand = b => t.port.filter(c => c.perf.dpd >= b.min && c.perf.dpd <= b.max);
  d.table([
    { h: "Aging band", w: 26, v: b => b.label },
    { h: "Accounts", w: 12, n: 1, v: b => CNT(inBand(b).length) },
    { h: "Outstanding", w: 24, n: 1, v: b => P(inBand(b).reduce((a, c) => a + c.balance, 0)) },
    { h: "Required ACL", w: 24, n: 1, v: b => P(inBand(b).reduce((a, c) => a + c.acl.required, 0)) }
  ], R.agingBands);

  d.heading("Allowance for credit losses", "The higher of the matrix floor and any approved model result, plus overlay.");
  const floored = t.all.filter(c => c.acl.floorApplied), skipped = t.all.filter(c => c.acl.skipped);
  const unsec = t.all.filter(c => c.acl.table === "Unsecured matrix"), sec = t.all.filter(c => c.acl.table === "Secured matrix");
  d.table([
    { h: "Item", w: 48, v: r => r[0] }, { h: "Accounts", w: 14, n: 1, v: r => r[1] }, { h: "Amount", w: 24, n: 1, v: r => r[2] }
  ], [
    ["Priced on the unsecured matrix", CNT(unsec.length), P(unsec.reduce((a, c) => a + c.acl.required, 0))],
    ["Priced on the secured matrix", CNT(sec.length), P(sec.reduce((a, c) => a + c.acl.required, 0))],
    ["At the " + P0(R.smallLoanMinimumAcl) + " small-loan minimum", CNT(floored.length), P(floored.reduce((a, c) => a + c.acl.required, 0))],
    ["Excluded: no recognised receivable or out of scope", CNT(skipped.length), P(0)],
    ["Total required allowance", CNT(t.all.length), P(t.required)],
    ["Booked allowance per source records", "", P(t.booked)],
    ["Deficiency / (excess)", "", P(t.aclGap)]
  ], { boldRow: r => /^Total|Deficiency/.test(r[0]) });

  d.heading("AFRD compliance", "RA 11901 requires at least 25% of total loanable funds.");
  const elig = t.all.reduce((a, c) => a + c.afrd.eligible, 0), req = R.totalLoanableFunds * R.afrdRate;
  d.table([{ h: "Step", w: 58, v: r => r[0] }, { h: "Amount", w: 26, n: 1, v: r => r[1] }], [
    ["Total loanable funds", P(R.totalLoanableFunds)],
    ["Mandatory requirement at " + PCT(R.afrdRate, 0), P(req)],
    ["Net AFRD-eligible amount", P(elig)],
    ["Compliance percentage", R.totalLoanableFunds ? PCT(elig / R.totalLoanableFunds) : "denominator not entered"],
    ["Excess / (deficiency)", P(elig - req)],
    ["ACPC balances excluded from the numerator", P(t.all.filter(c => c.afrd.status === "EXCLUDED_ACPC").reduce((a, c) => a + c.balance, 0))]
  ], { boldRow: r => /Compliance|deficiency/.test(r[0]) });

  const mv = deriveMovement();
  if (mv.available) {
    d.heading("Portfolio movement", "Derived by comparing this period against the " + mv.priorKey + " snapshot.");
    d.table([
      { h: "Movement", w: 48, v: r => r[0] },
      { h: "Accounts", w: 14, n: 1, v: r => r[1] ? CNT(r[1]) : "" },
      { h: "Amount", w: 24, n: 1, v: r => P(r[2]) }
    ], mv.lines, { boldRow: r => /balance|difference/i.test(r[0]) });
  }

  d.heading("Exceptions requiring action", "Blocking errors must be cleared before the period can be locked.");
  const byCode = {};
  t.exceptions.forEach(e => { (byCode[e.code] = byCode[e.code] || { sev: e.sev, msg: e.msg, fix: e.fix, n: 0 }); byCode[e.code].n++; });
  d.table([
    { h: "Rule", w: 10, v: r => r[0] },
    { h: "Severity", w: 10, v: r => r[1].sev === "BLOCK" ? "Blocking" : "Warning" },
    { h: "Accounts", w: 9, n: 1, v: r => CNT(r[1].n) },
    { h: "Finding", w: 36, v: r => r[1].msg },
    { h: "Required correction", w: 35, v: r => r[1].fix }
  ], Object.entries(byCode).sort((a, b) => (a[1].sev === "BLOCK" ? 0 : 1) - (b[1].sev === "BLOCK" ? 0 : 1) || b[1].n - a[1].n));

  d.heading("Parameters in force", "Effective-dated and versioned. Locked periods are never reclassified.");
  d.table([{ h: "Parameter", w: 40, v: r => r[0] }, { h: "Value", w: 26, n: 1, v: r => r[1] }, { h: "Source", w: 34, v: r => r[2] }], [
    ["Curing period", R.curingDays + " days", "Source IV"],
    ["NPL threshold", R.nplDpdThreshold + " days", "Source IV"],
    ["GLLP rate", PCT(R.gllpRate, 0), "ACL instruction"],
    ["Small-loan threshold", P0(R.smallLoanThreshold), "ACL instruction"],
    ["Small-loan minimum allowance", P0(R.smallLoanMinimumAcl), "ACL instruction"],
    ["Floor suppressed on memorandum accounts", R.suppressFloorOnMemo ? "Yes" : "No", "No recognised receivable"],
    ["Secured rates require collateral evidence", R.securedRatesRequireCollateral ? "Yes" : "No", "Source III"],
    ["AFRD denominator", "Total loanable funds", "Source VI / RA 11901"],
    ["SBCorp risk transfer confirmed", R.sbcorpRiskTransferConfirmed ? "Yes" : "No", "Legal and Accounting"],
    ["Rule set", R.ruleVersion + " (" + R.approvalState.replace(/_/g, " ") + ")", "Parameter governance"]
  ]);

  return d.finish();
}

