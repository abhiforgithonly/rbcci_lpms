"use strict";

/* ===================================================== core.js
   Generic helpers, ZIP/XLSX/CSV codecs, OPFS storage vault,
   AES-256-GCM encryption at rest. No app-specific state lives here. */

/* ============================================================ RBCCI LPMRS
   Single-file offline application. No external libraries, no CDN, no network.
   Reference: RBCCI LPMRS source document 05 Aug 2026 + ACL matrix instruction.
   ======================================================================== */
const APP = { version: "1.13.1", ruleVersion: "2026.08.1", root: "rbcci-lpmrs" };
/* Declared here, above every consumer, so the limits that stop a damaged file
   taking the page down are visible in one place rather than buried. */
const INFLATE_DEADLINE_MS = 25000;   /* hard ceiling on decompressing one part */

/* ---------------------------------------------------------------- helpers */
const $ = id => document.getElementById(id);
const E = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const N = v => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
/* Rate columns arrive in three shapes across core-banking exports: "1.00%",
   the string "1.00" meaning one per cent, and the number 0.01. N() strips the
   per-cent sign and would return 1 for the first two, overstating any amount
   derived from them by a hundred. RATE() resolves all three to a decimal
   fraction. A bare value above 1 is read as a percentage, since a provision
   or interest rate of more than 100% is not a real figure. */
const RATE = v => {
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const n = N(raw);
  if (/%/.test(raw)) return n / 100;
  return n > 1 ? n / 100 : n;
};
const P = v => "\u20b1" + N(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const P0 = v => "\u20b1" + N(v).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const PCT = (v, d) => (N(v) * 100).toFixed(d === undefined ? 2 : d) + "%";
const CNT = v => N(v).toLocaleString("en-PH");
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now());
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Long-running steps set a persistent message. It must always be cleared by
   whatever finishes or fails, never left to time out on its own. */
function toast(msg, kind) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 3200);
  if (kind === "err") console.warn(msg);
}
function dateISO(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
async function sha256(buf) {
  try {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return "hash-unavailable"; }
}
/* ----------------------------------------------------- login password hashing
   Login passwords use the same PBKDF2 primitive the vault already uses for
   its own encryption key (250,000 iterations, SHA-256), with a random salt
   per user, instead of a single unsalted SHA-256 round. hashPassword() makes
   a fresh {hash, salt} pair for a new/changed password; verifyPassword()
   checks a password against a stored pair. Both are plain base64 strings so
   they store the same way passHash always did. */
const PwHash = (() => {
  const b64 = u => btoa(String.fromCharCode.apply(null, Array.from(u)));
  const un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pass, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, 256);
    return b64(new Uint8Array(bits));
  }
  async function hash(pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { hash: await derive(pass, salt), salt: b64(salt) };
  }
  async function verify(pass, saltB64, hashB64) {
    if (!saltB64) return false;
    try { return (await derive(pass, un(saltB64))) === hashB64; } catch (e) { return false; }
  }
  return { hash, verify };
})();
/* "2026-08-14" -> "14 August 2026". Correspondence to a borrower reads as
   a letter, not as a database row. */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return String(+m[3]) + " " + MONTHS[+m[2] - 1] + " " + m[1];
}

/* Minimal CSV writer. A leading BOM so Excel opens UTF-8 correctly, and any
   cell that could be read as a formula is prefixed with an apostrophe —
   an issuer name beginning with = would otherwise execute on open. */
function toCsvBlob(rows) {
  const cell = v => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = rows.map(r => r.map(cell).join(",")).join("\r\n");
  return new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
}

