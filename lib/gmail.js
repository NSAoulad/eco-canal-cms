const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { loadReplies, loadConversations, loadEmailLinks } = require("./sheet");

const MAILBOX = "marketing@ecoboatsamsterdam.com";
const DATA_DIR = path.join(__dirname, "..", "data");

function decode(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function address(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function isUs(email) {
  return email.toLowerCase() === MAILBOX;
}

function isIgnoredSender(email) {
  return /(?:^|[.+])(?:no-?reply|notifications|mailer-daemon|postmaster)@/i.test(email);
}

function messageTime(msg) {
  const parsed = Date.parse(msg.date || "");
  if (!Number.isNaN(parsed)) return parsed;
  const internal = Number(msg.internalDate);
  return Number.isNaN(internal) ? 0 : internal;
}

function isBounce(msg) {
  const from = address(msg.sender).toLowerCase();
  const text = `${msg.subject || ""} ${decode(msg.snippet)}`;
  return (
    /mailer-daemon|postmaster@/.test(from) ||
    /delivery status notification|undeliverable|delivery failed|address not found|wasn.t delivered|was not delivered/i.test(text)
  );
}

function isAuto(msg) {
  const text = `${msg.subject || ""} ${decode(msg.snippet)}`;
  return (
    /\b(out of office|out-of-office|automatic reply|auto-reply|autoreply|automated reply|automated message)\b/i.test(text) ||
    /acknowledgement of receipt|acknowledgment of receipt|eingangsbest[aä]tigung/i.test(text) ||
    /automatische antwort|r[ée]ponse automatique|respuesta autom[aá]tica|risposta automatica|automatisch antwoord|autosvar|afwezigheidsbericht|abwesenheitsnotiz/i.test(text) ||
    /this is an automated|do not reply to this|we are closed during/i.test(text)
  );
}

function urlsIn(text) {
  const found = decode(text).match(/https?:\/\/[^\s<>"']+/gi) || [];
  const urls = [];
  for (const raw of found) {
    const url = raw.replace(/[),.;]+$/, "");
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (/google\.com$|googleusercontent\.com$|gstatic\.com$|schema\.org$|googleapis\.com$/i.test(host)) continue;
    urls.push(url);
  }
  return urls;
}

function buildMailbox(threads, checkedAt) {
  const byEmail = new Map();

  function bucket(email) {
    const key = email.toLowerCase();
    let row = byEmail.get(key);
    if (!row) {
      row = { email: key, sent: 0, replied: 0, events: [], links: new Set() };
      byEmail.set(key, row);
    }
    return row;
  }

  for (const thread of threads) {
    const messages = [...(thread.messages || [])].sort((a, b) => messageTime(a) - messageTime(b));
    const seenMessages = new Set();
    const keys = new Set();
    const events = [];
    const links = new Set();
    let sent = 0;
    let incoming = 0;

    for (const msg of messages) {
      if (msg.id && seenMessages.has(msg.id)) continue;
      if (msg.id) seenMessages.add(msg.id);
      const from = address(msg.sender);
      const fromKey = from.toLowerCase();
      const at = messageTime(msg);
      for (const url of urlsIn(`${msg.snippet || ""} ${msg.subject || ""}`)) links.add(url);

      if (isUs(fromKey)) {
        sent += 1;
        events.push({ kind: "us", at, msg });
        for (const recipient of [...(msg.toRecipients || []), ...(msg.ccRecipients || [])]) {
          const email = address(recipient).toLowerCase();
          if (email && !isUs(email) && !isIgnoredSender(email)) keys.add(email);
        }
      } else if (isBounce(msg)) {
        events.push({ kind: "bounce", at, msg });
      } else if (isAuto(msg)) {
        incoming += 1;
        events.push({ kind: "auto", at, msg });
        if (fromKey && !isIgnoredSender(fromKey)) keys.add(fromKey);
      } else if (fromKey && !isIgnoredSender(fromKey)) {
        incoming += 1;
        events.push({ kind: "them", at, msg });
        keys.add(fromKey);
      }
    }

    if (!keys.size) continue;
    for (const email of keys) {
      const row = bucket(email);
      row.sent += sent;
      row.replied += incoming;
      row.events.push(...events);
      for (const url of links) row.links.add(url);
    }
  }

  let previousLinks = {};
  const linksFile = path.join(DATA_DIR, "email-links.json");
  if (fs.existsSync(linksFile)) {
    previousLinks = JSON.parse(fs.readFileSync(linksFile, "utf8")).byEmail || {};
  }
  for (const [email, links] of Object.entries(previousLinks)) {
    const row = byEmail.get(String(email).toLowerCase());
    if (!row) continue;
    for (const link of links || []) row.links.add(link);
  }

  const replies = [];
  const conversations = {};
  const emailLinks = {};

  for (const row of [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))) {
    if (!row.sent && !row.replied && !row.events.some((event) => event.kind === "bounce")) continue;
    conversations[row.email] = { sent: row.sent, replied: row.replied };
    const ordered = [...row.events].sort((a, b) => a.at - b.at);
    const humans = ordered.filter((event) => event.kind === "them");
    const autos = ordered.filter((event) => event.kind === "auto");
    const bounces = ordered.filter((event) => event.kind === "bounce");
    const spoken = ordered.filter((event) => event.kind !== "bounce");
    const last = spoken[spoken.length - 1];
    let status = "";
    let chosen = null;
    if (humans.length) {
      status = "replied";
      chosen = humans[humans.length - 1];
    } else if (autos.length) {
      status = "auto";
      chosen = autos[autos.length - 1];
    } else if (bounces.length) {
      status = "bounced";
      chosen = bounces[bounces.length - 1];
    }
    if (status) {
      const summary =
        status === "bounced"
          ? "Delivery failed. The address rejected the message or could not be found."
          : decode(chosen.msg.snippet).slice(0, 280);
      const reply = {
        email: row.email,
        status,
        replyFrom: status === "bounced" ? "" : address(chosen.msg.sender),
        replyDate: new Date(chosen.at).toISOString().slice(0, 10),
        summary,
        gereageerd: Boolean(last && last.kind === "them"),
      };
      if (last) reply.lastMessage = last.kind === "us" ? "us" : last.kind === "auto" ? "auto" : "them";
      replies.push(reply);
    }
    if (row.links.size) emailLinks[row.email] = [...row.links];
  }

  return {
    checkedAt,
    replyFile: { checkedAt, mailbox: MAILBOX, replies },
    conversations,
    emailLinks,
    threadCount: threads.length,
  };
}

const TOKEN_FILE = path.join(DATA_DIR, "gmail-token.json");
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
let accessCache = { token: "", expiresAt: 0 };

function writeMailbox(mailbox) {
  const checkedAt = mailbox.checkedAt;
  fs.writeFileSync(
    path.join(DATA_DIR, "replies.json"),
    JSON.stringify({ checkedAt, mailbox: MAILBOX, replies: mailbox.replyFile.replies }, null, 2)
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "conversations.json"),
    JSON.stringify(
      {
        countedAt: checkedAt,
        mailbox: MAILBOX,
        threads: mailbox.threadCount,
        emails: mailbox.conversations,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "email-links.json"),
    JSON.stringify({ collectedAt: checkedAt, mailbox: MAILBOX, byEmail: mailbox.emailLinks }, null, 2)
  );
}

function clientConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
}

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function gmailStatus(redirectUri, refreshToken) {
  let checkedAt = "";
  try {
    checkedAt = loadReplies().checkedAt || "";
  } catch {
    checkedAt = "";
  }
  const connected = Boolean(refreshToken || process.env.GMAIL_REFRESH_TOKEN || readToken()?.refresh_token);
  return {
    configured: clientConfigured(),
    connected,
    mailbox: MAILBOX,
    checkedAt,
    redirectUri,
  };
}

function setupError(redirectUri) {
  return `Gmail sync needs a Google OAuth client. Add ${redirectUri} as a redirect URI, put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env, then restart.`;
}

function createAuthState() {
  return crypto.randomBytes(16).toString("hex");
}

function consumeAuthState(state, cookieState) {
  const left = String(state || "");
  const right = String(cookieState || "");
  if (!left || left !== right || left.length < 16) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authUrl(redirectUri, state) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GMAIL_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("login_hint", MAILBOX);
  url.searchParams.set("state", state);
  return url.toString();
}

function requestJson(method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    if (url.protocol !== "https:" || !["gmail.googleapis.com", "oauth2.googleapis.com"].includes(url.hostname)) {
      reject(new Error("Unexpected Google host."));
      return;
    }
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = { error: { message: raw.slice(0, 180) } };
          }
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(payload.error?.message || payload.error_description || `Gmail returned ${res.statusCode}`);
          error.status = res.statusCode;
          reject(error);
          return;
        }
        resolve(payload);
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error("Gmail took too long to respond.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function formBody(fields) {
  return new URLSearchParams(fields).toString();
}

