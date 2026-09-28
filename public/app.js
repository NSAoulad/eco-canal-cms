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

let result = null;
let activeFilter = "all";
let activeCountry = "all";

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
    return countryOk && statusOk;
  });
  document.querySelector("#count-total").textContent = String(result.counts.total);
  document.querySelector("#count-replied").textContent = String(result.counts.replied);
  document.querySelector("#count-none").textContent = String(result.counts.none);
  document.querySelector("#count-other").textContent = String(result.counts.auto + result.counts.bounced);
  stats.hidden = false;
  filters.hidden = false;
  tableWrap.hidden = false;
  exportButton.disabled = false;
  hint.textContent = `${result.counts.tabs} tabs, ${result.counts.total} contacts. Gmail checked ${result.checkedAt} in ${result.mailbox}. Gereageerd? is TRUE only when a person replied.`;
  tbody.replaceChildren(
    ...rows.map((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td><span class="status status-${row.status}"></span></td>
        <td></td>
        <td></td>
        <td></td>
      `;
      const cells = tr.children;
      cells[0].textContent = row.country;
      cells[1].textContent = row.university;
      cells[2].textContent = row.email;
      cells[3].querySelector("span").textContent = row.statusLabel;
      cells[4].textContent = row.replyFrom;
      cells[5].textContent = row.replyDate;
      cells[6].textContent = row.summary;
      return tr;
    })
  );
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
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

fetchButton.addEventListener("click", fetchEmails);
exportButton.addEventListener("click", downloadExcel);

fetch("/api/defaults")
  .then((response) => response.json())
  .then((body) => {
    sheetInput.value = body.sheetUrl;
    return fetchEmails();
  })
  .catch((error) => setError(error.message));
