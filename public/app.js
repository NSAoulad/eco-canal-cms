const sheetInput = document.querySelector("#sheet-url");
const fetchButton = document.querySelector("#fetch");
const syncButton = document.querySelector("#sync");
const exportButton = document.querySelector("#export");
const hint = document.querySelector("#hint");
const errorBox = document.querySelector("#error");
const phases = document.querySelector("#phases");
const toolbar = document.querySelector("#toolbar");
const tableWrap = document.querySelector("#table-wrap");
const tbody = document.querySelector("#rows");
const countrySelect = document.querySelector("#country");
const searchInput = document.querySelector("#search");

let result = null;
let gmailStatus = null;
let activeCountry = "all";
let activePhase = "all";
let searchText = "";

function setError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message || "";
}

function fillCountries() {
  const previous = activeCountry;
  countrySelect.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = `All tabs (${result.counts.tabs})`;
  countrySelect.appendChild(all);
  for (const country of result.countries) {
    const option = document.createElement("option");
    const count = result.rows.filter((row) => row.country === country).length;
    option.value = country;
    option.textContent = `${country} (${count})`;
    countrySelect.appendChild(option);
  }
  activeCountry = [...countrySelect.options].some((option) => option.value === previous) ? previous : "all";
  countrySelect.value = activeCountry;
}

function portalHref(value) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

function linkLabel(href) {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return host.length > 26 ? `${host.slice(0, 24)}…` : host;
  } catch {
    return "Link";
  }
}

function canOpenThread(row) {
  return (row.sent || 0) > 0 || (row.replied || 0) > 0;
}

function rowLinks(row) {
  const seen = new Set();
  const links = [];
  const add = (value) => {
    const href = portalHref(value);
    if (!href) return;
    const key = href.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ href, label: linkLabel(href) });
  };
  for (const link of row.emailLinks || []) add(link);
  add(row.careerPortal);
  return links.slice(0, 3);
}

function visibleRows() {
  const query = searchText.trim().toLowerCase();
  return result.rows.filter((row) => {
    const countryOk = activeCountry === "all" || row.country === activeCountry;
    const phaseOk = activePhase === "all" || row.phase === activePhase;
    const searchOk = !query || `${row.university} ${row.email} ${row.replyFrom}`.toLowerCase().includes(query);
    return countryOk && phaseOk && searchOk;
  });
}