async function exchangeCode(redirectUri, code) {
  const payload = await requestJson("POST", "https://oauth2.googleapis.com/token", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      code,
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const refreshToken = payload.refresh_token || readToken()?.refresh_token;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Remove this app's access in the Google account and connect again.");
  }
  accessCache = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
  };
  const profile = await gmailGet(payload.access_token, "profile");
  if (String(profile.emailAddress || "").toLowerCase() !== MAILBOX) {
    throw new Error(`Connected as ${profile.emailAddress}. Use ${MAILBOX}.`);
  }
  try {
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ refresh_token: refreshToken, email: profile.emailAddress, connectedAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // The Vercel filesystem does not keep this file. The browser cookie does.
  }
  return refreshToken;
}

async function getAccessToken(refreshToken) {
  if (accessCache.token && Date.now() < accessCache.expiresAt - 60000) return accessCache.token;
  const saved = refreshToken || process.env.GMAIL_REFRESH_TOKEN || readToken()?.refresh_token;
  if (!saved) throw new Error("Gmail is not connected.");
  if (!clientConfigured()) throw new Error("GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are missing from .env.");
  const payload = await requestJson("POST", "https://oauth2.googleapis.com/token", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: saved,
      grant_type: "refresh_token",
    }),
  });
  accessCache = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000,
  };
  return accessCache.token;
}

