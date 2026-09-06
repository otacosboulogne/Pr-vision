(() => {
  'use strict';

  const PRODUCTS = [
    { key:'pouletMarine', label:'Poulet Mariné', exact:'Poulet Mariné (1 portion)', portionG:110, kgPerBag:2.3, prepMidi:1, prepSoir:1, step:.25 },
    { key:'pouletNature', label:'Poulet Nature', exact:'Poulet nature (1 portion)', portionG:110, kgPerBag:.8, prepMidi:1, prepSoir:1, step:.25 },
    { key:'merguez', label:'Merguez', exact:'Merguez de bœuf (1 louche)', portionG:110, kgPerBag:2.4, prepMidi:1, prepSoir:1, step:.25 },
    { key:'kebab', label:'Kebab', exact:'Kebab Portion', portionG:110, kgPerBag:.7, prepMidi:2, prepSoir:2, step:.25 },
    { key:'viandeHachee', label:'Viande Hachée', exact:'Viande hachée de boeuf (1 portion)', portionG:110, kgPerBag:2.1, prepMidi:2, prepSoir:2, step:.25 },
    { key:'fromagere', label:'Sauce Fromagère', exact:null, portionG:null, kgPerBag:2.2, prepMidi:4, prepSoir:4, step:.25 }
  ];

  const DEFAULT_CONFIG = {
    general: {
      midiShare:40,
      soirShare:60,
      maxCorrectionPct:20,
      historyDays:28,
      minHistory:5,
      productionWeight:70,
      caWeight:30
    },
    products: JSON.parse(JSON.stringify(PRODUCTS)),
    sauce: {
      M:80,
      L:100,
      XL:125,
      supplement:50,
      omini:50,
      fritotacos:50,
      fritesFromagere:50,
      beaucoupExtra:0,
      sansObowl:0,
      croustySauce:0
    }
  };

  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const gasUrl = ((window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '').trim();
  const remoteEnabled = !!gasUrl && !gasUrl.includes('PASTE_YOUR');

  let config = loadLocalConfig();
  let history = [];
  let currentImport = null;
  let forecastDay = null;
  let realDay = null;
  let analysisChart = null;
  let adminToken = null;
  let logoDataUrl = null;
  const localPdfUrls = new Map();

  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    $('storageBadge').textContent = remoteEnabled ? 'Google Sheets + Drive' : 'Mode local';
    bindEvents();
    populateAnalysisProducts();
    $('analysisDate').value = todayIso();
    await loadLogoDataUrl();

    if(remoteEnabled){
      try{
        const r = await api({action:'getConfig'});
        if(r && r.config) config = mergeConfig(DEFAULT_CONFIG, r.config);
      }catch(e){
        showStatus('Connexion Google indisponible.', true);
      }
    }

    await refreshHistory();
    renderParams();
    renderAnalysis();
  }

  function bindEvents(){
    $$('.nav-tab').forEach(btn => btn.addEventListener('click', () => requestView(btn.dataset.view)));
    $('btnRefresh').addEventListener('click', async () => {
      await refreshHistory();
      if(currentImport) await recomputeForecast();
      renderAnalysis();
    });

    $('restaurant').addEventListener('change', async () => {
      if(currentImport) await recomputeForecast();
    });

    $('fileInput').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if(file) importExcel(file);
    });

    const zone = $('uploadZone');
    ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.add('dragover');
    }));
    ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', e => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(file) importExcel(file);
    });

    $('btnViewForecastPdf').addEventListener('click', () => viewPdfForDay(forecastDay, 'forecast'));
    $('btnPrintForecast').addEventListener('click', () => printForecastPdf());

    $('realDaySelect').addEventListener('change', () => loadRealDay($('realDaySelect').value));
    $('actualCA').addEventListener('input', recalcActuals);
    $('btnCloseDay').addEventListener('click', closeDay);

    ['analysisRestaurant','analysisProduct','analysisPeriod','analysisDate','toggleInpulse','toggleImproved','toggleActual']
      .forEach(id => $(id).addEventListener('change', renderAnalysis));

    $('btnSaveParams').addEventListener('click', saveParamsFromUI);
    $('btnCloseAdminModal').addEventListener('click', closeAdminModal);
    $('btnAdminLogin').addEventListener('click', adminLogin);
    $('adminCode').addEventListener('keydown', e => { if(e.key === 'Enter') adminLogin(); });
  }

  async function requestView(view){
    if(view === 'settings' && !adminToken){
      openAdminModal();
      return;
    }
    switchView(view);
  }

  function switchView(view){
    $$('.app-view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if(view === 'actual') renderRealDayPicker();
    if(view === 'analysis') renderAnalysis();
    if(view === 'settings') renderParams();
  }

  function openAdminModal(){
    $('adminCode').value = '';
    $('adminError').textContent = '';
    $('adminModal').classList.remove('hidden');
    setTimeout(() => $('adminCode').focus(), 50);
  }

  function closeAdminModal(){ $('adminModal').classList.add('hidden'); }

  async function adminLogin(){
    const code = $('adminCode').value;
    if(!code){ $('adminError').textContent = 'Code requis.'; return; }
    if(!remoteEnabled){
      $('adminError').textContent = 'Connecte Google Apps Script pour activer l’accès sécurisé.';
      return;
    }
    try{
      const r = await api({action:'verifyAdmin', code});
      if(!r.ok || !r.token){ $('adminError').textContent = 'Code incorrect.'; return; }
      adminToken = r.token;
      closeAdminModal();
      switchView('settings');
    }catch(e){ $('adminError').textContent = 'Accès refusé.'; }
  }

  async function importExcel(file){
    try{
      showStatus('Lecture du fichier Inpulse…');
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, {type:'array', cellDates:true});
      const det = wb.Sheets['Données détaillées'];
      if(!det) throw new Error('Onglet « Données détaillées » introuvable.');
      const rows = XLSX.utils.sheet_to_json(det, {defval:null, raw:true});
      if(!rows.length) throw new Error('Le fichier Inpulse ne contient aucune donnée exploitable.');

      const dates = [...new Set(rows.map(r => parseDateValue(r['Date'])).filter(Boolean))].sort();
      if(!dates.length) throw new Error('Date introuvable dans le fichier.');
      const date = dates[0];

      let ca = 0;
      const caSheet = wb.Sheets['CA journalier'];
      if(caSheet){
        const caRows = XLSX.utils.sheet_to_json(caSheet, {defval:null, raw:true});
        const match = caRows.find(r => parseDateValue(r['Date']) === date) || caRows[0];
        if(match) ca = firstNumeric(match, ['CA TTC','CA','Chiffre d\'affaires','Chiffre d’affaires']);
      }

      currentImport = {fileName:file.name, date, rows, dates, ca};
      $('detectedDate').textContent = formatDateFR(date);
      $('forecastCAValue').textContent = ca > 0 ? money(ca) : '—';
      await refreshHistory();
      await recomputeForecast();
      showStatus(`Prévision calculée pour le ${formatDateFR(date)}.`);
    }catch(e){
      showStatus(e.message || 'Impossible de lire le fichier.', true);
    }
  }

  async function recomputeForecast(){
    if(!currentImport) return;
    const restaurant = $('restaurant').value;
    const extracted = extractInpulse(currentImport.rows);
    const relevantHistory = history.filter(h => h.restaurant === restaurant && h.status === 'CLOSED');
    const details = [];

    for(const p of config.products){
      const e = extracted[p.key];
      const sourceUnits = num(e.units);
      const needKg = p.key === 'fromagere' ? num(e.needKg) : sourceUnits * num(p.portionG) / 1000;
      const rawBags = num(p.kgPerBag) > 0 ? needKg / num(p.kgPerBag) : 0;
      const baseMidi = rawBags * num(config.general.midiShare) / 100;
      const baseSoir = rawBags * num(config.general.soirShare) / 100;

      const inpulseMidi = Math.max(num(p.prepMidi), ceilStep(baseMidi, num(p.step) || .25));
      const inpulseSoir = Math.max(num(p.prepSoir), ceilStep(baseSoir, num(p.step) || .25));
      const trendMidi = trendFactor(p.key, 'MIDI', currentImport.date, relevantHistory);
      const trendSoir = trendFactor(p.key, 'SOIR', currentImport.date, relevantHistory);
      const midiForecast = Math.max(num(p.prepMidi), ceilStep(baseMidi * trendMidi, num(p.step) || .25));
      const soirForecast = Math.max(num(p.prepSoir), ceilStep(baseSoir * trendSoir, num(p.step) || .25));

      details.push({
        key:p.key,
        label:p.label,
        sourceUnits,
        needKg,
        rawBags,
        baseMidi,
        baseSoir,
        inpulseMidi,
        inpulseSoir,
        trendMidi,
        trendSoir,
        midiForecast,
        soirForecast,
        prepMidi:num(p.prepMidi),
        prepSoir:num(p.prepSoir),
        marginMidi:Math.max(0, midiForecast - num(p.prepMidi)),
        marginSoir:Math.max(0, soirForecast - num(p.prepSoir)),
        matches:e.matches || [],
        sauceBreakdown:e.sauceBreakdown || null
      });
    }

    const existing = history.find(h => h.id === `${restaurant}_${currentImport.date}`);
    forecastDay = {
      ...(existing || {}),
      id:`${restaurant}_${currentImport.date}`,
      date:currentImport.date,
      restaurant,
      source:'INPULSE',
      fileName:currentImport.fileName,
      forecastCA:num(currentImport.ca),
      status:(existing && existing.status === 'CLOSED') ? 'CLOSED' : 'FORECAST',
      createdAt:(existing && existing.createdAt) || new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      details,
      sauceDebug:extracted.fromagere.sauceBreakdown,
      comment:(existing && existing.comment) || ''
    };

    renderForecast();
    $('forecastSection').classList.remove('hidden');
    await persistForecastAutomatic();
    renderRealDayPicker();
    renderAnalysis();
  }

  function extractInpulse(rows){
    const out = {};
    for(const p of config.products.filter(x => x.key !== 'fromagere')){
      const matches = rows.filter(r => norm(r['Catégorie']) === norm('VIANDES') && norm(r['Nom']) === norm(p.exact));
      out[p.key] = {
        units:sum(matches.map(r => num(r["Nombre d'unités"]))),
        matches:matches.map(slimRow)
      };
    }
    out.fromagere = extractSauce(rows);
    return out;
  }

  function extractSauce(rows){
    const allowedCats = ['NOS RECETTES','TACOS À COMPOSER','MENU'].map(norm);
    const sizeItems = {M:[],L:[],XL:[]};

    for(const r of rows){
      if(!allowedCats.includes(norm(r['Catégorie']))) continue;
      const name = String(r['Nom'] || '').trim();
      const m = name.match(/(?:\s|^)(XL|L|M)$/i);
      if(m) sizeItems[m[1].toUpperCase()].push(r);
    }

    const qtyM = sum(sizeItems.M.map(r => num(r["Nombre d'unités"])));
    const qtyL = sum(sizeItems.L.map(r => num(r["Nombre d'unités"])));
    const qtyXL = sum(sizeItems.XL.map(r => num(r["Nombre d'unités"])));
    const findQty = exact => sum(rows.filter(r => norm(r['Nom']) === norm(exact)).map(r => num(r["Nombre d'unités"])));
    const startsQty = prefix => sum(rows.filter(r => norm(r['Nom']).startsWith(norm(prefix))).map(r => num(r["Nombre d'unités"])));

    const sansM = findQty('Sans sauce fromagère Otacos M');
    const sansL = findQty('Sans sauce fromagère Otacos L');
    const sansXL = findQty('Sans sauce fromagère Otacos XL');
    const supplement = findQty('Supplément sauce fromagère');
    const omini = startsQty("O'Mini -");
    const sansOmini = findQty("Sans sauce fromagère O'Mini");
    const fritotacos = findQty("Frit'Otacos");
    const fritesFromagere = findQty('Menu à composer Supplément Frites sauce fromagère');
    const beaucoup = findQty('Beaucoup de sauce fromagère');
    const sansObowl = findQty('Sans sauce fromagère Obowl');
    const croustySauce = findQty("CrO'usty Sauce fromagère");

    const grams =
      qtyM*num(config.sauce.M) + qtyL*num(config.sauce.L) + qtyXL*num(config.sauce.XL)
      - sansM*num(config.sauce.M) - sansL*num(config.sauce.L) - sansXL*num(config.sauce.XL)
      + supplement*num(config.sauce.supplement)
      + Math.max(0, omini-sansOmini)*num(config.sauce.omini)
      + fritotacos*num(config.sauce.fritotacos)
      + fritesFromagere*num(config.sauce.fritesFromagere)
      + beaucoup*num(config.sauce.beaucoupExtra)
      - sansObowl*num(config.sauce.sansObowl)
      + croustySauce*num(config.sauce.croustySauce);

    const breakdown = {
      M:{qty:qtyM,g:num(config.sauce.M),items:sizeItems.M.map(slimRow)},
      L:{qty:qtyL,g:num(config.sauce.L),items:sizeItems.L.map(slimRow)},
      XL:{qty:qtyXL,g:num(config.sauce.XL),items:sizeItems.XL.map(slimRow)},
      sansM,sansL,sansXL,supplement,omini,sansOmini,fritotacos,fritesFromagere,beaucoup,sansObowl,croustySauce,grams
    };

    const matches = [
      ...sizeItems.M,...sizeItems.L,...sizeItems.XL,
      ...rows.filter(r => /sauce fromagère|O'Mini|Frit'Otacos/i.test(String(r['Nom'] || '')))
    ].map(slimRow);

    return {units:qtyM+qtyL+qtyXL, needKg:Math.max(0, grams/1000), matches, sauceBreakdown:breakdown};
  }

  function trendFactor(productKey, service, currentDate, hist){
    const maxCorr = num(config.general.maxCorrectionPct)/100;
    const prodW = num(config.general.productionWeight)/100;
    const caW = num(config.general.caWeight)/100;
    const horizon = num(config.general.historyDays) || 28;
    const cur = new Date(currentDate + 'T12:00:00');
    const curDow = cur.getDay();
    const signals = [];

    for(const day of hist){
      const d = new Date(day.date + 'T12:00:00');
      const age = (cur-d)/86400000;
      if(age <= 0 || age > horizon) continue;
      const detail = (day.details || []).find(x => x.key === productKey);
      const a = day.actuals && day.actuals[productKey];
      if(!detail || !a) continue;
      const base = service === 'MIDI' ? num(detail.inpulseMidi || detail.baseMidi) : num(detail.inpulseSoir || detail.baseSoir);
      const actual = num(service === 'MIDI' ? a.actualMidi : a.actualSoir);
      if(base <= 0 || actual < 0) continue;

      const ratioProd = actual/base;
      const caRatio = num(day.forecastCA) > 0 && num(day.actualCA) > 0 ? num(day.actualCA)/num(day.forecastCA) : 1;
      const caNormalized = caRatio > 0 ? ratioProd/caRatio : ratioProd;
      const signal = prodW*(ratioProd-1) + caW*(caNormalized-1);
      const recency = Math.pow(.88, age/7);
      const weekdayBoost = d.getDay() === curDow ? 1.8 : 1;
      signals.push({signal, weight:recency*weekdayBoost});
    }

    if(!signals.length) return 1;
    const totalWeight = sum(signals.map(x => x.weight));
    const avg = totalWeight ? sum(signals.map(x => x.signal*x.weight))/totalWeight : 0;
    const confidence = Math.min(1, signals.length/Math.max(1, num(config.general.minHistory)));
    return 1 + clamp(avg*confidence, -maxCorr, maxCorr);
  }

  function renderForecast(){
    if(!forecastDay) return;
    const tb = $('forecastTable').querySelector('tbody');
    tb.innerHTML = '';

    for(const d of forecastDay.details){
      const inpulseTotal = d.inpulseMidi + d.inpulseSoir;
      const improvedTotal = d.midiForecast + d.soirForecast;
      const delta = inpulseTotal > 0 ? (improvedTotal/inpulseTotal - 1)*100 : 0;
      const trendClass = delta > .05 ? 'trend-up' : delta < -.05 ? 'trend-down' : 'trend-flat';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${esc(d.label)}</strong></td>
        <td class="forecast-total">${fmt(inpulseTotal,2)}</td>
        <td class="${trendClass}">${fmt(improvedTotal,2)} <small>${delta === 0 ? '' : `(${pct(delta)})`}</small></td>
        <td class="highlight num-strong">${fmt(d.midiForecast,2)}</td>
        <td class="highlight num-strong">${fmt(d.soirForecast,2)}</td>
        <td>${fmt(d.prepMidi,2)}</td>
        <td>${fmt(d.prepSoir,2)}</td>
        <td>${fmt(d.marginMidi,2)}</td>
        <td>${fmt(d.marginSoir,2)}</td>`;
      tb.appendChild(tr);
    }
  }

  async function persistForecastAutomatic(){
    if(!forecastDay) return;
    $('pdfState').textContent = 'Génération…';
    $('forecastSyncState').textContent = remoteEnabled ? 'Enregistrement Drive…' : 'Prévisualisation locale';
    $('forecastSyncState').className = 'sync-state warn';

    try{
      forecastDay.status = forecastDay.status === 'CLOSED' ? 'CLOSED' : 'FORECAST';
      await saveDay(forecastDay);
      const doc = buildPdf(forecastDay, 'forecast');
      const fileName = `${forecastDay.date}_${forecastDay.restaurant}_PREVISION.pdf`;

      if(remoteEnabled){
        const r = await uploadPdfDoc(doc, forecastDay, 'forecast', fileName);
        forecastDay.pdfForecastUrl = r.url;
        $('pdfState').textContent = 'Drive ✓';
        $('forecastSyncState').textContent = 'PDF enregistré dans Drive';
        $('forecastSyncState').className = 'sync-state ok';
      }else{
        rememberLocalPdf(forecastDay.id, 'forecast', doc);
        $('pdfState').textContent = 'PDF prêt';
        $('forecastSyncState').textContent = 'PDF prêt en local';
        $('forecastSyncState').className = 'sync-state ok';
      }

      $('btnViewForecastPdf').disabled = false;
      $('btnPrintForecast').disabled = false;
      await refreshHistory();
    }catch(e){
      $('pdfState').textContent = 'Erreur';
      $('forecastSyncState').textContent = 'PDF non enregistré';
      $('forecastSyncState').className = 'sync-state warn';
      showStatus('La prévision est calculée mais le PDF n’a pas pu être stocké.', true);
    }
  }

  function renderRealDayPicker(){
    const select = $('realDaySelect');
    const candidates = uniqueDays([
      ...(forecastDay ? [forecastDay] : []),
      ...history
    ]).sort((a,b) => String(b.date).localeCompare(String(a.date)));

    if(!candidates.length){
      select.innerHTML = '<option value="">Aucune journée</option>';
      $('realEmpty').classList.remove('hidden');
      $('realWorkspace').classList.add('hidden');
      return;
    }

    select.innerHTML = candidates.map(d => `<option value="${escAttr(d.id)}">${formatDateFR(d.date)} · ${d.restaurant === 'BSM' ? 'Boulogne-sur-Mer' : 'Armentières'}${d.status === 'CLOSED' ? ' · clôturée' : ''}</option>`).join('');
    const preferred = realDay && candidates.find(d => d.id === realDay.id) ? realDay.id : (forecastDay ? forecastDay.id : candidates[0].id);
    select.value = preferred;
    loadRealDay(preferred);
  }

  function loadRealDay(id){
    if(!id) return;
    const found = (forecastDay && forecastDay.id === id) ? forecastDay : history.find(h => h.id === id);
    if(!found) return;
    realDay = JSON.parse(JSON.stringify(found));
    $('realEmpty').classList.add('hidden');
    $('realWorkspace').classList.remove('hidden');
    $('realRestaurant').textContent = realDay.restaurant === 'BSM' ? "O'TACOS BOULOGNE-SUR-MER" : "O'TACOS ARMENTIÈRES";
    $('realDate').textContent = formatDateFR(realDay.date);
    $('actualForecastCA').textContent = num(realDay.forecastCA) > 0 ? money(realDay.forecastCA) : '—';
    $('actualCA').value = num(realDay.actualCA) > 0 ? String(num(realDay.actualCA)) : '';
    $('comment').value = realDay.comment || '';
    renderActualTable();
  }

  function renderActualTable(){
    if(!realDay) return;
    const tb = $('actualTable').querySelector('tbody');
    tb.innerHTML = '';
    const stored = realDay.actuals || {};

    for(const d of realDay.details || []){
      const old = stored[d.key] || {};
      const plannedPrepMidi = num(d.prepMidi);
      const plannedPrepSoir = num(d.prepSoir);

      // Nouveau fonctionnement : on confirme simplement si la prépa prévue a bien été lancée.
      // Compatibilité avec les anciennes journées : une ancienne prépa > 0 est considérée comme lancée.
      const prepMidiLaunched = old.prepMidiLaunched ?? (old.prepMidiActual !== undefined ? num(old.prepMidiActual) > 0 : false);
      const prepSoirLaunched = old.prepSoirLaunched ?? (old.prepSoirActual !== undefined ? num(old.prepSoirActual) > 0 : false);
      const addMidi = old.addMidi ?? old.launchMidi ?? 0;
      const addSoir = old.addSoir ?? old.launchSoir ?? 0;
      const prepMidiActual = prepMidiLaunched ? plannedPrepMidi : 0;
      const prepSoirActual = prepSoirLaunched ? plannedPrepSoir : 0;
      const actualMidi = prepMidiActual + num(addMidi);
      const actualSoir = prepSoirActual + num(addSoir);
      const actualTotal = actualMidi + actualSoir;
      const forecastTotal = num(d.midiForecast) + num(d.soirForecast);
      const variance = actualTotal - forecastTotal;

      const tr = document.createElement('tr');
      tr.dataset.key = d.key;
      tr.innerHTML = `
        <td><strong>${esc(d.label)}</strong></td>
        <td>
          <label class="prep-check ${prepMidiLaunched ? 'is-checked' : ''}">
            <input class="prep-midi-check" type="checkbox" ${prepMidiLaunched ? 'checked' : ''}>
            <span class="prep-check-box" aria-hidden="true"></span>
            <span class="prep-check-qty">${fmt(plannedPrepMidi,2)}</span>
          </label>
        </td>
        <td><input class="add-midi" type="number" min="0" step="0.25" value="${fmtInput(addMidi)}"></td>
        <td class="actual-midi num-strong">${fmt(actualMidi,2)}</td>
        <td>
          <label class="prep-check ${prepSoirLaunched ? 'is-checked' : ''}">
            <input class="prep-soir-check" type="checkbox" ${prepSoirLaunched ? 'checked' : ''}>
            <span class="prep-check-box" aria-hidden="true"></span>
            <span class="prep-check-qty">${fmt(plannedPrepSoir,2)}</span>
          </label>
        </td>
        <td><input class="add-soir" type="number" min="0" step="0.25" value="${fmtInput(addSoir)}"></td>
        <td class="actual-soir num-strong">${fmt(actualSoir,2)}</td>
        <td class="actual-total num-strong">${fmt(actualTotal,2)}</td>
        <td>${fmt(forecastTotal,2)}</td>
        <td class="variance ${varianceClass(variance)}">${signed(variance)}</td>`;
      tr.querySelectorAll('input').forEach(input => input.addEventListener('input', recalcActuals));
      tr.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', recalcActuals));
      tb.appendChild(tr);
    }
  }

  function recalcActuals(){
    if(!realDay) return;
    $$('#actualTable tbody tr').forEach(tr => {
      const d = (realDay.details || []).find(x => x.key === tr.dataset.key);
      if(!d) return;
      const prepMidiCheck = tr.querySelector('.prep-midi-check');
      const prepSoirCheck = tr.querySelector('.prep-soir-check');
      const prepMidi = prepMidiCheck.checked ? num(d.prepMidi) : 0;
      const addMidi = num(tr.querySelector('.add-midi').value);
      const prepSoir = prepSoirCheck.checked ? num(d.prepSoir) : 0;
      const addSoir = num(tr.querySelector('.add-soir').value);
      const midi = prepMidi + addMidi;
      const soir = prepSoir + addSoir;
      const total = midi + soir;
      const forecastTotal = num(d.midiForecast) + num(d.soirForecast);
      const variance = total - forecastTotal;

      prepMidiCheck.closest('.prep-check').classList.toggle('is-checked', prepMidiCheck.checked);
      prepSoirCheck.closest('.prep-check').classList.toggle('is-checked', prepSoirCheck.checked);
      tr.querySelector('.actual-midi').textContent = fmt(midi,2);
      tr.querySelector('.actual-soir').textContent = fmt(soir,2);
      tr.querySelector('.actual-total').textContent = fmt(total,2);
      const v = tr.querySelector('.variance');
      v.textContent = signed(variance);
      v.className = `variance ${varianceClass(variance)}`;
    });
  }

  function collectActuals(){
    const actuals = {};
    $$('#actualTable tbody tr').forEach(tr => {
      const d = (realDay.details || []).find(x => x.key === tr.dataset.key);
      if(!d) return;
      const prepMidiLaunched = tr.querySelector('.prep-midi-check').checked;
      const prepSoirLaunched = tr.querySelector('.prep-soir-check').checked;
      const prepMidiActual = prepMidiLaunched ? num(d.prepMidi) : 0;
      const addMidi = num(tr.querySelector('.add-midi').value);
      const prepSoirActual = prepSoirLaunched ? num(d.prepSoir) : 0;
      const addSoir = num(tr.querySelector('.add-soir').value);
      const actualMidi = prepMidiActual + addMidi;
      const actualSoir = prepSoirActual + addSoir;
      actuals[tr.dataset.key] = {
        prepMidiLaunched,
        prepMidiActual,
        addMidi,
        actualMidi,
        prepSoirLaunched,
        prepSoirActual,
        addSoir,
        actualSoir,
        actualTotal:actualMidi+actualSoir
      };
    });
    return actuals;
  }

  async function closeDay(){
    if(!realDay) return;
    try{
      realDay.actualCA = num($('actualCA').value);
      realDay.comment = $('comment').value || '';
      realDay.actuals = collectActuals();
      realDay.status = 'CLOSED';
      realDay.closedAt = new Date().toISOString();
      await saveDay(realDay);

      const doc = buildPdf(realDay, 'closure');
      const fileName = `${realDay.date}_${realDay.restaurant}_CLOTURE.pdf`;
      if(remoteEnabled){
        const r = await uploadPdfDoc(doc, realDay, 'closure', fileName);
        realDay.pdfClosureUrl = r.url;
      }else{
        rememberLocalPdf(realDay.id, 'closure', doc);
      }

      if(forecastDay && forecastDay.id === realDay.id) forecastDay = JSON.parse(JSON.stringify(realDay));
      await refreshHistory();
      renderRealDayPicker();
      renderAnalysis();
      showStatus('Journée clôturée. Le réel est intégré au moteur de prévision.');
    }catch(e){
      showStatus(e.message || 'Impossible de clôturer la journée.', true);
    }
  }

  function populateAnalysisProducts(){
    $('analysisProduct').innerHTML = '<option value="ALL">Tous les produits</option>' + PRODUCTS.map(p => `<option value="${p.key}">${esc(p.label)}</option>`).join('');
  }

  function renderAnalysis(){
    const restaurant = $('analysisRestaurant').value || 'ALL';
    const product = $('analysisProduct').value || 'ALL';
    const period = $('analysisPeriod').value || 'month';
    const anchor = $('analysisDate').value || todayIso();

    const days = history.filter(d => {
      if(restaurant !== 'ALL' && d.restaurant !== restaurant) return false;
      return dateMatchesPeriod(d.date, anchor, period);
    }).sort((a,b) => String(a.date).localeCompare(String(b.date)));

    const rows = [];
    for(const day of days){
      for(const d of day.details || []){
        if(product !== 'ALL' && d.key !== product) continue;
        const a = day.actuals && day.actuals[d.key];
        rows.push({
          date:day.date,
          restaurant:day.restaurant,
          key:d.key,
          label:d.label,
          inpulse:num(d.inpulseMidi ?? d.baseMidi) + num(d.inpulseSoir ?? d.baseSoir),
          improved:num(d.midiForecast) + num(d.soirForecast),
          actual:a ? num(a.actualTotal) : null,
          forecastCA:num(day.forecastCA),
          actualCA:num(day.actualCA),
          status:day.status
        });
      }
    }

    renderAnalysisKpis(days, rows);
    renderAnalysisChart(rows, product);
    renderAnalysisTable(rows);
  }

  function renderAnalysisKpis(days, rows){
    const unique = uniqueDays(days);
    const forecastCA = sum(unique.map(d => num(d.forecastCA)));
    const actualCA = sum(unique.filter(d => num(d.actualCA) > 0).map(d => num(d.actualCA)));
    const closedRows = rows.filter(r => r.actual !== null);
    const actualSum = sum(closedRows.map(r => num(r.actual)));
    const errInp = actualSum > 0 ? sum(closedRows.map(r => Math.abs(num(r.inpulse)-num(r.actual))))/actualSum*100 : null;
    const errImp = actualSum > 0 ? sum(closedRows.map(r => Math.abs(num(r.improved)-num(r.actual))))/actualSum*100 : null;
    const caGap = forecastCA > 0 && actualCA > 0 ? (actualCA/forecastCA-1)*100 : null;

    $('kpiForecastCA').textContent = forecastCA > 0 ? money(forecastCA) : '—';
    $('kpiActualCA').textContent = actualCA > 0 ? money(actualCA) : '—';
    $('kpiCAGap').textContent = caGap === null ? '—' : pct(caGap);
    $('kpiInpulseError').textContent = errInp === null ? '—' : fmt(errInp,1) + ' %';
    $('kpiImprovedError').textContent = errImp === null ? '—' : fmt(errImp,1) + ' %';
  }

  function renderAnalysisChart(rows, product){
    const grouped = new Map();
    for(const r of rows){
      const key = r.date;
      if(!grouped.has(key)) grouped.set(key, {date:key, inpulse:0, improved:0, actual:0, hasActual:false});
      const g = grouped.get(key);
      g.inpulse += num(r.inpulse);
      g.improved += num(r.improved);
      if(r.actual !== null){ g.actual += num(r.actual); g.hasActual = true; }
    }
    const points = [...grouped.values()].sort((a,b) => a.date.localeCompare(b.date));
    const labels = points.map(p => formatDateShort(p.date));
    const datasets = [];

    if($('toggleInpulse').checked) datasets.push({label:'Inpulsé', data:points.map(p => p.inpulse), borderColor:'#8a8a8a', backgroundColor:'rgba(138,138,138,.14)', borderWidth:2, tension:.25, pointRadius:3});
    if($('toggleImproved').checked) datasets.push({label:'Amélioré', data:points.map(p => p.improved), borderColor:'#ff7900', backgroundColor:'rgba(255,121,0,.14)', borderWidth:3, tension:.25, pointRadius:3});
    if($('toggleActual').checked) datasets.push({label:'Réel', data:points.map(p => p.hasActual ? p.actual : null), borderColor:'#111111', backgroundColor:'rgba(17,17,17,.08)', borderWidth:3, tension:.25, pointRadius:4});

    if(analysisChart) analysisChart.destroy();
    analysisChart = new Chart($('analysisChart'), {
      type:'line',
      data:{labels,datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{legend:{position:'top',align:'end',labels:{usePointStyle:true,boxWidth:8,font:{weight:'700'}}}},
        scales:{
          x:{grid:{display:false},ticks:{color:'#666'}},
          y:{beginAtZero:true,grid:{color:'#ececec'},ticks:{color:'#666'},title:{display:true,text:product === 'ALL' ? 'Sachets cumulés' : 'Sachets'}}
        }
      }
    });
  }

  function renderAnalysisTable(rows){
    const tb = $('analysisTable').querySelector('tbody');
    tb.innerHTML = rows.slice().reverse().map(r => {
      const gap = r.actual === null ? null : num(r.improved)-num(r.actual);
      return `<tr>
        <td>${formatDateFR(r.date)}</td>
        <td>${r.restaurant === 'BSM' ? 'Boulogne-sur-Mer' : 'Armentières'}</td>
        <td><strong>${esc(r.label)}</strong></td>
        <td>${fmt(r.inpulse,2)}</td>
        <td>${fmt(r.improved,2)}</td>
        <td>${r.actual === null ? '—' : fmt(r.actual,2)}</td>
        <td class="${gap === null ? '' : varianceClass(gap)}">${gap === null ? '—' : signed(gap)}</td>
      </tr>`;
    }).join('');
  }

  function renderParams(){
    const p = $('paramsPanel');
    let html = `<div class="params-group"><h3>Produits, portions et préparations</h3><div class="table-wrap"><table class="data-table params-table"><thead><tr><th>Produit</th><th>Portion g</th><th>Kg / sachet</th><th>Pas sachet</th><th>Prépa matin</th><th>Prépa soir</th></tr></thead><tbody>`;
    for(const x of config.products){
      html += `<tr data-pkey="${x.key}"><td><strong>${esc(x.label)}</strong></td><td><input data-f="portionG" type="number" step="1" value="${x.portionG ?? ''}" ${x.key === 'fromagere' ? 'disabled' : ''}></td><td><input data-f="kgPerBag" type="number" step="0.01" value="${x.kgPerBag}"></td><td><input data-f="step" type="number" step="0.25" value="${x.step}"></td><td><input data-f="prepMidi" type="number" step="0.25" value="${x.prepMidi}"></td><td><input data-f="prepSoir" type="number" step="0.25" value="${x.prepSoir}"></td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    html += `<div class="params-group"><h3>Sauce fromagère - grammes</h3><div class="table-wrap"><table class="data-table params-table"><thead><tr><th>M</th><th>L</th><th>XL</th><th>Supplément</th><th>O'Mini</th><th>Frit'Otacos</th><th>Frites fromagère</th><th>Beaucoup +</th><th>Sans Obowl -</th><th>CrO'usty</th></tr></thead><tbody><tr>`;
    for(const k of Object.keys(config.sauce)) html += `<td><input data-skey="${k}" type="number" step="1" value="${config.sauce[k]}"></td>`;
    html += `</tr></tbody></table></div></div>`;

    const g = config.general;
    html += `<div class="params-group"><h3>Moteur de prévision</h3><div class="table-wrap"><table class="data-table params-table"><thead><tr><th>MIDI %</th><th>SOIR %</th><th>Correction max %</th><th>Historique jours</th><th>Pleine confiance</th><th>Poids production %</th><th>Poids CA %</th></tr></thead><tbody><tr>
      <td><input data-gkey="midiShare" type="number" value="${g.midiShare}"></td>
      <td><input data-gkey="soirShare" type="number" value="${g.soirShare}"></td>
      <td><input data-gkey="maxCorrectionPct" type="number" value="${g.maxCorrectionPct}"></td>
      <td><input data-gkey="historyDays" type="number" value="${g.historyDays}"></td>
      <td><input data-gkey="minHistory" type="number" value="${g.minHistory}"></td>
      <td><input data-gkey="productionWeight" type="number" value="${g.productionWeight}"></td>
      <td><input data-gkey="caWeight" type="number" value="${g.caWeight}"></td>
    </tr></tbody></table></div></div>`;
    p.innerHTML = html;
  }

  async function saveParamsFromUI(){
    if(!adminToken) return showStatus('Accès paramètres non autorisé.', true);

    $$('#paramsPanel tr[data-pkey]').forEach(tr => {
      const product = config.products.find(x => x.key === tr.dataset.pkey);
      tr.querySelectorAll('input[data-f]').forEach(i => { if(!i.disabled) product[i.dataset.f] = num(i.value); });
    });
    $$('#paramsPanel input[data-skey]').forEach(i => config.sauce[i.dataset.skey] = num(i.value));
    $$('#paramsPanel input[data-gkey]').forEach(i => config.general[i.dataset.gkey] = num(i.value));

    if(Math.abs(num(config.general.midiShare) + num(config.general.soirShare) - 100) > .01){
      return showStatus('La répartition MIDI + SOIR doit être égale à 100 %.', true);
    }
    if(Math.abs(num(config.general.productionWeight) + num(config.general.caWeight) - 100) > .01){
      return showStatus('Les poids Production + CA doivent être égaux à 100 %.', true);
    }

    localStorage.setItem('otacos_config_v2', JSON.stringify(config));
    if(remoteEnabled){
      const r = await api({action:'saveConfig', config, adminToken});
      if(!r.ok) return showStatus(r.error || 'Paramètres non enregistrés.', true);
    }
    showStatus('Paramètres enregistrés.');
    if(currentImport) await recomputeForecast();
  }

  async function saveDay(day){
    if(remoteEnabled){
      const r = await api({action:'saveDay', day});
      if(!r.ok) throw new Error(r.error || 'Erreur sauvegarde');
    }else{
      const arr = loadLocalDays();
      const i = arr.findIndex(x => x.id === day.id);
      const copy = JSON.parse(JSON.stringify(day));
      if(i >= 0) arr[i] = copy; else arr.push(copy);
      localStorage.setItem('otacos_days_v2', JSON.stringify(arr));
    }
  }

  async function refreshHistory(){
    try{
      if(remoteEnabled){
        const r = await api({action:'listDays'});
        history = r.days || [];
      }else{
        history = loadLocalDays();
      }
      history.sort((a,b) => String(b.date).localeCompare(String(a.date)));
      renderRealDayPicker();
    }catch(e){
      showStatus('Historique indisponible.', true);
    }
  }

  async function uploadPdfDoc(doc, day, kind, fileName){
    const dataUri = doc.output('datauristring');
    const base64 = dataUri.split(',')[1];
    const r = await api({
      action:'uploadPdf',
      dayId:day.id,
      date:day.date,
      restaurant:day.restaurant,
      kind,
      fileName,
      base64
    });
    if(!r.ok) throw new Error(r.error || 'Erreur Drive');
    return r;
  }

  function rememberLocalPdf(dayId, kind, doc){
    const key = `${dayId}_${kind}`;
    const previous = localPdfUrls.get(key);
    if(previous) URL.revokeObjectURL(previous);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    localPdfUrls.set(key, url);
  }

  function viewPdfForDay(day, kind){
    if(!day) return;
    const remoteUrl = kind === 'closure' ? day.pdfClosureUrl : day.pdfForecastUrl;
    if(remoteUrl){ window.open(remoteUrl, '_blank', 'noopener'); return; }
    const local = localPdfUrls.get(`${day.id}_${kind}`);
    if(local){ window.open(local, '_blank', 'noopener'); return; }
    const doc = buildPdf(day, kind);
    rememberLocalPdf(day.id, kind, doc);
    window.open(localPdfUrls.get(`${day.id}_${kind}`), '_blank', 'noopener');
  }

  function printForecastPdf(){
    if(!forecastDay) return;
    const doc = buildPdf(forecastDay, 'forecast');
    printPdfDoc(doc);
  }

  function printPdfDoc(doc){
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if(!w) return;
    setTimeout(() => {
      try{ w.focus(); w.print(); }catch(e){}
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, 1000);
  }

  function buildPdf(day, kind){
    const {jsPDF} = window.jspdf;
    const doc = new jsPDF({unit:'mm', format:'a4', orientation:'portrait'});
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const orange = [255,121,0];
    const black = [17,17,17];
    const soft = [255,246,237];
    const light = [247,247,245];
    let y = 12;

    // Header
    if(logoDataUrl){
      try{ doc.addImage(logoDataUrl, 'PNG', 12, 10, 28, 24, undefined, 'FAST'); }catch(e){}
    }
    doc.setFillColor(...black);
    doc.roundedRect(45, 10, W-57, 24, 3, 3, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(15);
    doc.text(kind === 'closure' ? 'BILAN DE PRODUCTION' : 'PLAN DE PRODUCTION', 51, 20);
    doc.setFontSize(8.5);
    doc.setTextColor(220,220,220);
    doc.text("O'TACOS · PILOTAGE PRODUCTION", 51, 27);
    doc.setFillColor(...orange);
    doc.rect(45, 31.5, W-57, 2.5, 'F');
    y = 42;

    // Identity strip
    const restaurant = day.restaurant === 'BSM' ? "O'TACOS BOULOGNE-SUR-MER" : "O'TACOS ARMENTIÈRES";
    doc.setFillColor(...light);
    doc.roundedRect(12, y, W-24, 19, 2.5, 2.5, 'F');
    doc.setTextColor(...black);
    doc.setFont('helvetica','bold');
    doc.setFontSize(10);
    doc.text(restaurant, 17, y+7);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    doc.setTextColor(85,85,85);
    doc.text(`Date : ${formatDateFR(day.date)}`, 17, y+13.5);
    doc.text(`Source : ${day.source || 'INPULSE'}`, W-17, y+13.5, {align:'right'});
    y += 25;

    y = pdfSectionTitle(doc, 'PRODUCTION RECOMMANDÉE', y, orange, black);
    y = pdfTable(doc, y,
      ['Produit','MIDI','SOIR','Total'],
      (day.details || []).map(d => [d.label, fmt(d.midiForecast,2), fmt(d.soirForecast,2), fmt(num(d.midiForecast)+num(d.soirForecast),2)]),
      {firstColWide:true, orange, black, soft}
    );

    y += 4;
    y = pdfSectionTitle(doc, 'PRÉPARATION DE SERVICE', y, orange, black);
    const actualsForPdf = day.actuals || {};
    y = pdfTable(doc, y,
      ['Produit','10H','Lancé','16H','Lancé'],
      (day.details || []).map(d => {
        const a = actualsForPdf[d.key] || {};
        const checkedM = kind === 'closure' ? (a.prepMidiLaunched ?? (a.prepMidiActual !== undefined ? num(a.prepMidiActual) > 0 : false)) : null;
        const checkedS = kind === 'closure' ? (a.prepSoirLaunched ?? (a.prepSoirActual !== undefined ? num(a.prepSoirActual) > 0 : false)) : null;
        return [
          d.label,
          fmt(d.prepMidi,2),
          checkedM === null ? '[ ]' : (checkedM ? '[X]' : '[ ]'),
          fmt(d.prepSoir,2),
          checkedS === null ? '[ ]' : (checkedS ? '[X]' : '[ ]')
        ];
      }),
      {firstColWide:true, orange, black, soft, checkboxCols:[2,4]}
    );

    y += 4;
    y = pdfSectionTitle(doc, 'MARGE RESPONSABLE', y, orange, black);
    y = pdfTable(doc, y,
      ['Produit','Marge MIDI','Réel total MIDI','Marge SOIR','Réel total SOIR'],
      (day.details || []).map(d => {
        const a = actualsForPdf[d.key] || {};
        return [
          d.label,
          fmt(d.marginMidi,2),
          kind === 'closure' ? fmt(a.actualMidi,2) : '',
          fmt(d.marginSoir,2),
          kind === 'closure' ? fmt(a.actualSoir,2) : ''
        ];
      }),
      {firstColWide:true, orange, black, soft}
    );

    if(kind === 'closure'){
      if(y > 215){ doc.addPage(); y = 18; }
      y += 4;
      y = pdfSectionTitle(doc, 'RÉEL DE PRODUCTION', y, orange, black);
      const a = day.actuals || {};
      y = pdfTable(doc, y,
        ['Produit','Prépa M','Ajout M','Total M','Prépa S','Ajout S','Total S','Total'],
        (day.details || []).map(d => {
          const x = a[d.key] || {};
          const pmLaunched = x.prepMidiLaunched ?? (x.prepMidiActual !== undefined ? num(x.prepMidiActual) > 0 : false);
          const psLaunched = x.prepSoirLaunched ?? (x.prepSoirActual !== undefined ? num(x.prepSoirActual) > 0 : false);
          const pm = pmLaunched ? num(d.prepMidi) : 0;
          const am = x.addMidi ?? x.launchMidi ?? 0;
          const ps = psLaunched ? num(d.prepSoir) : 0;
          const as = x.addSoir ?? x.launchSoir ?? 0;
          const tm = x.actualMidi ?? num(pm)+num(am);
          const ts = x.actualSoir ?? num(ps)+num(as);
          return [d.label,fmt(pm,2),fmt(am,2),fmt(tm,2),fmt(ps,2),fmt(as,2),fmt(ts,2),fmt(num(tm)+num(ts),2)];
        }),
        {fontSize:7.1, firstColWide:true, orange, black, soft}
      );

      y += 4;
      if(y > 252){ doc.addPage(); y = 18; }
      y = pdfSectionTitle(doc, 'ÉCARTS', y, orange, black);
      y = pdfTable(doc, y,
        ['Produit','Inpulsé','Amélioré','Réel','Écart'],
        (day.details || []).map(d => {
          const x = a[d.key] || {};
          const inp = num(d.inpulseMidi ?? d.baseMidi)+num(d.inpulseSoir ?? d.baseSoir);
          const imp = num(d.midiForecast)+num(d.soirForecast);
          const act = num(x.actualTotal);
          return [d.label,fmt(inp,2),fmt(imp,2),fmt(act,2),signed(act-imp)];
        }),
        {firstColWide:true, orange, black, soft}
      );

    }

    if(day.comment){
      if(y > 260){ doc.addPage(); y = 18; }
      y += 3;
      y = pdfSectionTitle(doc, 'COMMENTAIRE', y, orange, black);
      doc.setFillColor(250,250,249);
      doc.roundedRect(12, y, W-24, 22, 2, 2, 'F');
      doc.setTextColor(45,45,45);
      doc.setFont('helvetica','normal');
      doc.setFontSize(8.5);
      doc.text(String(day.comment).slice(0,700), 17, y+7, {maxWidth:W-34});
      y += 24;
    }

    finalizePdfFooters(doc, orange, black);
    return doc;
  }

  function pdfSectionTitle(doc, title, y, orange, black){
    const W = doc.internal.pageSize.getWidth();
    if(y > 272){ doc.addPage(); y = 18; }
    doc.setFillColor(...black);
    doc.roundedRect(12, y, W-24, 8.5, 1.8, 1.8, 'F');
    doc.setFillColor(...orange);
    doc.rect(12, y, 3, 8.5, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8.5);
    doc.text(title, 19, y+5.7);
    return y+10.5;
  }

  function pdfTable(doc, y, head, body, opts){
    const W = doc.internal.pageSize.getWidth();
    const fontSize = opts.fontSize || 8.2;
    const colStyles = opts.firstColWide ? {0:{cellWidth:62,halign:'left'}} : {};
    doc.autoTable({
      startY:y,
      head:[head],
      body,
      theme:'grid',
      margin:{left:12,right:12,bottom:16},
      styles:{font:'helvetica',fontSize,cellPadding:2.15,textColor:opts.black,lineColor:[218,218,218],lineWidth:.18,halign:'center',valign:'middle'},
      headStyles:{fillColor:opts.soft,textColor:opts.black,fontStyle:'bold',lineColor:[210,210,210],lineWidth:.18},
      bodyStyles:{fillColor:[255,255,255]},
      alternateRowStyles:{fillColor:[250,250,249]},
      columnStyles:colStyles,
      didDrawCell:(data) => {
        if(data.section !== 'body' || !opts.checkboxCols || !opts.checkboxCols.includes(data.column.index)) return;
        const raw = String(data.cell.raw ?? '');
        const checked = raw === '[X]';
        const size = 3.2;
        const x = data.cell.x + data.cell.width/2 - size/2;
        const yy = data.cell.y + data.cell.height/2 - size/2;
        doc.setDrawColor(90,90,90);
        doc.setLineWidth(.28);
        doc.rect(x, yy, size, size);
        if(checked){
          doc.setDrawColor(...opts.orange);
          doc.setLineWidth(.48);
          doc.line(x+.65, yy+1.75, x+1.35, yy+2.45);
          doc.line(x+1.35, yy+2.45, x+2.75, yy+.75);
        }
      },
      didParseCell:(data) => {
        if(data.section === 'body' && opts.checkboxCols && opts.checkboxCols.includes(data.column.index)){
          data.cell.text = [''];
        }
      },
    });
    return doc.lastAutoTable.finalY;
  }

  function finalizePdfFooters(doc, orange, black){
    const pages = doc.internal.getNumberOfPages();
    for(let current=1; current<=pages; current++){
      doc.setPage(current);
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      doc.setDrawColor(...orange);
      doc.setLineWidth(.5);
      doc.line(12, H-11, W-12, H-11);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.2);
      doc.setTextColor(110,110,110);
      doc.text("O'TACOS · PILOTAGE PRODUCTION", 12, H-6.5);
      doc.text(`Page ${current}/${pages}`, W-12, H-6.5, {align:'right'});
    }
  }

  async function loadLogoDataUrl(){
    try{
      const response = await fetch('assets/otacos-logo.png');
      const blob = await response.blob();
      logoDataUrl = await blobToDataUrl(blob);
    }catch(e){ logoDataUrl = null; }
  }

  function blobToDataUrl(blob){
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function api(payload){
    const res = await fetch(gasUrl, {method:'POST', body:JSON.stringify(payload), redirect:'follow'});
    const text = await res.text();
    let json;
    try{ json = JSON.parse(text); }
    catch(e){ throw new Error('Réponse Apps Script invalide.'); }
    if(json.error) throw new Error(json.error);
    return json;
  }

  function loadLocalConfig(){
    try{
      const saved = JSON.parse(localStorage.getItem('otacos_config_v2') || localStorage.getItem('otacos_config_v1') || 'null');
      return mergeConfig(DEFAULT_CONFIG, saved);
    }catch(e){
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function loadLocalDays(){
    try{
      return JSON.parse(localStorage.getItem('otacos_days_v2') || localStorage.getItem('otacos_days_v1') || '[]');
    }catch(e){ return []; }
  }

  function mergeConfig(base, over){
    const out = JSON.parse(JSON.stringify(base));
    if(!over) return out;
    out.general = {...out.general, ...(over.general || {})};
    out.sauce = {...out.sauce, ...(over.sauce || {})};
    if(Array.isArray(over.products)) out.products = out.products.map(p => ({...p, ...(over.products.find(x => x.key === p.key) || {})}));
    return out;
  }

  function uniqueDays(days){
    const map = new Map();
    for(const d of days || []) if(d && d.id) map.set(d.id, d);
    return [...map.values()];
  }

  function dateMatchesPeriod(dateIso, anchorIso, period){
    if(!dateIso || !anchorIso) return false;
    if(period === 'day') return dateIso === anchorIso;
    if(period === 'month') return dateIso.slice(0,7) === anchorIso.slice(0,7);
    if(period === 'year') return dateIso.slice(0,4) === anchorIso.slice(0,4);
    if(period === 'week'){
      const d = new Date(dateIso+'T12:00:00');
      const a = new Date(anchorIso+'T12:00:00');
      const day = (a.getDay()+6)%7;
      const start = new Date(a); start.setDate(a.getDate()-day); start.setHours(0,0,0,0);
      const end = new Date(start); end.setDate(start.getDate()+7);
      return d >= start && d < end;
    }
    return true;
  }

  function firstNumeric(obj, keys){
    for(const k of keys){
      if(Object.prototype.hasOwnProperty.call(obj,k) && num(obj[k]) !== 0) return num(obj[k]);
    }
    for(const [k,v] of Object.entries(obj)) if(/ca/i.test(k) && num(v) !== 0) return num(v);
    return 0;
  }

  function showStatus(msg, error=false){
    const box = $('statusBox');
    box.textContent = msg;
    box.classList.remove('hidden');
    box.classList.toggle('error', error);
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => box.classList.add('hidden'), 5500);
  }

  function parseDateValue(v){
    if(!v) return null;
    if(v instanceof Date && !isNaN(v)) return localIso(v);
    if(typeof v === 'number' && window.XLSX && XLSX.SSF){
      const p = XLSX.SSF.parse_date_code(v);
      if(p) return `${p.y}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}`;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function num(v){
    if(v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(n) ? n : 0;
  }
  function norm(s){ return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/’/g,"'").trim().toLowerCase(); }
  function sum(a){ return a.reduce((x,y) => x + num(y), 0); }
  function ceilStep(v,s=.25){ return Math.ceil((num(v)-1e-9)/s)*s; }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function fmt(v,d=2){ return num(v).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}); }
  function fmtInput(v){ return String(Math.round(num(v)*100)/100); }
  function money(v){ return num(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'}); }
  function signed(v){ const n=num(v); return `${n>0?'+':''}${fmt(n,2)}`; }
  function pct(v){ const n=num(v); return `${n>0?'+':''}${fmt(n,1)} %`; }
  function formatDateFR(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; }
  function formatDateShort(iso){ if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}`; }
  function todayIso(){ return localIso(new Date()); }
  function localIso(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function slimRow(r){ return {category:r['Catégorie'], name:r['Nom'], qty:num(r["Nombre d'unités"])}; }
  function esc(s){ return String(s ?? '').replace(/[&<>"]/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function escAttr(s){ return esc(s).replace(/'/g,'&#39;'); }
  function varianceClass(v){ return num(v) > .001 ? 'variance-pos' : num(v) < -.001 ? 'variance-neg' : ''; }
})();
