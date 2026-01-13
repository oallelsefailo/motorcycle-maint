const tbody = document.getElementById("tbody");
const emptyState = document.getElementById("emptyState");
const totalSpentEl = document.getElementById("totalSpent");
const entryCountEl = document.getElementById("entryCount");
const oilAvgEl = document.getElementById("oilAvg");

const addForm = document.getElementById("addForm");
const dateInput = document.getElementById("dateInput");
const maintInput = document.getElementById("maintInput");
const mileageInput = document.getElementById("mileageInput");
const costInput = document.getElementById("costInput");

const searchInput = document.getElementById("searchInput");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");

let entries = [];
let query = "";
let deleteConfirmId = null;

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(2)}`;
}

function sanitizeMoney(value) {
  // accepts "$220", "220", "220.00"
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function sanitizeMileage(value) {
  // optional field: blank => null
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function formatMileage(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : "";
}

function formatDisplayDate(isoDate) {
  // stored as YYYY-MM-DD, display as MM/DD/YYYY
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate))
    return isoDate;
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${mm}/${dd}/${yyyy}`;
}

function matchesOilChange(text) {
  // simple, flexible: "oil change", "Oil Change + filter", etc.
  return /oil\s*change/i.test(text || "");
}

function computeAverageOilInterval(list) {
  // only entries that look like oil changes AND have mileage
  const oil = list
    .filter(
      (e) =>
        matchesOilChange(e.maintenance) && Number.isFinite(Number(e.mileage))
    )
    .map((e) => ({ mileage: Number(e.mileage) }))
    .sort((a, b) => a.mileage - b.mileage);

  if (oil.length < 2) return null;

  const diffs = [];
  for (let i = 1; i < oil.length; i++) {
    const diff = oil[i].mileage - oil[i - 1].mileage;
    if (diff > 0) diffs.push(diff);
  }

  if (!diffs.length) return null;

  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.round(avg);
}

function computeTotals() {
  const total = entries.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  totalSpentEl.textContent = formatMoney(total);
  entryCountEl.textContent = String(entries.length);

  const avgOil = computeAverageOilInterval(entries);
  oilAvgEl.textContent = avgOil ? `~${avgOil.toLocaleString()} miles` : "—";
}

function render() {
  tbody.innerHTML = "";

  const filtered = !query
    ? entries
    : entries.filter((e) => {
        const hay = `${e.date} ${e.maintenance} ${e.mileage ?? ""} ${
          e.cost ?? ""
        }`.toLowerCase();
        return hay.includes(query.toLowerCase());
      });

  if (!filtered.length) {
    emptyState.classList.remove("hidden");
    emptyState.textContent = query
      ? "No matches. Try a different search."
      : "No entries yet. Add your first oil change / mod below.";
  } else {
    emptyState.classList.add("hidden");
  }

  for (const e of filtered) {
    const tr = document.createElement("tr");
    tr.dataset.id = e.id;

    const isConfirmingDelete = deleteConfirmId === e.id;

    tr.innerHTML = `
      <td class="col-date" data-field="date">${escapeHtml(
        formatDisplayDate(e.date)
      )}</td>
      <td data-field="maintenance">${escapeHtml(e.maintenance)}</td>
      <td class="col-mileage" data-field="mileage">${escapeHtml(
        formatMileage(e.mileage)
      )}</td>
      <td class="col-cost" data-field="cost">${escapeHtml(
        formatMoney(e.cost)
      )}</td>
      <td class="col-actions">
        <div class="actions">
          ${
            isConfirmingDelete
              ? `
                <button class="icon-btn danger" data-action="confirm-delete" type="button" title="Confirm delete">
                  ✅ <span>Confirm</span>
                </button>
                <button class="icon-btn" data-action="cancel-delete" type="button" title="Cancel">
                  ↩ <span>Cancel</span>
                </button>
              `
              : `
                <button class="icon-btn" data-action="edit" type="button" title="Edit">
                  ✏️ <span>Edit</span>
                </button>
                <button class="icon-btn danger" data-action="delete" type="button" title="Delete">
                  ✖ <span>Del</span>
                </button>
              `
          }
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  }

  computeTotals();
}

async function refresh() {
  const res = await fetch("/api/entries");
  entries = await res.json();
  render();
}

async function addEntry({ date, maintenance, mileage, cost }) {
  const res = await fetch("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, maintenance, mileage, cost }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Failed to add entry.");
    return;
  }

  entries = await res.json();
  render();
}

async function updateEntry(id, { date, maintenance, mileage, cost }) {
  const res = await fetch(`/api/entries/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, maintenance, mileage, cost }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Failed to update entry.");
    return false;
  }

  entries = await res.json();
  render();
  return true;
}

