"use strict";

/* ===================================================== api/health.js
   Cheap, no-external-calls status check for the backend features. Never
   returns the API key itself — only whether it's set. Used once after
   boot (see checkBackendHealth() in events.js) to log a quiet audit
   entry if AI suggestions aren't configured; it never blocks anything
   and is never called while offline (the fetch there fails immediately
   and is ignored, same as every other backend call in this app). */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    verifyImportAvailable: true,
    openRouterConfigured: !!process.env.OPENROUTER_API_KEY
  });
};