function render() {
  const rows = visibleRows();
  const counts = result.counts;
  document.querySelector("#phase-all").textContent = String(counts.total);
  document.querySelector("#phase-not-contacted").textContent = String(counts.notContacted);
  document.querySelector("#phase-contacted-none").textContent = String(counts.contactedNone);
  document.querySelector("#phase-followed-none").textContent = String(counts.followedNone);
  document.querySelector("#phase-contacted-replied").textContent = String(counts.contactedReplied);
  document.querySelector("#phase-conversation").textContent = String(counts.conversation);
  document.querySelector("#phase-conversation-waiting").textContent = String(counts.conversationWaiting);
  document.querySelector("#phase-auto").textContent = String(counts.auto);
  document.querySelector("#phase-bounced").textContent = String(counts.bounced);
  phases.hidden = false;
  toolbar.hidden = false;
  tableWrap.hidden = false;
  exportButton.disabled = false;
  document.querySelector("#showing").textContent = `${rows.length} shown · ${counts.tabs} tabs`;
  const checked = result.checkedAt ? new Date(result.checkedAt) : null;
  const checkedLabel = checked && !Number.isNaN(checked.getTime())
    ? checked.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : result.checkedAt || "";
  const source = String(result.checkedAt || "").includes("T")
    ? `Gmail synced ${checkedLabel}.`
    : `Mailbox snapshot ${checkedLabel}. Use Sync Gmail to refresh it.`;
  hint.textContent = `${source} Replied means they wrote back at least once. We sent and They sent are the emails in that thread. Click a university to read it here.`;
  tbody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td class="university"></td>
        <td></td>
        <td></td>
        <td><span class="phase-pill"></span></td>
        <td><span class="yesno"></span></td>
        <td class="num"><span class="count-pill"></span></td>
        <td class="num"><span class="count-pill"></span></td>
        <td></td>
        <td></td>
        <td class="summary"></td>
      `;
      const cells = tr.children;
      cells[0].textContent = row.country;
      if (canOpenThread(row)) {
        const thread = document.createElement("button");
        thread.type = "button";
        thread.className = "university-link";
        thread.textContent = row.university;
        thread.title = "Read the email thread";
        thread.addEventListener("click", () => openThread(row));
        cells[1].appendChild(thread);
      } else {
        cells[1].textContent = row.university;
      }
      for (const link of rowLinks(row)) {
        const portal = document.createElement("a");
        portal.className = "portal";
        portal.href = link.href;
        portal.target = "_blank";
        portal.rel = "noopener noreferrer";
        portal.textContent = link.label;
        portal.title = link.href;
        cells[2].appendChild(portal);
      }
      cells[3].textContent = row.email;
      const phase = cells[4].querySelector("span");
      phase.textContent = row.phaseLabel;
      phase.classList.add(row.phase);
      const replied = cells[5].querySelector("span");
      replied.textContent = row.theyReplied ? "Yes" : "No";
      replied.classList.add(row.theyReplied ? "yesno-yes" : "yesno-no");
      cells[6].querySelector("span").textContent = String(row.sent);
      cells[7].querySelector("span").textContent = String(row.replied);
      cells[8].textContent = row.replyFrom;
      cells[9].textContent = row.replyDate;
      cells[10].textContent = row.summary;
      cells[10].title = row.summary;
      return tr;
    })
  );
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = "Nothing matches this phase.";
    tr.appendChild(td);
    tbody.replaceChildren(tr);
  }
}

async function fetchEmails() {
  setError("");
  fetchButton.disabled = true;
  fetchButton.textContent = "Fetching…";
  try {
    const response = await fetch("/api/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetUrl: sheetInput.value.trim() }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not fetch the sheet.");
    result = body;
    fillCountries();
    render();
    renderFollowup();
  } catch (error) {
    setError(error.message);
  } finally {
    fetchButton.disabled = false;
    fetchButton.textContent = "Fetch emails";
  }
}

const SYNC_KEY = "eco-gmail-sync";

function syncLabel() {
  if (gmailStatus?.configured && !gmailStatus.connected) return "Connect Gmail";
  return "Sync Gmail";
}

function readSyncCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_KEY) || "null");
    if (!saved || !saved.historyId || !Array.isArray(saved.threads)) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeSyncCache(historyId, threads) {
  if (!historyId) return;
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ historyId, threads }));
  } catch {
    localStorage.removeItem(SYNC_KEY);
  }
}

function applyThreadUpdates(existing, updates) {
  const byId = new Map(existing.map((thread) => [thread.id, thread]));
  for (const thread of updates || []) {
    if (!thread || !thread.id) continue;
    if (thread.removed) byId.delete(thread.id);
    else byId.set(thread.id, thread);
  }
  return [...byId.values()];
}

async function pullThreads(ids) {
  let offset = 0;
  let knownIds = ids;
  let historyId = "";
  const threads = [];
  let total = ids ? ids.length : 0;
  while (true) {
    const started = Date.now();
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, ids: knownIds }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not sync Gmail.");
    if (!knownIds) knownIds = body.ids;
    if (body.historyId) historyId = body.historyId;
    total = body.total || total;
    threads.push(...(body.threads || []));
    offset = body.next;
    syncButton.textContent = `Syncing Gmail… ${Math.min(offset, total)} of ${total}`;
    if (body.retryAfter) {
      syncButton.textContent = `Gmail limit reached. Waiting ${body.retryAfter}s…`;
      await new Promise((resolve) => setTimeout(resolve, body.retryAfter * 1000));
      continue;
    }
    if (body.done) break;
    const wait = 5000 - (Date.now() - started);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return { threads, historyId };
}

async function finishSync(threads, historyId, options = {}) {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finish: true, full: Boolean(options.full), threads, historyId, sheetUrl: sheetInput.value.trim() }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not sync Gmail.");
  if (!body.result) throw new Error(body.error || "Gmail synced, but the sheet could not be loaded.");
  writeSyncCache(historyId, threads.filter((thread) => thread && !thread.removed));
  result = body.result;
  fillCountries();
  render();
  renderFollowup();
  await refreshGmailStatus();
}

async function refreshGmailStatus() {
  const response = await fetch("/api/gmail/status");
  gmailStatus = await response.json();
  syncButton.textContent = syncLabel();
}

async function syncGmail() {
  setError("");
  if (gmailStatus?.configured && !gmailStatus.connected) {
    window.location.href = "/api/gmail/auth";
    return;
  }
  syncButton.disabled = true;
  syncButton.textContent = "Syncing Gmail…";
  try {
    const saved = readSyncCache();
    const probe = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incremental: true }),
    });
    const mode = await probe.json();
    if (!probe.ok) throw new Error(mode.error || "Could not sync Gmail.");
    if (mode.historyId && !mode.catchup && !mode.expired) {
      syncButton.textContent = "Checking for new mail…";
      const updates = mode.ids?.length ? await pullThreads(mode.ids) : { threads: [] };
      const threads = applyThreadUpdates(saved?.threads || [], updates.threads);
      syncButton.textContent = mode.ids?.length ? `Saving ${mode.ids.length} new threads…` : "No new mail";
      await finishSync(threads, mode.historyId);
      return;
    }
    if (saved && !mode.catchup) {
      syncButton.textContent = "Checking for new mail…";
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId: saved.historyId }),
      });
      const changes = await response.json();
      if (!response.ok) throw new Error(changes.error || "Could not sync Gmail.");
      if (!changes.expired) {
        const updates = changes.ids?.length ? await pullThreads(changes.ids) : { threads: [] };
        const threads = applyThreadUpdates(saved.threads, updates.threads);
        syncButton.textContent = changes.ids?.length ? `Saving ${changes.ids.length} new threads…` : "No new mail";
        await finishSync(threads, changes.historyId);
        return;
      }
    }
    syncButton.textContent = "Checking for new mail…";
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catchup: true }),
    });
    const recent = await response.json();
    if (!response.ok) throw new Error(recent.error || "Could not sync Gmail.");
    const updates = recent.ids?.length ? await pullThreads(recent.ids) : { threads: [] };
    syncButton.textContent = recent.ids?.length ? `Saving ${recent.ids.length} new threads…` : "No new mail";
    await finishSync(updates.threads, recent.historyId);
  } catch (error) {
    setError(error.message);
  } finally {
    syncButton.disabled = false;
    syncButton.textContent = syncLabel();
  }
}

async function downloadExcel() {
  if (!result) return;
  setError("");
  exportButton.disabled = true;
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "Could not build the Excel file.");
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "university-email-replies.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    setError(error.message);
  } finally {
    exportButton.disabled = false;
  }
}

phases.addEventListener("click", (event) => {
  const button = event.target.closest("[data-phase]");
  if (!button || !result) return;
  activePhase = button.dataset.phase;
  for (const item of phases.querySelectorAll(".phase")) {
    item.classList.toggle("is-active", item === button);
  }
  render();
});

countrySelect.addEventListener("change", () => {
  activeCountry = countrySelect.value;
  if (result) render();
});

searchInput.addEventListener("input", () => {
  searchText = searchInput.value;
  if (result) render();
});

const followup = document.querySelector("#followup");
const followupCount = document.querySelector("#followup-count");
const followupSubject = document.querySelector("#followup-subject");
const followupBody = document.querySelector("#followup-body");
const followupPreview = document.querySelector("#followup-preview");
const followupDrafts = document.querySelector("#followup-drafts");
const followupStatus = document.querySelector("#followup-status");
const sendConfirm = document.querySelector("#send-confirm");
const sendConfirmText = document.querySelector("#send-confirm-text");
const previewLabel = document.querySelector("#preview-label");
const audienceContacted = document.querySelector("#aud-contacted");
const audienceFollowed = document.querySelector("#aud-followed");
let previewIndex = 0;

const FOLLOWUP_SUBJECT = "Re: Internship placements in Amsterdam with Eco Boats Amsterdam and Canal Motorboats";
const FOLLOWUP_BODY = `Dear {university},

I hope you are doing well. I wrote earlier about internship placements at Eco Boats Amsterdam and Canal Motorboats for the remainder of 2026 and 2027, and I wanted to follow up in case that note was missed.

We host students in Amsterdam for at least two months. The work mixes marketing, customer communication and time with guests on the canals, and it suits students who want to use their English in a real tourism business.

If you are happy to share this with your students, or if you would rather we post the offer on your career portal, I would be glad to hear how you prefer to do that.

Met vriendelijke groet,
With kind regards,

Cathán Broderick
Marketing & Communications Specialist
Eco Boats Amsterdam
Canal Motorboats
+31 (0) 61 849 9167
cathan@ecoboatsamsterdam.com`;

function domainOf(email) {
  return String(email || "").split("@")[1]?.toLowerCase() || "";
}

function noReplyRows() {
  const answeredDomains = new Set(result.repliedDomains || []);
  for (const row of result.rows) {
    if (row.status === "replied") answeredDomains.add(domainOf(row.email));
  }
  return result.rows.filter((row) => {
    if (row.replied !== 0 || row.status === "auto" || row.status === "bounced") return false;
    if (answeredDomains.has(domainOf(row.email))) return false;
    if (row.phase === "contacted-none") return audienceContacted.checked;
    if (row.phase === "followed-none") return audienceFollowed.checked;
    return false;
  });
}

function fillTemplate(template, university) {
  return template.replaceAll("{university}", university || "the university");
}

function renderFollowup() {
  const rows = noReplyRows();
  followup.hidden = false;
  if (!followupSubject.value) followupSubject.value = FOLLOWUP_SUBJECT;
  if (!followupBody.value) followupBody.value = FOLLOWUP_BODY;
  if (previewIndex >= rows.length) previewIndex = 0;
  const contacted = rows.filter((row) => row.phase === "contacted-none").length;
  const followed = rows.filter((row) => row.phase === "followed-none").length;
  followupCount.textContent = rows.length
    ? `${rows.length} separate emails. ${contacted} were contacted with no reply, and ${followed} were followed up with no reply. {university} is filled in for each one.`
    : "No addresses selected.";
  const sample = rows[previewIndex];
  previewLabel.textContent = sample ? `${previewIndex + 1} of ${rows.length} · ${sample.university}` : "No recipient";
  followupPreview.textContent = sample
    ? `To: ${sample.email}\nSubject: ${fillTemplate(followupSubject.value, sample.university)}\n\n${fillTemplate(followupBody.value, sample.university)}`
    : "Choose contacted or followed up.";
}

function insertUniversity() {
  const token = "{university}";
  const start = followupBody.selectionStart ?? followupBody.value.length;
  const end = followupBody.selectionEnd ?? start;
  followupBody.value = `${followupBody.value.slice(0, start)}${token}${followupBody.value.slice(end)}`;
  const cursor = start + token.length;
  followupBody.focus();
  followupBody.setSelectionRange(cursor, cursor);
  renderFollowup();
}

function askForDrafts() {
  const rows = noReplyRows();
  if (!rows.length) {
    followupStatus.textContent = "Select at least one group.";
    return;
  }
  const sample = rows[previewIndex] || rows[0];
  sendConfirm.hidden = false;
  sendConfirmText.textContent = `Create ${rows.length} drafts in marketing@ecoboatsamsterdam.com. The first one starts “Dear ${sample.university}”. Nothing is sent until you send them from Gmail.`;
}

async function createDrafts() {
  const rows = noReplyRows();
  sendConfirm.hidden = true;
  followupDrafts.disabled = true;
  if (gmailStatus?.configured && !gmailStatus.connected) {
    window.location.href = "/api/gmail/auth";
    return;
  }
  followupStatus.textContent = `Creating ${rows.length} Gmail drafts…`;
  try {
    const messages = rows.map((row) => ({
      to: row.email,
      subject: fillTemplate(followupSubject.value, row.university),
      body: fillTemplate(followupBody.value, row.university),
    }));
    let created = 0;
    for (let index = 0; index < messages.length; ) {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.slice(index, index + 10) }),
      });
      const body = await response.json();
      if (body.reconnect) {
        window.location.href = "/api/gmail/auth";
        return;
      }
      if (!response.ok) throw new Error(body.error || "Could not create the Gmail drafts.");
      created += body.created || 0;
      index += body.created || 0;
      if (body.retryAfter) {
        followupStatus.textContent = `Gmail limit reached. Waiting ${body.retryAfter}s…`;
        await new Promise((resolve) => setTimeout(resolve, body.retryAfter * 1000));
        continue;
      }
      followupStatus.textContent = `Creating Gmail drafts… ${created} of ${messages.length}`;
      if (!body.created) throw new Error("Gmail did not create a draft.");
    }
    followupStatus.textContent = `Created ${created} drafts in marketing@ecoboatsamsterdam.com. Open Gmail drafts to send them.`;
  } catch (error) {
    followupStatus.textContent = error.message;
  } finally {
    followupDrafts.disabled = false;
  }
}

const threadDialog = document.querySelector("#thread");
const threadTitle = document.querySelector("#thread-title");
const threadMeta = document.querySelector("#thread-meta");
const threadStatus = document.querySelector("#thread-status");
const threadMessages = document.querySelector("#thread-messages");
let threadRequest = 0;

function messageWhen(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function renderThread(messages) {
  threadMessages.replaceChildren();
  if (!messages.length) {
    threadStatus.textContent = "No emails with this address were found in the mailbox.";
    return;
  }
  threadStatus.textContent = "";
  let subject = "";
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = `thread-message ${message.fromUs ? "us" : "them"}`;
    const header = document.createElement("header");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = message.fromUs ? "Us" : message.from || "Them";
    const when = document.createElement("time");
    when.textContent = messageWhen(message.at);
    header.append(who, when);
    article.appendChild(header);
    if (message.subject && message.subject !== subject) {
      const title = document.createElement("p");
      title.className = "subject";
      title.textContent = message.subject;
      article.appendChild(title);
      subject = message.subject;
    }
    const body = document.createElement("p");
    body.className = "body";
    body.textContent = message.body || "";
    article.appendChild(body);
    threadMessages.appendChild(article);
  }
}

async function openThread(row) {
  const request = ++threadRequest;
  threadTitle.textContent = row.university || row.email;
  threadMeta.textContent = row.email;
  threadStatus.textContent = "Loading the thread…";
  threadMessages.replaceChildren();
  if (!threadDialog.open) threadDialog.showModal();
  try {
    const response = await fetch(`/api/gmail/thread?email=${encodeURIComponent(row.email)}`);
    const body = await response.json();
    if (request !== threadRequest) return;
    if (!response.ok) throw new Error(body.error || "Could not load the thread.");
    renderThread(body.messages || []);
  } catch (error) {
    if (request !== threadRequest) return;
    threadStatus.textContent = error.message;
  }
}

document.querySelector("#thread-close").addEventListener("click", () => threadDialog.close());
threadDialog.addEventListener("click", (event) => {
  if (event.target === threadDialog) threadDialog.close();
});

document.querySelector(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  const view = button.dataset.view;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab === button);
  }
  document.querySelector("#view-replies").hidden = view !== "replies";
  document.querySelector("#view-bulk").hidden = view !== "bulk";
});

fetchButton.addEventListener("click", fetchEmails);
syncButton.addEventListener("click", syncGmail);
exportButton.addEventListener("click", downloadExcel);
followupSubject.addEventListener("input", () => result && renderFollowup());
followupBody.addEventListener("input", () => result && renderFollowup());
audienceContacted.addEventListener("change", () => result && renderFollowup());
audienceFollowed.addEventListener("change", () => result && renderFollowup());
document.querySelector("#insert-university").addEventListener("click", insertUniversity);
document.querySelector("#preview-prev").addEventListener("click", () => {
  const rows = noReplyRows();
  if (!rows.length) return;
  previewIndex = (previewIndex - 1 + rows.length) % rows.length;
  renderFollowup();
});
document.querySelector("#preview-next").addEventListener("click", () => {
  const rows = noReplyRows();
  if (!rows.length) return;
  previewIndex = (previewIndex + 1) % rows.length;
  renderFollowup();
});
followupDrafts.addEventListener("click", askForDrafts);
document.querySelector("#send-confirm-yes").addEventListener("click", createDrafts);
document.querySelector("#send-confirm-no").addEventListener("click", () => {
  sendConfirm.hidden = true;
});

const justConnected = new URLSearchParams(location.search).get("gmail") === "connected";
if (justConnected) history.replaceState({}, "", "/");

Promise.all([
  fetch("/api/defaults").then((response) => response.json()),
  refreshGmailStatus(),
])
  .then(([body]) => {
    sheetInput.value = body.sheetUrl;
    return justConnected ? syncGmail() : fetchEmails();
  })
  .catch((error) => setError(error.message));
