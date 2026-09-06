# O'Tacos - Pilotage Production V3.0

## Nouveautés V3.0

### Fromagère
- Dans **Production recommandée**, la Fromagère est séparée en deux lignes : `Fromagère 2,5 kg` et `Fromagère 1 kg`.
- Les quantités sont directement exprimées en nombre de poches/sachets (pas de 0,25 pour le 1 kg).
- Dans **Préparation de service**, seule la ligne `Fromagère 2,5 kg` apparaît et conserve les cases à cocher.
- Grande poche affichée **2,5 kg**, rendement utile **2,2 kg**.
- Petit sachet affiché **1 kg**, rendement utile **0,875 kg**.
- Le moteur choisit automatiquement le conditionnement.
- Dans **Marge responsable**, la Fromagère est séparée en deux lignes :
  - `Fromagère 2,5 kg`
  - `Fromagère 1 kg`
- Les quantités sont saisies par pas de `0,25` : 0,25 / 0,50 / 0,75 / 1 / 1,25…
- Dans la saisie du réel, les deux conditionnements sont également séparés : aucun calcul de kg à faire par le responsable.
- La préparation Fromagère reste basée sur les grandes poches, avec case à cocher `Prépa lancée`.

### PDF
- Le document s'appelle **FEUILLE DE PRODUCTION**.
- Structure conservée : Production recommandée / Préparation de service / Marge responsable.
- Les cases de préparation restent imprimables.
- Les colonnes `Réel total MIDI` et `Réel total SOIR` sont remplies dans le PDF de clôture.
- Les PDF de clôture restent dans `CLOTURES - ADMIN` et ne sont pas affichés dans les accès équipe.

### Archive CA prévisionnel indépendante
Deux accès séparés dans l'accès global :
- `CA BSM`
- `CA ARS`

Chaque écran est en lecture seule et permet de filtrer par date.
Ces données sont stockées dans l'onglet Google Sheet `CA_PREVISIONNEL_ARCHIVE` et **ne sont jamais utilisées par le moteur de prévision de production**.

Pour alimenter l'archive :
1. Ouvrir `Paramètres` avec le code administrateur.
2. Section `Importer les CA prévisionnels`.
3. Importer le fichier Excel contenant `DATE / CA Prév BSM` et `DATE / CA Prév ARS`.
4. Le fichier remplace l'archive CA précédente en une seule opération.

## Mise à jour GitHub
Remplacer :
- `index.html`
- `equipe.html`
- `app.js`
- `styles.css`
- `excel-worker.js`
- `assets/otacos-logo.png`

Conserver le `config.js` déjà configuré avec l'URL `/exec` Apps Script.

## Mise à jour Google Apps Script
1. Remplacer `Code.gs` par `gas/Code.gs`.
2. Remplacer `appsscript.json` si nécessaire.
3. Exécuter une fois `setupApp()` : l'onglet `CA_PREVISIONNEL_ARCHIVE` sera créé automatiquement.
4. `Déployer > Gérer les déploiements > Modifier > Nouvelle version > Déployer`.

La propriété de script doit rester :
- `ADMIN_CODE` = votre code administrateur.

## Accès équipes
- BSM : Guillaume, Imane, Papa Mor.
- ARS : Babacar, Imane.
- Les liens équipe restent permanents et séparés par restaurant.
