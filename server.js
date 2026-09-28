const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { DEFAULT_SHEET_URL, toXlsxUrl, matchWorkbook, workbookRows } = require("./lib/sheet");

const PORT = Number(process.env.PORT) || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function getBuffer(target, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const host = url.hostname;
    const googleHost =
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com");
    if (url.protocol !== "https:" || !googleHost) {
      reject(new Error("The sheet link redirected away from Google."));
      return;
    }
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("Google Sheets redirected too many times."));
          return;
        }
        resolve(getBuffer(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`Google Sheets returned ${res.statusCode}. Check that the workbook is shared for viewing.`));
          return;
        }
        resolve(buffer);
      });
    });
    req.on("error", reject);
  });
}

async function fetchSheet(sheetUrl) {
  const buffer = await getBuffer(toXlsxUrl(sheetUrl));
  if (buffer.slice(0, 2).toString() !== "PK") {
    throw new Error("Google Sheets did not return the workbook. It may be private.");
  }
  return matchWorkbook(buffer);
}

const COLUMN_WIDTHS = [
  { wch: 8 },
  { wch: 38 },
  { wch: 46 },
  { wch: 16 },
  { wch: 14 },
  { wch: 14 },
  { wch: 42 },
  { wch: 42 },
  { wch: 18 },
  { wch: 14 },
  { wch: 14 },
  { wch: 28 },
  { wch: 36 },
  { wch: 14 },
  { wch: 72 },
];

function buildWorkbook(result) {
  const book = XLSX.utils.book_new();
  const summaryRows = [
    { Metric: "Mailbox", Value: result.mailbox },
    { Metric: "Gmail checked", Value: result.checkedAt },
    { Metric: "Tabs", Value: result.counts.tabs },
    { Metric: "Contacts", Value: result.counts.total },
    { Metric: "Gereageerd", Value: result.counts.gereageerd },
    { Metric: "Replied at some point", Value: result.counts.replied },
    { Metric: "No reply", Value: result.counts.none },
    { Metric: "Auto-reply only", Value: result.counts.auto },
    { Metric: "Bounced", Value: result.counts.bounced },
    { Metric: "Not contacted yet", Value: result.counts.notContacted },
    { Metric: "Contacted, no reply", Value: result.counts.contactedNone },
    { Metric: "Followed up, no reply", Value: result.counts.followedNone },
    { Metric: "Contacted, replied", Value: result.counts.contactedReplied },
    { Metric: "In conversation", Value: result.counts.conversation },
    { Metric: "In conversation, no reply", Value: result.counts.conversationWaiting },
  ];
  for (const country of result.countries || []) {
    const rows = result.rows.filter((row) => row.country === country);
    summaryRows.push({
      Metric: country,
      Value: `${rows.filter((row) => row.gereageerd === "TRUE").length} gereageerd / ${rows.length}`,
    });
  }
  const summary = XLSX.utils.json_to_sheet(summaryRows);
  summary["!cols"] = [{ wch: 20 }, { wch: 48 }];
  XLSX.utils.book_append_sheet(book, summary, "Summary");

  for (const country of result.countries || []) {
    const sheet = XLSX.utils.json_to_sheet(workbookRows(result.rows.filter((row) => row.country === country)));
    sheet["!cols"] = COLUMN_WIDTHS;
    XLSX.utils.book_append_sheet(book, sheet, String(country).slice(0, 31));
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

function serveStatic(req, res) {
  const requestPath = req.url.split("?")[0];
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/defaults") {
      sendJson(res, 200, { sheetUrl: DEFAULT_SHEET_URL });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/fetch") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const result = await fetchSheet(body.sheetUrl || DEFAULT_SHEET_URL);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/export") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.rows || !Array.isArray(body.rows) || !body.counts) {
        sendJson(res, 400, { error: "Fetch the sheet before downloading Excel." });
        return;
      }
      const buffer = buildWorkbook(body);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="university-email-replies.xlsx"',
        "Content-Length": buffer.length,
      });
      res.end(buffer);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/outbox") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) {
        sendJson(res, 400, { error: "There are no emails to save." });
        return;
      }
      const saved = messages
        .filter((message) => message && typeof message.to === "string" && message.to.includes("@"))
        .map((message) => ({
          to: String(message.to).trim(),
          university: String(message.university || "").trim(),
          country: String(message.country || "").trim(),
          subject: String(message.subject || ""),
          body: String(message.body || ""),
        }));
      if (saved.some((message) => message.body.includes("{university}") || message.subject.includes("{university}"))) {
        sendJson(res, 400, { error: "A university name was still missing from one email." });
        return;
      }
      const file = path.join(__dirname, "data", "outbox.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ savedAt: new Date().toISOString(), mailbox: "marketing@ecoboatsamsterdam.com", messages: saved }, null, 2)
      );
      sendJson(res, 200, { saved: saved.length });
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Request failed" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Reply checker listening on http://127.0.0.1:${PORT}`);
});
