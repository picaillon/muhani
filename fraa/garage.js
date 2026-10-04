'use strict';
const $ = (id) => document.getElementById(id);
const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = (v) => new Intl.NumberFormat('fr-CD', {style:'currency',currency:'USD'}).format(Number(v || 0));
const date = (v) => v ? new Date(v).toLocaleString('fr-CD', {timeZone:'Africa/Lubumbashi',dateStyle:'short',timeStyle:'short'}) : '';
const dayOf = (value) => { const parts=new Intl.DateTimeFormat('en', {timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)); const part=key=>parts.find(p=>p.type===key).value; return `${part('year')}-${part('month')}-${part('day')}`; };
const today = () => dayOf(new Date());
const icon = (name) => `<i data-lucide="${name}"></i>`;
const button = (action, label, symbol, id='', cls='') => `<button type="button" class="${cls}" data-action="${action}" data-id="${h(id)}" title="${h(label)}" aria-label="${h(label)}">${icon(symbol)}${cls.includes('icon') ? '' : h(label)}</button>`;
const menus = [
  ['dashboard','Tableau de bord','layout-dashboard'],['pos','Point de vente','shopping-cart'],['sales','Ventes & factures','receipt'],
  ['products','Catalogue','package'],['clients','Clients','users'],['suppliers','Fournisseurs','truck'],['purchases','Achats & réceptions','package-check'],
  ['stock','Stocks & inventaires','clipboard-list'],['needs','État des besoins','list-plus'],['cash','Caisse','wallet'],['expenses','Dépenses','banknote'],
  ['quotes','Devis','file-text'],['finance','Finance','landmark'],['reports','Rapports','chart-no-axes-combined'],['branches','Agences','building-2'],
  ['sync','Synchronisation','refresh-cw'],['users','Utilisateurs','user-cog'],['audit','Journal d’audit','history'],['settings','Paramètres','settings']
];
let state, view='dashboard', branch='main', query='', page=1, cart=[], period='month', from='', to='', busy=false;
let queue = [];
let lastSync = '';
function can(permission) { return state.permissions.includes('*') || state.permissions.includes(permission); }
function writable() { return state.user.role !== 'Auditeur'; }
function icons() { window.lucide?.createIcons(); }
function toast(message) { $('toast').textContent=message; $('toast').classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').classList.remove('show'),6000); }
async function api(path, data) {
  let response;
  try { response=await fetch('/api/'+path, data ? {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf || ''},body:JSON.stringify(data)} : {cache:'no-store'}); }
  catch { const err=new Error('Serveur injoignable. Vérifiez la connexion.'); err.network=true; throw err; }
  const result=await response.json();
  if (!response.ok) { const err=new Error(result.error || 'Opération impossible.'); err.status=response.status; if(response.status===401 && state) { state=null; $('modal').close(); await showLogin(); } throw err; }
  return result;
}
async function refresh() {
  state=await api('state');
  branch=state.branches.find(b=>b.id===branch && b.active)?.id || state.branches.find(b=>b.active)?.id || 'main';
  queue=JSON.parse(localStorage.getItem('garage-queue-'+state.user.id) || '[]');
  lastSync=state.serverTime;
}
async function mutate(action, data={}) {
  const result=await api('action',{action,branchId:branch,requestId:crypto.randomUUID(),...data});
  if(result.logout) { state=null; await showLogin(); return result; }
  await refresh(); renderShell(); toast(result.message); return result;
}
function saveQueue() { localStorage.setItem('garage-queue-'+state.user.id,JSON.stringify(queue)); }
function scoped(kind) { return (state[kind] || []).filter(d=>!d.branchId || d.branchId===branch); }
function find(kind,id) { return state[kind].find(d=>d.id===id); }
function stock(p) { return state.stocks.find(s=>s.product_id===p.id && s.branch_id===branch)?.qty || 0; }
function products(active=true) { return state.products.filter(p=>!active || p.active); }
function filtered(rows) { const q=query.toLocaleLowerCase(); return rows.filter(r=>!q || JSON.stringify(r).toLocaleLowerCase().includes(q)); }
function badge(value) { return `<span class="badge ${/attente|partiel|Commandé|Ouverte/i.test(value)?'warn':/Annul|Rejet|Retourn|Rupture|Expir/i.test(value)?'bad':''}">${h(value)}</span>`; }
function table(headers, rows, label='Résultats') {
  const start=(page-1)*25;
  const pages=Math.max(1,Math.ceil(rows.length/25));
  if(page>pages) page=pages;
  const shown=rows.slice((page-1)*25,page*25);
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${h(label)}"><table class="${shown.length?'':'no-rows'}"><thead><tr>${headers.map(c=>`<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${shown.length ? shown.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty">Aucun enregistrement</td></tr>`}</tbody></table></div>${rows.length>25?`<div class="pager"><span>${rows.length} résultats · Page ${page}/${pages}</span><div class="actions">${button('prev','Précédent','chevron-left')}${button('next','Suivant','chevron-right')}</div></div>`:''}`;
}
function heading(title, actions='') { return `<div class="section-head"><h2>${h(title)}</h2><div class="actions">${actions}</div></div>`; }
function options(rows, selected='', blank='') { return (blank?`<option value="">${h(blank)}</option>`:'')+rows.map(r=>`<option value="${h(r.id ?? r)}" ${String(r.id ?? r)===String(selected)?'selected':''}>${h(r.name ?? r)}</option>`).join(''); }
function field(name,label,value='',type='text',extra='') { return `<label>${h(label)}<input name="${h(name)}" type="${type}" value="${h(value)}" ${extra}></label>`; }
function select(name,label,rows,selected='',blank='') { return `<label>${h(label)}<select name="${h(name)}">${options(rows,selected,blank)}</select></label>`; }
const paymentModes=['Espèces','Mobile Money','M-Pesa','Airtel Money','Carte bancaire','Virement bancaire','Mixte'];
const categories=['Moteur','Freinage','Transmission','Suspension','Électricité','Carrosserie','Pneus','Batteries','Lubrifiants','Accessoires','Motos','Entretien','Autres'];
function modeField(value='Espèces') { return select('mode','Mode de paiement',paymentModes,value); }
function formData(form) { const data=Object.fromEntries(new FormData(form)); form.querySelectorAll('input[type=checkbox]').forEach(el=>data[el.name]=el.checked); return data; }
function openModal(title,html,formAction='',id='') {
  $('modalBody').innerHTML=`<div class="dialog-head"><h2>${h(title)}</h2>${button('close','Fermer','x','','icon')}</div>${formAction?`<form data-form="${formAction}" data-id="${h(id)}"><div class="form-grid">${html}</div><div class="actions dialog-actions">${button('close','Annuler','x')}<button class="primary" type="submit">${icon('check')}Enregistrer</button></div><p class="error" role="alert"></p></form>`:html}`;
  icons(); if(!$('modal').open) $('modal').showModal();
}
function periods() { return `<div class="period">${select('period','Période',[{id:'day',name:'Aujourd’hui'},{id:'week',name:'7 derniers jours'},{id:'month',name:'Ce mois'},{id:'year',name:'Cette année'},{id:'all',name:'Toutes les dates'},{id:'custom',name:'Personnalisée'}],period)}${period==='custom'?field('from','Du',from,'date')+field('to','Au',to,'date'):''}</div>`; }
function inPeriod(doc) {
  const day=dayOf(doc.date);
  const t=today();
  if(period==='day') return day===t;
  if(period==='month') return day.slice(0,7)===t.slice(0,7);
  if(period==='year') return day.slice(0,4)===t.slice(0,4);
  if(period==='week') return new Date(day)>=new Date(new Date(t).getTime()-6*86400000);
  if(period==='custom') return (!from || day>=from)&&(!to || day<=to);
  return true;
}
function metrics() {
  const sales=scoped('sales').filter(inPeriod).filter(s=>s.status!=='Annulée');
  const ledger=scoped('cash').filter(inPeriod);
  const revenue=sales.reduce((a,s)=>a+s.total-(s.credited||0),0);
  const receipts=ledger.filter(c=>c.direction==='in' && ['Vente','Paiement client'].includes(c.category)).reduce((a,c)=>a+c.amount,0)-ledger.filter(c=>c.category==='Remboursement').reduce((a,c)=>a+c.amount,0);
  const expenses=ledger.filter(c=>c.direction==='out'&&!['Achat','Paiement fournisseur','Remboursement'].includes(c.category)).reduce((a,c)=>a+c.amount,0);
  const cost=sales.reduce((a,s)=>a+s.lines.reduce((n,l)=>n+(l.qty-(l.returned||0))*l.cost,0),0);
  const debt=scoped('sales').filter(s=>s.status!=='Annulée').reduce((a,s)=>a+s.balance,0);
  return {sales,revenue,receipts,expenses,cost,debt,net:revenue-cost-expenses,cash:sales.filter(s=>!s.balance).reduce((a,s)=>a+s.total-(s.credited||0),0),credit:sales.reduce((a,s)=>a+s.balance,0)};
}
function metric(label,value,note='') { return `<div class="metric"><span>${h(label)}</span><strong>${h(value)}</strong><small>${h(note)}</small></div>`; }
function renderShell() {
  if(!state) return;
  if(!can(view) && !['sync','settings'].includes(view)) view='dashboard';
  const nav=menus.filter(([key])=>can(key) || ['sync','settings'].includes(key));
  $('app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">H</div><div><strong>Garage Haojue</strong><small>Gestion & point de vente</small></div><button type="button" class="mobile-menu icon" data-action="menu" aria-label="Menu principal" aria-expanded="false" aria-controls="navigation">${icon('menu')}</button></div><nav id="navigation" class="nav" aria-label="Navigation principale">${nav.map(([key,label,sym])=>`<button data-action="nav" data-id="${key}" class="${view===key?'active':''}" ${view===key?'aria-current="page"':''}>${icon(sym)}<span>${h(label)}</span></button>`).join('')}</nav><div class="account"><div><strong>${h(state.user.name)}</strong><small>${h(state.user.role)}</small></div>${button('logout','Déconnexion','log-out','','icon')}</div></aside><main class="main"><header class="topbar"><div><h1>${h(menus.find(m=>m[0]===view)?.[1])}</h1><small>${h(state.company.name)} · USD ($)</small></div><div class="tools"><input class="search" id="search" type="search" value="${h(query)}" placeholder="Rechercher…" aria-label="Recherche globale"><select id="agency" aria-label="Agence">${options(state.branches.filter(b=>b.active),branch)}</select>${button('alerts','Notifications','bell','','icon')}${button('refresh','Actualiser','refresh-cw','','icon')}</div></header><div id="content"></div></main></div>`;
  renderContent();
}
function renderContent() {
  const renderers={dashboard:renderDashboard,pos:renderPOS,products:renderProducts,clients:()=>renderContacts('clients'),suppliers:()=>renderContacts('suppliers'),sales:renderSales,purchases:renderPurchases,stock:renderStock,needs:renderNeeds,cash:renderCash,expenses:renderExpenses,quotes:renderQuotes,finance:renderFinance,reports:renderReports,branches:renderBranches,users:renderUsers,audit:renderAudit,sync:renderSync,settings:renderSettings};
  $('content').innerHTML=renderers[view](); icons();
  if(['dashboard','reports'].includes(view)) drawChart();
}
function renderDashboard() {
  if(!can('sales')) {
    const items=products().filter(p=>p.type!=='Service');const low=filtered(items.filter(p=>stock(p)<=p.minStock));
    return `<div class="grid">${metric('Articles au catalogue',items.length)}${metric('Sous le seuil',items.filter(p=>stock(p)<=p.minStock).length)}${metric('En rupture',items.filter(p=>stock(p)===0).length)}${metric('Inventaires en attente',scoped('inventories').filter(i=>i.status==='En attente').length)}</div><section class="section">${heading('Stock à surveiller')}${table(['Article','Code','Disponible','Seuil'],low.map(p=>[h(p.name),h(p.code),stock(p),p.minStock]))}</section>`;
  }
  const m=metrics();
  const low=filtered(products().filter(p=>p.type!=='Service'&&stock(p)<=p.minStock));
  return periods()+`<div class="grid">${metric('Ventes comptant',usd(m.cash),'Factures intégralement réglées')}${metric('Crédit restant',usd(m.credit),'Solde des ventes de la période')}${metric('Dépenses',usd(m.expenses),'Décaissements hors achats')}${metric('Résultat opérationnel',usd(m.net),'Ventes − coût des articles − dépenses')}</div><div class="chart-grid"><section class="chart"><h2>Évolution des ventes</h2><canvas id="salesChart" aria-label="Évolution journalière des ventes" role="img"></canvas><small>Chiffre d’affaires net des retours</small></section><section class="chart"><h2>Situation du garage</h2><div class="detail-list"><p>Encaissements clients<strong>${usd(m.receipts)}</strong></p><p>Créances totales<strong>${usd(m.debt)}</strong></p><p>Valeur du stock<strong>${usd(products().reduce((a,p)=>a+stock(p)*p.cost,0))}</strong></p><p>Ventes sur la période<strong>${m.sales.length}</strong></p></div></section></div><section class="section">${heading('Stock à surveiller',can('needs')?button('nav','État des besoins','arrow-right','needs'):'')}${table(['Article','Code','Disponible','Seuil','État'],low.map(p=>[h(p.name),h(p.code),stock(p),p.minStock,badge(stock(p)===0?'Rupture':'Stock faible')]))}</section>`;
}
function drawChart() {
  const canvas=$('salesChart'); if(!canvas) return;
  const rect=canvas.getBoundingClientRect(); const ratio=devicePixelRatio||1;
  canvas.width=Math.max(1,rect.width*ratio); canvas.height=220*ratio;
  const ctx=canvas.getContext('2d'); ctx.scale(ratio,ratio);
  const w=rect.width, ht=220;
  const grouped={};
  metrics().sales.forEach(s=>{ const day=s.date.slice(0,10); grouped[day]=(grouped[day]||0)+s.total-(s.credited||0); });
  const days=Object.keys(grouped).sort().slice(-31);
  const values=days.map(d=>grouped[d]), max=Math.max(1,...values);
  ctx.font='11px system-ui'; ctx.strokeStyle='#e1e7eb'; ctx.fillStyle='#647085';
  for(let i=0;i<4;i++) {const y=18+i*52; ctx.beginPath();ctx.moveTo(52,y);ctx.lineTo(w-12,y);ctx.stroke();ctx.fillText(Math.round(max*(1-i/3)).toLocaleString(),0,y+4);}
  if(!values.length) {ctx.fillText('Aucune vente sur cette période',60,105); return;}
  const x=i=>52+(w-70)*(values.length===1?.5:i/(values.length-1)); const y=v=>174-v/max*156;
  ctx.beginPath(); ctx.strokeStyle='#126b5c';ctx.lineWidth=2.5;values.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.stroke();
  ctx.fillStyle='#126b5c'; values.forEach((v,i)=>{ctx.beginPath();ctx.arc(x(i),y(v),3,0,Math.PI*2);ctx.fill();});
  ctx.fillStyle='#647085';ctx.fillText(days[0].slice(5),52,204);if(days.length>1) ctx.fillText(days.at(-1).slice(5),Math.max(80,w-55),204);
}
function renderProducts() {
  const rows=filtered(products(false));
  return heading('Catalogue des produits',button('product.export','Exporter Excel','download')+(writable()?button('product.import','Importer Excel','upload')+button('product.new','Ajouter','plus','','primary'):'')+button('product.template','Modèle Excel','file-spreadsheet'))+table(['Code / référence','Désignation','Type / modèles','Stock','Prix achat','Prix vente','État','Actions'],rows.map(p=>[`${h(p.code)}<small>${h(p.reference)}</small>`,`${h(p.name)}<small>${h(p.category)}</small>`,`${h(p.type)}<small>${h(p.models)}</small>`,p.type==='Service'?'—':stock(p),usd(p.cost),usd(p.price),badge(p.active?'Actif':'Inactif'),`<div class="actions">${writable()?button('product.edit','Modifier','pencil',p.id,'icon')+button('product.delete','Supprimer','trash-2',p.id,'icon danger'):''}</div>`]));
}
function productForm(id='') {
  const p=id?find('products',id):{active:true,type:'Pièce',category:'Moteur',minStock:1,stock:0,price:0,cost:0};
  openModal(id?'Modifier le produit':'Nouveau produit',field('code','Code',p.code||'Attribué à l’enregistrement','text','readonly')+field('reference','Référence',p.reference||'Automatique','text','readonly')+field('name','Désignation',p.name,'text','required')+select('type','Type',['Pièce','Moto','Accessoire','Lubrifiant','Service'],p.type)+select('category','Catégorie',categories,p.category)+field('models','Modèles compatibles',p.models)+field('cost','Prix achat ($)',p.cost,'number','min="0" step="0.01" required')+field('price','Prix vente ($)',p.price,'number','min="0" step="0.01" required')+field('minStock','Seuil minimum',p.minStock,'number','min="0" step="1" required')+(id?'':field('stock','Stock initial de l’agence',0,'number','min="0" step="1" required'))+field('barcode','Code-barres',p.barcode)+field('unit','Unité',p.unit)+field('location','Emplacement',p.location)+`<label class="check"><input name="active" type="checkbox" ${p.active?'checked':''}>Produit actif</label>`,'product.save',id);
}
function renderContacts(kind) {
  const client=kind==='clients';
  const rows=filtered(state[kind]);
  return heading(client?'Répertoire clients':'Répertoire fournisseurs',writable()?button(client?'client.new':'supplier.new','Ajouter','plus','','primary'):'')+table(['Nom','Téléphone','E-mail','Adresse','Solde dû','Actions'],rows.map(c=>{const docs=client?scoped('sales').filter(s=>s.clientId===c.id && s.status!=='Annulée'):scoped('purchases').filter(s=>s.supplierId===c.id);return [h(c.name)+(c.active?'':`<small>Inactif</small>`),h(c.phone),h(c.email),h(c.address),usd(docs.reduce((a,d)=>a+d.balance,0)),`<div class="actions">${button(client?'client.detail':'supplier.detail','Historique','eye',c.id,'icon')}${writable()?button(client?'client.edit':'supplier.edit','Modifier','pencil',c.id,'icon'):''}</div>`];}));
}
function contactForm(kind,id='') {
  const c=id?find(kind,id):{active:true,creditLimit:0};
  openModal(kind==='clients'?'Fiche client':'Fiche fournisseur',field('name','Nom / raison sociale',c.name,'text','required')+field('phone','Téléphone',c.phone,'tel')+field('email','E-mail',c.email,'email')+field('address','Adresse',c.address)+field('terms','Conditions de paiement',c.terms)+(kind==='clients'?field('creditLimit','Limite de crédit ($), 0 = sans limite',c.creditLimit,'number','min="0" step="0.01"'):'')+`<label class="check"><input name="active" type="checkbox" ${c.active?'checked':''}>Compte actif</label>`,kind==='clients'?'client.save':'supplier.save',id);
}
function renderPOS() {
  const list=filtered(products()).slice(0,60);
  const subtotal=cart.reduce((a,l)=>a+l.qty*l.price,0);
  return `<div class="workspace"><section>${heading('Produits disponibles')}<div class="product-grid">${list.map(p=>`<button class="product-tile" data-action="cart.add" data-id="${h(p.id)}"><span class="tile-icon">${icon(p.type==='Service'?'wrench':p.type==='Moto'?'bike':'package')}</span><strong>${h(p.name)}</strong><small>${h(p.code)} · ${p.type==='Service'?'Service':stock(p)+' en stock'}</small><b>${usd(p.price)}</b></button>`).join('')||'<p class="empty">Ajoutez des produits au catalogue.</p>'}</div></section><form class="cart" data-form="sale.create" data-total="${Math.round(subtotal*(1+state.company.tax/100)*100)/100}"><div class="section-head"><h2>Vente en cours</h2>${button('cart.clear','Vider le panier','trash-2','','icon danger')}</div><div class="cart-lines">${cart.map(l=>`<div class="cart-line"><div><strong>${h(l.name)}</strong>${button('cart.remove','Retirer','x',l.productId,'icon')}</div><div class="qty"><input aria-label="Quantité ${h(l.name)}" data-qty="${h(l.productId)}" type="number" value="${l.qty}" min="1" step="1"><span>${usd(l.price)} / unité</span><b>${usd(l.price*l.qty)}</b></div></div>`).join('')||'<p class="empty">Panier vide</p>'}</div><div class="form-grid">${select('clientId','Client',state.clients.filter(c=>c.active),'','Client comptant')}${modeField()}${field('discount','Remise ($)',0,'number','min="0" step="0.01"')}${field('paid','Montant payé ($)',Math.round(subtotal*(1+state.company.tax/100)*100)/100,'number','min="0" step="0.01"')}${field('due','Échéance du crédit','','date')}${field('note','Observation')}</div><div class="total"><span>Total · taxe ${state.company.tax}%</span><strong id="cartTotal">${usd(subtotal*(1+state.company.tax/100))}</strong></div><button class="primary" type="submit">${icon('check')}Valider la vente</button><p class="error" role="alert"></p></form></div>`;
}
function renderSales() {
  const rows=filtered(scoped('sales').filter(inPeriod));
  return periods()+heading('Ventes et factures',button('sales.export','Exporter Excel','download')+(can('pos')&&writable()?button('nav','Nouvelle vente','plus','pos','primary'):''))+table(['Facture','Date','Client','Vendeur','Total net','Payé','Solde','Statut','Actions'],rows.map(s=>[h(s.number),date(s.date),h(s.client),h(s.user),usd(s.total-(s.credited||0)),usd(s.paid),usd(s.balance),badge(s.status),`<div class="actions">${button('sale.detail','Détail / facture','eye',s.id,'icon')}${s.balance&&can('cash')&&writable()?button('sale.pay','Encaisser','banknote',s.id,'icon'):''}</div>`]));
}
function renderPurchases() {
  return heading('Commandes fournisseurs',writable()?button('purchase.new','Commander','plus','','primary'):'')+table(['Commande','Date','Fournisseur','Total','Payé','Dette','Statut','Actions'],filtered(scoped('purchases')).map(p=>[h(p.number),date(p.date),h(p.supplier),usd(p.total),usd(p.paid),usd(p.balance),badge(p.status),`<div class="actions">${button('purchase.detail','Détails','eye',p.id,'icon')}${writable()&&['Commandé','Partiellement reçu'].includes(p.status)?button('purchase.receive','Réceptionner','package-check',p.id,'icon'):''}${writable()&&can('cash')&&p.balance?button('purchase.pay','Payer','banknote',p.id,'icon'):''}</div>`]));
}
function linesEditor(purchase=false,initial=[]) {
  return `<div class="full"><div class="form-grid">${select('pickProduct','Article',products().filter(p=>!purchase||p.type!=='Service'),'','Choisir un article')}${field('pickQty','Quantité',1,'number','min="1" step="1"')}${purchase?field('pickPrice','Prix achat ($)',0,'number','min="0" step="0.01"'):''}</div><div class="actions" style="margin-top:12px">${button('document.add','Ajouter la ligne','plus')}</div><div id="documentLines" class="detail-list"></div></div>`;
}
let documentLines=[];
function documentForm(kind,initial=[]) {
  documentLines=initial;
  const purchase=kind==='purchase';
  openModal(purchase?'Nouvelle commande':'Nouveau devis',select(purchase?'supplierId':'clientId',purchase?'Fournisseur':'Client',(purchase?state.suppliers:state.clients).filter(c=>c.active),'','Sélectionner')+(purchase?field('expected','Livraison prévue','','date'):field('validUntil','Valide jusqu’au',today(),'date','required'))+linesEditor(purchase)+(purchase?field('paid','Paiement initial ($)',0,'number','min="0" step="0.01"')+modeField():field('discount','Remise ($)',0,'number','min="0" step="0.01"'))+field('note','Conditions / observation'),purchase?'purchase.create':'quote.create');
  renderDocumentLines();
}
function renderDocumentLines() {
  $('documentLines').innerHTML=documentLines.map((l,i)=>`<p><span>${h(l.name)} · ${l.qty} × ${usd(l.price)}</span>${button('document.remove','Retirer','x',i,'icon')}</p>`).join('')+`<p><strong>Sous-total</strong><strong>${usd(documentLines.reduce((a,l)=>a+l.qty*l.price,0))}</strong></p>`; icons();
}
function renderStock() {
  return heading('Stock de l’agence',writable()?button('inventory.new','Inventaire','clipboard-check')+button('transfer.new','Transférer','arrow-right-left'):'')+table(['Code','Article','Disponible','Seuil','Valeur achat'],filtered(products().filter(p=>p.type!=='Service')).map(p=>[h(p.code),h(p.name),stock(p),p.minStock,usd(stock(p)*p.cost)]))+`<section class="section">${heading('Inventaires physiques')}${table(['Numéro','Date','Articles','Justification','Statut','Actions'],scoped('inventories').map(i=>[h(i.number),date(i.date),i.lines.length,h(i.reason),badge(i.status),button('inventory.detail','Détail','eye',i.id,'icon')+(i.status==='En attente'&&can('approve')&&writable()?button('inventory.approve','Valider','check',i.id,'icon'):'')]))}</section><section class="section">${heading('Mouvements récents')}${table(['Date','Article','Variation','Avant','Après','Référence'],filtered(scoped('movements')).map(m=>[date(m.date),h(m.product),m.delta,m.before,m.after,h(m.reason)]))}</section>`;
}
function renderNeeds() {
  const rows=filtered(products().filter(p=>p.type!=='Service'&&stock(p)<=p.minStock));
  return heading('Articles à approvisionner',button('needs.export','Exporter Excel','download')+(can('purchases')&&writable()?button('needs.order','Préparer une commande','shopping-bag'):'') )+table(['Code','Article','Stock','Minimum','Déjà commandé','À commander'],rows.map(p=>{const ordered=scoped('purchases').filter(o=>['Commandé','Partiellement reçu'].includes(o.status)).reduce((a,o)=>a+o.lines.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.qty-l.received,0),0);return[h(p.code),h(p.name),stock(p),p.minStock,ordered,Math.max(0,p.minStock-stock(p)-ordered)];}));
}
function renderCash() {
  const entries=scoped('cash');
  const balance=entries.reduce((a,c)=>a+(c.direction==='in'?c.amount:-c.amount),0);
  return `<div class="grid">${metric('Trésorerie enregistrée',usd(balance),'Tous modes de paiement')}${metric('Encaissements',usd(entries.filter(c=>c.direction==='in').reduce((a,c)=>a+c.amount,0)))}${metric('Décaissements',usd(entries.filter(c=>c.direction==='out').reduce((a,c)=>a+c.amount,0)))}${metric('Sessions ouvertes',scoped('cash_sessions').filter(s=>s.status==='Ouverte').length)}</div><section class="section">${heading('Sessions de caisse',writable()?button('cash.open','Ouvrir une caisse','unlock')+button('cash.manual','Mouvement manuel','plus'):'')}${table(['Session','Ouverture','Fonds initial','Théorique','Compté','Écart','Statut','Actions'],scoped('cash_sessions').map(s=>[h(s.number),date(s.date),usd(s.opening),s.theoretical===undefined?'—':usd(s.theoretical),s.actual===undefined?'—':usd(s.actual),s.gap===undefined?'—':usd(s.gap),badge(s.status),button('cash.detail','Rapport','eye',s.id,'icon')+(writable()&&s.status==='Ouverte'?button('cash.close','Clôturer','lock',s.id,'icon'):'')+(writable()&&can('approve')&&s.status==='En attente'?button('cash.approve','Valider','check',s.id,'icon'):'')]))}</section><section class="section">${heading('Mouvements financiers',button('cash.export','Exporter Excel','download'))}${table(['Date','Sens','Catégorie','Mode','Montant','Motif','Utilisateur'],filtered(entries).map(c=>[date(c.date),badge(c.direction==='in'?'Entrée':'Sortie'),h(c.category),h(c.mode),usd(c.amount),h(c.note),h(c.user)]))}</section>`;
}
function renderExpenses() {
  return heading('Dépenses',writable()?button('expense.new','Nouvelle dépense','plus','','primary'):'')+table(['Référence','Date','Bénéficiaire','Catégorie','Montant','Motif','Statut','Actions'],filtered(scoped('expenses')).map(e=>[h(e.number),date(e.date),h(e.beneficiary),h(e.category),usd(e.amount),h(e.note),badge(e.status),e.status==='En attente'&&can('approve')&&writable()?button('expense.approve','Valider','check',e.id,'icon')+button('expense.reject','Rejeter','x',e.id,'icon danger'):'—']));
}
function renderQuotes() {
  return heading('Propositions commerciales',writable()?button('quote.new','Nouveau devis','plus','','primary'):'')+table(['Devis','Client','Date','Validité','Total','Statut','Actions'],filtered(scoped('quotes')).map(q=>[h(q.number),h(q.client),date(q.date),h(q.validUntil),usd(q.total),badge(q.status==='En attente'&&q.validUntil<today()?'Expiré':q.status),button('quote.detail','Imprimer','eye',q.id,'icon')+(q.status==='En attente'&&q.validUntil>=today()&&can('pos')&&writable()?button('quote.convert','Convertir en vente','shopping-cart',q.id,'icon'):'')+(q.status==='En attente'&&writable()?button('quote.cancel','Annuler','x',q.id,'icon danger'):'')]));
}
function renderFinance() {
  const m=metrics();
  const suppliers=scoped('purchases').reduce((a,p)=>a+p.balance,0);
  return periods()+`<div class="grid">${metric('Chiffre d’affaires',usd(m.revenue))}${metric('Marge brute',usd(m.revenue-m.cost),'Ventes − coût des articles')}${metric('Créances clients',usd(m.debt))}${metric('Dettes fournisseurs',usd(suppliers))}</div><section class="section">${heading('Ventes à crédit',button('finance.export','Exporter Excel','download'))}${table(['Facture','Client','Échéance','Total net','Solde','Actions'],filtered(scoped('sales').filter(s=>s.balance>0&&s.status!=='Annulée')).map(s=>[h(s.number),h(s.client),h(s.due),usd(s.total-(s.credited||0)),usd(s.balance),can('cash')&&writable()?button('sale.pay','Encaisser','banknote',s.id,'icon'):'—']))}</section><section class="section">${heading('Comptes fournisseurs')}${table(['Commande','Fournisseur','Total','Dette','Actions'],filtered(scoped('purchases').filter(p=>p.balance>0)).map(p=>[h(p.number),h(p.supplier),usd(p.total),usd(p.balance),can('cash')&&writable()?button('purchase.pay','Payer','banknote',p.id,'icon'):'—']))}</section>`;
}
function renderReports() {
  const m=metrics();
  const ranks={}; m.sales.forEach(s=>s.lines.forEach(l=>{ranks[l.name]=(ranks[l.name]||0)+l.qty-(l.returned||0);}));
  return periods()+heading('Rapport de gestion',button('report.export','Exporter Excel','download')+button('report.print','Imprimer / PDF','printer'))+`<div class="grid">${metric('Chiffre d’affaires',usd(m.revenue))}${metric('Panier moyen',usd(m.sales.length?m.revenue/m.sales.length:0))}${metric('Encaissements clients',usd(m.receipts))}${metric('Résultat opérationnel',usd(m.net))}</div><div class="chart-grid"><section class="chart"><h2>Ventes journalières</h2><canvas id="salesChart" role="img" aria-label="Ventes journalières"></canvas></section><section class="chart"><h2>Articles les plus vendus</h2>${Object.entries(ranks).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,qty])=>`<div class="bar-row"><div><span>${h(name)}</span><strong>${qty}</strong></div><div class="bar"><span style="width:${100*qty/Math.max(1,...Object.values(ranks))}%"></span></div></div>`).join('')||'<p class="empty">Aucune vente</p>'}</section></div><section class="section">${heading('Répartition par agence')}${table(['Agence','Ventes nettes','Nombre de ventes','Créances'],state.branches.map(b=>{const sales=state.sales.filter(s=>s.branchId===b.id&&s.status!=='Annulée'&&inPeriod(s));return[h(b.name),usd(sales.reduce((a,s)=>a+s.total-(s.credited||0),0)),sales.length,usd(sales.reduce((a,s)=>a+s.balance,0))];}))}</section>`;
}
function renderBranches() { return heading('Agences',can('users')?button('branch.new','Ajouter une agence','plus','','primary'):'')+table(['Nom','Adresse','Téléphone','Statut','Actions'],filtered(state.branches).map(b=>[h(b.name),h(b.address),h(b.phone),badge(b.active?'Active':'Inactive'),can('users')?button('branch.edit','Modifier','pencil',b.id,'icon'):'—'])); }
function renderUsers() { return heading('Utilisateurs',button('user.new','Ajouter un utilisateur','plus','','primary'))+table(['Nom','Identifiant','Profil','Agence','État','Actions'],filtered(state.users).map(u=>[h(u.name),h(u.login),h(u.role),h(state.branches.find(b=>b.id===u.branch_id)?.name||'Toutes les agences'),badge(u.active?'Actif':'Inactif'),button('user.edit','Modifier / réinitialiser','pencil',u.id,'icon')])); }
function renderAudit() { return heading('Historique des opérations')+table(['Date','Utilisateur','Agence','Action','Référence'],filtered(state.audit).map(a=>[date(a.date),h(a.user),h(state.branches.find(b=>b.id===a.branch_id)?.name||'—'),h(a.action),h(a.detail)])); }
function renderSync() {
  return `<div class="grid">${metric('Serveur',navigator.onLine?'Connecté':'Hors connexion')}${metric('Ventes en attente',queue.length)}${metric('Dernière lecture',date(lastSync))}${metric('Base centrale','SQLite')}</div><section class="section">${heading('File de synchronisation',button('sync.run','Synchroniser','refresh-cw','','primary'))}${queue.map(q=>`<div class="sync-item"><strong>${h(q.requestId)}</strong><p>${q.lines.length} article(s) · ${h(q.error||'En attente d’envoi')}</p>${button('queue.remove','Abandonner la vente locale','trash-2',q.requestId,'danger')}</div>`).join('')||'<p class="empty">Toutes les ventes ont été transmises.</p>'}</section>`;
}
function renderSettings() {
  return `${heading('Mon compte',button('password.new','Changer le mot de passe','key-round'))}${can('users')?`<section class="section">${heading('Informations du garage',button('settings.edit','Modifier','pencil'))}<div class="detail-list"><p>Nom<strong>${h(state.company.name)}</strong></p><p>Adresse<strong>${h(state.company.address)}</strong></p><p>Téléphone<strong>${h(state.company.phone)}</strong></p><p>Devise<strong>Dollar américain (USD)</strong></p><p>Taxe<strong>${state.company.tax}%</strong></p></div></section><section class="section">${heading('Sauvegardes',button('backup','Télécharger la sauvegarde','download')+button('restore','Restaurer','upload'))}</section>`:''}`;
}
function documentDetail(kind,id) {
  const d=find(kind,id);
  const name=kind==='quotes'?'Devis':kind==='purchases'?'Bon de commande':'Facture';
  const lines=d.lines;
  openModal(name+' '+d.number,`<article class="print-document"><h1>${h(state.company.name)}</h1><p>${h(state.company.address)} · ${h(state.company.phone)}</p><section class="section"><h2>${name} ${h(d.number)}</h2><p>${date(d.date)} · ${h(state.branches.find(b=>b.id===d.branchId)?.name)}</p><p>${kind==='purchases'?'Fournisseur':'Client'} : ${h(d.client||d.supplier)}</p><p>${h(d.status)}${d.due?' · Échéance : '+h(d.due):''}${d.validUntil?' · Validité : '+h(d.validUntil):''}</p></section><section class="section">${table(['Article','Quantité','Prix ($)','Total ($)'],lines.map(l=>[h(l.name)+(l.returned?`<small>${l.returned} retourné(s)</small>`:''),l.qty,usd(l.price),usd(l.qty*l.price)]))}</section><div class="detail-list"><p>Sous-total<strong>${usd(d.subtotal??d.total)}</strong></p>${d.discount?`<p>Remise<strong>${usd(d.discount)}</strong></p>`:''}${d.tax?`<p>Taxe ${d.taxRate}%<strong>${usd(d.tax)}</strong></p>`:''}<p>Total net<strong>${usd(d.total-(d.credited||0))}</strong></p>${kind!=='quotes'?`<p>Payé<strong>${usd(d.paid)}</strong></p><p>Solde<strong>${usd(d.balance)}</strong></p>`:''}<p>${h(d.note)}</p></div>${(d.returns||[]).map(r=>`<p>Avoir ${h(r.number)} : ${h(r.product)} × ${r.qty} · ${usd(r.amount)} · ${h(r.reason)}</p>`).join('')}</article><div class="actions dialog-actions">${button('print','Imprimer / PDF','printer')}${kind==='sales'&&can('approve')&&writable()&&['Validée','Retour partiel'].includes(d.status)?button('sale.return','Retour / avoir','undo-2',id)+(d.status==='Validée'&&!d.returns?.length?button('sale.cancel','Annuler la vente','x',id,'danger'):''):''}</div>`);
}
function exportExcel(name,rows) { const book=XLSX.utils.book_new(); const sheet=XLSX.utils.json_to_sheet(rows);sheet['!cols']=Object.keys(rows[0]||{}).map(()=>({wch:22}));XLSX.utils.book_append_sheet(book,sheet,'Données');XLSX.writeFile(book,`${name}-${today()}.xlsx`); }
function productRows() {return filtered(products(false)).map(p=>({'Code':p.code,'Référence':p.reference,'Désignation':p.name,'Catégorie':p.category,'Type':p.type,'Prix achat':p.cost,'Prix vente':p.price,'Stock':stock(p),'Seuil alerte':p.minStock,'Unité':p.unit,'Emplacement':p.location,'Modèles compatibles':p.models,'Code-barres':p.barcode}));}
function downloadJSON(name,data) { const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function chooseFile(accept,onFile) { const input=document.createElement('input');input.type='file';input.accept=accept;input.onchange=async()=>{try{if(input.files[0])await onFile(input.files[0]);}catch(e){toast(e.message);}};input.click(); }
async function importProducts(file) {
  const workbook=XLSX.read(await file.arrayBuffer());const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{defval:''});
  const normalize=k=>k.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const payload=rows.map((r,i)=>{const row=Object.fromEntries(Object.entries(r).map(([k,v])=>[normalize(k),v]));const name=row.designation||row.nom; if(!name)throw new Error(`Ligne ${i+2} : désignation manquante.`); const n=(key,fallback=0)=>{const val=row[key];const v=val===''||val===undefined?fallback:Number(String(val).replace(',','.'));if(!Number.isFinite(v)||v<0)throw new Error(`Ligne ${i+2} : ${key} invalide.`);return v;};return {name,type:row.type||'Pièce',category:row.categorie||'Autres',cost:n('prix achat'),price:n('prix vente'),stock:n('stock'),minStock:n('seuil alerte',1),models:row['modeles compatibles']||'',unit:row.unite||'pièce',location:row.emplacement||'',barcode:row['code-barres']||'',active:true};});
  if(!confirm(`Ajouter ${payload.length} nouveau(x) produit(s) ? Les codes et références seront attribués automatiquement.`))return;
  await mutate('products.import',{rows:payload});
}
async function syncQueue() {
  if(busy)return; busy=true;
  try {await refresh();for(const q of [...queue]) {try{await api('action',q);queue=queue.filter(x=>x.requestId!==q.requestId);saveQueue();}catch(e){q.error=e.message;saveQueue();if(e.network||e.status===401)break;}}await refresh();renderShell();toast(queue.length?`${queue.length} vente(s) restent à traiter.`:'Synchronisation terminée.');}finally{busy=false;}
}
async function handleAction(action,id) {
  if(action==='menu'){const open=document.querySelector('.sidebar').classList.toggle('nav-open');document.querySelector('[data-action=menu]').setAttribute('aria-expanded',String(open));return;}
  if(action==='close'){$('modal').close();return;}
  if(action==='nav'){view=id;page=1;query='';renderShell();return;}
  if(action==='refresh'){await refresh();renderShell();toast('Données actualisées.');return;}
  if(action==='prev'||action==='next'){page=Math.max(1,page+(action==='next'?1:-1));renderContent();return;}
  if(action==='logout'){await api('logout',{});state=null;cart=[];queue=[];await showLogin();return;}
  if(action==='print'){window.print();return;}
  if(action==='product.new'||action==='product.edit'){productForm(id);return;}
  if(action==='product.delete'){if(confirm('Supprimer définitivement ce produit ? Son stock doit être nul et aucun document ne doit le référencer.'))await mutate('product.delete',{id});return;}
  if(action==='product.export'){exportExcel('catalogue',productRows());return;}
  if(action==='product.template'){exportExcel('modele-catalogue',[{'Désignation':'Bougie Haojue','Catégorie':'Électricité','Type':'Pièce','Prix achat':2.5,'Prix vente':4,'Stock':10,'Seuil alerte':3,'Unité':'pièce','Emplacement':'A1','Modèles compatibles':'EG 125, EG 150','Code-barres':''}]);return;}
  if(action==='product.import'){chooseFile('.xlsx,.xls,.csv',importProducts);return;}
  if(/^(client|supplier)\.(new|edit)$/.test(action)){contactForm(action.startsWith('client')?'clients':'suppliers',id);return;}
  if(action==='client.detail'||action==='supplier.detail'){const isClient=action.startsWith('client');const c=find(isClient?'clients':'suppliers',id);const docs=scoped(isClient?'sales':'purchases').filter(d=>(isClient?d.clientId:d.supplierId)===id);openModal('Historique : '+c.name,table(['Document','Date','Montant','Solde'],docs.map(d=>[h(d.number),date(d.date),usd(d.total),usd(d.balance)]))+`<div class="actions dialog-actions">${button('print','Imprimer le relevé','printer')}</div>`);return;}
  if(action==='cart.add'){const p=find('products',id);const line=cart.find(l=>l.productId===id);if(p.type!=='Service'&&stock(p)<(line?.qty||0)+1)throw new Error('Stock insuffisant pour cet article.');if(line)line.qty++;else cart.push({productId:id,name:p.name,qty:1,price:p.price});renderContent();return;}
  if(action==='cart.remove'){cart=cart.filter(l=>l.productId!==id);renderContent();return;}
  if(action==='cart.clear'){if(!cart.length||confirm('Vider le panier ?')){cart=[];renderContent();}return;}
  if(['sale.detail','purchase.detail','quote.detail'].includes(action)){documentDetail(action.startsWith('sale')?'sales':action.startsWith('purchase')?'purchases':'quotes',id);return;}
  if(action==='sale.pay'||action==='purchase.pay'){const d=find(action==='sale.pay'?'sales':'purchases',id);openModal('Règlement '+d.number,field('amount','Montant ($)',d.balance,'number',`min="0.01" max="${d.balance}" step="0.01" required`)+modeField(),action,id);return;}
  if(action==='sale.cancel'){openModal('Annuler la vente',field('reason','Motif obligatoire','','text','required'),'sale.cancel',id);return;}
  if(action==='sale.return'){const s=find('sales',id);openModal('Retour et avoir',select('productId','Article',s.lines.filter(l=>l.qty>(l.returned||0)).map(l=>({id:l.productId,name:l.name})))+field('qty','Quantité',1,'number','min="1" step="1" required')+field('reason','Motif','','text','required')+`<label class="check"><input type="checkbox" name="damaged">Produit endommagé (ne pas réintégrer le stock)</label>`,'sale.return',id);return;}
  if(action==='purchase.new'||action==='quote.new'){documentForm(action.startsWith('purchase')?'purchase':'quote');return;}
  if(action==='document.add'){const f=$('modal').querySelector('form');const p=find('products',f.elements.pickProduct.value);if(!p)throw new Error('Sélectionnez un article.');const qty=Number(f.elements.pickQty.value);if(!Number.isInteger(qty)||qty<=0)throw new Error('Quantité entière positive obligatoire.');const price=f.dataset.form==='purchase.create'?Number(f.elements.pickPrice.value):p.price;if(!Number.isFinite(price)||price<0)throw new Error('Prix invalide.');const existing=documentLines.find(l=>l.productId===p.id);if(existing){existing.qty+=qty;existing.price=price;}else documentLines.push({productId:p.id,name:p.name,qty,price});renderDocumentLines();return;}
  if(action==='document.remove'){documentLines.splice(Number(id),1);renderDocumentLines();return;}
  if(action==='purchase.receive'){const p=find('purchases',id);openModal('Réception '+p.number,p.lines.filter(l=>l.qty>l.received).map(l=>field('receive_'+l.productId,l.name+' · reste '+(l.qty-l.received),l.qty-l.received,'number',`min="0" max="${l.qty-l.received}" step="1" required`)).join(''),'purchase.receive',id);return;}
  if(action==='inventory.new'){openModal('Comptage physique',products().filter(p=>p.type!=='Service').map(p=>field('count_'+p.id,p.name+' · théorique '+stock(p),stock(p),'number','min="0" step="1" required')).join('')+field('reason','Justification','','text','required'),'inventory.create');return;}
  if(action==='inventory.detail'){const d=find('inventories',id);openModal(d.number,table(['Article','Théorique','Compté','Écart'],d.lines.map(l=>[h(l.name),l.before,l.counted,l.counted-l.before])));return;}
  if(action==='transfer.new'){openModal('Transfert de stock',select('productId','Produit',products().filter(p=>p.type!=='Service'))+select('target','Agence destinataire',state.branches.filter(b=>b.active&&b.id!==branch))+field('qty','Quantité',1,'number','min="1" step="1" required')+field('reason','Motif','','text','required'),'stock.transfer');return;}
  if(action==='needs.order'){const initial=products().filter(p=>p.type!=='Service').map(p=>{const ordered=scoped('purchases').filter(o=>['Commandé','Partiellement reçu'].includes(o.status)).reduce((a,o)=>a+o.lines.filter(l=>l.productId===p.id).reduce((n,l)=>n+l.qty-l.received,0),0);return {productId:p.id,name:p.name,qty:Math.max(0,p.minStock-stock(p)-ordered),price:p.cost};}).filter(l=>l.qty>0);if(!initial.length)throw new Error('Aucun besoin non couvert par les commandes en cours.');documentForm('purchase',initial);return;}
  if(action==='cash.open'){openModal('Ouverture de caisse',field('amount','Fonds de caisse observé ($)',0,'number','min="0" step="0.01" required'),'cash.open');return;}
  if(action==='cash.close'){openModal('Clôture de caisse',field('amount','Espèces réellement comptées ($)',0,'number','min="0" step="0.01" required')+field('reason','Justification de l’écart'),'cash.close',id);return;}
  if(action==='cash.detail'){const s=find('cash_sessions',id);openModal('Rapport '+s.number,`<article class="print-document"><h1>${h(state.company.name)}</h1><h2>${h(s.number)}</h2><div class="detail-list"><p>Ouverture<strong>${date(s.date)}</strong></p><p>Clôture<strong>${date(s.closedAt)}</strong></p><p>Fond initial<strong>${usd(s.opening)}</strong></p><p>Théorique<strong>${usd(s.theoretical)}</strong></p><p>Compté<strong>${usd(s.actual)}</strong></p><p>Écart<strong>${usd(s.gap)}</strong></p><p>Justification<strong>${h(s.reason)}</strong></p><p>Statut<strong>${h(s.status)}</strong></p></div></article><div class="actions dialog-actions">${button('print','Imprimer / PDF','printer')}</div>`);return;}
  if(action==='cash.manual'){openModal('Mouvement manuel',select('direction','Sens',[{id:'in',name:'Entrée'},{id:'out',name:'Sortie'}])+field('amount','Montant ($)',0,'number','min="0.01" step="0.01" required')+modeField()+field('category','Catégorie','Autres','text','required')+field('note','Motif obligatoire','','text','required'),'cash.manual');return;}
  if(action==='expense.new'){openModal('Nouvelle dépense',select('category','Catégorie',['Salaires','Loyer','Transport','Électricité et eau','Télécommunication','Entretien','Frais bancaires','Taxes','Autres'])+field('beneficiary','Bénéficiaire','','text','required')+field('amount','Montant ($)',0,'number','min="0.01" step="0.01" required')+modeField()+field('reference','Référence du justificatif')+field('note','Motif','','text','required'),'expense.create');return;}
  if(['expense.approve','expense.reject','inventory.approve','cash.approve','quote.cancel'].includes(action)){if(confirm('Confirmer cette opération ?'))await mutate(action,{id});return;}
  if(action==='quote.convert'){const q=find('quotes',id);openModal('Convertir '+q.number+' en vente',field('paid','Montant payé ($)',q.total,'number','min="0" step="0.01" required')+modeField()+field('due','Échéance si crédit','','date'),'quote.convert',id);return;}
  if(action==='branch.new'||action==='branch.edit'){const b=id?state.branches.find(b=>b.id===id):{active:true};openModal('Agence',field('name','Nom',b.name,'text','required')+field('address','Adresse',b.address)+field('phone','Téléphone',b.phone)+`<label class="check"><input name="active" type="checkbox" ${b.active?'checked':''}>Agence active</label>`,'branch.save',id);return;}
  if(action==='user.new'||action==='user.edit'){const u=id?state.users.find(u=>u.id===id):{active:true,role:'Vendeur'};openModal('Compte utilisateur',field('name','Nom',u.name,'text','required')+field('login','Identifiant',u.login,'text','required')+select('role','Profil',Object.keys(state.roles),u.role)+select('userBranch','Agence',state.branches.filter(b=>b.active),u.branch_id,'Toutes les agences')+field('password',id?'Nouveau mot de passe (facultatif)':'Mot de passe','','password',`minlength="10" autocomplete="new-password" ${id?'':'required'}`)+`<label class="check"><input name="active" type="checkbox" ${u.active?'checked':''}>Compte actif</label>`,'user.save',id);return;}
  if(action==='settings.edit'){const c=state.company;openModal('Informations du garage',field('name','Nom',c.name,'text','required')+field('address','Adresse',c.address)+field('phone','Téléphone',c.phone)+field('tax','Taxe (%)',c.tax,'number','min="0" max="100" step="0.01" required'),'settings.save');return;}
  if(action==='password.new'){openModal('Changer le mot de passe',field('current','Mot de passe actuel','','password','required autocomplete="current-password"')+field('password','Nouveau mot de passe','','password','required minlength="10" autocomplete="new-password"'),'password.change');return;}
  if(action==='backup'){downloadJSON('garage-sauvegarde-'+today()+'.json',await api('backup'));return;}
  if(action==='restore'){chooseFile('.json',async f=>{const backup=JSON.parse(await f.text());if(confirm('Remplacer la base par cette sauvegarde ? Une copie de sécurité sera créée sur le serveur.')){const result=await api('restore',{backup});state=null;$('modal').close();await showLogin();toast(result.message);}});return;}
  if(action==='sync.run'){await syncQueue();return;}
  if(action==='queue.remove'){if(confirm('Abandonner cette vente locale non transmise ?')){queue=queue.filter(q=>q.requestId!==id);saveQueue();renderContent();}return;}
  if(action==='alerts'){const low=products().filter(p=>p.type!=='Service'&&stock(p)<=p.minStock);const debts=scoped('sales').filter(s=>s.balance>0&&s.due&&s.due<today());const pending=scoped('expenses').filter(e=>e.status==='En attente');openModal('Notifications',`<div class="detail-list">${low.map(p=>`<p>${h(p.name)}<strong>${stock(p)} disponible(s)</strong></p>`).join('')}${debts.map(s=>`<p>Échéance dépassée : ${h(s.number)}<strong>${usd(s.balance)}</strong></p>`).join('')}${pending.map(e=>`<p>Dépense en attente : ${h(e.number)}<strong>${usd(e.amount)}</strong></p>`).join('')}${!low.length&&!debts.length&&!pending.length?'<p>Aucune alerte.</p>':''}</div>`);return;}
  if(action.endsWith('.export')){const prefix=action.split('.')[0];if(prefix==='needs')exportExcel('besoins',productRows().filter(r=>r.Stock<=r['Seuil alerte']));else if(prefix==='cash')exportExcel('caisse',filtered(scoped('cash')).map(c=>({Date:date(c.date),Sens:c.direction,Catégorie:c.category,Mode:c.mode,Montant:c.amount,Motif:c.note})));else if(prefix==='finance')exportExcel('finance',scoped('cash').filter(inPeriod).map(c=>({Date:date(c.date),Sens:c.direction,Catégorie:c.category,Montant:c.amount,Mode:c.mode})));else exportExcel('ventes',filtered(scoped('sales').filter(inPeriod)).map(s=>({Facture:s.number,Date:date(s.date),Client:s.client,Agence:state.branches.find(b=>b.id===s.branchId)?.name,Total:s.total-(s.credited||0),Payé:s.paid,Solde:s.balance,Statut:s.status})));return;}
  if(action==='report.print'){const m=metrics();openModal('Rapport de gestion',`<article class="print-document"><h1>${h(state.company.name)}</h1><p>${h(state.branches.find(b=>b.id===branch)?.name)} · ${today()}</p><h2>Rapport · ${h(period)}</h2><div class="detail-list"><p>Ventes<strong>${usd(m.revenue)}</strong></p><p>Encaissements<strong>${usd(m.receipts)}</strong></p><p>Coût des articles<strong>${usd(m.cost)}</strong></p><p>Dépenses<strong>${usd(m.expenses)}</strong></p><p>Résultat opérationnel<strong>${usd(m.net)}</strong></p></div></article><div class="actions dialog-actions">${button('print','Imprimer / PDF','printer')}</div>`);return;}
}
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;el.disabled=true;try{await handleAction(el.dataset.action,el.dataset.id);}catch(err){toast(err.message);}finally{el.disabled=false;}});
document.addEventListener('submit',async e=>{
  const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;const data=formData(form);const action=form.dataset.form;const error=form.querySelector('.error');
  try {
    if(action==='login'||action==='setup'){await api(action,data);await refresh();renderShell();return;}
    if(form.dataset.id)data.id=form.dataset.id;
    if(action==='sale.create'){
      if(!cart.length)throw new Error('Ajoutez un article au panier.');
      const payload={action,branchId:branch,requestId:crypto.randomUUID(),...data,lines:cart.map(l=>({productId:l.productId,qty:l.qty}))};
      let result;
      try {result=await api('action',payload);}catch(err){if(err.network){if(confirm('Le serveur est injoignable. Conserver cette vente dans la file de synchronisation ?')){queue.push(payload);saveQueue();cart=[];renderContent();toast('Vente conservée localement. Le stock sera vérifié lors de la synchronisation.');return;}}throw err;}
      cart=[];await refresh();view='sales';renderShell();toast('Vente enregistrée.');documentDetail('sales',result.document.id);return;
    }
    if(action==='purchase.create'||action==='quote.create')data.lines=documentLines;
    if(action==='purchase.receive')data.lines=Object.entries(data).filter(([k])=>k.startsWith('receive_')).map(([k,v])=>({productId:k.slice(8),qty:v}));
    if(action==='inventory.create')data.lines=Object.entries(data).filter(([k])=>k.startsWith('count_')).map(([k,v])=>({productId:k.slice(6),counted:v}));
    const result=await mutate(action,data);$('modal').close();if(result.document && action==='quote.convert'){view='sales';renderShell();documentDetail('sales',result.document.id);}
  }catch(err){if(error?.isConnected)error.textContent=err.message;else toast(err.message);}finally{submit.disabled=false;}
});
document.addEventListener('input',e=>{
  if(e.target.id==='search'){query=e.target.value;page=1;clearTimeout(window.searchTimer);window.searchTimer=setTimeout(renderContent,180);}
  if(e.target.dataset.qty){const l=cart.find(l=>l.productId===e.target.dataset.qty);const qty=Number(e.target.value);if(l&&Number.isInteger(qty)&&qty>0){l.qty=qty;e.target.closest('.qty').querySelector('b').textContent=usd(l.qty*l.price);updateCartTotals();}}
  if(e.target.name==='discount' && view==='pos' && !$('modal').open)updateCartTotals();
});
function updateCartTotals(){const form=document.querySelector('form[data-form="sale.create"]');if(!form)return;const total=Math.round(Math.max(0,cart.reduce((a,l)=>a+l.qty*l.price,0)-Number(form.elements.discount.value||0))*(1+state.company.tax/100)*100)/100;if(Number(form.elements.paid.value)===Number(form.dataset.total))form.elements.paid.value=total;form.dataset.total=total;$('cartTotal').textContent=usd(total);}
document.addEventListener('change',e=>{
  if(e.target.id==='agency'){if(cart.length&&!confirm('Changer d’agence et vider le panier ?')){e.target.value=branch;return;}branch=e.target.value;cart=[];page=1;renderContent();}
  if(e.target.name==='period'){period=e.target.value;page=1;renderContent();}
  if(e.target.name==='from'||e.target.name==='to'){if(e.target.name==='from')from=e.target.value;else to=e.target.value;renderContent();}
  if(e.target.name==='pickProduct'){const p=find('products',e.target.value);const f=e.target.closest('form');if(p&&f?.elements.pickPrice)f.elements.pickPrice.value=p.cost;}
});
window.addEventListener('resize',()=>{if(state&&['dashboard','reports'].includes(view))drawChart();});
window.addEventListener('online',()=>{if(state&&queue.length)syncQueue().catch(e=>toast(e.message));});
async function showLogin() {
  const status=await api('status');
  $('app').innerHTML=`<main class="auth"><section class="auth-panel"><div class="brand"><div class="brand-mark">H</div><div><strong>Garage Haojue</strong><small>Gestion & point de vente</small></div></div><h2>${status.setup?'Créer le compte administrateur':'Connexion'}</h2><form data-form="${status.setup?'setup':'login'}">${status.setup?field('name','Nom complet','','text','required autocomplete="name"'):''}${field('login','Identifiant','','text','required autocomplete="username"')}${field('password','Mot de passe','','password',`required ${status.setup?'minlength="10" autocomplete="new-password"':'autocomplete="current-password"'}`)}<button class="primary" type="submit">${icon('log-in')}${status.setup?'Créer le compte':'Se connecter'}</button><p class="error" role="alert"></p></form></section></main>`; icons();
}
async function boot(){try{await refresh();renderShell();}catch(e){if(e.status!==401){$('app').innerHTML=`<main class="auth"><section class="auth-panel"><h1>Garage Haojue</h1><p class="error">${h(e.message)}</p>${button('reload','Réessayer','refresh-cw')}</section></main>`;}else await showLogin();}}
document.addEventListener('click',e=>{if(e.target.closest('[data-action="reload"]'))boot();});
document.addEventListener('DOMContentLoaded',boot);