function download(name, blob) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------- ZIP reader */
/* Minimal reader for .xlsx (a ZIP). Uses DecompressionStream for deflate.   */
/* --------------------------------------------------- pure-JS DEFLATE fallback */
/* Bank workstations are frequently locked to old browser builds (legacy
   Edge/IE mode, unpatched Safari) that never shipped DecompressionStream.
   The people using this application are not going to diagnose a browser
   compatibility error or go find a different computer — the application has
   to just work on whatever is already on their desk. This is a compact,
   dependency-free raw-DEFLATE (RFC 1951) decompressor used only when the
   browser's native decompressor is missing or throws, so unzipping an
   .xlsx never depends on which browser happens to be installed.

   The Huffman decoder below uses the classic counts/symbols array method
   (as in the public-domain "tinf" decoder) rather than a hash lookup per
   bit — it is plain integer array arithmetic, which matters because this
   sometimes has to run on years-old office hardware. On top of that,
   decodeEntries() hands control back to the browser every so often while
   it works, so a big workbook stays a visible "please wait" instead of a
   frozen tab: a slow computer takes longer, but the page never stops
   responding to clicks while it does. */
const TinyInflate = (() => {
  const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  /* Canonical-Huffman table: counts[len] = how many codes of that bit
     length exist, symbols[] = the symbols in canonical code order. Decoding
     a symbol is then a tight loop of integer compares, no per-bit hashing. */
  function buildTree(lengths, num) {
    const counts = new Uint16Array(16);
    for (let i = 0; i < num; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    const symbols = new Uint16Array(num);
    for (let i = 0; i < num; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts, symbols };
  }

  const FIXED_LIT_LENGTHS = (() => {
    const l = new Uint8Array(288);
    for (let i = 0; i < 144; i++) l[i] = 8;
    for (let i = 144; i < 256; i++) l[i] = 9;
    for (let i = 256; i < 280; i++) l[i] = 7;
    for (let i = 280; i < 288; i++) l[i] = 8;
    return l;
  })();
  const FIXED_DIST_LENGTHS = new Uint8Array(30).fill(5);

  const idle = () => new Promise(r => setTimeout(r, 0));

  /* Async so it can pause and hand control back to the browser periodically
     (see YIELD_EVERY below) instead of running as one long blocking call. */
  async function inflateRawAsync(input) {
    let pos = 0, bitBuf = 0, bitCnt = 0;
    /* Reading past the end of the input must fail loudly. Indexing a
       Uint8Array beyond its length yields undefined, and `undefined & 1` is
       zero, so a truncated stream would otherwise feed an endless run of zero
       bits: the final-block flag never arrives, the loop never exits, and the
       tab freezes with no error to report. */
    const bit = () => {
      if (bitCnt === 0) {
        if (pos >= input.length) throw new Error("This workbook is incomplete \u2014 the compressed data ends earlier than the file says it should. Open it in Excel and save a fresh copy, then import that.");
        bitBuf = input[pos++]; bitCnt = 8;
      }
      const b = bitBuf & 1; bitBuf >>= 1; bitCnt--; return b;
    };
    const bits = n => { let v = 0; for (let i = 0; i < n; i++) v |= bit() << i; return v; };
    const decodeSym = tree => {
      let sum = 0, cur = 0, len = 0;
      do {
        cur = 2 * cur + bit();
        len++;
        if (len > 15) throw new Error("Corrupted archive (bad Huffman code).");
        sum += tree.counts[len];
        cur -= tree.counts[len];
      } while (cur >= 0);
      return tree.symbols[sum + cur];
    };

    let out = new Uint8Array(Math.max(64, input.length * 3));
    let outLen = 0;
    /* A damaged stream can otherwise ask for unbounded output and take the
       tab down with an out-of-memory failure instead of a message. */
    const MAX_OUT = 512 * 1024 * 1024;
    const ensure = n => {
      if (outLen + n > MAX_OUT) throw new Error("This workbook expands to an unreasonable size and is very likely damaged.");
      if (outLen + n > out.length) { const g = new Uint8Array(Math.max(out.length * 2, outLen + n)); g.set(out.subarray(0, outLen)); out = g; }
    };

    const YIELD_EVERY = 250000; // output bytes between UI yields
    let sinceYield = 0;

    /* A wall-clock deadline that no path can escape.

       Yielding on output bytes is not enough on its own: a stream that spins
       without ever emitting a byte reaches no yield point, so the browser
       never repaints and the tab locks with "This page isn't responding".
       Checking elapsed time at the top of every block, and on every pass of
       the literal/length loop, means the decoder gives up and reports rather
       than taking the page down \u2014 whatever shape the damage takes. */
    const DEADLINE = Date.now() + INFLATE_DEADLINE_MS;
    let guard = 0;
    const tick = () => {
      /* Date.now() on every iteration would itself be a cost; sampling is
         accurate enough for a limit measured in seconds. */
      if ((++guard & 0x3FFF) !== 0) return;
      if (Date.now() > DEADLINE) {
        throw new Error("Reading this workbook did not finish within "
          + Math.round(INFLATE_DEADLINE_MS / 1000) + " seconds and has been stopped so the page stays usable. "
          + "The file is very likely incomplete or damaged \u2014 if it is stored in OneDrive or SharePoint, "
          + "right-click it in File Explorer, choose \u201cAlways keep on this device\u201d, wait for the tick to fill in, then try again. "
          + "Otherwise open it in Excel and save a fresh copy.");
      }
    };

    let final = 0;
    do {
      tick();
      final = bit();
      const type = bits(2);
      if (type === 0) {
        // stored block: discard any partial byte, then read a raw length-prefixed run
        bitBuf = 0; bitCnt = 0;
        if (pos + 4 > input.length) throw new Error("This workbook is incomplete (truncated stored block). Open it in Excel and save a fresh copy.");
        const len = input[pos] | (input[pos + 1] << 8);
        const nlen = input[pos + 2] | (input[pos + 3] << 8);
        pos += 4;                                  // LEN + one's-complement NLEN
        /* NLEN is LEN inverted. If they disagree the stream is damaged, and
           continuing would append whatever bytes happen to follow. */
        if ((len ^ 0xFFFF) !== nlen) throw new Error("Corrupted archive (stored block length check failed).");
        if (pos + len > input.length) throw new Error("This workbook is incomplete (stored block runs past the end of the file).");
        ensure(len);
        out.set(input.subarray(pos, pos + len), outLen);
        outLen += len; pos += len; sinceYield += len;
      } else if (type === 1 || type === 2) {
        let litTree, distTree;
        if (type === 1) {
          litTree = buildTree(FIXED_LIT_LENGTHS, 288);
          distTree = buildTree(FIXED_DIST_LENGTHS, 30);
        } else {
          const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          const clLengths = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clLengths[CLORDER[i]] = bits(3);
          const clTree = buildTree(clLengths, 19);
          const lengths = new Uint8Array(hlit + hdist);
          let li = 0;
          while (li < hlit + hdist) {
            const sym = decodeSym(clTree);
            if (sym < 16) lengths[li++] = sym;
            else if (sym === 16) { const rep = bits(2) + 3; const prev = li > 0 ? lengths[li - 1] : 0; for (let i = 0; i < rep; i++) lengths[li++] = prev; }
            else if (sym === 17) { const rep = bits(3) + 3; li += rep; }
            else { const rep = bits(7) + 11; li += rep; }
          }
          litTree = buildTree(lengths.subarray(0, hlit), hlit);
          distTree = buildTree(lengths.subarray(hlit, hlit + hdist), hdist);
        }
        for (;;) {
          const sym = decodeSym(litTree);
          tick();
          if (sym < 256) { ensure(1); out[outLen++] = sym; sinceYield++; if (sinceYield > YIELD_EVERY) { sinceYield = 0; await idle(); } continue; }
          if (sym === 256) break;
          const li = sym - 257;
          const length = LBASE[li] + bits(LEXT[li]);
          const dsym = decodeSym(distTree);
          const dist = DBASE[dsym] + bits(DEXT[dsym]);
          /* A back-reference pointing before the start of the output means the
             stream is damaged. Left unchecked it reads undefined, which a
             typed array silently stores as zero, quietly corrupting the data
             rather than reporting a problem. */
          if (dist > outLen) throw new Error("Corrupted archive (back-reference before start of data).");
          ensure(length);
          let from = outLen - dist;
          for (let i = 0; i < length; i++) out[outLen++] = out[from++];
          sinceYield += length;
          if (sinceYield > YIELD_EVERY) { sinceYield = 0; await idle(); }
        }
      } else {
        throw new Error("Corrupted archive (unknown DEFLATE block type).");
      }
    } while (!final);
    return out.subarray(0, outLen);
  }
  return { inflateRawAsync };
})();

const ZipRead = (() => {
  /* The browser's own decompressor is used when it exists, because it is
     native code and far faster. Older locked-down office builds do not have
     it, and some throw on streams they dislike, so a self-contained decoder
     stands behind it. Nothing about importing a workbook then depends on
     which browser happens to be installed on the workstation. */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "undefined") {
      try {
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) {
        /* Fall through and try again in JavaScript. A genuinely damaged file
           will fail there too, with a message that says what to do. */
      }
    }
    return await TinyInflate.inflateRawAsync(bytes);
  }
  /* What kind of file is this actually? Named .xlsx does not mean it is one.
     Naming the real format lets the message say what to do about it instead
     of failing with something the operator cannot act on. */
  function sniff(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length < 8) return { kind: "empty", why: "The file is empty or truncated." };
    const b = Array.from(u8.slice(0, 8));
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) {
      return { kind: "xls", why: "This is an old binary Excel file (.xls), or an .xlsx protected with a password. "
        + "Open it in Excel, choose File then Save As, pick 'Excel Workbook (*.xlsx)' with no password, and import that copy." };
    }
    if (b[0] === 0x50 && b[1] === 0x4B) return { kind: "zip" };
    /* Text of some kind: a CSV or an HTML table saved with an .xlsx name. */
    const head = new TextDecoder().decode(u8.slice(0, 400)).toLowerCase();
    if (head.includes("<html") || head.includes("<table"))
      return { kind: "html", why: "This is a web page saved with an Excel name, not a real Excel workbook. "
        + "Open it in Excel and save it again as 'Excel Workbook (*.xlsx)'." };
    return { kind: "unknown", why: "This does not look like an Excel workbook. If it is a CSV, rename it with a .csv ending and import it again." };
  }

  async function entries(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    const s = sniff(buffer);
    if (s.kind !== "zip") throw new Error(s.why);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a readable .xlsx file (no ZIP directory found). The file may be damaged \u2014 open it in Excel and save a fresh copy.");
    let count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    /* ZIP64: the 16-bit count and 32-bit offset above saturate on large
       archives, and the real values live in a separate record. Without this
       the directory offset is nonsense and nothing is found. */
    if (count === 0xFFFF || off === 0xFFFFFFFF) {
      for (let i = eocd - 20; i >= 0 && i > eocd - 4096; i--) {
        if (dv.getUint32(i, true) === 0x07064b50) {
          const z64 = Number(dv.getBigUint64(i + 8, true));
          if (dv.getUint32(z64, true) === 0x06064b50) {
            count = Number(dv.getBigUint64(z64 + 32, true));
            off = Number(dv.getBigUint64(z64 + 48, true));
          }
          break;
        }
      }
    }
    const out = {};
    for (let i = 0; i < count; i++) {
      /* Every read is bounds-checked. A damaged directory would otherwise
         walk off the end of the buffer or spin on garbage lengths. */
      if (off < 0 || off + 46 > u8.length) break;
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true);
      const nlen = dv.getUint16(off + 28, true);
      const elen = dv.getUint16(off + 30, true);
      const clen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
      if (lho + 30 > u8.length) { off += 46 + nlen + elen + clen; continue; }
      const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnl + lel;
      /* A zero or over-long compressed size means the entry was written with
         a streaming data descriptor. Take everything to the end of the buffer
         and let the decompressor stop at the end of the deflate stream. */
      const end = (csize > 0 && start + csize <= u8.length) ? start + csize : u8.length;
      if (start < u8.length) out[name] = { method, data: u8.subarray(start, end) };
      const step = 46 + nlen + elen + clen;
      if (step <= 0) break;
      off += step;
    }
    return out;
  }
  /* Compression methods this reader can handle. 0 is stored, 8 is deflate;
     between them they cover every .xlsx any spreadsheet application writes.
     Anything else was previously handed to the deflate decoder anyway, which
     is given data it cannot parse. A stream that errors part-way does not
     always reject cleanly, so the failure surfaced as the whole import
     stopping with nothing to report rather than as an error. */
  const METHOD_NAMES = { 0: "stored", 1: "shrunk", 6: "imploded", 8: "deflate",
    9: "deflate64", 12: "bzip2", 14: "LZMA", 98: "PPMd" };
  const INFLATE_TIMEOUT_MS = 30000;

  async function text(entry) {
    if (!entry) return "";
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error("This workbook uses " + (METHOD_NAMES[entry.method] || "compression method " + entry.method)
        + " compression, which cannot be read here. Open it in Excel and use Save As to write a normal .xlsx, then import that.");
    }
    if (entry.method === 0) return new TextDecoder().decode(entry.data);
    /* A hard limit as well, so a decoder that stalls on damaged data cannot
       leave the application waiting indefinitely. */
    let timer;
    const raw = await Promise.race([
      inflateRaw(entry.data),
      new Promise((_, rej) => { timer = setTimeout(() =>
        rej(new Error("Decompressing part of this workbook did not finish. The file may be damaged; try opening it in Excel and saving a fresh copy.")),
        INFLATE_TIMEOUT_MS); })
    ]).finally(() => clearTimeout(timer));
    return new TextDecoder().decode(raw);
  }
  return { entries, text };
})();

