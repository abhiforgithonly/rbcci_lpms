"use strict";

/* ===================================================== api/verify-import.js
   Structure-only pre-check for an uploaded workbook, run before the
   browser does the real import (import.js -> importFile()).

   What this endpoint does:
     - reads sheet names, header rows and column labels
     - runs them through the SAME mapHeaders()/scoreMapping() logic the
       client uses, from shared/schema.js, so the two never disagree
     - returns whether a recognised loan register was found, and which
       key columns (account number / outstanding balance) are missing

   What this endpoint deliberately never does:
     - it never reads or returns any data-row VALUES (borrower names,
       account numbers, balances, dates). Only header labels and row/
       column counts are inspected. This mirrors the same boundary the
       client-side diagnostic already holds itself to (see import.js).
     - it never stores the uploaded file. The buffer only exists for the
       duration of this request and is discarded when the function returns.

   If this endpoint is unreachable, slow, or returns a non-2xx response,
   the frontend is expected to fall back to the existing client-side
   check (import.js) rather than block the import — see events.js. */

const XLSX = require("xlsx");
const { mapHeaders, scoreMapping, REQUIRED_SCORE_THRESHOLD } = require("../shared/schema.js");

const MAX_BYTES = 8 * 1024 * 1024;          // guardrail; raw file, before base64 overhead
const HEADER_ROW_SEARCH_DEPTH = 6;          // same depth importFile() searches client-side

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST." });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ ok: false, error: "Malformed request body." });
    return;
  }

  const { filename, dataBase64 } = body || {};
  if (!filename || !dataBase64) {
    res.status(400).json({ ok: false, error: "filename and dataBase64 are required." });
    return;
  }

  let buf;
  try {
    buf = Buffer.from(dataBase64, "base64");
  } catch (e) {
    res.status(400).json({ ok: false, error: "dataBase64 could not be decoded." });
    return;
  }
  if (!buf.length) {
    res.status(400).json({ ok: false, error: "Empty file." });
    return;
  }
  if (buf.length > MAX_BYTES) {
    /* Large files fall back to the client-side check by design — that's a
       deliberate size ceiling, not a bug. See fallback note above. */
    res.status(413).json({ ok: false, error: "File too large for the backend pre-check; the app will fall back to the on-device check." });
    return;
  }

  let workbook;
  try {
    workbook = XLSX.read(buf, { type: "buffer" });
  } catch (e) {
    res.status(200).json({
      ok: false,
      recognised: false,
      reason: "Could not parse " + filename + " as a workbook. It may not be a valid .xlsx/.xls file.",
      sheets: []
    });
    return;
  }

  const sheetNames = workbook.SheetNames || [];
  let best = null;
  const sheetSummaries = [];

  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    /* header:1 -> array-of-arrays, i.e. structure only. sheet_to_json still
       reads cell values into memory momentarily to build the rows, but only
       header-row labels and row/column COUNTS are ever placed in the
       response below; data-row contents are never copied out of this
       function. */
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    const rowCount = rows.length;
    const widest = rows.reduce((a, r) => Math.max(a, r.length), 0);
    let sheetBest = null;

    for (let hr = 0; hr < Math.min(HEADER_ROW_SEARCH_DEPTH, rowCount); hr++) {
      const headers = (rows[hr] || []).map(String);
      const { map } = mapHeaders(headers);
      const score = scoreMapping(map);
      if (!sheetBest || score > sheetBest.score) sheetBest = { headerRow: hr, score, mappedCount: Object.keys(map).length, map };
      if (!best || score > best.score) best = { sheet: name, headerRow: hr, score, mappedCount: Object.keys(map).length, map };
    }

    sheetSummaries.push({
      name, rows: rowCount, widestRow: widest,
      bestHeaderRow: sheetBest ? sheetBest.headerRow : null,
      bestScore: sheetBest ? sheetBest.score : 0,
      mappedColumns: sheetBest ? sheetBest.mappedCount : 0
    });
  }

  const recognised = !!best && best.score >= REQUIRED_SCORE_THRESHOLD;
  const missingKeyColumns = [];
  if (best) {
    if (best.map.accountNo === undefined) missingKeyColumns.push("Loan account number");
    if (best.map.balance === undefined) missingKeyColumns.push("Outstanding principal");
  }

  res.status(200).json({
    ok: true,                         // the check itself ran successfully
    recognised,                       // whether a loan register was found
    filename,
    sheets: sheetSummaries,
    bestSheet: best ? { name: best.sheet, headerRow: best.headerRow, score: best.score, mappedColumns: best.mappedCount } : null,
    missingKeyColumns,
    reason: recognised
      ? null
      : (best
          ? "No sheet scored high enough to be recognised as a loan register (best: \u201c" + best.sheet + "\u201d, " + best.mappedCount + " column(s) mapped)."
          : "No sheets with any rows were found in " + filename + ".")
  });
};
