# O'Tacos - Pilotage Production V2

Interface GitHub Pages + Google Apps Script + Google Sheets + Google Drive.

## Fichiers GitHub

À publier dans le dépôt :

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `assets/otacos-logo.png`
- dossier `gas/` (sauvegarde du backend)

## 1. Google Apps Script

1. Créer un projet sur `script.google.com`.
2. Copier `gas/Code.gs` dans `Code.gs`.
3. Copier le contenu de `gas/appsscript.json` dans le manifeste si nécessaire.
4. Dans **Paramètres du projet > Propriétés du script**, créer une propriété :
   - Nom : `ADMIN_CODE`
   - Valeur : votre code administrateur privé.
5. Exécuter manuellement la fonction `setupApp()` une fois et accepter les autorisations Google Sheets / Drive.
6. Déployer > **Nouveau déploiement** > **Application Web**.
7. Exécuter en tant que : **Moi**.
8. Choisir l'accès adapté à votre utilisation.
9. Copier l'URL se terminant par `/exec`.

## 2. Relier GitHub au backend

Dans `config.js`, remplacer :

```js
GAS_URL: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE'
```

par l'URL `/exec` du déploiement Apps Script.

## 3. GitHub Pages

Dans GitHub :

1. Settings > Pages.
2. Source : `Deploy from a branch`.
3. Branch : `main`.
4. Folder : `/ (root)`.

## Fonctions V2

- Import Inpulse Excel.
- Lecture automatique de la date et du CA prévisionnel.
- Prévision 40 % MIDI / 60 % SOIR.
- Correction progressive par historique réel et CA.
- PDF de prévision généré automatiquement et stocké dans Drive.
- Saisie simplifiée du réel : prépa réellement lancée + ajout pendant service.
- Clôture et apprentissage automatique.
- Analyse Jour / Semaine / Mois / Année.
- Comparaison Inpulse / prévision améliorée / réel avec séries activables.
- Paramètres masqués derrière un accès administrateur validé côté Apps Script.

## Stockage Drive

Les PDF sont rangés automatiquement :

```text
O'TACOS - Prévisions Production/
  BSM/
    2026/
      09/
        2026-09-06_BSM_PREVISION.pdf
        2026-09-06_BSM_CLOTURE.pdf
```

Un PDF de même nom est remplacé automatiquement pour éviter les doublons.

## V2.1 — saisie réel simplifiée

- Dans **Saisie réel**, la prépa n'est plus une quantité à retaper : une **case à cocher** confirme que la prépa prévue a bien été lancée.
- Le responsable saisit uniquement la quantité **ajoutée pendant le service**. Le total MIDI/SOIR et le total réel sont calculés automatiquement.
- Dans le PDF, le tableau **Préparation de service** contient une case `Lancé` pour 10H et 16H.
- Le tableau **Marge responsable** contient maintenant les colonnes **Réel total MIDI** et **Réel total SOIR**. Elles restent vides sur le PDF de prévision et sont remplies automatiquement sur le PDF de clôture.