/* ------------------------------------------------------------- ZIP writer */
/* Writes STORED (uncompressed) entries — produces a valid .xlsx workbook.  */
const ZipWrite = (() => {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflate(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const cs = new CompressionStream("deflate-raw");
      const st = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(st).arrayBuffer());
    } catch (e) { return null; }
  }
  async function build(files, mime) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(raw);
      const packed = await deflate(raw);
      const useDeflate = packed && packed.length < raw.length;
      const data = useDeflate ? packed : raw;
      const method = useDeflate ? 8 : 0;
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, method, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, raw.length, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, method, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
      ch.set(name, 46); central.push(ch);
      offset += lh.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  return { build };
})();

/* ------------------------------------------------------- XLSX read / write */
const MAX_SHEET_COLS = 1024;   /* far wider than any loan extract; guards against stray cells */
const Xlsx = (() => {
  const colNum = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const colName = i => { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; } return s; };
  const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
  const xesc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;" }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  const serialToISO = n => {
    const ms = (n - 25569) * 86400000;
    if (!Number.isFinite(ms)) return "";
    return new Date(Math.round(ms)).toISOString().slice(0, 10);
  };

  async function read(buffer) {
    const z = await ZipRead.entries(buffer);
    const wbXml = await ZipRead.text(z["xl/workbook.xml"]);
    const relXml = await ZipRead.text(z["xl/_rels/workbook.xml.rels"]);
    const ssXml = z["xl/sharedStrings.xml"] ? await ZipRead.text(z["xl/sharedStrings.xml"]) : "";
    const styXml = z["xl/styles.xml"] ? await ZipRead.text(z["xl/styles.xml"]) : "";

    const shared = [];
    ssXml.replace(/<si>([\s\S]*?)<\/si>/g, (m, body) => {
      let s = ""; body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, t) => { s += unesc(t); return ""; });
      shared.push(s); return "";
    });
    // date-formatted style ids
    const numFmt = {};
    styXml.replace(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g, (m, id, code) => { numFmt[id] = unesc(code); return ""; });
    const cellXfs = (styXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [""])[0];
    const dateStyle = [];
    let xi = 0;
    cellXfs.replace(/<xf\b[^>]*\/?>/g, tag => {
      const id = (tag.match(/numFmtId="(\d+)"/) || [])[1];
      const code = numFmt[id] || "";
      const builtinDate = ["14","15","16","17","22","165","166","167"].includes(id);
      dateStyle[xi++] = builtinDate || /[dmyh]/i.test(code) && /[\/\-]|yy|mmm/i.test(code);
      return tag;
    });

    /* Relationship and sheet lookup, order-independently.

       Attribute order carries no meaning in XML, and exporters differ: some
       write Id before Target, others Target before Id. Matching both in one
       regex silently fails on the second form — the relationship map comes
       back empty, every sheet path resolves to nothing, and the workbook
       looks like it contains no data at all rather than reporting an error.
       Each tag is therefore isolated first and its attributes read
       individually. */
    const attr = (tag, name) => {
      const m = tag.match(new RegExp("(?:^|\\s)" + name + '\\s*=\\s*"([^"]*)"')) ||
                tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*'([^']*)'"));
      return m ? m[1] : "";
    };
    const rels = {};
    (relXml.match(/<Relationship\b[^>]*>/g) || []).forEach(tag => {
      const id = attr(tag, "Id"), tgt = attr(tag, "Target");
      if (id && tgt) rels[id] = tgt.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    });
    const sheets = [];
    (wbXml.match(/<sheet\b[^>]*\/?>/g) || []).forEach(tag => {
      const nm = attr(tag, "name");
      if (!nm) return;
      /* r:id is the correct pointer; sheetId is a fallback for workbooks that
         omit the relationship, and the positional guess is a last resort. */
      const rid = attr(tag, "r:id") || attr(tag, "relationshipId");
      const sid = attr(tag, "sheetId");
      let path = rid && rels[rid] ? "xl/" + rels[rid] : "";
      if (!path && sid) path = "xl/worksheets/sheet" + sid + ".xml";
      if (!path) path = "xl/worksheets/sheet" + (sheets.length + 1) + ".xml";
      sheets.push({ name: unesc(nm), path });
    });

    /* Fallback discovery. If the workbook index or its relationships are
       missing, damaged, or point at parts that are not in the package, the
       data is usually still there — every worksheet is its own part. Rather
       than reporting an empty workbook, find the worksheet parts directly and
       read them in file order. A sheet with a generic name is far better than
       no sheet at all. */
    const partNames = Object.keys(z).filter(n => /^xl\/worksheets\/[^\/]+\.xml$/i.test(n));
    const resolved = sheets.filter(sh => z[sh.path]);
    if (!resolved.length && partNames.length) {
      partNames.sort((a, b) => {
        const na = +(a.match(/(\d+)\.xml$/) || [0, 0])[1], nb = +(b.match(/(\d+)\.xml$/) || [0, 0])[1];
        return na - nb;
      });
      sheets.length = 0;
      partNames.forEach((p, i) => sheets.push({ name: "Sheet " + (i + 1), path: p, recovered: true }));
    }

    const out = [];
    for (const sh of sheets) {
      /* One unreadable sheet must not lose the other sixteen. */
      let xml = "";
      try { xml = await ZipRead.text(z[sh.path]); }
      catch (e) { out.push({ name: sh.name, rows: [], error: e.message }); continue; }
      if (!xml) { out.push({ name: sh.name, rows: [] }); continue; }
      const rows = [];
      xml.replace(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*r="(\d+)"[^>]*\/>/g, (m, rn, body) => {
        const arr = [];
        (body || "").replace(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g, (mm, attrsSelf, attrsOpen, innerRaw) => {
          const attrs = attrsSelf !== undefined ? attrsSelf : attrsOpen;
          const inner = attrsSelf !== undefined ? undefined : innerRaw;
          const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || "";
          const t = (attrs.match(/t="([^"]+)"/) || [])[1] || "";
          const s = +((attrs.match(/s="(\d+)"/) || [])[1] || -1);
          let v = "";
          if (t === "inlineStr") { (inner || "").replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (a, b) => { v += unesc(b); return ""; }); }
          else {
            const vm = (inner || "").match(/<v>([\s\S]*?)<\/v>/);
            v = vm ? unesc(vm[1]) : "";
            if (t === "s") v = shared[+v] ?? "";
          }
          if (v !== "" && t !== "s" && t !== "str" && t !== "inlineStr" && s >= 0 && dateStyle[s] && Number.isFinite(+v) && +v > 20000 && +v < 80000) v = serialToISO(+v);
          /* A workbook can carry a stray cell far to the right of the real
             data — Excel leaves them behind after edits. Indexing straight
             from the reference would then pad every row out to that column
             and the padding loop below would run into the millions. Columns
             beyond a sane width are dropped rather than allowed to blow up
             the parse. */
          if (ref) { const ci = colNum(ref); if (ci <= MAX_SHEET_COLS) arr[ci] = v; }
          return "";
        });
        for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = "";
        rows.push(arr);
        return "";
      });
      out.push({ name: sh.name, rows, recovered: !!sh.recovered });
    }
    /* Nothing at all came back, but the package clearly held worksheets.
       Say so precisely rather than letting the caller report "no register". */
    if (partNames.length && out.every(x => !x.rows.length)) {
      const errs = out.filter(x => x.error).map(x => x.error);
      throw new Error("The workbook was opened but no rows could be read from any of its "
        + partNames.length + " sheet(s)."
        + (errs.length ? " " + errs[0] : " Open it in Excel and save a fresh copy, then import that."));
    }
    return out;
  }

  /* Build a real .xlsx from [{name, rows:[[...]], widths:[..]}] */
  async function write(sheets) {
    const strings = [], smap = new Map();
    const sidx = s => { if (smap.has(s)) return smap.get(s); const i = strings.length; strings.push(s); smap.set(s, i); return i; };
    const sheetXml = sh => {
      const cols = sh.widths ? `<cols>${sh.widths.map((w, i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
      const body = sh.rows.map((row, r) => {
        const cells = row.map((v, c) => {
          const ref = colName(c) + (r + 1);
          const head = r === 0 || (sh.headRows || 0) > r;
          const st = head ? ' s="1"' : (typeof v === "number" ? ' s="2"' : "");
          if (v === null || v === undefined || v === "") return `<c r="${ref}"${st}/>`;
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
          return `<c r="${ref}" t="s"${st}><v>${sidx(String(v))}</v></c>`;
        }).join("");
        return `<row r="${r + 1}">${cells}</row>`;
      }).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr/></sheetPr>${cols}<sheetData>${body}</sheetData></worksheet>`;
    };
    const bodies = sheets.map(sheetXml);
    const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t xml:space="preserve">${xesc(s)}</t></si>`).join("")}</sst>`;
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xesc(s.name.slice(0, 31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${sheets.length+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F3D2E"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>` },
      { name: "xl/sharedStrings.xml", data: sst },
      ...bodies.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b }))
    ];
    return ZipWrite.build(files);
  }
  return { read, write };
})();