function gmailGet(accessToken, resource, params = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${resource}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value) url.searchParams.set(key, value);
  }
  return requestJson("GET", url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
}

function headerValue(message, name) {
  const headers = message.payload?.headers || [];
  const found = headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
  return found?.value || "";
}

function addressesIn(value) {
  return String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
}

function mapThread(thread) {
  return {
    id: thread.id,
    messages: (thread.messages || []).map((message) => ({
      id: message.id,
      snippet: message.snippet || "",
      subject: headerValue(message, "Subject"),
      sender: headerValue(message, "From"),
      toRecipients: addressesIn(headerValue(message, "To")),
      ccRecipients: addressesIn(headerValue(message, "Cc")),
      date: headerValue(message, "Date"),
      labelIds: message.labelIds || [],
      internalDate: message.internalDate,
    })),
  };
}

async function listThreadIds(accessToken) {
  const ids = [];
  let pageToken = "";
  do {
    const page = await gmailGet(accessToken, "threads", { maxResults: "500", pageToken });
    for (const thread of page.threads || []) ids.push(thread.id);
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return ids;
}

const THREAD_CHUNK = 10;

function isQuotaError(error) {
  return /quota exceeded|rate limit/i.test(String(error && error.message));
}

async function fetchThread(accessToken, id) {
  try {
    const thread = await gmailGet(accessToken, `threads/${encodeURIComponent(id)}`, {
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Subject", "Date"],
    });
    return mapThread(thread);
  } catch (error) {
    if (error.status === 404) return { id, removed: true };
    throw error;
  }
}

async function listChanges(refreshToken, sinceHistoryId) {
  const accessToken = await getAccessToken(refreshToken);
  const threadIds = new Set();
  const startHistoryId = String(sinceHistoryId || "");
  let pageToken = "";
  let historyId = startHistoryId;
  try {
    do {
      const page = await gmailGet(accessToken, "history", {
        startHistoryId,
        pageToken,
        historyTypes: ["messageAdded", "messageDeleted"],
      });
      if (page.historyId) historyId = String(page.historyId);
      for (const record of page.history || []) {
        for (const item of [...(record.messagesAdded || []), ...(record.messagesDeleted || [])]) {
          const threadId = item.message?.threadId;
          if (threadId) threadIds.add(threadId);
        }
      }
      pageToken = page.nextPageToken || "";
    } while (pageToken);
  } catch (error) {
    if (error.status === 404 || error.status === 400) return { expired: true };
    throw error;
  }
  return { expired: false, historyId, ids: [...threadIds] };
}

async function syncChunk(refreshToken, offset, ids) {
  const accessToken = await getAccessToken(refreshToken);
  let threadIds = Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.length < 80) : null;
  let historyId = "";
  if (!threadIds) {
    const profile = await gmailGet(accessToken, "profile");
    if (String(profile.emailAddress || "").toLowerCase() !== MAILBOX) {
      throw new Error(`Connected as ${profile.emailAddress}. Use ${MAILBOX}.`);
    }
    historyId = String(profile.historyId || "");
    threadIds = await listThreadIds(accessToken);
  }
  const start = Math.max(0, Number(offset) || 0);
  const slice = threadIds.slice(start, start + THREAD_CHUNK);
  const threads = [];
  for (const id of slice) {
    try {
      threads.push(await fetchThread(accessToken, id));
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      return {
        ids: threadIds,
        threads,
        next: start + threads.length,
        total: threadIds.length,
        done: false,
        retryAfter: 60,
        historyId,
      };
    }
  }
  const next = start + slice.length;
  return {
    ids: threadIds,
    threads,
    next,
    total: threadIds.length,
    done: next >= threadIds.length,
    historyId,
  };
}

