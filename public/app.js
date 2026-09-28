const sheetInput = document.querySelector("#sheet-url");
const fetchButton = document.querySelector("#fetch");
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
  hint.textContent = "Replied means they wrote back at least once. We sent and They sent are the emails in that thread.";
  tbody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td class="university"></td>
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
      cells[1].textContent = row.university;
      cells[2].textContent = row.email;
      const phase = cells[3].querySelector("span");
      phase.textContent = row.phaseLabel;
      phase.classList.add(row.phase);
      const replied = cells[4].querySelector("span");
      replied.textContent = row.theyReplied ? "Yes" : "No";
      replied.classList.add(row.theyReplied ? "yesno-yes" : "yesno-no");
      cells[5].querySelector("span").textContent = String(row.sent);
      cells[6].querySelector("span").textContent = String(row.replied);
      cells[7].textContent = row.replyFrom;
      cells[8].textContent = row.replyDate;
      cells[9].textContent = row.summary;
      cells[9].title = row.summary;
      return tr;
    })
  );
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
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
const followupDownload = document.querySelector("#followup-download");
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
  sendConfirmText.textContent = `Prepare ${rows.length} emails for marketing@ecoboatsamsterdam.com. The first one starts “Dear ${sample.university}”. Nothing is sent.`;
}

async function createDrafts() {
  const rows = noReplyRows();
  sendConfirm.hidden = true;
  followupDrafts.disabled = true;
  followupStatus.textContent = `Saving ${rows.length} personalized emails…`;
  try {
    const messages = rows.map((row) => ({
      to: row.email,
      university: row.university,
      country: row.country,
      subject: fillTemplate(followupSubject.value, row.university),
      body: fillTemplate(followupBody.value, row.university),
    }));
    const response = await fetch("/api/outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save the emails.");
    followupStatus.textContent = `Prepared ${body.saved} emails. {university} is already replaced with each university name. Nothing has been sent.`;
  } catch (error) {
    followupStatus.textContent = error.message;
  } finally {
    followupDrafts.disabled = false;
  }
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
followupDownload.addEventListener("click", downloadFollowups);
followupDrafts.addEventListener("click", askForDrafts);
document.querySelector("#send-confirm-yes").addEventListener("click", createDrafts);
document.querySelector("#send-confirm-no").addEventListener("click", () => {
  sendConfirm.hidden = true;
});

fetch("/api/defaults")
  .then((response) => response.json())
  .then((body) => {
    sheetInput.value = body.sheetUrl;
    return fetchEmails();
  })
  .catch((error) => setError(error.message));