async function deleteEntry(id) {
  const res = await fetch(`/api/entries/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || "Failed to delete entry.");
    return;
  }

  entries = await res.json();
  render();
}

function getRowEntry(id) {
  return entries.find((e) => e.id === id);
}

function startInlineEdit(tr, entry) {
  tr.classList.add("editing");

  const dateTd = tr.querySelector('[data-field="date"]');
  const maintTd = tr.querySelector('[data-field="maintenance"]');
  const mileageTd = tr.querySelector('[data-field="mileage"]');
  const costTd = tr.querySelector('[data-field="cost"]');
  const actionsTd = tr.querySelector(".actions");

  // Replace cells with inputs (date stays ISO for <input type="date">)
  dateTd.innerHTML = `<input class="cell-input" type="date" value="${escapeHtml(
    entry.date
  )}" />`;
  maintTd.innerHTML = `<input class="cell-input" type="text" value="${escapeHtml(
    entry.maintenance
  )}" />`;
  mileageTd.innerHTML = `<input class="cell-input" type="number" step="1" min="0" value="${escapeHtml(
    entry.mileage ?? ""
  )}" style="text-align:right" />`;
  costTd.innerHTML = `<input class="cell-input" type="text" value="${escapeHtml(
    sanitizeMoney(entry.cost) !== null
      ? sanitizeMoney(entry.cost).toFixed(2)
      : "0.00"
  )}" style="text-align:right" />`;

  actionsTd.innerHTML = `
    <button class="icon-btn" data-action="save" type="button" title="Save">✅ <span>Save</span></button>
    <button class="icon-btn danger" data-action="cancel" type="button" title="Cancel">↩ <span>Cancel</span></button>
  `;

  const inputs = tr.querySelectorAll(".cell-input");
  if (inputs[1]) inputs[1].focus();

  // Auto-format cost on blur during edit
  const costEditInput = costTd.querySelector("input");
  if (costEditInput) {
    costEditInput.addEventListener("blur", () => {
      const n = sanitizeMoney(costEditInput.value);
      if (n === null) return;
      costEditInput.value = n.toFixed(2);
    });
  }
}

function cancelInlineEdit() {
  render();
}

// ---- Add form ----
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = dateInput.value;
  const maintenance = maintInput.value.trim();

  if (!date || !maintenance) return;

  const mileageSan = sanitizeMileage(mileageInput.value); // can be null
  const costSan = sanitizeMoney(costInput.value);
  if (costSan === null) return alert("Cost must be a number.");

  await addEntry({ date, maintenance, mileage: mileageSan, cost: costSan });

  maintInput.value = "";
  mileageInput.value = "";
  costInput.value = "";
  maintInput.focus();
});

// Auto-format cost in add form
costInput.addEventListener("blur", () => {
  const n = sanitizeMoney(costInput.value);
  if (n === null) return;
  costInput.value = n.toFixed(2);
});

// ---- Search ----
searchInput.addEventListener("input", (e) => {
  query = e.target.value || "";
  render();
});

// ---- Row actions ----
tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const tr = btn.closest("tr");
  if (!tr) return;

  const id = tr.dataset.id;
  const entry = getRowEntry(id);
  if (!entry) return;

  if (action === "edit") {
    deleteConfirmId = null;
    startInlineEdit(tr, entry);
    return;
  }

  if (action === "delete") {
    deleteConfirmId = id;
    render();
    return;
  }

  if (action === "cancel-delete") {
    deleteConfirmId = null;
    render();
    return;
  }

  if (action === "confirm-delete") {
    deleteConfirmId = null;
    await deleteEntry(id);
    return;
  }

  if (action === "cancel") {
    cancelInlineEdit();
    return;
  }

  if (action === "save") {
    const dateVal = tr.querySelector('td[data-field="date"] input')?.value;
    const maintVal = tr
      .querySelector('td[data-field="maintenance"] input')
      ?.value?.trim();
    const mileageVal = tr.querySelector(
      'td[data-field="mileage"] input'
    )?.value;
    const costVal = tr.querySelector('td[data-field="cost"] input')?.value;

    if (!dateVal || !maintVal) {
      alert("Date and Maintenance are required.");
      return;
    }

    const mileageSan = sanitizeMileage(mileageVal);
    const costSan = sanitizeMoney(costVal);
    if (costSan === null) {
      alert("Cost must be a number.");
      return;
    }

    const success = await updateEntry(id, {
      date: dateVal,
      maintenance: maintVal,
      mileage: mileageSan,
      cost: costSan,
    });

    if (!success) return;
  }
});

// ---- PDF download ----
downloadPdfBtn.addEventListener("click", () => {
  window.location.href = "/api/entries.pdf";
});

// ---- Default date to today ----
(function initDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dateInput.value = `${yyyy}-${mm}-${dd}`;
})();

refresh().catch(() => {
  alert("Failed to load entries. Is the server running?");
});
