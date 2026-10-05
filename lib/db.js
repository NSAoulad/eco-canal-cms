const https = require("https");
const { loadReplies, loadConversations, loadEmailLinks } = require("./sheet");

const MAILBOX = "marketing@ecoboatsamsterdam.com";

function config() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return { url, key };
}

function enabled() {
  return Boolean(config());
}

function rest(method, path, { body, prefer } = {}) {
  const settings = config();
  if (!settings) throw new Error("Supabase is not configured.");
  return new Promise((resolve, reject) => {
    const target = new URL(`/rest/v1/${path}`, settings.url);
    if (target.hostname !== new URL(settings.url).hostname) {
      reject(new Error("Unexpected Supabase host."));
      return;
    }
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = {
      apikey: settings.key,
      Authorization: `Bearer ${settings.key}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    if (payload) headers["Content-Length"] = payload.length;
    const req = https.request(target, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(raw.slice(0, 240) || `Supabase returned ${res.statusCode}`));
          return;
        }
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error("Supabase took too long to respond.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function batches(rows, size, write) {
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
}

async function clear(table) {
  await rest("DELETE", `${table}?email=not.is.null`);
}

async function loadMailbox() {
  if (!enabled()) {
    return {
      replyFile: loadReplies(),
      conversations: loadConversations(),
      emailLinks: loadEmailLinks(),
    };
  }
  const [replies, conversations, links, state] = await Promise.all([
    rest("GET", "replies?select=email,status,reply_from,reply_date,summary,gereageerd,last_message&order=email.asc&limit=5000"),
    rest("GET", "conversations?select=email,sent,replied,last_sent&limit=5000"),
    rest("GET", "email_links?select=email,url&limit=10000"),
    rest("GET", "gmail_state?id=eq.1&select=history_id,checked_at,mailbox"),
  ]);
  const replyRows = replies || [];
  if (!replyRows.length && !(conversations || []).length) {
    return {
      replyFile: loadReplies(),
      conversations: loadConversations(),
      emailLinks: loadEmailLinks(),
    };
  }
  const saved = (state || [])[0] || {};
  const byEmail = {};
  for (const link of links || []) {
    if (!byEmail[link.email]) byEmail[link.email] = [];
    byEmail[link.email].push(link.url);
  }
  const counts = {};
  for (const row of conversations || []) {
    counts[row.email] = { sent: row.sent, replied: row.replied, lastSent: row.last_sent || "" };
  }
  return {
    replyFile: {
      checkedAt: saved.checked_at || "",
      mailbox: saved.mailbox || MAILBOX,
      replies: replyRows.map((row) => ({
        email: row.email,
        status: row.status,
        replyFrom: row.reply_from || "",
        replyDate: row.reply_date || "",
        summary: row.summary || "",
        gereageerd: Boolean(row.gereageerd),
        lastMessage: row.last_message || undefined,
      })),
    },
    conversations: counts,
    emailLinks: byEmail,
  };
}

async function saveMailbox(mailbox, historyId, threadsComplete = false) {
  const replies = [];
  const seenReplies = new Set();
  for (const reply of mailbox.replyFile?.replies || []) {
    const email = String(reply.email || "").toLowerCase();
    if (!email || seenReplies.has(email)) continue;
    seenReplies.add(email);
    replies.push({
      email,
      status: reply.status || "none",
      reply_from: reply.replyFrom || "",
      reply_date: reply.replyDate || "",
      summary: reply.summary || "",
      gereageerd: Boolean(reply.gereageerd),
      last_message: reply.lastMessage || null,
    });
  }
  const conversationRows = [];
  const seenConversations = new Set();
  for (const [email, counts] of Object.entries(mailbox.conversations || {})) {
    const key = String(email).toLowerCase();
    if (!key || seenConversations.has(key)) continue;
    seenConversations.add(key);
    conversationRows.push({
      email: key,
      sent: counts.sent || 0,
      replied: counts.replied || 0,
      last_sent: counts.lastSent || "",
    });
  }
  const linkRows = [];
  const seenLinks = new Set();
  for (const [email, urls] of Object.entries(mailbox.emailLinks || {})) {
    for (const url of urls || []) {
      const row = { email: String(email).toLowerCase(), url };
      const key = `${row.email}\n${row.url}`;
      if (!row.email || !row.url || seenLinks.has(key)) continue;
      seenLinks.add(key);
      linkRows.push(row);
    }
  }
  await clear("replies");
  await clear("conversations");
  await clear("email_links");
  await batches(replies, 200, (rows) => rest("POST", "replies", { body: rows, prefer: "return=minimal" }));
  await batches(conversationRows, 200, (rows) => rest("POST", "conversations", { body: rows, prefer: "return=minimal" }));
  await batches(linkRows, 200, (rows) => rest("POST", "email_links", { body: rows, prefer: "return=minimal" }));
  await rest("POST", "gmail_state", {
    body: {
      id: 1,
      history_id: historyId ? String(historyId) : null,
      checked_at: mailbox.checkedAt || new Date().toISOString(),
      mailbox: MAILBOX,
      threads_complete: Boolean(threadsComplete),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function getState() {
  if (!enabled()) return null;
  const rows = await rest("GET", "gmail_state?id=eq.1&select=history_id,checked_at,mailbox,threads_complete");
  return (rows || [])[0] || null;
}

async function saveState(historyId, checkedAt) {
  const current = await getState();
  await rest("POST", "gmail_state", {
    body: {
      id: 1,
      history_id: historyId ? String(historyId) : current?.history_id || null,
      checked_at: checkedAt || current?.checked_at || new Date().toISOString(),
      mailbox: MAILBOX,
      threads_complete: Boolean(current?.threads_complete),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function upsertThreads(threads) {
  const rows = (threads || [])
    .filter((thread) => thread && thread.id && !thread.removed)
    .map((thread) => ({ id: thread.id, payload: thread, updated_at: new Date().toISOString() }));
  await batches(rows, 100, (part) => rest("POST", "gmail_threads", { body: part, prefer: "resolution=merge-duplicates,return=minimal" }));
}

async function deleteThreads(ids) {
  const list = (ids || []).filter(Boolean);
  for (const id of list) {
    await rest("DELETE", `gmail_threads?id=eq.${encodeURIComponent(id)}`);
  }
}

async function listThreads() {
  const threads = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await rest("GET", `gmail_threads?select=payload&order=id.asc&limit=1000&offset=${offset}`);
    const page = rows || [];
    for (const row of page) {
      if (row.payload) threads.push(row.payload);
    }
    if (page.length < 1000) break;
  }
  return threads;
}

async function applyLastSent(dates) {
  const rows = await rest("GET", "conversations?select=email,sent,replied,last_sent&limit=5000");
  const updates = [];
  for (const row of rows || []) {
    const lastSent = dates[String(row.email || "").toLowerCase()];
    if (!lastSent || lastSent === row.last_sent) continue;
    updates.push({ email: row.email, sent: row.sent || 0, replied: row.replied || 0, last_sent: lastSent });
  }
  await batches(updates, 200, (part) => rest("POST", "conversations", { body: part, prefer: "resolution=merge-duplicates,return=minimal" }));
  return updates.length;
}

async function saveOutbox(messages) {
  await rest("DELETE", "outbox?id=gt.0");
  const rows = messages.map((message) => ({
    to_email: message.to,
    university: message.university || "",
    country: message.country || "",
    subject: message.subject || "",
    body: message.body || "",
  }));
  await batches(rows, 200, (part) => rest("POST", "outbox", { body: part, prefer: "return=minimal" }));
}

module.exports = {
  applyLastSent,
  deleteThreads,
  enabled,
  getState,
  listThreads,
  loadMailbox,
  saveMailbox,
  saveOutbox,
  saveState,
  upsertThreads,
};
