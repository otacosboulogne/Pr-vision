/* O'TACOS Forecast V2.7 - Parseur Inpulse haute performance (Web Worker) */
'use strict';

importScripts('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');

self.onmessage = function(event){
  const started = Date.now();
  try{
    const buffer = event.data && event.data.buffer;
    const config = event.data && event.data.config;
    if(!buffer) throw new Error('Fichier Excel vide.');

    const wb = XLSX.read(buffer, {
      type:'array',
      dense:true,
      cellDates:false,
      cellText:false,
      cellNF:false,
      cellStyles:false,
      cellFormula:false,
      cellHTML:false,
      bookDeps:false,
      bookFiles:false,
      bookProps:false
    });

    const det = wb.Sheets['Données détaillées'];
    if(!det) throw new Error('Onglet « Données détaillées » introuvable.');

    const matrix = XLSX.utils.sheet_to_json(det, {header:1, defval:null, raw:true, blankrows:false});
    if(matrix.length < 2) throw new Error('Le fichier Inpulse ne contient aucune donnée exploitable.');

    const headers = matrix[0].map(v => String(v == null ? '' : v).trim());
    const idx = indexHeaders(headers);
    const dateIdx = findHeader(idx, ['date']);
    const catIdx = findHeader(idx, ['catégorie','categorie']);
    const nameIdx = findHeader(idx, ['nom']);
    const unitsIdx = findHeader(idx, ["nombre d'unités","nombre d'unites"]);
    if(dateIdx < 0 || catIdx < 0 || nameIdx < 0 || unitsIdx < 0){
      throw new Error('Colonnes Inpulse Date / Catégorie / Nom / Nombre d\'unités introuvables.');
    }

    const products = (config && config.products) || [];
    const sauceCfg = (config && config.sauce) || {};
    const meatByName = new Map();
    const extracted = {};
    products.filter(p => p.key !== 'fromagere').forEach(p => {
      extracted[p.key] = {units:0};
      meatByName.set(norm(p.exact || ''), p.key);
    });

    const allowedCats = new Set(['NOS RECETTES','TACOS À COMPOSER','MENU'].map(norm));
    let qtyM = 0, qtyL = 0, qtyXL = 0;
    const sq = {sansM:0,sansL:0,sansXL:0,supplement:0,omini:0,sansOmini:0,fritotacos:0,fritesFromagere:0,beaucoup:0,sansObowl:0,croustySauce:0};
    const N = {
      sansM:norm('Sans sauce fromagère Otacos M'),
      sansL:norm('Sans sauce fromagère Otacos L'),
      sansXL:norm('Sans sauce fromagère Otacos XL'),
      supplement:norm('Supplément sauce fromagère'),
      sansOmini:norm("Sans sauce fromagère O'Mini"),
      fritotacos:norm("Frit'Otacos"),
      fritesFromagere:norm('Menu à composer Supplément Frites sauce fromagère'),
      beaucoup:norm('Beaucoup de sauce fromagère'),
      sansObowl:norm('Sans sauce fromagère Obowl'),
      croustySauce:norm("CrO'usty Sauce fromagère"),
      ominiPrefix:norm("O'Mini -")
    };

    const dateSet = new Set();
    for(let i=1; i<matrix.length; i++){
      const r = matrix[i];
      if(!r) continue;
      const date = parseDateValue(r[dateIdx]);
      if(date) dateSet.add(date);
      const name = String(r[nameIdx] == null ? '' : r[nameIdx]).trim();
      if(!name) continue;
      const nameN = norm(name);
      const catN = norm(r[catIdx]);
      const units = num(r[unitsIdx]);

      if(catN === norm('VIANDES')){
        const key = meatByName.get(nameN);
        if(key) extracted[key].units += units;
      }

      if(allowedCats.has(catN)){
        const mm = name.match(/(?:\s|^)(XL|L|M)$/i);
        if(mm){
          const size = mm[1].toUpperCase();
          if(size === 'M') qtyM += units;
          else if(size === 'L') qtyL += units;
          else if(size === 'XL') qtyXL += units;
        }
      }

      if(nameN === N.sansM) sq.sansM += units;
      else if(nameN === N.sansL) sq.sansL += units;
      else if(nameN === N.sansXL) sq.sansXL += units;
      else if(nameN === N.supplement) sq.supplement += units;
      else if(nameN === N.sansOmini) sq.sansOmini += units;
      else if(nameN === N.fritotacos) sq.fritotacos += units;
      else if(nameN === N.fritesFromagere) sq.fritesFromagere += units;
      else if(nameN === N.beaucoup) sq.beaucoup += units;
      else if(nameN === N.sansObowl) sq.sansObowl += units;
      else if(nameN === N.croustySauce) sq.croustySauce += units;
      if(nameN.startsWith(N.ominiPrefix)) sq.omini += units;
    }

    const dates = Array.from(dateSet).sort();
    if(!dates.length) throw new Error('Date introuvable dans le fichier.');
    const date = dates[0];

    const grams =
      qtyM*num(sauceCfg.M) + qtyL*num(sauceCfg.L) + qtyXL*num(sauceCfg.XL)
      - sq.sansM*num(sauceCfg.M) - sq.sansL*num(sauceCfg.L) - sq.sansXL*num(sauceCfg.XL)
      + sq.supplement*num(sauceCfg.supplement)
      + Math.max(0, sq.omini-sq.sansOmini)*num(sauceCfg.omini)
      + sq.fritotacos*num(sauceCfg.fritotacos)
      + sq.fritesFromagere*num(sauceCfg.fritesFromagere)
      + sq.beaucoup*num(sauceCfg.beaucoupExtra)
      - sq.sansObowl*num(sauceCfg.sansObowl)
      + sq.croustySauce*num(sauceCfg.croustySauce);

    extracted.fromagere = {
      units:qtyM+qtyL+qtyXL,
      needKg:Math.max(0, grams/1000),
      sauceBreakdown:{M:{qty:qtyM,g:num(sauceCfg.M)},L:{qty:qtyL,g:num(sauceCfg.L)},XL:{qty:qtyXL,g:num(sauceCfg.XL)},...sq,grams}
    };

    let ca = 0;
    const caSheet = wb.Sheets['CA journalier'];
    if(caSheet){
      const caMatrix = XLSX.utils.sheet_to_json(caSheet, {header:1, defval:null, raw:true, blankrows:false});
      if(caMatrix.length >= 2){
        const caHeaders = caMatrix[0].map(v => String(v == null ? '' : v).trim());
        const caIndex = indexHeaders(caHeaders);
        const caDateIdx = findHeader(caIndex,['date']);
        const valueIdx = findHeader(caIndex,['ca ttc','ca',"chiffre d'affaires",'chiffre d’affaires']);
        let fallback = 0;
        for(let i=1;i<caMatrix.length;i++){
          const r = caMatrix[i] || [];
          const val = valueIdx >= 0 ? num(r[valueIdx]) : 0;
          if(!fallback && val) fallback = val;
          if(caDateIdx >= 0 && parseDateValue(r[caDateIdx]) === date){ ca = val; break; }
        }
        if(!ca) ca = fallback;
      }
    }

    self.postMessage({ok:true,date,dates,ca,extracted,parseMs:Date.now()-started,rowCount:matrix.length-1});
  }catch(err){
    self.postMessage({ok:false,error:String(err && err.message || err),parseMs:Date.now()-started});
  }
};

function indexHeaders(headers){
  const m = new Map();
  headers.forEach((h,i) => m.set(norm(h),i));
  return m;
}
function findHeader(map,names){
  for(const n of names){ const i=map.get(norm(n)); if(i !== undefined) return i; }
  return -1;
}
function norm(v){
  return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
}
function num(v){
  if(typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '0' : v).replace(/\s/g,'').replace(',','.'));
  return isFinite(n) ? n : 0;
}
function parseDateValue(v){
  if(v == null || v === '') return '';
  if(v instanceof Date && !isNaN(v)) return iso(v.getFullYear(),v.getMonth()+1,v.getDate());
  if(typeof v === 'number' && isFinite(v)){
    try{
      const d = XLSX.SSF.parse_date_code(v);
      if(d && d.y) return iso(d.y,d.m,d.d);
    }catch(e){}
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if(m) return iso(+m[3],+m[2],+m[1]);
  m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if(m) return iso(+m[1],+m[2],+m[3]);
  const d = new Date(s);
  if(!isNaN(d)) return iso(d.getFullYear(),d.getMonth()+1,d.getDate());
  return '';
}
function iso(y,m,d){ return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
