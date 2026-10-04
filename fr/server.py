import argparse
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from decimal import Decimal, ROUND_HALF_UP

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('GARAGE_DB', str(ROOT / 'data' / 'garage.sqlite3')))
ROLES = {
    'Administrateur': ['*'],
    'Responsable': ['dashboard', 'pos', 'sales', 'products', 'clients', 'suppliers', 'purchases', 'stock', 'needs', 'cash', 'expenses', 'quotes', 'finance', 'reports', 'branches', 'audit', 'approve'],
    'Caissier': ['dashboard', 'pos', 'sales', 'products', 'clients', 'cash', 'quotes'],
    'Vendeur': ['dashboard', 'pos', 'sales', 'products', 'clients', 'quotes'],
    'Gestionnaire de stock': ['dashboard', 'products', 'suppliers', 'purchases', 'stock', 'needs'],
    'Comptable': ['dashboard', 'sales', 'clients', 'suppliers', 'purchases', 'cash', 'expenses', 'finance', 'reports', 'approve'],
    'Auditeur': ['dashboard', 'sales', 'products', 'clients', 'suppliers', 'purchases', 'stock', 'needs', 'cash', 'expenses', 'quotes', 'finance', 'reports', 'branches', 'audit'],
}
KINDS = ['products', 'clients', 'suppliers', 'sales', 'purchases', 'cash', 'cash_sessions', 'expenses', 'quotes', 'movements', 'inventories', 'transfers', 'payments']