function finishMailbox(threads, historyId) {
  const list = (Array.isArray(threads) ? threads : []).filter((thread) => thread && thread.id && !thread.removed).slice(0, 5000);
  const mailbox = buildMailbox(list, new Date().toISOString());
  try {
    writeMailbox(mailbox);
    if (historyId) {
      fs.writeFileSync(
        path.join(DATA_DIR, "gmail-state.json"),
        JSON.stringify({ historyId: String(historyId), savedAt: mailbox.checkedAt }, null, 2)
      );
    }
  } catch {
    // A read-only host still returns the synced rows in the response.
  }
  return mailbox;
}

function loadMailbox() {
  return {
    replyFile: loadReplies(),
    conversations: loadConversations(),
    emailLinks: loadEmailLinks(),
  };
}

module.exports = {
  MAILBOX,
  authUrl,
  buildMailbox,
  consumeAuthState,
  createAuthState,
  exchangeCode,
  gmailStatus,
  finishMailbox,
  listChanges,
  loadMailbox,
  setupError,
  syncChunk,
};

if (require.main === module) {
  const mailbox = loadMailbox();
  console.log(
    JSON.stringify({
      checkedAt: mailbox.replyFile.checkedAt,
      threads: mailbox.threadCount || 0,
      replies: mailbox.replyFile.replies.length,
      contacts: Object.keys(mailbox.conversations).length,
    })
  );
}
