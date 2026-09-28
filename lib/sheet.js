const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1k8Gu5wQEjzP3cwIjNoc1zyYSMn3ZViIlhioNbFw5MXk/edit";

const STATUS_LABEL = {
  replied: "Replied",
  none: "No reply",
  auto: "Auto-reply only",
  bounced: "Bounced",
  not_checked: "Not checked",
};

function spreadsheetId(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Paste a Google Sheet link.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That sheet link is not a valid URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
    throw new Error("Only a docs.google.com spreadsheet link can be fetched.");
  }
  const id = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!id) throw new Error("Could not find a spreadsheet id in that link.");
  return id;
}

function toXlsxUrl(input) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId(input)}/export?format=xlsx`;
}

function headerIndex(headers, pattern) {
  return headers.findIndex((header) => pattern.test(String(header || "")));
}

function loadReplies() {
  const file = path.join(__dirname, "..", "data", "replies.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadConversations() {
  const file = path.join(__dirname, "..", "data", "conversations.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.emails || {};
}

function loadEmailLinks() {
  const file = path.join(__dirname, "..", "data", "email-links.json");
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.byEmail || {};
}

function conversationFor(status, counts, gereageerd) {
  const sent = counts?.sent || 0;
  let replied = counts?.replied || 0;
  if (status === "auto" || status === "bounced") replied = 0;
  else if (status === "replied" && replied === 0) replied = 1;
  const theyReplied = replied > 0;
  const detail = `We sent ${sent} · They sent ${replied}`;
  if (status === "bounced") {
    return { sent, replied, theyReplied: false, phase: "bounced", phaseLabel: "Bounced", detail };
  }
  if (status === "auto") {
    return { sent, replied, theyReplied: false, phase: "auto", phaseLabel: "Auto-reply", detail };
  }
  if (!theyReplied && sent >= 2) {
    return { sent, replied: 0, theyReplied: false, phase: "followed-none", phaseLabel: "Followed up, no reply", detail };
  }
  if (!theyReplied && sent === 1) {
    return { sent, replied: 0, theyReplied: false, phase: "contacted-none", phaseLabel: "Contacted, no reply", detail };
  }
  if (!theyReplied) {
    return { sent, replied: 0, theyReplied: false, phase: "not-contacted", phaseLabel: "Not contacted yet", detail };
  }
  if (sent <= 1) {
    return { sent, replied, theyReplied: true, phase: "contacted-replied", phaseLabel: "Contacted, replied", detail };
  }
  if (gereageerd) {
    return { sent, replied, theyReplied: true, phase: "conversation", phaseLabel: "In conversation", detail };
  }
  return { sent, replied, theyReplied: true, phase: "conversation-waiting", phaseLabel: "In conversation, no reply", detail };
}

function rowFromRecord(country, record, emailIndex, columns, byEmail, conversations, emailLinks) {
  const email = String(record[emailIndex] || "").trim();
  if (!email || !email.includes("@")) return null;
  const reply = byEmail.get(email.toLowerCase());
  const status = reply ? reply.status : "none";
  const value = (index) => (index >= 0 ? String(record[index] || "").trim() : "");
  return {
    country,
    email,
    university: value(columns.university),
    city: value(columns.city),
    interested: value(columns.interested),
    sheetResponded: value(columns.responded),
    careerPortal: value(columns.portal),
    emailLinks: emailLinks[email.toLowerCase()] || [],
    notes: value(columns.notes),
    status,
    statusLabel: STATUS_LABEL[status] || status,
    gereageerd: reply?.gereageerd ? "TRUE" : "FALSE",
    replyFrom: reply?.replyFrom || "",
    replyDate: reply?.replyDate || "",
    summary: reply?.summary || (status === "none" ? "No reply found in Gmail." : ""),
    ...conversationFor(status, conversations[email.toLowerCase()], Boolean(reply?.gereageerd)),
  };
}

function matchWorkbook(buffer, replyFile = loadReplies(), conversations = loadConversations(), emailLinks = loadEmailLinks()) {
  const book = XLSX.read(buffer, { type: "buffer" });
  const byEmail = new Map(replyFile.replies.map((reply) => [reply.email.toLowerCase(), reply]));
  const rows = [];
  const countries = [];

  for (const country of book.SheetNames) {
    const table = XLSX.utils.sheet_to_json(book.Sheets[country], { header: 1, defval: "" });
    if (!table.length) continue;
    const headers = table[0].map((header) => String(header || "").trim());
    const emailIndex = headerIndex(headers, /email\s*contact/i);
    if (emailIndex < 0) continue;
    const columns = {
      university: headerIndex(headers, /university/i),
      city: headerIndex(headers, /^city$/i),
      interested: headerIndex(headers, /interested/i),
      responded: headerIndex(headers, /gereageerd/i),
      portal: headerIndex(headers, /link to career portal/i),
      notes: headerIndex(headers, /^notes$/i),
    };
    const sheetRows = [];
    for (const record of table.slice(1)) {
      const row = rowFromRecord(country, record, emailIndex, columns, byEmail, conversations, emailLinks);
      if (row) sheetRows.push(row);
    }
    if (!sheetRows.length) continue;
    countries.push(country);
    rows.push(...sheetRows);
  }

  if (!rows.length) {
    throw new Error("No Emailcontact column with email addresses was found.");
  }

  return {
    checkedAt: replyFile.checkedAt,
    mailbox: replyFile.mailbox,
    countries,
    repliedDomains: [
      ...new Set(
        replyFile.replies
          .filter((reply) => reply.status === "replied")
          .flatMap((reply) => [reply.email, reply.replyFrom])
          .map((email) => String(email || "").split("@")[1]?.toLowerCase())
          .filter(Boolean)
      ),
    ],
    rows,
    counts: {
      tabs: countries.length,
      total: rows.length,
      replied: rows.filter((row) => row.status === "replied").length,
      gereageerd: rows.filter((row) => row.gereageerd === "TRUE").length,
      none: rows.filter((row) => row.status === "none").length,
      auto: rows.filter((row) => row.status === "auto").length,
      bounced: rows.filter((row) => row.status === "bounced").length,
      notChecked: rows.filter((row) => row.status === "not_checked").length,
      contactedNone: rows.filter((row) => row.phase === "contacted-none").length,
      followedNone: rows.filter((row) => row.phase === "followed-none").length,
      contactedReplied: rows.filter((row) => row.phase === "contacted-replied").length,
      conversation: rows.filter((row) => row.phase === "conversation").length,
      conversationWaiting: rows.filter((row) => row.phase === "conversation-waiting").length,
      notContacted: rows.filter((row) => row.phase === "not-contacted").length,
    },
  };
}

function workbookRows(rows) {
  return rows.map((row) => ({
    Tab: row.country,
    Emailcontact: row.email,
    University: row.university,
    City: row.city,
    "Interested?": row.interested,
    "Gereageerd?": row.gereageerd,
    "Link to career portal": row.careerPortal,
    "Links from email": (row.emailLinks || []).join("\n"),
    "Sheet notes": row.notes,
    Phase: row.phaseLabel,
    "Replied at all": row.theyReplied ? "Yes" : "No",
    "Emails we sent": row.sent,
    "Emails they sent": row.replied,
    "Reply from": row.replyFrom,
    "Reply date": row.replyDate,
    "Reply summary": row.summary,
  }));
}

module.exports = {
  DEFAULT_SHEET_URL,
  STATUS_LABEL,
  toXlsxUrl,
  loadReplies,
  loadConversations,
  loadEmailLinks,
  matchWorkbook,
  workbookRows,
};
