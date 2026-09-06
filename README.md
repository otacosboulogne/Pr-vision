# O'Tacos — Prévision Production V1

Prototype GitHub Pages + Excel Inpulse + Google Sheets/Drive via Apps Script.

## Test immédiat sans Google

1. Mettre les fichiers `index.html`, `styles.css`, `app.js`, `config.js` dans un dépôt GitHub.
2. Activer GitHub Pages (Settings > Pages > Deploy from branch).
3. Ouvrir la page.
4. Sélectionner BSM ou ARS puis importer `Export_Mix_Produit-4.xlsx`.
5. Le mode local utilise `localStorage` pour les paramètres, prévisions et clôtures.
6. Le PDF est téléchargé localement.

## Connexion Google Sheets + Drive

1. Aller sur https://script.google.com et créer un nouveau projet Apps Script.
2. Remplacer `Code.gs` par le contenu du dossier `gas/Code.gs`.
3. Dans les paramètres du projet, utiliser le fuseau `Europe/Paris`.
4. Exécuter manuellement une fois la fonction `setupApp_` depuis l'éditeur pour autoriser Sheets/Drive. Elle crée :
   - un Google Sheet `O'TACOS - Prévisions production`,
   - un dossier Drive `O'TACOS - Prévisions Production`,
   - les onglets PARAM_PRODUCTS, PARAM_SAUCE, PARAM_GENERAL, DAYS, DETAILS.
5. Déployer > Nouveau déploiement > Application Web.
   - Exécuter en tant que : Moi
   - Qui a accès : Toute personne disposant du lien / Anyone (pour le prototype GitHub Pages).
6. Copier l'URL `/exec` du Web App.
7. La coller dans `config.js` à la place de `PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEBAPP_URL_HERE`.
8. Repousser `config.js` sur GitHub.

> Important : le mode `Anyone` est pratique pour le prototype mais n'est pas une authentification de production. Avant usage réel multi-utilisateurs, ajouter une connexion Google / contrôle d'accès.

## Règles V1 intégrées

- Restaurant : BSM ou ARS.
- Source : Inpulse (Oracle désactivé pour le moment).
- Date lue dans `Données détaillées`.
- CA prévisionnel prérempli depuis `CA journalier`, mais modifiable.
- Viandes lues dans la catégorie `VIANDES` avec les appellations exactes :
  - Poulet Mariné (1 portion)
  - Poulet nature (1 portion)
  - Merguez de bœuf (1 louche)
  - Kebab Portion
  - Viande hachée de boeuf (1 portion)
- Portions viandes : 110 g.
- Kg/sachet : Mariné 2,3 ; Nature 0,8 ; Merguez 2,4 ; Kebab 0,7 ; VH 2,1 ; Fromagère 2,2.
- Répartition de base : 40 % MIDI / 60 % SOIR.
- Pas de lancement : 0,25 sachet, arrondi au quart supérieur.
- Prépa minimum :
  - Poulet Mariné 1 / 1
  - Poulet Nature 1 / 1
  - Merguez 1 / 1
  - Kebab 2 / 2
  - Viande Hachée 2 / 2
  - Fromagère 4 / 4

## Sauce fromagère V1

Base : tous les articles finissant par M/L/XL dans les catégories `NOS RECETTES`, `TACOS À COMPOSER`, `MENU`.

- M : 80 g
- L : 100 g
- XL : 125 g
- Retire Sans sauce fromagère Otacos M/L/XL
- Ajoute Supplément sauce fromagère : 50 g
- Ajoute O'Mini net des O'Mini sans sauce : 50 g
- Ajoute Frit'Otacos : 50 g
- Ajoute Menu à composer Supplément Frites sauce fromagère : 50 g
- `Beaucoup de sauce fromagère`, `Sans sauce fromagère Obowl` et `CrO'usty Sauce fromagère` restent paramétrables à 0 g tant que leur grammage n'est pas fixé.

## Apprentissage V1

Pour chaque restaurant, produit et service :

1. On calcule la base Inpulse en sachets.
2. On applique 40/60.
3. Les journées clôturées servent à calculer un facteur de tendance.
4. Le signal combine :
   - 70 % : écart entre production réellement consommée et base Inpulse,
   - 30 % : ce même écart normalisé par l'écart de CA.
5. Les mêmes jours de semaine sont pondérés davantage.
6. Les jours récents sont pondérés davantage.
7. Correction maximum par défaut : ±20 %.
8. La consommation réelle utilisée = prépa + lancé hors prépa - reste fin de service.

Tous ces paramètres sont modifiables dans l'interface et, si le backend Google est activé, dans les onglets PARAM_*.

## PDF

Deux versions :
- `YYYY-MM-DD_BSM_PREVISION.pdf`
- `YYYY-MM-DD_BSM_CLOTURE.pdf`

En mode Google, les PDF sont stockés dans :
`O'TACOS - Prévisions Production / BSM ou ARS / YYYY / MM /`.