/* ------------------------------------------------------------------- CSV */
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { cell += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === "," && !q) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !q) {
      if (cell !== "" || row.length) { row.push(cell); rows.push(row); row = []; cell = ""; }
      if (c === "\r" && n === "\n") i++;
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------- OPFS storage vault */
const Vault = (() => {
  let root = null, ok = false, reason = "not initialised";
  async function init() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) { reason = "This browser has no Origin Private File System. Data is kept in memory for this session only."; return false; }
      const dir = await navigator.storage.getDirectory();
      root = await dir.getDirectoryHandle(APP.root, { create: true });
      for (const p of ["config", "imports", "parsed", "loanbook", "reports", "exports", "audit", "backups", "temp"]) {
        await root.getDirectoryHandle(p, { create: true });
      }
      ok = true; reason = "ready"; return true;
    } catch (e) { reason = e.message; return false; }
  }
  async function estimate() {
    try {
      const e = await navigator.storage.estimate();
      const quota = e.quota || 0, usage = e.usage || 0;
      return { quota, usage, available: quota - usage };
    } catch (e) { return { quota: 0, usage: 0, available: 0 }; }
  }
  async function persist() { try { return await navigator.storage.persist(); } catch (e) { return false; } }
  async function persisted() { try { return await navigator.storage.persisted(); } catch (e) { return false; } }
  async function put(path, text) {
    if (!ok) return false;
    const parts = path.split("/"); const file = parts.pop();
    let d = root; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(file, { create: true });
    const w = await fh.createWritable(); await w.write(text); await w.close();
    return true;
  }
  async function get(path) {
    if (!ok) return null;
    try {
      const parts = path.split("/"); const file = parts.pop();
      let d = root; for (const p of parts) d = await d.getDirectoryHandle(p);
      const fh = await d.getFileHandle(file); return await (await fh.getFile()).text();
    } catch (e) { return null; }
  }
  async function list(prefix) {
    if (!ok) return [];
    const out = [];
    async function walk(dir, path) {
      for await (const [name, handle] of dir.entries()) {
        const p = path ? path + "/" + name : name;
        if (handle.kind === "directory") await walk(handle, p);
        else { const f = await handle.getFile(); out.push({ path: p, size: f.size, modified: new Date(f.lastModified).toISOString().slice(0, 16).replace("T", " ") }); }
      }
    }
    try { await walk(root, ""); } catch (e) {}
    return prefix ? out.filter(f => f.path.startsWith(prefix)) : out;
  }
  async function purge() {
    if (!ok) return false;
    const dir = await navigator.storage.getDirectory();
    try { await dir.removeEntry(APP.root, { recursive: true }); } catch (e) {}
    return await init();
  }
  return { init, estimate, persist, persisted, put, get, list, purge,
           get ready() { return ok; }, get reason() { return reason; } };
})();

