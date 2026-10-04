const STORAGE_KEY = "haojue-stock-pro-v2";

const categories = ["Moteur", "Freinage", "Transmission", "Suspension", "Electricité", "Carburateur", "Carrosserie", "Pneus", "Huiles", "Accessoires", "Consommables", "Visserie"];
const paymentModes = ["Espèces", "Mobile Money", "Airtel Money", "M-Pesa", "Banque", "Crédit", "Mixte"];
const cashCategories = ["Vente", "Paiement client", "Apport", "Achat pièces", "Paiement fournisseur", "Loyer", "Transport", "Salaire", "Internet", "Electricité", "Frais Mobile Money", "Autres"];

const seed = {
  users: [{ id: "u1", name: "Administrateur", role: "Administrateur" }],
  models: [
    { id: "m16n", name: "16N", brand: "Haojue", active: true },
    { id: "meg125", name: "EG 125", brand: "Haojue", active: true },
    { id: "meg150", name: "EG 150", brand: "Haojue", active: true },
    { id: "meh", name: "EH", brand: "Haojue", active: true },
    { id: "mdh", name: "DH", brand: "Haojue", active: true },
    { id: "mud", name: "UD", brand: "Haojue", active: true },
    { id: "mdk", name: "DK", brand: "Haojue", active: true },
    { id: "mexpressplus", name: "Express Plus", brand: "Haojue", active: true },
    { id: "mexpress", name: "Express", brand: "Haojue", active: true }
  ],
  parts: [
    { id: "p1", code: "HJ-FR-001", name: "Plaquettes de frein avant", category: "Freinage", reference: "FR-EG-AV", cost: 14500, price: 22000, stock: 2, minStock: 5, unit: "paire", location: "Rayon B1", models: ["meg125", "meg150", "meh"], description: "" },
    { id: "p2", code: "HJ-EL-014", name: "Bougie d'allumage", category: "Electricité", reference: "SP-125", cost: 4200, price: 7500, stock: 20, minStock: 5, unit: "pièce", location: "Rayon A2", models: ["m16n", "meg125", "meg150", "mdh", "mud"], description: "" },
    { id: "p3", code: "HJ-TR-022", name: "Chaîne de transmission", category: "Transmission", reference: "CH-DK-428", cost: 26000, price: 38000, stock: 0, minStock: 3, unit: "jeu", location: "Dépôt", models: ["mdk", "mexpress", "mexpressplus"], description: "" },
    { id: "p4", code: "HJ-CR-031", name: "Carénage avant Express Plus", category: "Carrosserie", reference: "CP-EX+", cost: 52000, price: 78000, stock: 4, minStock: 2, unit: "pièce", location: "Rayon C4", models: ["mexpressplus"], description: "" }
  ],
  sales: [],
  purchases: [],
  cash: [{ id: "c0", date: new Date().toISOString(), type: "in", category: "Apport", paymentMode: "Espèces", amount: 250000, note: "Solde initial" }],
  movements: []
};

let state = loadState();
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("fr-CD", { dateStyle: "short", timeStyle: "short" });

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  fillStaticSelects();
  bindForms();
  renderAll();
  document.querySelectorAll(".table-wrap").forEach((wrapper) => {
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", wrapper.closest(".panel").querySelector("h2").textContent);
  });
  if (window.lucide) window.lucide.createIcons();
});

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(seed);
  try {
    return { ...structuredClone(seed), ...JSON.parse(raw) };
  } catch {
    return structuredClone(seed);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function bindNavigation() {
  document.querySelectorAll("[data-view], [data-view-link]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || button.dataset.viewLink));
  });
  byId("globalSearch").addEventListener("input", renderAll);
  byId("modelFilter").addEventListener("change", renderParts);
  byId("reportPeriod").addEventListener("change", renderReports);
  byId("exportData").addEventListener("click", exportData);
  byId("resetDatabase").addEventListener("click", resetDatabase);
  byId("exportPartsExcel").addEventListener("click", exportPartsExcel);
  byId("downloadPartsTemplate").addEventListener("click", downloadPartsTemplate);
  byId("importPartsExcel").addEventListener("change", importPartsExcel);
  byId("printReport").addEventListener("click", () => window.print());
  byId("printLastSale").addEventListener("click", printLastSale);
}

