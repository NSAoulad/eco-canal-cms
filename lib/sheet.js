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

function conversationFor(status, counts) {
  const sent = counts?.sent || 0;
  let replied = counts?.replied || 0;
  if (status === "auto" || status === "bounced") replied = 0;
  else if (status === "replied" && replied === 0) replied = 1;
  if (status === "bounced") {
    return { sent, replied, conversationKey: "bounced", conversation: sent ? `Bounced · sent ${sent}` : "Bounced" };
  }
  if (status === "auto") {
    return { sent, replied, conversationKey: "auto", conversation: sent ? `Auto-reply · sent ${sent}` : "Auto-reply" };
  }
  if (replied <= 0) {
    return {
      sent,
      replied: 0,
      conversationKey: `none-${sent}`,
      conversation: sent ? `No reply ${sent}` : "No reply",
    };
  }
  return {
    sent,
    replied,
    conversationKey: `replied-${replied}`,
    conversation: `Sent ${sent}, replied ${replied}`,
  };
}

function rowFromRecord(country, record, emailIndex, columns, byEmail, conversations) {
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
    notes: value(columns.notes),
    status,
    statusLabel: STATUS_LABEL[status] || status,
    gereageerd: reply?.gereageerd ? "TRUE" : "FALSE",
    replyFrom: reply?.replyFrom || "",
    replyDate: reply?.replyDate || "",
    summary: reply?.summary || (status === "none" ? "No reply found in Gmail." : ""),
    ...conversationFor(status, conversations[email.toLowerCase()]),
  };
}

function matchWorkbook(buffer, replyFile = loadReplies(), conversations = loadConversations()) {
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
      const row = rowFromRecord(country, record, emailIndex, columns, byEmail, conversations);
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
      none1: rows.filter((row) => row.conversationKey === "none-1").length,
      none2: rows.filter((row) => row.conversationKey === "none-2").length,
      none3: rows.filter((row) => row.conversationKey === "none-3").length,
      replied1: rows.filter((row) => row.conversationKey === "replied-1").length,
      replied2: rows.filter((row) => row.conversationKey === "replied-2").length,
      replied3: rows.filter((row) => row.conversationKey === "replied-3").length,
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
    "Sheet notes": row.notes,
    "Gmail status": row.statusLabel,
    "Emails sent": row.sent,
    "Their replies": row.replied,
    Conversation: row.conversation,
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
  matchWorkbook,
  workbookRows,
};