/* ---------------------------------------------------- encryption at rest */
const Crypt = (() => {
  let key = null, on = false;
  const b64 = u => btoa(String.fromCharCode.apply(null, Array.from(u)));
  const un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pass, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function enable(pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pass, salt); on = true;
    try { localStorage.setItem("rbcci-lpmrs-salt", b64(salt)); } catch (e) {}
    return true;
  }
  async function unlock(pass) {
    let raw = null; try { raw = localStorage.getItem("rbcci-lpmrs-salt"); } catch (e) {}
    if (!raw) return false;
    key = await derive(pass, un(raw)); on = true; return true;
  }
  function disable() { key = null; on = false; try { localStorage.removeItem("rbcci-lpmrs-salt"); } catch (e) {} }
  async function encrypt(text) {
    if (!on || !key) return text;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    return "ENC1:" + b64(iv) + ":" + b64(new Uint8Array(ct));
  }
  async function decrypt(text) {
    if (!String(text).startsWith("ENC1:")) return text;
    if (!on || !key) throw new Error("locked");
    const parts = String(text).split(":");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: un(parts[1]) }, key, un(parts[2]));
    return new TextDecoder().decode(pt);
  }
  return { enable, unlock, disable, encrypt, decrypt,
    get on() { return on; },
    get configured() { try { return !!localStorage.getItem("rbcci-lpmrs-salt"); } catch (e) { return false; } } };
})();