function setView(view) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === view));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  const titles = {
    dashboard: ["Tableau de bord", "Vue rapide des ventes, du stock, de la caisse et des alertes."],
    sales: ["Ventes", "Enregistrer une vente, filtrer les pièces par modèle et suivre les crédits clients."],
    purchases: ["Achats", "Réceptionner les pièces, augmenter le stock et suivre les dettes fournisseurs."],
    parts: ["Pièces et compatibilités", "Gérer le catalogue, les prix, les seuils et les modèles compatibles."],
    cash: ["Caisse", "Suivre les entrées, sorties, dépenses et le solde théorique."],
    reports: ["Rapports", "Consulter les indicateurs journaliers, mensuels et annuels."]
  };
  byId("viewTitle").textContent = titles[view][0];
  byId("viewSubtitle").textContent = titles[view][1];
}

function fillStaticSelects() {
  fillSelect("partCategory", categories.map((name) => ({ value: name, label: name })));
  ["salePaymentMode", "purchasePaymentMode", "cashPaymentMode"].forEach((id) => fillSelect(id, paymentModes.map((mode) => ({ value: mode, label: mode }))));
  fillSelect("cashCategory", cashCategories.map((name) => ({ value: name, label: name })));
}

function fillDynamicSelects() {
  const models = state.models.filter((m) => m.active).map((m) => ({ value: m.id, label: `${m.brand} ${m.name}` }));
  fillSelect("saleModel", models);
  fillSelect("partModels", models);
  fillSelect("modelFilter", [{ value: "all", label: "Tous les modèles" }, ...models]);
  fillSelect("purchasePart", state.parts.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` })));
  refreshSalePartOptions();
}

function fillSelect(id, options) {
  const select = byId(id);
  if (!select) return;
  const current = Array.from(select.selectedOptions).map((o) => o.value);
  select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
  Array.from(select.options).forEach((option) => {
    if (current.includes(option.value)) option.selected = true;
  });
}

function bindForms() {
  byId("saleModel").addEventListener("change", refreshSalePartOptions);
  byId("saleForm").addEventListener("input", updateSaleTotal);
  byId("purchaseForm").addEventListener("input", updatePurchaseTotal);
  byId("saleForm").addEventListener("submit", submitSale);
  byId("purchaseForm").addEventListener("submit", submitPurchase);
  byId("partForm").addEventListener("submit", submitPart);
  byId("partForm").elements.name.addEventListener("input", previewPartIdentifiers);
  byId("cashForm").addEventListener("submit", submitCash);
  byId("resetPartForm").addEventListener("click", resetPartForm);
}

function renderAll() {
  fillDynamicSelects();
  byId("saleNumber").textContent = nextNumber("FAC", state.sales.length + 1);
  byId("purchaseNumber").textContent = nextNumber("ACH", state.purchases.length + 1);
  renderDashboard();
  renderSales();
  renderPurchases();
  renderParts();
  renderCash();
  renderReports();
  updateSaleTotal();
  updatePurchaseTotal();
  previewPartIdentifiers();
  if (window.lucide) window.lucide.createIcons();
}

function renderDashboard() {
  const todaySales = periodItems(state.sales, "day").reduce((sum, sale) => sum + sale.total, 0);
  const todayPurchases = periodItems(state.purchases, "day").reduce((sum, item) => sum + item.total, 0);
  const todayExpenses = periodItems(state.cash, "day").filter((c) => c.type === "out").reduce((sum, c) => sum + c.amount, 0);
  const receivables = state.sales.reduce((sum, sale) => sum + sale.balance, 0);
  const payables = state.purchases.reduce((sum, item) => sum + item.balance, 0);
  const kpis = [
    ["Ventes du jour", formatMoney(todaySales)],
    ["Achats du jour", formatMoney(todayPurchases)],
    ["Dépenses du jour", formatMoney(todayExpenses)],
    ["Solde caisse", formatMoney(cashBalance())],
    ["Stock faible", state.parts.filter((p) => p.stock > 0 && p.stock <= p.minStock).length],
    ["Ruptures", state.parts.filter((p) => p.stock <= 0).length],
    ["Créances clients", formatMoney(receivables)],
    ["Dettes fournisseurs", formatMoney(payables)]
  ];
  byId("kpiGrid").innerHTML = kpis.map(([label, value]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong></article>`).join("");
  byId("lowStockRows").innerHTML = state.parts.filter((p) => p.stock <= p.minStock).map((p) => `<tr><td>${p.code}</td><td>${p.name}</td><td>${p.stock}</td><td>${p.minStock}</td><td>${stockStatus(p)}</td></tr>`).join("") || emptyRow(5, "Aucune alerte de stock.");

  const sold = {};
  state.sales.forEach((sale) => {
    sold[sale.partId] = (sold[sale.partId] || 0) + sale.qty;
  });
  byId("topParts").innerHTML = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([partId, qty], index) => `<div class="rank-item"><div><strong>${index + 1}. ${partName(partId)}</strong><small>${qty} vendu(s)</small></div><span>${formatMoney(salesAmount(partId))}</span></div>`).join("") || `<p class="muted">Aucune vente enregistrée.</p>`;
  byId("movementFeed").innerHTML = state.movements.slice(-6).reverse().map((m) => `<div class="feed-item"><div><strong>${m.type}</strong><small>${partName(m.partId)} | ${shortDate.format(new Date(m.date))}</small></div><span>${m.qty > 0 ? "+" : ""}${m.qty}</span></div>`).join("") || `<p class="muted">Aucun mouvement pour le moment.</p>`;
}

