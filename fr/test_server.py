import copy
import http.cookiejar
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import os
from concurrent.futures import ThreadPoolExecutor

import server


class BusinessRules(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_path = server.DB_PATH
        server.DB_PATH = Path(self.temp.name) / 'test.sqlite3'
        server.init_db()
        self.user = {'id': 'admin', 'name': 'Admin', 'login': 'admin', 'role': 'Administrateur', 'branch_id': None}
        self.run_action('product.save', name='Bougie', category='Moteur', price=10, cost=4, stock=20, minStock=3)
        with server.connect() as con:
            self.product = server.records(con, 'products')[0]
        self.run_action('client.save', name='Client', creditLimit=100)
        self.run_action('supplier.save', name='Fournisseur')
        with server.connect() as con:
            self.client = server.records(con, 'clients')[0]
            self.supplier = server.records(con, 'suppliers')[0]

    def tearDown(self):
        server.DB_PATH = self.old_path
        self.temp.cleanup()

    def run_action(self, action, **data):
        with server.connect() as con:
            con.execute('BEGIN IMMEDIATE')
            return server.action(con, self.user, {'action': action, 'branchId': 'main', **data})

    def sale(self, qty=2, paid=20, **extras):
        return self.run_action('sale.create', lines=[{'productId': self.product['id'], 'qty': qty}], paid=paid, **extras)['document']

    def read(self, kind):
        with server.connect() as con:
            return server.records(con, kind)

    def qty(self, branch='main'):
        with server.connect() as con:
            return server.stock_qty(con, self.product['id'], branch)

    def test_sale_stock_and_historical_cost(self):
        sale = self.sale()
        self.assertEqual(self.qty(), 18)
        self.assertEqual(sale['total'], 20)
        self.assertEqual(sale['lines'][0]['cost'], 4)
        self.assertEqual(self.read('cash')[0]['amount'], 20)

    def test_insufficient_stock_rolls_back_everything(self):
        with self.assertRaises(server.RuleError):
            self.sale(21, 210)
        self.assertEqual(self.qty(), 20)
        self.assertEqual(self.read('sales'), [])
        self.assertEqual(self.read('cash'), [])

    def test_credit_payments_and_limit(self):
        sale = self.sale(paid=5, clientId=self.client['id'], due='2026-12-31')
        self.assertEqual(sale['balance'], 15)
        self.run_action('sale.pay', id=sale['id'], amount=10, mode='Mobile Money')
        self.assertEqual(self.read('sales')[0]['balance'], 5)
        with self.assertRaises(server.RuleError):
            self.run_action('sale.pay', id=sale['id'], amount=6)
        with self.assertRaises(server.RuleError):
            self.sale(qty=11, paid=0, clientId=self.client['id'], due='2026-12-31')

    def test_credit_requires_customer(self):
        with self.assertRaises(server.RuleError):
            self.sale(paid=0)

    def test_cancel_restores_stock_and_preserves_sale(self):
        sale = self.sale()
        self.run_action('sale.cancel', id=sale['id'], reason='Erreur de saisie')
        self.assertEqual(self.qty(), 20)
        self.assertEqual(self.read('sales')[0]['status'], 'Annulée')
        self.assertEqual(sum(c['amount'] if c['direction'] == 'in' else -c['amount'] for c in self.read('cash')), 0)
        with self.assertRaises(server.RuleError):
            self.run_action('sale.cancel', id=sale['id'], reason='Bis')

    def test_returns_proportion_discount_and_tax(self):
        self.run_action('settings.save', name='Garage', tax=10)
        sale = self.sale(qty=3, paid=27.5, discount=5)
        for _ in range(3):
            self.run_action('sale.return', id=sale['id'], productId=self.product['id'], qty=1, reason='Retour')
        doc = self.read('sales')[0]
        self.assertEqual(self.qty(), 20)
        self.assertEqual(doc['paid'], 0)
        self.assertEqual(doc['credited'], 27.5)
        self.assertEqual(doc['status'], 'Retournée')

    def test_damaged_return_reduces_debt_without_restock(self):
        sale = self.sale(paid=0, clientId=self.client['id'], due='2026-12-31')
        self.run_action('sale.return', id=sale['id'], productId=self.product['id'], qty=1, damaged=True, reason='Cassé')
        self.assertEqual(self.qty(), 18)
        self.assertEqual(self.read('sales')[0]['balance'], 10)
        self.assertEqual(self.read('cash'), [])

    def test_partial_purchase_receipts(self):
        purchase = self.run_action('purchase.create', supplierId=self.supplier['id'], lines=[{'productId':self.product['id'],'qty':5,'price':3}], paid=0)['document']
        self.assertEqual(self.qty(), 20)
        self.run_action('purchase.receive', id=purchase['id'], lines=[{'productId':self.product['id'],'qty':2}])
        self.assertEqual(self.qty(), 22)
        self.assertEqual(self.read('purchases')[0]['status'], 'Partiellement reçu')
        with self.assertRaises(server.RuleError):
            self.run_action('purchase.receive', id=purchase['id'], lines=[{'productId':self.product['id'],'qty':4}])
        self.run_action('purchase.receive', id=purchase['id'], lines=[{'productId':self.product['id'],'qty':3}])
        self.assertEqual(self.qty(), 25)
        self.assertEqual(self.read('purchases')[0]['status'], 'Reçu')

    def test_inventory_conflict_does_not_replace_new_stock(self):
        self.run_action('inventory.create', lines=[{'productId':self.product['id'],'counted':17}], reason='Comptage')
        inventory = self.read('inventories')[0]
        self.sale()
        with self.assertRaises(server.RuleError):
            self.run_action('inventory.approve', id=inventory['id'])
        self.assertEqual(self.qty(), 18)
        self.assertEqual(self.read('inventories')[0]['status'], 'En attente')

    def test_transfer_is_atomic(self):
        self.run_action('branch.save', id='second', name='Deuxième')
        self.run_action('stock.transfer', productId=self.product['id'], target='second', qty=3, reason='Réassort')
        self.assertEqual(self.qty(), 17)
        self.assertEqual(self.qty('second'), 3)
        with self.assertRaises(server.RuleError):
            self.run_action('stock.transfer', productId=self.product['id'], target='second', qty=100, reason='Erreur')
        self.assertEqual(self.qty('second'), 3)

    def test_expense_requires_approval(self):
        self.run_action('expense.create', category='Loyer', beneficiary='Bailleur', amount=25, note='Octobre')
        self.assertEqual(self.read('cash'), [])
        expense = self.read('expenses')[0]
        self.run_action('expense.approve', id=expense['id'])
        self.assertEqual(self.read('cash')[0]['amount'], 25)
        with self.assertRaises(server.RuleError):
            self.run_action('expense.approve', id=expense['id'])

    def test_cash_close_uses_only_cash_payments(self):
        self.run_action('cash.open', amount=50)
        session = self.read('cash_sessions')[0]
        self.sale(mode='Mobile Money')
        self.sale(mode='Espèces')
        self.run_action('cash.close', id=session['id'], amount=70)
        self.assertEqual(self.read('cash_sessions')[0]['theoretical'], 70)
        self.assertEqual(self.read('cash_sessions')[0]['gap'], 0)

    def test_quote_convert_once(self):
        self.run_action('quote.create', clientId=self.client['id'], validUntil='2099-01-01', lines=[{'productId':self.product['id'],'qty':2}])
        quote = self.read('quotes')[0]
        self.assertEqual(self.qty(), 20)
        self.run_action('quote.convert', id=quote['id'], paid=20)
        self.assertEqual(self.qty(), 18)
        with self.assertRaises(server.RuleError):
            self.run_action('quote.convert', id=quote['id'], paid=20)

    def test_import_invalid_line_rolls_back_all(self):
        with self.assertRaises(server.RuleError):
            self.run_action('products.import', rows=[{'name':'Valide','category':'Moteur','price':5,'stock':1},{'name':'Invalide','category':'Moteur','price':-1}])
        self.assertEqual(len(self.read('products')), 1)

    def test_code_never_reused_after_deletion(self):
        self.run_action('product.save', name='Vide', category='Autres', stock=0)
        new = self.read('products')[0]
        self.run_action('product.delete', id=new['id'])
        self.run_action('product.save', name='Suivant', category='Autres')
        self.assertNotEqual(self.read('products')[0]['code'], new['code'])

    def test_auditor_and_branch_permissions(self):
        self.user['role']='Auditeur'
        with self.assertRaises(server.RuleError):
            self.sale()
        self.user['role']='Caissier'
        self.user['branch_id']='main'
        with self.assertRaises(server.RuleError):
            self.run_action('settings.save', name='Garage', tax=0)
        with self.assertRaises(server.RuleError):
            with server.connect() as con:
                server.branch_access(con, self.user, 'other')

    def test_concurrent_sales_cannot_oversell(self):
        def attempt():
            try:
                self.sale(qty=15, paid=150)
                return True
            except server.RuleError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.qty(), 5)
        self.assertEqual(len(self.read('sales')), 1)

    def test_stock_profile_does_not_receive_financial_ledgers(self):
        self.sale()
        self.user['role'] = 'Gestionnaire de stock'
        self.user['branch_id'] = 'main'
        with server.connect() as con:
            state = server.state_for(con, self.user)
        self.assertEqual(state['sales'], [])
        self.assertEqual(state['cash'], [])
        self.assertEqual(state['daily'], {})
        self.assertEqual(state['users'], [])
        self.assertEqual(state['audit'], [])


class HTTPContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.port=5198
        env={**os.environ,'GARAGE_DB':str(Path(cls.temp.name)/'http.sqlite3')}
        cls.process=subprocess.Popen(['python',str(Path(server.__file__)),'--port',str(cls.port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.base=f'http://127.0.0.1:{cls.port}'
        cls.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        for _ in range(50):
            try:
                cls.request('status')
                break
            except urllib.error.URLError:
                time.sleep(.1)
        cls.request('setup',{'name':'Test','login':'admin-test','password':'Password-test-2026'})
        cls.state=cls.request('state')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.temp.cleanup()

    @classmethod
    def request(cls,route,data=None,csrf=True):
        headers={'Content-Type':'application/json'}
        if hasattr(cls,'state') and csrf:
            headers['X-CSRF-Token']=cls.state['csrf']
        req=urllib.request.Request(cls.base+'/api/'+route,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        with cls.opener.open(req,timeout=10) as res:
            return json.load(res)

    def test_passwords_not_exposed_and_database_not_served(self):
        self.assertNotIn('password',self.request('state')['users'][0])
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.opener.open(self.base+'/data/garage.sqlite3')
        self.assertEqual(ctx.exception.code,404)

    def test_csrf_rejects_writes(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.request('action',{'action':'client.save','name':'Bad','requestId':'bad'},csrf=False)
        self.assertEqual(ctx.exception.code,400)

    def test_request_retry_does_not_duplicate(self):
        payload={'action':'product.save','requestId':'unique-retry','name':'Retry','category':'Autres','stock':3}
        first=self.request('action',payload)
        second=self.request('action',payload)
        self.assertEqual(first,second)
        self.assertEqual(len([p for p in self.request('state')['products'] if p['name']=='Retry']),1)

    def test_backup_restore_cycle(self):
        backup=self.request('backup')
        self.assertEqual(backup['version'],1)
        result=self.request('restore',{'backup':backup})
        self.assertIn('restaurée',result['message'])
        self.request('login',{'login':'admin-test','password':'Password-test-2026'})
        type(self).state=self.request('state')


if __name__ == '__main__':
    unittest.main()
