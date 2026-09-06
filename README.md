# O'Tacos Production Forecast — V2.5

## Accès

- `index.html` : accès global (prévision, réel, analyse, PDF, paramètres protégés)
- `equipe.html?teamToken=...` : accès équipe permanent, désormais séparé par restaurant

Le backend crée deux tokens permanents distincts :
- BSM : ne renvoie que les journées et PDF de Boulogne-sur-Mer
- ARS : ne renvoie que les journées et PDF d'Armentières

Un token BSM ne peut pas valider une journée ARS et inversement.

## Drive

Classement automatique :

```
O'TACOS - Prévisions Production/
├── BSM/
│   └── 2026/
│       ├── 01 - Janvier/
│       ├── ...
│       └── 12 - Décembre/
└── ARS/
    └── 2026/
        ├── 01 - Janvier/
        ├── ...
        └── 12 - Décembre/
```

Les PDF commencent par `AAAA-MM-JJ`, donc ils restent triés chronologiquement dans le dossier du mois.

## Mise à jour depuis V2.4

1. Remplacer sur GitHub : `index.html`, `equipe.html`, `app.js` (et garder les autres fichiers V2.4).
2. Remplacer `Code.gs` dans Google Apps Script par `gas/Code.gs` de cette V2.5.
3. Exécuter `setupApp()` une fois : il crée/conserve la structure Drive et initialise les deux tokens BSM/ARS.
4. `Déployer > Gérer les déploiements > Modifier > Nouvelle version > Déployer`.
5. L'URL `/exec` reste normalement identique : pas besoin de changer `config.js`.

Dans l'accès global, la zone **Accès équipe** affiche ensuite deux cartes : **Accès BSM** et **Accès ARS**, chacune avec son bouton Ouvrir/Copier.