function renderSales() {
  byId("salesRows").innerHTML = filterBySearch(state.sales, (sale) => `${sale.number} ${sale.client} ${partName(sale.partId)}`).slice().reverse().map((sale) => `<tr><td>${sale.number}</td><td>${sale.client || "Client comptant"}</td><td>${formatMoney(sale.total)}</td><td>${formatMoney(sale.paid)}</td><td>${formatMoney(sale.balance)}</td></tr>`).join("") || emptyRow(5, "Aucune vente enregistrée.");
}

function renderPurchases() {
  byId("purchaseRows").innerHTML = filterBySearch(state.purchases, (item) => `${item.number} ${item.supplier} ${partName(item.partId)}`).slice().reverse().map((item) => `<tr><td>${item.number}</td><td>${item.supplier}</td><td>${partName(item.partId)}</td><td>${formatMoney(item.total)}</td><td>${formatMoney(item.balance)}</td></tr>`).join("") || emptyRow(5, "Aucun achat enregistré.");
}

function renderParts() {
  const modelFilter = byId("modelFilter").value || "all";
  byId("partsRows").innerHTML = filterBySearch(state.parts, (p) => `${p.code} ${p.name} ${p.category} ${p.reference}`).filter((p) => modelFilter === "all" || p.models.includes(modelFilter)).map((p) => `<tr><td>${p.code}<br><small>${p.reference || ""}</small></td><td>${p.name}<br><small>${p.category} | ${p.location || "Sans emplacement"}</small></td><td>${modelNames(p.models)}</td><td>${stockStatus(p)}</td><td>${formatMoney(p.price)}</td><td><div class="row-actions"><button class="secondary-button" onclick="editPart('${p.id}')">Modifier</button><button class="danger-button" onclick="deletePart('${p.id}')">Supprimer</button></div></td></tr>`).join("") || emptyRow(6, "Aucune pièce trouvée.");
}

