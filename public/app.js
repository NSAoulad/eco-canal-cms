const sheetInput = document.querySelector("#sheet-url");
const fetchButton = document.querySelector("#fetch");
const exportButton = document.querySelector("#export");
const hint = document.querySelector("#hint");
const errorBox = document.querySelector("#error");
const stats = document.querySelector("#stats");
const filters = document.querySelector("#filters");
const tableWrap = document.querySelector("#table-wrap");
const tbody = document.querySelector("#rows");
const countrySelect = document.querySelector("#country");
const conversations = document.querySelector("#conversations");

let result = null;
let activeFilter = "all";
let activeCountry = "all";
let activeConversation = "all";

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

function render() {
  const rows = result.rows.filter((row) => {
    const countryOk = activeCountry === "all" || row.country === activeCountry;
    const statusOk = activeFilter === "all" || row.status === activeFilter;
    const conversationOk = activeConversation === "all" || row.conversationKey === activeConversation;
    return countryOk && statusOk && conversationOk;
  });
  document.querySelector("#count-total").textContent = String(result.counts.total);
  document.querySelector("#count-replied").textContent = String(result.counts.gereageerd);
  document.querySelector("#count-none").textContent = String(result.counts.none);
  document.querySelector("#count-other").textContent = String(result.counts.auto + result.counts.bounced);
  document.querySelector("#conv-none-1").textContent = String(result.counts.none1);
  document.querySelector("#conv-none-2").textContent = String(result.counts.none2);
  document.querySelector("#conv-none-3").textContent = String(result.counts.none3);
  document.querySelector("#conv-replied-1").textContent = String(result.counts.replied1);
  document.querySelector("#conv-replied-2").textContent = String(result.counts.replied2);
  document.querySelector("#conv-replied-3").textContent = String(result.counts.replied3);
  stats.hidden = false;
  filters.hidden = false;
  conversations.hidden = false;
  tableWrap.hidden = false;
  exportButton.disabled = false;
  hint.textContent = `${result.counts.tabs} tabs, ${result.counts.total} contacts. No reply 1, 2, or 3 is how many emails we sent with no reply from them. Replied 1, 2, or 3 is how many times they wrote back.`;
  tbody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td><span class="status status-${row.status}"></span></td>
        <td><span class="conversation"></span></td>
        <td></td>
        <td></td>
        <td></td>
      `;
      const cells = tr.children;
      cells[0].textContent = row.country;
      cells[1].textContent = row.university;
      cells[2].textContent = row.email;
      cells[3].querySelector("span").textContent = row.statusLabel;
      const conversation = cells[4].querySelector("span");
      conversation.textContent = row.conversation;
      conversation.classList.add(`conversation-${row.conversationKey}`);
      cells[5].textContent = row.replyFrom;
      cells[6].textContent = row.replyDate;
      cells[7].textContent = row.summary;
      return tr;
    })
  );
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "Nothing in this filter.";
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

filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button || !result) return;
  activeFilter = button.dataset.filter;
  for (const item of filters.querySelectorAll(".filter")) {
    item.classList.toggle("is-active", item === button);
  }
  render();
});

countrySelect.addEventListener("change", () => {
  activeCountry = countrySelect.value;
  if (result) render();
});

conversations.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation]");
  if (!button || !result) return;
  activeConversation = button.dataset.conversation;
  for (const item of conversations.querySelectorAll(".filter")) {
    item.classList.toggle("is-active", item === button);
  }
  render();
});

const followup = document.querySelector("#followup");
const followupCount = document.querySelector("#followup-count");
const followupSubject = document.querySelector("#followup-subject");
const followupBody = document.querySelector("#followup-body");
const followupPreview = document.querySelector("#followup-preview");
const followupDownload = document.querySelector("#followup-download");

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
  return result.rows.filter((row) => row.replied === 0 && row.status !== "auto" && row.status !== "bounced" && !answeredDomains.has(domainOf(row.email)));
}

function fillTemplate(template, university) {
  return template.replaceAll("{university}", university || "the university");
}

function renderFollowup() {
  const rows = noReplyRows();
  followup.hidden = false;
  if (!followupSubject.value) followupSubject.value = FOLLOWUP_SUBJECT;
  if (!followupBody.value) followupBody.value = FOLLOWUP_BODY;
  const sentOnce = rows.filter((row) => row.conversationKey === "none-1").length;
  const sentTwice = rows.filter((row) => row.conversationKey === "none-2").length;
  const sentMore = rows.filter((row) => row.sent >= 3).length;
  const waiting = result.rows.filter((row) => row.replied === 0 && row.status !== "auto" && row.status !== "bounced").length;
  const skipped = waiting - rows.length;
  const parts = [`${sentOnce} after 1 email from us`, `${sentTwice} after 2 emails`];
  if (sentMore) parts.push(`${sentMore} after 3 or more`);
  const skippedNote = skipped ? ` ${skipped} skipped because someone at that university already replied.` : "";
  followupCount.textContent = `${rows.length} addresses with no reply: ${parts.join(", ")}.${skippedNote}`;
  const sample = rows[0];
  followupPreview.textContent = sample
    ? `To: ${sample.email}\nSubject: ${fillTemplate(followupSubject.value, sample.university)}\n\n${fillTemplate(followupBody.value, sample.university)}`
    : "No addresses in this group.";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadFollowups() {
  const rows = noReplyRows();
  const lines = [["Tab", "University", "Email", "Emails sent", "Subject", "Body"].join(",")];
  for (const row of rows) {
    lines.push(
      [row.country, row.university, row.email, row.sent, fillTemplate(followupSubject.value, row.university), fillTemplate(followupBody.value, row.university)]
        .map(csvCell)
        .join(",")
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "no-reply-follow-ups.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

fetchButton.addEventListener("click", fetchEmails);
exportButton.addEventListener("click", downloadExcel);
followupSubject.addEventListener("input", () => result && renderFollowup());
followupBody.addEventListener("input", () => result && renderFollowup());
followupDownload.addEventListener("click", downloadFollowups);

fetch("/api/defaults")
  .then((response) => response.json())
  .then((body) => {
    sheetInput.value = body.sheetUrl;
    return fetchEmails();
  })
  .catch((error) => setError(error.message));
