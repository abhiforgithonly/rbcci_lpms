"use strict";

/* ===================================================== api/suggest-mapping.js
   Called automatically by the frontend right after api/verify-import.js
   reports a workbook as NOT recognised. Sends Claude Opus (via OpenRouter)
   the column HEADER LABELS ONLY for the most plausible sheets — never any
   data row, never a cell value — plus the app's expected field list, and
   asks for:
     (a) a short plain-language explanation of what's missing, and
     (b) suggested mappings from the unrecognised headers to expected fields

   This never touches the loan data itself and it never changes anything on
   its own. The suggestions are for a human (maker/checker) to read and
   apply through the normal column-mapping screen — see the design note in
   import.js requestMappingSuggestions(). Nothing here writes to storage or
   modifies the uploaded file.

   Requires the OPENROUTER_API_KEY environment variable (Vercel dashboard ->
   Settings -> Environment Variables). If it's missing, or the OpenRouter
   call fails or times out, this returns ok:false and the frontend simply
   skips showing suggestions — it never blocks the import flow. */

const { FIELDS } = require("../shared/schema.js");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.8";
const REQUEST_TIMEOUT_MS = 25000;
const MAX_SHEETS = 3;             // bound payload/cost — only the most plausible sheets
const MAX_HEADERS_PER_SHEET = 60;

/* Optional, lightweight abuse guard. This is NOT real authentication — a
   value baked into client-side JS is visible to anyone who opens devtools.
   It only stops casual/automated hits on a paid endpoint; if you need real
   protection, put this behind your existing login/session instead, or use
   Vercel's Deployment Protection. Leave APP_INTERNAL_TOKEN unset to disable. */
function checkAppToken(req, res) {
  const required = process.env.APP_INTERNAL_TOKEN;
  if (!required) return true;
  if (req.headers["x-app-token"] === required) return true;
  res.status(401).json({ ok: false, error: "Missing or invalid app token." });
  return false;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Use POST." }); return; }
  if (!checkAppToken(req, res)) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) { res.status(200).json({ ok: false, error: "OPENROUTER_API_KEY is not configured on the server." }); return; }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch (e) { res.status(400).json({ ok: false, error: "Malformed request body." }); return; }

  const { filename, sheets } = body || {};
  if (!filename || !Array.isArray(sheets) || !sheets.length) {
    res.status(400).json({ ok: false, error: "filename and a non-empty sheets[] are required." });
    return;
  }

  /* Trim to a bounded, header-labels-only payload before it ever leaves
     this function's memory for the prompt below. */
  const trimmedSheets = sheets.slice(0, MAX_SHEETS).map(s => ({
    name: String(s.name || "").slice(0, 120),
    headers: Array.isArray(s.headers) ? s.headers.slice(0, MAX_HEADERS_PER_SHEET).map(h => String(h ?? "").slice(0, 120)) : [],
    unmapped: Array.isArray(s.unmapped) ? s.unmapped.slice(0, MAX_HEADERS_PER_SHEET).map(h => String(h ?? "").slice(0, 120)) : []
  }));

  const expectedFields = FIELDS.map(([key, label]) => ({ key, label }));

  const systemPrompt =
    "You help a bank's loan-portfolio import tool. You are given ONLY spreadsheet COLUMN HEADER LABELS "
    + "(never any data row or cell value) from a workbook the tool could not recognise as a loan register, "
    + "plus the list of fields the tool expects. Explain briefly why the sheet(s) weren't recognised "
    + "(e.g. no column that looks like an account number or outstanding balance), and suggest which expected "
    + "field, if any, each unmapped header most likely corresponds to. Never invent columns that were not given. "
    + "If a header doesn't clearly match anything, say so rather than guessing. "
    + "Respond with ONLY a JSON object, no markdown fences, no commentary outside the JSON, matching exactly: "
    + '{"explanation": string, "suggestions": [{"sheet": string, "header": string, "suggestedFieldKey": string|null, "suggestedFieldLabel": string|null, "confidence": "high"|"medium"|"low", "note": string}]}';

  const userPrompt = JSON.stringify({ filename, sheets: trimmedSheets, expectedFields });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
        /* OpenRouter asks for these so it can attribute traffic; harmless to include. */
        "HTTP-Referer": process.env.APP_PUBLIC_URL || "https://localhost",
        "X-Title": "RBCCI LPMRS import mapping assistant"
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0,
        response_format: { type: "json_object" }
      }),
      signal: ctrl.signal
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.status(200).json({ ok: false, error: "OpenRouter returned " + upstream.status + (text ? (": " + text.slice(0, 300)) : "") });
      return;
    }

    const data = await upstream.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!raw) { res.status(200).json({ ok: false, error: "OpenRouter returned no content." }); return; }

    let parsed;
    try {
      /* response_format should already guarantee pure JSON, but strip stray
         markdown fences defensively in case a provider ignores that hint. */
      parsed = JSON.parse(String(raw).trim().replace(/^```json\s*|\s*```$/g, ""));
    } catch (e) {
      res.status(200).json({ ok: false, error: "Could not parse the model's response as JSON." });
      return;
    }

    res.status(200).json({
      ok: true,
      model: DEFAULT_MODEL,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.name === "AbortError" ? "Timed out waiting for OpenRouter." : String(e.message || e) });
  } finally {
    clearTimeout(timer);
  }
};
