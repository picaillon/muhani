# Garage Haojue

Application locale de gestion commerciale en français. Devise : USD. La nouvelle version utilise Python 3 et SQLite, sans serveur externe ni installation de dépendances Python.

## Démarrage

```powershell
python server.py --port 5174
```

Ouvrir http://localhost:5174/. Le premier écran crée un administrateur avec un mot de passe d'au moins 10 caractères. Aucun mot de passe par défaut. Le script `Demarrer-Garage.ps1` permet aussi de démarrer le serveur en arrière-plan.

La base se trouve dans `data/garage.sqlite3`. Les anciennes sources (`index.html`, `app.js`, `styles.css`) sont conservées ; elles ne sont pas servies par le nouveau serveur. Les données de l'ancien navigateur ne sont pas supprimées et ne sont pas migrées automatiquement. Le catalogue peut être transféré par export/import Excel. Ne pas continuer à saisir dans l'ancienne version : les deux bases sont distinctes.

## Fonctions livrées

- Comptes utilisateurs, sept profils, affectation à une agence, désactivation, modification et réinitialisation administrateur des mots de passe. Hachage PBKDF2, cookie HttpOnly, protection CSRF, verrouillage après cinq échecs, session serveur de 30 minutes d'inactivité.
- Catalogue de pièces, motos, accessoires, lubrifiants et services. Codes et références automatiques, prix en dollars, compatibilité moto, historique des changements de prix. Suppression possible sans stock ni document associé ; sinon désactivation.
- Import Excel/CSV et export Excel. L'import crée de nouveaux produits avec des identifiants automatiques, ne modifie pas silencieusement un stock existant. Un import invalide est entièrement annulé.
- POS multi-articles, remises, taxes configurables (0 % par défaut), ventes comptant ou crédit, date d'échéance, limite de crédit, règlements et historique.
- Factures, reçus, devis, relevés et rapports imprimables. Le PDF est obtenu par l'option PDF du navigateur.
- Annulations justifiées avec remboursement et restitution du stock ; retours partiels, avoirs et produits endommagés.
- Fournisseurs, commandes, réceptions partielles, dettes et règlements.
- Stock par agence, transferts, inventaires avec validation et détection d'un stock modifié après comptage, état des besoins tenant compte des commandes ouvertes.
- Ouverture et clôture de caisse, écarts et validation. Le fonds d'ouverture est un montant observé et n'est pas compté comme une nouvelle recette. Les sessions de caisse portent uniquement sur les espèces ; la trésorerie regroupe tous les modes.
- Dépenses soumises à validation, finance, rapports filtrés, graphiques, comparaison des agences et alertes.
- Base centralisée locale, transactions atomiques et requêtes identifiées pour éviter les doublons. File de ventes non transmises après perte de connexion ; contrôle du stock et signalement des conflits lors de la reprise.
- Audit serveur, sauvegarde JSON complète, restauration transactionnelle avec copie préalable SQLite. Copie automatique au démarrage et après chaque opération, regroupée par heure dans `data/backups/`.
- Interface responsive et listes paginées (25 lignes par page). Icônes et bibliothèque Excel disponibles localement dans `vendor/`.

## Limites et suites du cahier des charges

Cette version couvre les parcours principaux des phases 1 et 2, pas la totalité du cahier des charges.

- Le serveur écoute uniquement sur cet ordinateur. Un déploiement multi-postes ou multi-sites nécessite un hébergement, HTTPS, une politique de sauvegarde et une configuration réseau. SQLite centralise les données des sessions utilisant ce serveur ; il ne synchronise pas plusieurs serveurs d'agences.
- Le fonctionnement hors connexion couvre une page déjà ouverte et une session active. Il n'y a pas encore de connexion hors ligne ni de rechargement complet hors ligne. Les ventes en attente ne constituent pas des factures validées et peuvent être rejetées à la reprise.
- Les autorisations sont définies par profil côté serveur ; l'édition de permissions personnalisées n'est pas encore proposée. Pas de récupération par e-mail ; un administrateur réinitialise les mots de passe.
- Les produits et contacts sont un catalogue commun ; les ventes, achats, stocks et caisses sont affectés aux agences. Le transfert exige l'accès aux deux agences.
- Pas encore de gestion des lots, châssis, photos, variantes, stock réservé, pièces jointes binaires, achats endommagés, annulation de commandes ou journal comptable en partie double.
- Devis : création, impression, annulation et conversion ; modification, duplication et circuit complet de statuts restent à développer.
- Reporting : périodes, agence, top articles, exports et graphiques ; comparaisons entre deux périodes, configuration libre d'indicateurs et envois planifiés restent à développer.
- Pas d'intégration bancaire, Mobile Money, SMS ou e-mail : le mode de paiement est enregistré, pas exécuté. Un paiement mixte n'est pas ventilé par compte dans cette version.
- Les sauvegardes contiennent les données personnelles et les hachages de mots de passe. Les conserver hors de portée des autres utilisateurs ; elles ne sont jamais servies comme fichiers statiques par l'application.
- La TVA et la conformité légale des factures restent à valider. Le résultat opérationnel affiché est ventes nettes moins coût historique des articles vendus et dépenses ; ce n'est pas une comptabilité certifiée.

## Vérification

```powershell
python -m unittest test_server.py
node --check garage.js
```
