# O’Tacos – Pilotage Production V2.7 PERFORMANCE

Version optimisée pour réduire le temps d’ouverture, la lecture Inpulse et l’enregistrement Google Sheets / Drive.

## Optimisations V2.7

- **Excel lu dans un Web Worker** : le fichier Inpulse est analysé hors du thread principal, l’interface ne se fige plus pendant la lecture.
- **Lecture ciblée** : seuls `Données détaillées` et `CA journalier` sont exploités, et seules les colonnes nécessaires sont conservées.
- **Plus de centaines de lignes Inpulse dans la base** : les `matches`, lignes de debug et détails inutiles ne sont plus envoyés à Apps Script.
- **Sauvegarde en arrière-plan** : la prévision s’affiche d’abord ; Google Sheets démarre pendant la fabrication du PDF, puis le PDF est envoyé à Drive.
- **Bibliothèques lourdes chargées à la demande** : XLSX, jsPDF et Chart.js ne ralentissent plus l’ouverture initiale de l’application.
- **1 seul bootstrap Google** au démarrage global pour récupérer paramètres + historique, au lieu de plusieurs appels réseau.
- **Google Sheets optimisé** : recherche d’une journée uniquement dans la colonne ID, lecture de l’historique uniquement depuis `dataJson`, écritures groupées.
- **Cache paramètres Apps Script** : les paramètres produits / sauce / moteur ne sont plus relus à chaque requête.
- **Cache dossiers Drive** : BSM / ARS / année / mois sont mémorisés par ID ; Drive ne recherche plus toute l’arborescence à chaque PDF.
- **Cache fichier PDF** : remplacement direct de l’ancien PDF à partir de son ID au lieu d’une recherche par nom à chaque sauvegarde.
- **Dossiers mensuels créés à la demande** : plus de création des 12 mois à chaque initialisation.
- **Clôture hors accès équipe** : l’équipe valide immédiatement ; le PDF de clôture privé est généré côté accès global en arrière-plan.
- **Responsables BSM** : Guillaume, Imane, Papa Mor.
- **Responsables ARS** : Babacar, Imane.

## Mise à jour depuis V2.6

### GitHub
Remplacer / ajouter :

- `index.html`
- `equipe.html`
- `app.js`
- `excel-worker.js` **(nouveau, obligatoire)**
- `styles.css`
- `config.js` (conserver votre URL Apps Script)
- `assets/otacos-logo.png`

### Google Apps Script

1. Remplacer entièrement `Code.gs` par `gas/Code.gs` V2.7.
2. Remplacer `appsscript.json` si nécessaire.
3. Exécuter une fois `setupApp()`.
4. Si des journées V2.6 sont déjà présentes, exécuter **une seule fois** `optimizeDatabase()` pour supprimer les anciennes données de debug lourdes.
5. `Déployer` → `Gérer les déploiements` → `Modifier` → `Nouvelle version` → `Déployer`.
6. Garder la même URL `/exec` dans `config.js`.

## Drive

Prévisions équipe :

`O'TACOS - Prévisions Production / BSM ou ARS / Année / 09 - Septembre / AAAA-MM-JJ_XXX_PREVISION.pdf`

Clôtures privées :

`O'TACOS - Prévisions Production / CLOTURES - ADMIN / BSM ou ARS / Année / 09 - Septembre / AAAA-MM-JJ_XXX_CLOTURE.pdf`

Les dossiers Année / Mois sont créés uniquement quand une fiche de cette période est réellement enregistrée.

## Test de référence 06/09/2026

Sans historique, avec les paramètres actuels :

- Poulet Mariné : MIDI 1,25 / SOIR 1,75
- Poulet Nature : MIDI 1,50 / SOIR 2,00
- Merguez : MIDI 1,00 / SOIR 1,00
- Kebab : MIDI 2,00 / SOIR 3,00
- Viande Hachée : MIDI 2,00 / SOIR 2,50
- Sauce Fromagère : MIDI 6,00 / SOIR 9,00

## Important

Après mise à jour GitHub, faire un rechargement forcé :

- Mac : `Cmd + Shift + R`
- Windows : `Ctrl + F5`

Les fichiers CSS / JS utilisent aussi un suffixe `?v=2.7.0` pour réduire les problèmes de cache GitHub Pages.