def now():
    return datetime.now(timezone.utc).isoformat()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    con = sqlite3.connect(DB_PATH, timeout=15, factory=ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS branches(id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, phone TEXT, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT UNIQUE NOT NULL COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL, branch_id TEXT REFERENCES branches(id), active INTEGER NOT NULL DEFAULT 1, failures INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, branch_id TEXT REFERENCES branches(id), data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS records_kind ON records(kind, branch_id);
        CREATE TABLE IF NOT EXISTS stocks(product_id TEXT REFERENCES records(id), branch_id TEXT REFERENCES branches(id), qty INTEGER NOT NULL CHECK(qty >= 0), PRIMARY KEY(product_id, branch_id));
        CREATE TABLE IF NOT EXISTS sequences(name TEXT PRIMARY KEY, value INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, user_id TEXT, branch_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        con.execute("INSERT OR IGNORE INTO branches VALUES('main', 'Garage Haojue', '', '', 1)")
        con.execute("INSERT OR IGNORE INTO settings VALUES('company', ?)", (json.dumps({'name': 'Garage Haojue', 'address': '', 'phone': '', 'tax': 0, 'currency': 'USD'}),))


def password_hash(password):
    require(isinstance(password, str) and len(password) >= 10, 'Le mot de passe doit contenir au moins 10 caractères.')
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()
    return salt + ':' + digest


def password_valid(password, encoded):
    salt, expected = encoded.split(':')
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()
    return hmac.compare_digest(digest, expected)


class RuleError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RuleError(message)


def text_value(value, label, required=True):
    value = str(value or '').strip()
    require(not required or value, label + ' obligatoire.')
    require(len(value) <= 3000, label + ' trop long.')
    return value


def amount(value):
    try:
        n = Decimal(str(value or 0))
        require(n.is_finite() and n >= 0 and n <= 1000000000, 'Montant invalide.')
        return float(n.quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
    except (ValueError, ArithmeticError):
        raise RuleError('Montant invalide.')


def quantity(value, zero=False):
    try:
        n = float(value)
        require(math.isfinite(n) and n.is_integer() and (n >= 0 if zero else n > 0) and n <= 10000000, 'Quantité entière invalide.')
        return int(n)
    except (ValueError, TypeError):
        raise RuleError('Quantité invalide.')


def number(con, prefix):
    con.execute('INSERT INTO sequences VALUES(?, 1) ON CONFLICT(name) DO UPDATE SET value=value+1', (prefix,))
    n = con.execute('SELECT value FROM sequences WHERE name=?', (prefix,)).fetchone()[0]
    return f'{prefix}-{n:05d}'


def put(con, kind, data, branch=None):
    data.setdefault('id', secrets.token_hex(12))
    data.setdefault('date', now())
    if branch:
        data['branchId'] = branch
    con.execute('INSERT INTO records VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', (data['id'], kind, branch, json.dumps(data, ensure_ascii=False)))
    return data


def get(con, kind, record_id):
    row = con.execute('SELECT data FROM records WHERE kind=? AND id=?', (kind, record_id)).fetchone()
    require(row is not None, 'Enregistrement introuvable.')
    return json.loads(row[0])


def records(con, kind, branch=None):
    query = 'SELECT data FROM records WHERE kind=?'
    args = [kind]
    if branch:
        query += ' AND (branch_id=? OR branch_id IS NULL)'
        args.append(branch)
    return [json.loads(row[0]) for row in con.execute(query + ' ORDER BY rowid DESC', args)]


def permissions(user):
    return ROLES[user['role']]


def can(user, permission):
    return '*' in permissions(user) or permission in permissions(user)


def authorize(user, permission, write=True):
    require(can(user, permission), 'Accès non autorisé à ce module.')
    require(not write or user['role'] != 'Auditeur', 'Ce compte dispose uniquement de la consultation.')


def branch_access(con, user, branch):
    row = con.execute('SELECT * FROM branches WHERE id=? AND active=1', (branch,)).fetchone()
    require(row is not None, 'Agence inactive ou introuvable.')
    require(user['branch_id'] is None or user['branch_id'] == branch, 'Cette agence ne vous est pas autorisée.')


def scoped(con, user, kind, record_id):
    doc = get(con, kind, record_id)
    if doc.get('branchId'):
        branch_access(con, user, doc['branchId'])
    return doc


def log(con, user, branch, action, detail):
    con.execute('INSERT INTO audit(date,user_id,branch_id,action,detail) VALUES(?,?,?,?,?)', (now(), user['id'], branch, action, detail))


def stock_qty(con, product_id, branch):
    row = con.execute('SELECT qty FROM stocks WHERE product_id=? AND branch_id=?', (product_id, branch)).fetchone()
    return row[0] if row else 0


def move_stock(con, product, branch, delta, reason, user):
    if product.get('type') == 'Service':
        return
    before = stock_qty(con, product['id'], branch)
    after = before + delta
    require(after >= 0, f"Stock insuffisant : {product['name']} ({before} disponible(s)).")
    con.execute('INSERT INTO stocks VALUES(?,?,?) ON CONFLICT(product_id,branch_id) DO UPDATE SET qty=excluded.qty', (product['id'], branch, after))
    put(con, 'movements', {'productId': product['id'], 'product': product['name'], 'delta': delta, 'before': before, 'after': after, 'reason': reason, 'user': user['name']}, branch)


def cash_entry(con, branch, user, direction, value, category, mode, note, source=None):
    if not value:
        return
    put(con, 'cash', {'direction': direction, 'amount': amount(value), 'category': category, 'mode': mode, 'note': note, 'source': source, 'user': user['name']}, branch)


def sale_lines(con, incoming, purchase=False):
    require(isinstance(incoming, list) and 0 < len(incoming) <= 200, 'Ajoutez au moins un article (200 maximum).')
    result = []
    seen = set()
    for item in incoming:
        product = get(con, 'products', item.get('productId'))
        require(product.get('active', True), 'Produit désactivé.')
        require(product['id'] not in seen, 'Regroupez les quantités du même article.')
        seen.add(product['id'])
        qty = quantity(item.get('qty'))
        price = amount(item.get('price', product['cost']) if purchase else product['price'])
        result.append({'productId': product['id'], 'name': product['name'], 'code': product['code'], 'qty': qty, 'price': price, 'cost': product['cost'], 'received': 0, 'returned': 0, 'type': product.get('type', 'Pièce')})
    return result


def totals(con, lines, discount):
    subtotal = amount(sum(line['qty'] * line['price'] for line in lines))
    discount = amount(discount)
    require(discount <= subtotal, 'La remise dépasse le sous-total.')
    tax_rate = json.loads(con.execute("SELECT value FROM settings WHERE key='company'").fetchone()[0])['tax']
    tax = amount((subtotal - discount) * tax_rate / 100)
    return {'subtotal': subtotal, 'discount': discount, 'tax': tax, 'taxRate': tax_rate, 'total': amount(subtotal - discount + tax)}


def create_sale(con, user, branch, data, lines=None):
    lines = lines or sale_lines(con, data.get('lines'))
    sums = totals(con, lines, data.get('discount', 0))
    paid = amount(data.get('paid'))
    require(paid <= sums['total'], 'Le montant payé dépasse le total.')
    client = get(con, 'clients', data['clientId']) if data.get('clientId') else None
    require(not client or client.get('active', True), 'Client désactivé.')
    if paid < sums['total']:
        require(client is not None, 'Sélectionnez un client pour une vente à crédit.')
        require(data.get('due'), 'Date d’échéance obligatoire pour le crédit.')
        datetime.fromisoformat(data['due'])
        debt = sum(s['balance'] for s in records(con, 'sales') if s.get('clientId') == client['id'] and s['status'] != 'Annulée')
        require(not client.get('creditLimit') or debt + sums['total'] - paid <= client['creditLimit'], 'La limite de crédit du client est dépassée.')
    sale = {'number': number(con, 'FAC'), 'clientId': client['id'] if client else None, 'client': client['name'] if client else 'Client comptant', 'lines': lines, **sums, 'paid': paid, 'balance': amount(sums['total'] - paid), 'mode': data.get('mode', 'Espèces'), 'due': data.get('due', ''), 'note': text_value(data.get('note'), 'Observation', False), 'status': 'Validée', 'user': user['name']}
    put(con, 'sales', sale, branch)
    for line in lines:
        move_stock(con, get(con, 'products', line['productId']), branch, -line['qty'], sale['number'], user)
    cash_entry(con, branch, user, 'in', paid, 'Vente', sale['mode'], sale['number'], sale['id'])
    if paid:
        put(con, 'payments', {'source': sale['id'], 'amount': paid, 'mode': sale['mode'], 'user': user['name']}, branch)
    return sale


def action(con, user, data):
    name = data.get('action')
    branch = data.get('branchId') or user['branch_id'] or 'main'
    branch_access(con, user, branch)
    result = {'message': 'Opération enregistrée.'}
    if name == 'product.save':
        authorize(user, 'products')
        old = get(con, 'products', data['id']) if data.get('id') else None
        code = old['code'] if old else number(con, 'HJ')
        product = {'id': old['id'] if old else secrets.token_hex(12), 'code': code, 'reference': old['reference'] if old else 'REF-' + code, 'name': text_value(data.get('name'), 'Désignation'), 'type': data.get('type', 'Pièce'), 'category': text_value(data.get('category'), 'Catégorie'), 'price': amount(data.get('price')), 'cost': amount(data.get('cost')), 'minStock': quantity(data.get('minStock', 0), True), 'unit': text_value(data.get('unit'), 'Unité', False), 'location': text_value(data.get('location'), 'Emplacement', False), 'models': text_value(data.get('models'), 'Compatibilité', False), 'barcode': text_value(data.get('barcode'), 'Code-barres', False), 'active': data.get('active', True), 'history': old.get('history', []) if old else []}
        require(product['type'] in ['Pièce', 'Moto', 'Accessoire', 'Lubrifiant', 'Service'], 'Type de produit invalide.')
        if old and (old['price'] != product['price'] or old['cost'] != product['cost']):
            product['history'].append({'date': now(), 'price': product['price'], 'cost': product['cost'], 'user': user['name']})
        put(con, 'products', product)
        if not old:
            move_stock(con, product, branch, quantity(data.get('stock', 0), True), 'Stock initial', user)
        result['id'] = product['id']
    elif name == 'product.delete':
        authorize(user, 'products')
        product = get(con, 'products', data['id'])
        used = any(any(l['productId'] == product['id'] for l in doc.get('lines', [])) for kind in ['sales', 'purchases', 'quotes'] for doc in records(con, kind))
        require(not used, 'Produit utilisé dans un document. Désactivez-le pour conserver l’historique.')
        require(not con.execute('SELECT 1 FROM stocks WHERE product_id=? AND qty>0', (product['id'],)).fetchone(), 'Le stock doit être nul avant la suppression.')
        con.execute('DELETE FROM stocks WHERE product_id=?', (product['id'],))
        con.execute('DELETE FROM records WHERE id=?', (product['id'],))
    elif name in ['client.save', 'supplier.save']:
        kind = 'clients' if name == 'client.save' else 'suppliers'
        authorize(user, kind)
        old = get(con, kind, data['id']) if data.get('id') else {}
        doc = {**old, 'name': text_value(data.get('name'), 'Nom'), 'phone': text_value(data.get('phone'), 'Téléphone', False), 'email': text_value(data.get('email'), 'E-mail', False), 'address': text_value(data.get('address'), 'Adresse', False), 'terms': text_value(data.get('terms'), 'Conditions', False), 'active': data.get('active', True)}
        if kind == 'clients':
            doc['creditLimit'] = amount(data.get('creditLimit'))
        put(con, kind, doc)
    elif name == 'sale.create':
        authorize(user, 'pos')
        result['document'] = create_sale(con, user, branch, data)
    elif name == 'sale.cancel':
        authorize(user, 'approve')
        sale = scoped(con, user, 'sales', data['id'])
        require(sale['status'] == 'Validée', 'Cette vente ne peut plus être annulée.')
        require(not any(l.get('returned') for l in sale['lines']), 'Cette vente comporte un retour. Effectuez les retours restants.')
        sale['reason'] = text_value(data.get('reason'), 'Motif')
        sale['status'] = 'Annulée'
        for line in sale['lines']:
            move_stock(con, get(con, 'products', line['productId']), sale['branchId'], line['qty'], 'Annulation ' + sale['number'], user)
        cash_entry(con, sale['branchId'], user, 'out', sale['paid'], 'Remboursement', sale['mode'], sale['reason'], sale['id'])
        sale['balance'] = 0
        put(con, 'sales', sale, sale['branchId'])
    elif name == 'sale.return':
        authorize(user, 'approve')
        sale = scoped(con, user, 'sales', data['id'])
        require(sale['status'] in ['Validée', 'Retour partiel'], 'Vente non retournable.')
        line = next((l for l in sale['lines'] if l['productId'] == data.get('productId')), None)
        require(line is not None, 'Article introuvable dans la vente.')
        qty = quantity(data.get('qty'))
        require(qty <= line['qty'] - line.get('returned', 0), 'Quantité supérieure au solde retournable.')
        reason = text_value(data.get('reason'), 'Motif du retour')
        # Allocate invoice discount and tax proportionally; the last return absorbs rounding.
        credit = amount(line['price'] * qty * sale['total'] / sale['subtotal']) if sale['subtotal'] else 0
        previous = sale.get('credited', 0)
        line['returned'] = line.get('returned', 0) + qty
        full = all(l.get('returned', 0) == l['qty'] for l in sale['lines'])
        credit = amount(sale['total'] - previous) if full else min(credit, amount(sale['total'] - previous))
        sale['credited'] = amount(previous + credit)
        reduction = min(sale['balance'], credit)
        refund = amount(credit - reduction)
        sale['balance'] = amount(sale['balance'] - reduction)
        sale['paid'] = amount(sale['paid'] - refund)
        sale['status'] = 'Retournée' if full else 'Retour partiel'
        if not data.get('damaged'):
            move_stock(con, get(con, 'products', line['productId']), sale['branchId'], qty, 'Retour ' + sale['number'], user)
        cash_entry(con, sale['branchId'], user, 'out', refund, 'Remboursement', sale['mode'], reason, sale['id'])
        sale.setdefault('returns', []).append({'number': number(con, 'AVO'), 'date': now(), 'product': line['name'], 'qty': qty, 'amount': credit, 'reason': reason, 'damaged': bool(data.get('damaged'))})
        put(con, 'sales', sale, sale['branchId'])
    elif name in ['sale.pay', 'purchase.pay']:
        kind = 'sales' if name == 'sale.pay' else 'purchases'
        authorize(user, 'cash')
        doc = scoped(con, user, kind, data['id'])
        require(doc['status'] not in ['Annulée', 'Retournée'], 'Document annulé ou retourné.')
        value = amount(data.get('amount'))
        require(0 < value <= doc['balance'], 'Le paiement doit être positif et ne pas dépasser le solde.')
        doc['paid'] = amount(doc['paid'] + value)
        doc['balance'] = amount(doc['balance'] - value)
        put(con, kind, doc, doc['branchId'])
        put(con, 'payments', {'source': doc['id'], 'amount': value, 'mode': data.get('mode', 'Espèces'), 'user': user['name']}, doc['branchId'])
        cash_entry(con, doc['branchId'], user, 'in' if kind == 'sales' else 'out', value, 'Paiement client' if kind == 'sales' else 'Paiement fournisseur', data.get('mode', 'Espèces'), doc['number'], doc['id'])
    elif name == 'purchase.create':
        authorize(user, 'purchases')
        supplier = get(con, 'suppliers', data.get('supplierId'))
        require(supplier.get('active', True), 'Fournisseur désactivé.')
        lines = sale_lines(con, data.get('lines'), True)
        require(all(l['type'] != 'Service' for l in lines), 'Un service ne peut pas être réceptionné en stock.')
        total = amount(sum(l['qty'] * l['price'] for l in lines))
        paid = amount(data.get('paid'))
        require(paid <= total, 'Le paiement dépasse le montant de la commande.')
        doc = put(con, 'purchases', {'number': number(con, 'ACH'), 'supplierId': supplier['id'], 'supplier': supplier['name'], 'lines': lines, 'total': total, 'paid': paid, 'balance': amount(total - paid), 'expected': data.get('expected', ''), 'status': 'Commandé', 'mode': data.get('mode', 'Espèces'), 'user': user['name'], 'note': data.get('note', '')}, branch)
        cash_entry(con, branch, user, 'out', paid, 'Achat', doc['mode'], doc['number'], doc['id'])
        if paid:
            put(con, 'payments', {'source': doc['id'], 'amount': paid, 'mode': doc['mode'], 'user': user['name']}, branch)
        result['document'] = doc
    elif name == 'purchase.receive':
        authorize(user, 'purchases')
        doc = scoped(con, user, 'purchases', data['id'])
        require(doc['status'] in ['Commandé', 'Partiellement reçu'], 'Commande non réceptionnable.')
        received_any = False
        for incoming in data.get('lines', []):
            line = next((l for l in doc['lines'] if l['productId'] == incoming.get('productId')), None)
            require(line is not None, 'Article absent de la commande.')
            qty = quantity(incoming.get('qty'), True)
            require(qty <= line['qty'] - line['received'], 'La réception dépasse la quantité restante.')
            if qty:
                received_any = True
                line['received'] += qty
                move_stock(con, get(con, 'products', line['productId']), doc['branchId'], qty, 'Réception ' + doc['number'], user)
        require(received_any, 'Saisissez une quantité reçue positive.')
        doc['status'] = 'Reçu' if all(l['received'] == l['qty'] for l in doc['lines']) else 'Partiellement reçu'
        put(con, 'purchases', doc, doc['branchId'])
    elif name == 'inventory.create':
        authorize(user, 'stock')
        lines = []
        for incoming in data.get('lines', []):
            product = get(con, 'products', incoming.get('productId'))
            require(product.get('type') != 'Service', 'Un service ne possède pas de stock.')
            require(not any(l['productId'] == product['id'] for l in lines), 'Produit répété dans l’inventaire.')
            lines.append({'productId': product['id'], 'name': product['name'], 'before': stock_qty(con, product['id'], branch), 'counted': quantity(incoming.get('counted'), True)})
        require(lines, 'Inventaire vide.')
        put(con, 'inventories', {'number': number(con, 'INV'), 'lines': lines, 'reason': text_value(data.get('reason'), 'Justification'), 'status': 'En attente', 'user': user['name']}, branch)
    elif name == 'inventory.approve':
        authorize(user, 'approve')
        doc = scoped(con, user, 'inventories', data['id'])
        require(doc['status'] == 'En attente', 'Inventaire déjà validé.')
        for line in doc['lines']:
            require(stock_qty(con, line['productId'], doc['branchId']) == line['before'], 'Le stock a changé depuis le comptage. Recommencez l’inventaire.')
            move_stock(con, get(con, 'products', line['productId']), doc['branchId'], line['counted'] - line['before'], doc['number'] + ' : ' + doc['reason'], user)
        doc['status'] = 'Validé'
        doc['approvedBy'] = user['name']
        put(con, 'inventories', doc, doc['branchId'])
    elif name == 'stock.transfer':
        authorize(user, 'stock')
        target = data.get('target')
        branch_access(con, user, target)
        require(branch != target, 'Choisissez une autre agence.')
        product = get(con, 'products', data.get('productId'))
        require(product.get('type') != 'Service', 'Un service ne peut pas être transféré.')
        qty = quantity(data.get('qty'))
        reason = text_value(data.get('reason'), 'Motif')
        ref = number(con, 'TRF')
        move_stock(con, product, branch, -qty, ref, user)
        move_stock(con, product, target, qty, ref, user)
        put(con, 'transfers', {'number': ref, 'product': product['name'], 'qty': qty, 'target': target, 'reason': reason, 'user': user['name']}, branch)
    elif name == 'cash.manual':
        authorize(user, 'cash')
        require(data.get('direction') in ['in', 'out'], 'Sens de mouvement invalide.')
        value = amount(data.get('amount'))
        require(value > 0, 'Montant positif obligatoire.')
        cash_entry(con, branch, user, data['direction'], value, data.get('category', 'Autres'), data.get('mode', 'Espèces'), text_value(data.get('note'), 'Motif'))
    elif name == 'cash.open':
        authorize(user, 'cash')
        require(not any(s['status'] == 'Ouverte' for s in records(con, 'cash_sessions', branch)), 'Une caisse est déjà ouverte pour cette agence.')
        value = amount(data.get('amount'))
        # The opening float is an observed balance, not a new accounting receipt.
        put(con, 'cash_sessions', {'number': number(con, 'CAI'), 'opening': value, 'status': 'Ouverte', 'user': user['name']}, branch)
    elif name == 'cash.close':
        authorize(user, 'cash')
        doc = scoped(con, user, 'cash_sessions', data['id'])
        require(doc['status'] == 'Ouverte', 'Caisse déjà clôturée.')
        movement_total = sum((c['amount'] if c['direction'] == 'in' else -c['amount']) for c in records(con, 'cash', doc['branchId']) if c['date'] >= doc['date'] and c['mode'] == 'Espèces')
        doc['theoretical'] = round(doc['opening'] + movement_total, 2)
        doc['actual'] = amount(data.get('amount'))
        doc['gap'] = round(doc['actual'] - doc['theoretical'], 2)
        doc['reason'] = text_value(data.get('reason'), 'Justification', bool(doc['gap']))
        doc['status'] = 'En attente'
        doc['closedAt'] = now()
        put(con, 'cash_sessions', doc, doc['branchId'])
    elif name == 'cash.approve':
        authorize(user, 'approve')
        doc = scoped(con, user, 'cash_sessions', data['id'])
        require(doc['status'] == 'En attente', 'Clôture non disponible.')
        doc['status'] = 'Clôturée'
        doc['approvedBy'] = user['name']
        put(con, 'cash_sessions', doc, doc['branchId'])
    elif name == 'expense.create':
        authorize(user, 'expenses')
        value = amount(data.get('amount'))
        require(value > 0, 'Montant positif obligatoire.')
        put(con, 'expenses', {'number': number(con, 'DEP'), 'category': text_value(data.get('category'), 'Catégorie'), 'beneficiary': text_value(data.get('beneficiary'), 'Bénéficiaire'), 'amount': value, 'mode': data.get('mode', 'Espèces'), 'note': text_value(data.get('note'), 'Motif'), 'reference': text_value(data.get('reference'), 'Justificatif', False), 'status': 'En attente', 'user': user['name']}, branch)
    elif name in ['expense.approve', 'expense.reject']:
        authorize(user, 'approve')
        doc = scoped(con, user, 'expenses', data['id'])
        require(doc['status'] == 'En attente', 'Dépense déjà traitée.')
        doc['status'] = 'Validée' if name == 'expense.approve' else 'Rejetée'
        doc['approvedBy'] = user['name']
        if name == 'expense.approve':
            cash_entry(con, doc['branchId'], user, 'out', doc['amount'], doc['category'], doc['mode'], doc['number'] + ' : ' + doc['note'], doc['id'])
        put(con, 'expenses', doc, doc['branchId'])
    elif name == 'quote.create':
        authorize(user, 'quotes')
        client = get(con, 'clients', data.get('clientId'))
        lines = sale_lines(con, data.get('lines'))
        valid = text_value(data.get('validUntil'), 'Validité')
        datetime.fromisoformat(valid)
        put(con, 'quotes', {'number': number(con, 'DEV'), 'clientId': client['id'], 'client': client['name'], 'lines': lines, **totals(con, lines, data.get('discount', 0)), 'validUntil': valid, 'note': data.get('note', ''), 'status': 'En attente', 'user': user['name']}, branch)
    elif name == 'quote.convert':
        authorize(user, 'quotes')
        authorize(user, 'pos')
        doc = scoped(con, user, 'quotes', data['id'])
        require(doc['status'] == 'En attente', 'Ce devis est déjà traité.')
        require(doc['validUntil'] >= datetime.now(timezone.utc).date().isoformat(), 'Devis expiré.')
        payload = {**data, 'clientId': doc['clientId'], 'discount': doc['discount'], 'note': doc['number']}
        require(totals(con, doc['lines'], doc['discount'])['taxRate'] == doc['taxRate'], 'Le taux de taxe a changé. Créez un nouveau devis.')
        sale = create_sale(con, user, doc['branchId'], payload, doc['lines'])
        doc['status'] = 'Transformé'
        doc['saleId'] = sale['id']
        put(con, 'quotes', doc, doc['branchId'])
        result['document'] = sale
    elif name == 'quote.cancel':
        authorize(user, 'quotes')
        doc = scoped(con, user, 'quotes', data['id'])
        require(doc['status'] == 'En attente', 'Ce devis est déjà traité.')
        doc['status'] = 'Annulé'
        put(con, 'quotes', doc, doc['branchId'])
    elif name == 'branch.save':
        authorize(user, 'users')
        bid = data.get('id') or secrets.token_hex(12)
        require(data.get('active', True) or bid != branch, 'Impossible de désactiver l’agence courante.')
        con.execute('INSERT INTO branches VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,phone=excluded.phone,active=excluded.active', (bid, text_value(data.get('name'), 'Nom'), data.get('address', ''), data.get('phone', ''), int(bool(data.get('active', True)))))
    elif name == 'user.save':
        authorize(user, 'users')
        uid = data.get('id') or secrets.token_hex(12)
        old = con.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        role = data.get('role')
        require(role in ROLES, 'Rôle inconnu.')
        active = int(bool(data.get('active', True)))
        require(uid != user['id'] or (role == 'Administrateur' and active), 'Vous ne pouvez pas retirer vos propres droits administrateur.')
        bid = data.get('userBranch') or None
        require(bid is None or con.execute('SELECT 1 FROM branches WHERE id=? AND active=1', (bid,)).fetchone(), 'Agence inconnue.')
        require(role in ['Administrateur', 'Responsable', 'Comptable', 'Auditeur'] or bid, 'Affectez ce profil à une agence.')
        encoded = password_hash(data['password']) if data.get('password') else (old['password'] if old else password_hash(''))
        con.execute('INSERT INTO users(id,name,login,password,role,branch_id,active) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,login=excluded.login,password=excluded.password,role=excluded.role,branch_id=excluded.branch_id,active=excluded.active,failures=0,locked_until=0', (uid, text_value(data.get('name'), 'Nom'), text_value(data.get('login'), 'Identifiant'), encoded, role, bid, active))
        if old:
            con.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
    elif name == 'password.change':
        require(password_valid(data.get('current', ''), user['password']), 'Mot de passe actuel incorrect.')
        con.execute('UPDATE users SET password=? WHERE id=?', (password_hash(data.get('password', '')), user['id']))
        con.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        result['logout'] = True
    elif name == 'settings.save':
        authorize(user, 'users')
        tax = amount(data.get('tax'))
        require(tax <= 100, 'Le taux de taxe doit être entre 0 et 100 %.')
        company = {'name': text_value(data.get('name'), 'Nom'), 'address': data.get('address', ''), 'phone': data.get('phone', ''), 'tax': tax, 'currency': 'USD'}
        con.execute("UPDATE settings SET value=? WHERE key='company'", (json.dumps(company),))
    elif name == 'products.import':
        authorize(user, 'products')
        rows = data.get('rows', [])
        require(isinstance(rows, list) and 0 < len(rows) <= 5000, 'Import limité à 5 000 lignes.')
        count = 0
        for row in rows:
            # Imports append new products; stock corrections use the inventory approval workflow.
            action(con, user, {**row, 'id': None, 'action': 'product.save', 'branchId': branch})
            count += 1
        result['message'] = f'{count} produit(s) importé(s).'
    else:
        raise RuleError('Opération inconnue.')
    log(con, user, branch, name, str(data.get('id') or result.get('document', {}).get('number') or result.get('id') or result['message']))
    return result


def state_for(con, user):
    branch = user['branch_id']
    result = {'user': {k: user[k] for k in ['id', 'name', 'login', 'role', 'branch_id']}, 'permissions': permissions(user), 'roles': ROLES if can(user, 'users') else {}, 'company': json.loads(con.execute("SELECT value FROM settings WHERE key='company'").fetchone()[0]), 'serverTime': now()}
    result['branches'] = [dict(row) for row in con.execute('SELECT * FROM branches' + (' WHERE id=?' if branch else ''), (branch,) if branch else ())]
    access = {'products': ['products', 'pos', 'purchases', 'stock'], 'clients': ['clients'], 'suppliers': ['suppliers'], 'sales': ['sales', 'finance', 'reports'], 'purchases': ['purchases', 'finance', 'reports'], 'cash': ['cash', 'finance', 'reports'], 'cash_sessions': ['cash'], 'expenses': ['expenses', 'finance', 'reports'], 'quotes': ['quotes'], 'movements': ['stock', 'reports'], 'inventories': ['stock'], 'transfers': ['stock'], 'payments': ['cash', 'finance']}
    for kind in KINDS:
        result[kind] = records(con, kind, branch) if any(can(user, perm) for perm in access[kind]) else []
    # Dashboard indicators are computed on the server, including for profiles without ledger access.
    sales = records(con, 'sales', branch)
    cash = records(con, 'cash', branch)
    result['daily'] = {}
    for doc in sales:
        if doc['status'] != 'Annulée':
            day = doc['date'][:10]
            row = result['daily'].setdefault(day, {'sales': 0, 'paid': 0, 'credit': 0, 'cost': 0, 'expenses': 0})
            row['sales'] += doc['total'] - doc.get('credited', 0)
            row['credit'] += doc['balance']
            row['cost'] += sum((l['qty'] - l.get('returned', 0)) * l['cost'] for l in doc['lines'])
    for doc in cash:
        row = result['daily'].setdefault(doc['date'][:10], {'sales': 0, 'paid': 0, 'credit': 0, 'cost': 0, 'expenses': 0})
        if doc['category'] in ['Vente', 'Paiement client'] and doc['direction'] == 'in':
            row['paid'] += doc['amount']
        elif doc['category'] == 'Remboursement':
            row['paid'] -= doc['amount']
        elif doc['direction'] == 'out' and doc['category'] not in ['Achat', 'Paiement fournisseur']:
            row['expenses'] += doc['amount']
    if not any(can(user, permission) for permission in ['sales', 'finance', 'reports']):
        result['daily'] = {}
    result['stocks'] = [dict(row) for row in con.execute('SELECT * FROM stocks' + (' WHERE branch_id=?' if branch else ''), (branch,) if branch else ())] if result['products'] else []
    result['users'] = [dict(row) for row in con.execute('SELECT id,name,login,role,branch_id,active FROM users')] if can(user, 'users') else []
    result['audit'] = [dict(row) for row in con.execute('SELECT a.*,u.name AS user FROM audit a LEFT JOIN users u ON a.user_id=u.id' + (' WHERE a.branch_id=?' if branch else '') + ' ORDER BY a.id DESC LIMIT 1000', (branch,) if branch else ())] if can(user, 'audit') else []
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, body, cookie=None):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        cookie = cookie or getattr(self, 'session_cookie', None)
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(payload)

    def session_user(self, con):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        token = cookie.get('garage_session')
        row = con.execute('SELECT s.csrf,s.expires,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1', (hashlib.sha256(token.value.encode()).hexdigest() if token else '',)).fetchone()
        if not row or row['expires'] < time.time():
            return None
        self.session_cookie = 'garage_session=' + token.value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800'
        con.execute('UPDATE sessions SET expires=? WHERE token=?', (time.time() + 1800, hashlib.sha256(token.value.encode()).hexdigest()))
        return dict(row)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path.startswith('/api/'):
            with connect() as con:
                if path == '/api/status':
                    self.send_json(200, {'setup': con.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0})
                    return
                user = self.session_user(con)
                if not user:
                    self.send_json(401, {'error': 'Veuillez vous connecter.'})
                    return
                if path == '/api/state':
                    data = state_for(con, user)
                    data['csrf'] = user['csrf']
                    self.send_json(200, data)
                elif path == '/api/backup' and can(user, 'users'):
                    data = {'version': 1, 'date': now(), 'tables': {}}
                    for table in ['branches', 'users', 'records', 'stocks', 'sequences', 'settings', 'audit']:
                        data['tables'][table] = [dict(row) for row in con.execute('SELECT * FROM ' + table)]
                    self.send_json(200, data)
                else:
                    self.send_json(403, {'error': 'Accès non autorisé.'})
            return
        allowed = {'/', '/index.html', '/garage.html', '/garage.js', '/garage.css', '/vendor/lucide.min.js', '/vendor/xlsx.full.min.js', '/favicon.ico'}
        if path not in allowed:
            self.send_error(404)
            return
        if path in ['/', '/index.html']:
            self.path = '/garage.html'
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404)

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            self.send_json(403, {'error': 'Origine non autorisée.'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            require(0 < length <= 10_000_000, 'Requête trop volumineuse ou vide.')
            require(self.headers.get('Content-Type', '').startswith('application/json'), 'Format JSON requis.')
            data = json.loads(self.rfile.read(length))
            require(isinstance(data, dict), 'Requête invalide.')
            with connect() as con:
                # Serialize all writes so stock checks and document numbering are atomic.
                con.execute('BEGIN IMMEDIATE')
                if self.path in ['/api/login', '/api/setup']:
                    if self.path == '/api/setup':
                        require(con.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0, 'Configuration déjà effectuée.')
                        con.execute('INSERT INTO users(id,name,login,password,role,branch_id) VALUES(?,?,?,?,?,NULL)', (secrets.token_hex(12), text_value(data.get('name'), 'Nom'), text_value(data.get('login'), 'Identifiant'), password_hash(data.get('password', '')), 'Administrateur'))
                    row = con.execute('SELECT * FROM users WHERE login=? COLLATE NOCASE', (data.get('login', ''),)).fetchone()
                    require(row is not None and row['active'], 'Identifiant ou mot de passe incorrect.')
                    require(row['locked_until'] <= time.time(), 'Compte bloqué temporairement. Réessayez dans 15 minutes.')
                    if not password_valid(data.get('password', ''), row['password']):
                        failures = row['failures'] + 1
                        con.execute('UPDATE users SET failures=?,locked_until=? WHERE id=?', (failures, time.time() + 900 if failures >= 5 else 0, row['id']))
                        con.commit()
                        raise RuleError('Identifiant ou mot de passe incorrect.')
                    con.execute('UPDATE users SET failures=0,locked_until=0 WHERE id=?', (row['id'],))
                    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
                    con.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), row['id'], csrf, time.time() + 1800))
                    log(con, dict(row), row['branch_id'], 'connexion', 'Connexion réussie')
                    con.commit()
                    self.send_json(200, {'ok': True}, 'garage_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800')
                    return
                user = self.session_user(con)
                if not user:
                    self.send_json(401, {'error': 'Session expirée. Reconnectez-vous.'})
                    return
                require(hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), user['csrf']), 'Session invalide. Rechargez la page.')
                if self.path == '/api/logout':
                    cookie = SimpleCookie(self.headers.get('Cookie', ''))
                    con.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(cookie['garage_session'].value.encode()).hexdigest(),))
                    con.commit()
                    self.send_json(200, {'ok': True}, 'garage_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
                    return
                if self.path == '/api/action':
                    rid = text_value(data.get('requestId'), 'Identifiant de requête')
                    existing = con.execute('SELECT * FROM requests WHERE id=?', (rid,)).fetchone()
                    if existing:
                        require(existing['user_id'] == user['id'], 'Requête non autorisée.')
                        result = json.loads(existing['result'])
                    else:
                        result = action(con, user, data)
                        con.execute('INSERT INTO requests VALUES(?,?,?)', (rid, user['id'], json.dumps(result)))
                    con.commit()
                    try:
                        automatic_backup()
                    except (OSError, sqlite3.Error) as error:
                        print('Backup failed:', str(error), flush=True)
                    self.send_json(200, result)
                    return
                if self.path == '/api/restore':
                    authorize(user, 'users')
                    backup = data.get('backup', {})
                    require(backup.get('version') == 1 and set(backup.get('tables', {})) == {'branches', 'users', 'records', 'stocks', 'sequences', 'settings', 'audit'}, 'Sauvegarde incompatible.')
                    # Take a recoverable database snapshot before replacing its contents.
                    snapshot = DB_PATH.parent / ('before-restore-' + str(int(time.time())) + '.sqlite3')
                    with connect() as source, sqlite3.connect(snapshot) as target:
                        source.backup(target)
                    con.execute('DELETE FROM sessions')
                    con.execute('DELETE FROM requests')
                    for table in ['stocks', 'users', 'records', 'branches', 'sequences', 'settings', 'audit']:
                        con.execute('DELETE FROM ' + table)
                    for table in ['branches', 'users', 'records', 'stocks', 'sequences', 'settings', 'audit']:
                        cols = [r[1] for r in con.execute('PRAGMA table_info(' + table + ')')]
                        for row in backup['tables'][table]:
                            con.execute('INSERT INTO ' + table + '(' + ','.join(cols) + ') VALUES(' + ','.join('?' for _ in cols) + ')', tuple(row.get(c) for c in cols))
                    require(con.execute("SELECT 1 FROM users WHERE role='Administrateur' AND active=1").fetchone(), 'La sauvegarde doit contenir un administrateur actif.')
                    con.commit()
                    self.send_json(200, {'message': 'Sauvegarde restaurée. Reconnectez-vous.'})
                    return
                self.send_json(404, {'error': 'Route inconnue.'})
        except (RuleError, ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
            message = str(error) if isinstance(error, RuleError) else 'Données invalides ou identifiant déjà utilisé.'
            self.send_json(400, {'error': message})
        except Exception as error:
            print('API error:', type(error).__name__, str(error), flush=True)
            self.send_json(500, {'error': 'Erreur serveur. Aucune modification n’a été enregistrée.'})


def automatic_backup():
    directory = DB_PATH.parent / 'backups'
    directory.mkdir(exist_ok=True)
    target_path = directory / (datetime.now(timezone.utc).strftime('%Y-%m-%d-%H') + '.sqlite3')
    with connect() as source, sqlite3.connect(target_path) as target:
        source.backup(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5174)
    args = parser.parse_args()
    init_db()
    automatic_backup()
    print(f'Garage Haojue: http://localhost:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