function renderCash() {
  byId("cashBalance").textContent = formatMoney(cashBalance());
  const entries = state.cash.filter((c) => c.type === "in").reduce((sum, c) => sum + c.amount, 0);
  const exits = state.cash.filter((c) => c.type === "out").reduce((sum, c) => sum + c.amount, 0);
  byId("cashBreakdown").innerHTML = [["Entrées", formatMoney(entries)], ["Sorties", formatMoney(exits)], ["Mouvements", state.cash.length]].map(([label, value]) => `<div class="mini-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  byId("cashRows").innerHTML = state.cash.slice().reverse().map((c) => `<tr><td>${shortDate.format(new Date(c.date))}</td><td>${c.type === "in" ? "Entrée" : "Sortie"}</td><td>${c.category}</td><td>${c.paymentMode}</td><td>${formatMoney(c.amount)}</td></tr>`).join("") || emptyRow(5, "Aucun mouvement de caisse.");
}

function renderReports() {
  const period = byId("reportPeriod").value;
  const sales = periodItems(state.sales, period);
  const purchases = periodItems(state.purchases, period);
  const cash = periodItems(state.cash, period);
  const cards = [
    ["Chiffre d'affaires", formatMoney(sales.reduce((sum, s) => sum + s.total, 0)), `${sales.length} facture(s)`],
    ["Achats", formatMoney(purchases.reduce((sum, p) => sum + p.total, 0)), `${purchases.length} bon(s)`],
    ["Dépenses / sorties", formatMoney(cash.filter((c) => c.type === "out").reduce((sum, c) => sum + c.amount, 0)), `${cash.filter((c) => c.type === "out").length} mouvement(s)`],
    ["Bénéfice brut estimé", formatMoney(grossProfit(sales)), "Ventes moins coût d'achat"],
    ["Valeur du stock", formatMoney(state.parts.reduce((sum, p) => sum + p.stock * p.cost, 0)), `${state.parts.length} référence(s)`],
    ["Crédits clients", formatMoney(state.sales.reduce((sum, s) => sum + s.balance, 0)), "Solde restant à payer"]
  ];
  byId("reportGrid").innerHTML = cards.map(([title, value, note]) => `<section class="panel report-card"><h2>${title}</h2><strong>${value}</strong><p>${note}</p></section>`).join("");
}

function submitSale(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const part = state.parts.find((p) => p.id === data.part);
  const qty = Number(data.qty);
  if (!part) return;
  if (qty > part.stock) {
    toast("Stock insuffisant. La vente en rupture exige une autorisation administrateur.");
    return;
  }
  const discount = Number(data.discount || 0);
  const total = Math.max(0, part.price * qty - discount);
  const paid = Math.min(Number(data.paid || 0), total);
  const sale = { id: crypto.randomUUID(), number: nextNumber("FAC", state.sales.length + 1), date: new Date().toISOString(), client: data.client || "Client comptant", phone: data.phone || "", modelId: data.model, partId: part.id, qty, unitPrice: part.price, discount, total, paid, balance: total - paid, paymentMode: data.paymentMode, note: data.note || "" };
  part.stock -= qty;
  state.sales.push(sale);
  state.movements.push(stockMovement("Sortie par vente", part.id, -qty, sale.number, part.stock + qty, part.stock));
  if (paid > 0) state.cash.push(cashMovement("in", "Vente", paid, data.paymentMode, sale.number));
  saveState();
  event.currentTarget.reset();
  renderAll();
  toast("Vente validée et stock mis à jour.");
}

function submitPurchase(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const part = state.parts.find((p) => p.id === data.part);
  if (!part) return;
  const qty = Number(data.qty);
  const cost = Number(data.cost || part.cost || 0);
  const discount = Number(data.discount || 0);
  const total = Math.max(0, cost * qty - discount);
  const paid = Math.min(Number(data.paid || 0), total);
  const purchase = { id: crypto.randomUUID(), number: nextNumber("ACH", state.purchases.length + 1), date: new Date().toISOString(), supplier: data.supplier, supplierRef: data.supplierRef || "", partId: part.id, qty, unitCost: cost, discount, total, paid, balance: total - paid, paymentMode: data.paymentMode, note: data.note || "" };
  const before = part.stock;
  part.stock += qty;
  part.cost = cost;
  state.purchases.push(purchase);
  state.movements.push(stockMovement("Entrée par achat", part.id, qty, purchase.number, before, part.stock));
  if (paid > 0) state.cash.push(cashMovement("out", "Achat pièces", paid, data.paymentMode, purchase.number));
  saveState();
  event.currentTarget.reset();
  renderAll();
  toast("Achat validé et stock augmenté.");
}

function submitPart(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const selectedModels = Array.from(byId("partModels").selectedOptions).map((option) => option.value);
  const identifiers = data.id ? { code: data.code, reference: data.reference } : nextPartIdentifiers();
  const payload = { id: data.id || crypto.randomUUID(), code: identifiers.code, name: data.name.trim(), category: data.category, reference: identifiers.reference, cost: Number(data.cost || 0), price: Number(data.price || 0), stock: Number(data.stock || 0), minStock: Number(data.minStock || 0), unit: data.unit || "pièce", location: data.location || "", models: selectedModels, description: data.description || "" };
  const index = state.parts.findIndex((p) => p.id === payload.id);
  if (index >= 0) state.parts[index] = payload;
  else state.parts.push(payload);
  saveState();
  resetPartForm();
  renderAll();
  toast("Fiche pièce enregistrée.");
}

function submitCash(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  state.cash.push(cashMovement(data.type, data.category, Number(data.amount), data.paymentMode, data.note || ""));
  saveState();
  event.currentTarget.reset();
  renderAll();
  toast("Mouvement de caisse ajouté.");
}

function editPart(id) {
  const part = state.parts.find((p) => p.id === id);
  if (!part) return;
  setView("parts");
  const form = byId("partForm");
  Object.entries(part).forEach(([key, value]) => {
    if (form.elements[key] && key !== "models") form.elements[key].value = value;
  });
  Array.from(byId("partModels").options).forEach((option) => {
    option.selected = part.models.includes(option.value);
  });
}

function deletePart(id) {
  const part = state.parts.find((p) => p.id === id);
  if (!part) return;
  const usedInSale = state.sales.some((sale) => sale.partId === id);
  const usedInPurchase = state.purchases.some((purchase) => purchase.partId === id);
  if (usedInSale || usedInPurchase) {
    toast("Cette pièce est utilisée dans l'historique. Suppression bloquée pour préserver les rapports.");
    return;
  }
  const ok = confirm(`Supprimer la pièce ${part.code} - ${part.name} ?`);
  if (!ok) return;
  state.parts = state.parts.filter((p) => p.id !== id);
  state.movements = state.movements.filter((movement) => movement.partId !== id);
  saveState();
  resetPartForm();
  renderAll();
  toast("Pièce supprimée.");
}

function resetPartForm() {
  byId("partForm").reset();
  document.querySelector("#partForm [name='id']").value = "";
  previewPartIdentifiers();
}

function previewPartIdentifiers() {
  const form = byId("partForm");
  if (form.elements.id.value) return;
  const identifiers = nextPartIdentifiers();
  form.elements.code.value = identifiers.code;
  form.elements.reference.value = identifiers.reference;
}

function refreshSalePartOptions() {
  const modelId = byId("saleModel").value;
  const compatible = state.parts.filter((p) => !modelId || p.models.includes(modelId));
  fillSelect("salePart", compatible.map((p) => ({ value: p.id, label: `${p.code} - ${p.name} (${p.stock})` })));
  updateSaleTotal();
}

function updateSaleTotal() {
  const form = byId("saleForm");
  const part = state.parts.find((p) => p.id === form.elements.part?.value);
  const total = part ? Math.max(0, part.price * Number(form.elements.qty?.value || 0) - Number(form.elements.discount?.value || 0)) : 0;
  byId("saleTotal").textContent = formatMoney(total);
  if (form.elements.paid && !form.elements.paid.value) form.elements.paid.value = total || 0;
}

function updatePurchaseTotal() {
  const form = byId("purchaseForm");
  const part = state.parts.find((p) => p.id === form.elements.part?.value);
  if (part && (!form.elements.cost.value || Number(form.elements.cost.value) === 0)) form.elements.cost.value = part.cost;
  const total = Math.max(0, Number(form.elements.qty?.value || 0) * Number(form.elements.cost?.value || 0) - Number(form.elements.discount?.value || 0));
  byId("purchaseTotal").textContent = formatMoney(total);
}

function resetDatabase() {
  const ok = confirm("Réinitialiser la base locale ? Toutes les ventes, achats, mouvements et pièces importées seront remplacés par les données de départ.");
  if (!ok) return;
  state = structuredClone(seed);
  saveState();
  resetPartForm();
  renderAll();
  toast("Base locale réinitialisée.");
}

function exportPartsExcel() {
  exportPartsWorkbook("catalogue-pieces-haojue", partsToRows(state.parts));
}

function downloadPartsTemplate() {
  exportPartsWorkbook("modele-import-pieces-haojue", [{
    Code: "HJ-EX-001",
    "Désignation": "Nom de la pièce",
    "Catégorie": "Moteur",
    "Référence": "REF-001",
    "Prix achat": 0,
    "Prix vente": 0,
    Stock: 0,
    "Seuil alerte": 1,
    "Unité": "pièce",
    Emplacement: "Rayon A",
    "Modèles compatibles": "EG 125, EG 150",
    Description: ""
  }]);
}

function exportPartsWorkbook(filename, rows) {
  if (!window.XLSX) {
    toast("Module Excel non chargé. Vérifiez la connexion puis rechargez la page.");
    return;
  }
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 36 }, { wch: 30 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Pieces");
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

function importPartsExcel(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!window.XLSX) {
    toast("Module Excel non chargé. Vérifiez la connexion puis rechargez la page.");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const workbook = XLSX.read(reader.result, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const result = upsertImportedParts(rows);
      saveState();
      renderAll();
      toast(`${result.created} pièce(s) ajoutée(s), ${result.updated} mise(s) à jour, ${result.skipped} ligne(s) ignorée(s).`);
    } catch {
      toast("Import impossible. Vérifiez le format du fichier Excel.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsArrayBuffer(file);
}

function upsertImportedParts(rows) {
  const result = { created: 0, updated: 0, skipped: 0 };
  rows.forEach((row) => {
    const normalized = normalizeImportedRow(row);
    if (!normalized.name) {
      result.skipped += 1;
      return;
    }
    const existing = normalized.code ? state.parts.find((part) => part.code.toLowerCase() === normalized.code.toLowerCase()) : null;
    const identifiers = normalized.code ? { code: normalized.code, reference: normalized.reference || nextReferenceFromCode(normalized.code) } : nextPartIdentifiers();
    const payload = {
      id: existing?.id || crypto.randomUUID(),
      code: identifiers.code,
      name: normalized.name,
      category: normalized.category || "Accessoires",
      reference: identifiers.reference,
      cost: parseNumber(normalized.cost),
      price: parseNumber(normalized.price),
      stock: parseNumber(normalized.stock),
      minStock: parseNumber(normalized.minStock || 1),
      unit: normalized.unit || "pièce",
      location: normalized.location,
      models: parseImportedModels(normalized.models),
      description: normalized.description
    };
    if (existing) {
      state.parts[state.parts.findIndex((part) => part.id === existing.id)] = payload;
      result.updated += 1;
    } else {
      state.parts.push(payload);
      result.created += 1;
    }
  });
  return result;
}

function normalizeImportedRow(row) {
  const get = (...names) => {
    const entries = Object.entries(row);
    for (const name of names) {
      const found = entries.find(([key]) => normalizeKey(key) === normalizeKey(name));
      if (found) return String(found[1]).trim();
    }
    return "";
  };
  return {
    code: get("Code", "Code pièce", "SKU"),
    name: get("Désignation", "Designation", "Nom", "Pièce", "Piece"),
    category: get("Catégorie", "Categorie"),
    reference: get("Référence", "Reference", "Réf. fabricant"),
    cost: get("Prix achat", "Prix d'achat", "Cout", "Coût"),
    price: get("Prix vente", "Prix de vente"),
    stock: get("Stock", "Quantité", "Quantite"),
    minStock: get("Seuil alerte", "Stock minimum", "Seuil"),
    unit: get("Unité", "Unite"),
    location: get("Emplacement", "Rayon"),
    models: get("Modèles compatibles", "Modeles compatibles", "Compatibilité", "Compatibilite"),
    description: get("Description", "Remarque")
  };
}

function parseImportedModels(value) {
  return String(value || "").split(/[,;|]/).map((name) => name.trim()).filter(Boolean).map((name) => ensureModel(name));
}

function ensureModel(name) {
  const cleanName = name.replace(/^haojue\s+/i, "").trim();
  const existing = state.models.find((model) => normalizeKey(model.name) === normalizeKey(cleanName));
  if (existing) return existing.id;
  const id = `m${crypto.randomUUID().slice(0, 8)}`;
  state.models.push({ id, name: cleanName, brand: "Haojue", active: true });
  return id;
}

function partsToRows(parts) {
  return parts.map((part) => ({
    Code: part.code,
    "Désignation": part.name,
    "Catégorie": part.category,
    "Référence": part.reference,
    "Prix achat": part.cost,
    "Prix vente": part.price,
    Stock: part.stock,
    "Seuil alerte": part.minStock,
    "Unité": part.unit,
    Emplacement: part.location,
    "Modèles compatibles": modelNames(part.models),
    Description: part.description
  }));
}

function nextPartIdentifiers() {
  const nextNumberValue = Math.max(0, ...state.parts.map((part) => numericCode(part.code))) + 1;
  const code = `HJ-${String(nextNumberValue).padStart(5, "0")}`;
  return { code, reference: nextReferenceFromCode(code) };
}

function nextReferenceFromCode(code) {
  return `REF-${code}`;
}

function numericCode(code) {
  const match = String(code || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function printLastSale() {
  const sale = state.sales.at(-1);
  if (!sale) {
    toast("Aucune facture à imprimer.");
    return;
  }
  const win = window.open("", "_blank", "width=520,height=720");
  win.document.write(`
    <title>${sale.number}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#172033}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}.total{font-size:22px;font-weight:700;text-align:right;margin-top:20px}</style>
    <h1>Haojue Stock Pro</h1>
    <p>Facture ${sale.number}<br>${shortDate.format(new Date(sale.date))}<br>Client: ${escapeHtml(sale.client)}</p>
    <table><thead><tr><th>Pièce</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody><tr><td>${partName(sale.partId)}</td><td>${sale.qty}</td><td>${formatMoney(sale.unitPrice)}</td><td>${formatMoney(sale.total)}</td></tr></tbody></table>
    <p class="total">Payé: ${formatMoney(sale.paid)}<br>Solde: ${formatMoney(sale.balance)}</p>
  `);
  win.document.close();
  win.print();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `haojue-stock-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function stockMovement(type, partId, qty, reference, before, after) {
  return { id: crypto.randomUUID(), date: new Date().toISOString(), type, partId, qty, reference, before, after, userId: "u1" };
}

function cashMovement(type, category, amount, paymentMode, note) {
  return { id: crypto.randomUUID(), date: new Date().toISOString(), type, category, paymentMode, amount: Number(amount || 0), note };
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function nextNumber(prefix, number) {
  return `${prefix}-${String(number).padStart(5, "0")}`;
}

function cashBalance() {
  return state.cash.reduce((sum, item) => sum + (item.type === "in" ? item.amount : -item.amount), 0);
}

function stockStatus(part) {
  if (part.stock <= 0) return `<span class="status bad">Rupture</span>`;
  if (part.stock <= part.minStock) return `<span class="status warn">Stock faible</span>`;
  return `<span class="status good">${part.stock} ${escapeHtml(part.unit || "")}</span>`;
}

function partName(id) {
  return state.parts.find((p) => p.id === id)?.name || "Pièce inconnue";
}

function modelNames(ids) {
  return ids.map((id) => state.models.find((m) => m.id === id)?.name).filter(Boolean).join(", ");
}

function salesAmount(partId) {
  return state.sales.filter((s) => s.partId === partId).reduce((sum, sale) => sum + sale.total, 0);
}

function grossProfit(sales) {
  return sales.reduce((sum, sale) => {
    const part = state.parts.find((p) => p.id === sale.partId);
    return sum + ((sale.unitPrice - (part?.cost || 0)) * sale.qty - sale.discount);
  }, 0);
}

function periodItems(items, period) {
  if (period === "all") return items;
  const now = new Date();
  return items.filter((item) => {
    const date = new Date(item.date);
    if (period === "day") return date.toDateString() === now.toDateString();
    if (period === "month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    if (period === "year") return date.getFullYear() === now.getFullYear();
    return true;
  });
}

function filterBySearch(items, projector) {
  const query = byId("globalSearch").value.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => projector(item).toLowerCase().includes(query));
}

function parseNumber(value) {
  const parsed = Number(String(value || "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function emptyRow(cols, message) {
  return `<tr><td colspan="${cols}">${message}</td></tr>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

function byId(id) {
  return document.getElementById(id);
}

window.editPart = editPart;
window.deletePart = deletePart;
