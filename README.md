# O'Tacos Pilotage Production — V3.2

## Correctifs CA prévisionnel

- Un seul bouton `CA prévisionnel` dans l'accès global.
- Accès CA séparé des paramètres de production.
- Code CA stocké côté Google Apps Script dans la propriété `CA_ACCESS_CODE`.
- Valeur à configurer : `Prev2026@`.
- Après connexion : choix du site `Boulogne-sur-Mer` ou `Armentières`, puis filtres `Du / Au`.
- L'import CA reste dans `Paramètres` (accès administrateur) et n'a aucun impact sur le moteur de production.
- Le parseur accepte directement le format officiel `CA PREV BS AR.xlsx` :
  - colonne A = DATE BSM
  - colonne B = CA Prév BSM
  - colonne E = DATE ARS
  - colonne F = CA Prév ARS
- Les lignes invalides / totaux / erreurs sont ignorés.

## Installation Google Apps Script

1. Remplacer `gas/Code.gs` dans le projet Apps Script.
2. Dans **Paramètres du projet > Propriétés du script**, ajouter :
   - `ADMIN_CODE` = votre code administrateur actuel
   - `CA_ACCESS_CODE` = `Prev2026@`
3. Exécuter `setupApp()` une fois.
4. Déployer > Gérer les déploiements > Modifier > Nouvelle version > Déployer.
5. Conserver la même URL `/exec` dans `config.js`.

## Import des CA

Dans l'accès global :

`Paramètres` > `Importer les CA prévisionnels`

Utiliser soit le fichier source officiel, soit `CA_PREVISIONNEL_CORRIGE_2026.xlsx`.

Le stockage se fait dans l'onglet Google Sheets `CA_PREVISIONNEL_ARCHIVE` sans modifier les prévisions de production.

## Consultation

Cliquer sur `CA prévisionnel`, saisir `Prev2026@`, choisir :

- Boulogne-sur-Mer (BSM)
- Armentières (ARS)

puis définir la période et cliquer sur `Actualiser`.
