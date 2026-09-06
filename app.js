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
      midiShare: 40,
      soirShare: 60,
      maxCorrectionPct: 20,
      historyDays: 28,
      minHistory: 5,
      productionWeight: 70,
      caWeight: 30
    },
    products: JSON.parse(JSON.stringify(PRODUCTS)),
    sauce: {
      M:80, L:100, XL:125,
      supplement:50,
      omini:50,
      fritotacos:50,
      fritesFromagere:50,
      beaucoupExtra:0,
      sansObowl:0,
      croustySauce:0
    }
  };

  let config = loadLocalConfig();
  let currentImport = null;
  let currentDay = null;
  let history = [];

  const $ = id => document.getElementById(id);
  const gasUrl = (window.APP_CONFIG && window.APP_CONFIG.GAS_URL || '').trim();
  const remoteEnabled = gasUrl && !gasUrl.includes('PASTE_YOUR');

  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    $('storageBadge').textContent = remoteEnabled ? 'Google Sheets + Drive' : 'Mode local (test)';
    bindEvents();
    if(remoteEnabled){
      try{
        const r = await api({action:'getConfig'});
        if(r && r.config) config = mergeConfig(DEFAULT_CONFIG, r.config);
      }catch(e){ showStatus('Backend Google indisponible : mode local utilisé. ' + e.message, true); }
    }
    renderParams();
    await refreshHistory();
  }

  function bindEvents(){
    $('fileInput').addEventListener('change', e => e.target.files[0] && importExcel(e.target.files[0]));
    $('forecastCA').addEventListener('input', () => { if(currentDay){ currentDay.forecastCA = num($('forecastCA').value); recalcActuals(); } });
    $('actualCA').addEventListener('input', recalcActuals);
    $('btnSaveParams').addEventListener('click', saveParamsFromUI);
    $('btnSaveForecast').addEventListener('click', saveForecast);
    $('btnPdfForecast').addEventListener('click', () => createAndStorePdf('forecast'));
    $('btnCloseDay').addEventListener('click', closeDay);
    $('btnPdfClosure').addEventListener('click', () => createAndStorePdf('closure'));
    $('btnRefresh').addEventListener('click', async () => { await refreshHistory(); if(currentImport) await recomputeForecast(); });
  }

  async function importExcel(file){
    try{
      showStatus('Lecture du fichier Inpulse…');
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, {type:'array'});
      const det = wb.Sheets['Données détaillées'];
      if(!det) throw new Error('Onglet « Données détaillées » introuvable.');
      const rows = XLSX.utils.sheet_to_json(det, {defval:null});
      if(!rows.length) throw new Error('Aucune donnée dans « Données détaillées ».');
      const dates = [...new Set(rows.map(r => parseDateValue(r['Date'])).filter(Boolean))];
      if(!dates.length) throw new Error('Date non détectée dans le fichier.');
      const date = dates[0];
      let ca = 0;
      const caSheet = wb.Sheets['CA journalier'];
      if(caSheet){
        const caRows = XLSX.utils.sheet_to_json(caSheet, {defval:null});
        const match = caRows.find(r => parseDateValue(r['Date']) === date) || caRows[0];
        ca = match ? num(match['CA TTC']) : 0;
      }
      currentImport = { fileName:file.name, date, rows, ca, dates };
      $('detectedDate').value = formatDateFR(date);
      if(ca && !$('forecastCA').value) $('forecastCA').value = ca.toFixed(2);
      await refreshHistory();
      await recomputeForecast();
      showStatus(`Fichier lu : ${file.name} • ${rows.length} lignes • date ${formatDateFR(date)}.`);
    }catch(e){ showStatus(e.message, true); }
  }

  async function recomputeForecast(){
    if(!currentImport) return;
    const restaurant = $('restaurant').value;
    const rows = currentImport.rows;
    const extracted = extractInpuse(rows);
    const relevantHistory = history.filter(h => h.restaurant === restaurant && h.status === 'CLOSED');
    const details = [];

    for(const p of config.products){
      const e = extracted[p.key];
      const sourceUnits = e.units;
      const needKg = p.key === 'fromagere' ? e.needKg : (sourceUnits * num(p.portionG) / 1000);
      const rawBags = p.kgPerBag > 0 ? needKg / p.kgPerBag : 0;
      const baseMidi = rawBags * config.general.midiShare / 100;
      const baseSoir = rawBags * config.general.soirShare / 100;
      const trendMidi = trendFactor(p.key, 'MIDI', currentImport.date, relevantHistory);
      const trendSoir = trendFactor(p.key, 'SOIR', currentImport.date, relevantHistory);
      const midiForecast = Math.max(num(p.prepMidi), ceilStep(baseMidi * trendMidi, p.step));
      const soirForecast = Math.max(num(p.prepSoir), ceilStep(baseSoir * trendSoir, p.step));
      details.push({
        key:p.key,label:p.label,sourceUnits,needKg,rawBags,baseMidi,baseSoir,trendMidi,trendSoir,
        midiForecast,soirForecast,prepMidi:num(p.prepMidi),prepSoir:num(p.prepSoir),
        marginMidi:Math.max(0,midiForecast-num(p.prepMidi)),marginSoir:Math.max(0,soirForecast-num(p.prepSoir)),
        matches:e.matches || [], sauceBreakdown:e.sauceBreakdown || null
      });
    }

    currentDay = {
      id: `${restaurant}_${currentImport.date}`,
      date: currentImport.date,
      restaurant,
      source:'INPULSE',
      fileName:currentImport.fileName,
      forecastCA:num($('forecastCA').value || currentImport.ca),
      status:'FORECAST',
      createdAt:new Date().toISOString(),
      details,
      sauceDebug:extracted.fromagere.sauceBreakdown,
      comment:''
    };
    renderForecast();
    renderActualTable();
    $('forecastSection').classList.remove('hidden');
    $('closureSection').classList.remove('hidden');
  }

  function extractInpuse(rows){
    const out = {};
    for(const p of config.products.filter(x => x.key !== 'fromagere')){
      const matches = rows.filter(r => norm(r['Catégorie']) === norm('VIANDES') && norm(r['Nom']) === norm(p.exact));
      out[p.key] = {units:sum(matches.map(r=>num(r["Nombre d'unités"]))), matches:matches.map(slimRow)};
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
    const qtyM=sum(sizeItems.M.map(r=>num(r["Nombre d'unités"])));
    const qtyL=sum(sizeItems.L.map(r=>num(r["Nombre d'unités"])));
    const qtyXL=sum(sizeItems.XL.map(r=>num(r["Nombre d'unités"])));

    const findQty = exact => sum(rows.filter(r=>norm(r['Nom'])===norm(exact)).map(r=>num(r["Nombre d'unités"])));
    const startsQty = prefix => sum(rows.filter(r=>norm(r['Nom']).startsWith(norm(prefix))).map(r=>num(r["Nombre d'unités"])));

    const sansM=findQty('Sans sauce fromagère Otacos M');
    const sansL=findQty('Sans sauce fromagère Otacos L');
    const sansXL=findQty('Sans sauce fromagère Otacos XL');
    const supplement=findQty('Supplément sauce fromagère');
    const omini=startsQty("O'Mini -");
    const sansOmini=findQty("Sans sauce fromagère O'Mini");
    const fritotacos=findQty("Frit'Otacos");
    const fritesFromagere=findQty('Menu à composer Supplément Frites sauce fromagère');
    const beaucoup=findQty('Beaucoup de sauce fromagère');
    const sansObowl=findQty('Sans sauce fromagère Obowl');
    const croustySauce=findQty("CrO'usty Sauce fromagère");

    const grams =
      qtyM*config.sauce.M + qtyL*config.sauce.L + qtyXL*config.sauce.XL
      - sansM*config.sauce.M - sansL*config.sauce.L - sansXL*config.sauce.XL
      + supplement*config.sauce.supplement
      + Math.max(0,omini-sansOmini)*config.sauce.omini
      + fritotacos*config.sauce.fritotacos
      + fritesFromagere*config.sauce.fritesFromagere
      + beaucoup*config.sauce.beaucoupExtra
      - sansObowl*config.sauce.sansObowl
      + croustySauce*config.sauce.croustySauce;

    const breakdown={
      M:{qty:qtyM,g:config.sauce.M,items:sizeItems.M.map(slimRow)},
      L:{qty:qtyL,g:config.sauce.L,items:sizeItems.L.map(slimRow)},
      XL:{qty:qtyXL,g:config.sauce.XL,items:sizeItems.XL.map(slimRow)},
      sansM,sansL,sansXL,supplement,omini,sansOmini,fritotacos,fritesFromagere,beaucoup,sansObowl,croustySauce,grams
    };
    const matches = [
      ...sizeItems.M,...sizeItems.L,...sizeItems.XL,
      ...rows.filter(r => /sauce fromagère|O'Mini|Frit'Otacos/i.test(String(r['Nom']||'')))
    ].map(slimRow);
    return {units:qtyM+qtyL+qtyXL, needKg:Math.max(0,grams/1000), matches, sauceBreakdown:breakdown};
  }

  function trendFactor(productKey, service, currentDate, hist){
    const maxCorr = num(config.general.maxCorrectionPct)/100;
    const prodW = num(config.general.productionWeight)/100;
    const caW = num(config.general.caWeight)/100;
    const horizon = num(config.general.historyDays) || 28;
    const cur = new Date(currentDate+'T12:00:00');
    const curDow = cur.getDay();
    const signals=[];
    for(const day of hist){
      const d = new Date(day.date+'T12:00:00');
      const age=(cur-d)/86400000;
      if(age<=0 || age>horizon) continue;
      const detail=(day.details||[]).find(x=>x.key===productKey);
      if(!detail || !day.actuals || !day.actuals[productKey]) continue;
      const base = service==='MIDI' ? num(detail.baseMidi) : num(detail.baseSoir);
      const actual = num(day.actuals[productKey][service==='MIDI'?'actualMidi':'actualSoir']);
      if(base<=0 || actual<0) continue;
      const ratioProd=actual/base;
      const caRatio=(num(day.forecastCA)>0 && num(day.actualCA)>0) ? num(day.actualCA)/num(day.forecastCA) : 1;
      const caNormalized=caRatio>0 ? ratioProd/caRatio : ratioProd;
      const signal=prodW*(ratioProd-1)+caW*(caNormalized-1);
      const recency=Math.pow(.88, age/7);
      const weekdayBoost=d.getDay()===curDow ? 1.8 : 1;
      signals.push({signal,weight:recency*weekdayBoost});
    }
    if(!signals.length) return 1;
    const avg=signals.reduce((a,x)=>a+x.signal*x.weight,0)/signals.reduce((a,x)=>a+x.weight,0);
    const confidence=Math.min(1, signals.length/Math.max(1,num(config.general.minHistory)));
    const corr=clamp(avg*confidence,-maxCorr,maxCorr);
    return 1+corr;
  }

  function renderForecast(){
    const tb=$('forecastTable').querySelector('tbody'); tb.innerHTML='';
    currentDay.details.forEach(d=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td><strong>${esc(d.label)}</strong></td>
        <td class="num">${fmt(d.sourceUnits,2)}</td><td class="num">${fmt(d.needKg,3)}</td><td class="num">${fmt(d.rawBags,2)}</td>
        <td class="num">${pct((d.trendMidi-1)*100)}</td><td class="num">${pct((d.trendSoir-1)*100)}</td>
        <td class="num"><strong>${fmt(d.midiForecast,2)}</strong></td><td class="num"><strong>${fmt(d.soirForecast,2)}</strong></td>
        <td class="num">${fmt(d.prepMidi,2)}</td><td class="num">${fmt(d.prepSoir,2)}</td>
        <td class="num">${fmt(d.marginMidi,2)}</td><td class="num">${fmt(d.marginSoir,2)}</td>`;
      tb.appendChild(tr);
    });
    renderMatchDetails();
  }

  function renderMatchDetails(){
    const d=currentDay.sauceDebug;
    const container=$('matchDetails');
    const groups=[['M',d.M],['L',d.L],['XL',d.XL]];
    let html='<div class="match-grid">';
    for(const [s,g] of groups){
      html+=`<div class="match-card"><h4>Taille ${s} — ${fmt(g.qty,2)} × ${fmt(g.g,0)} g</h4><ul>${g.items.map(x=>`<li>${esc(x.name)} — ${fmt(x.qty,2)}</li>`).join('')}</ul></div>`;
    }
    html+=`<div class="match-card"><h4>Ajustements sauce</h4><ul>
      <li>Sans sauce M : ${fmt(d.sansM,2)}</li><li>Sans sauce L : ${fmt(d.sansL,2)}</li><li>Sans sauce XL : ${fmt(d.sansXL,2)}</li>
      <li>Supplément fromagère : ${fmt(d.supplement,2)} × ${config.sauce.supplement} g</li>
      <li>O'Mini : ${fmt(d.omini,2)} ; sans sauce O'Mini : ${fmt(d.sansOmini,2)} ; net × ${config.sauce.omini} g</li>
      <li>Frit'Otacos : ${fmt(d.fritotacos,2)} × ${config.sauce.fritotacos} g</li>
      <li>Frites sauce fromagère : ${fmt(d.fritesFromagere,2)} × ${config.sauce.fritesFromagere} g</li>
      <li>Beaucoup de sauce : ${fmt(d.beaucoup,2)} × ${config.sauce.beaucoupExtra} g (paramètre à préciser)</li>
      <li>Sans sauce Obowl : ${fmt(d.sansObowl,2)} × ${config.sauce.sansObowl} g (paramètre à préciser)</li>
      <li>CrO'usty Sauce fromagère : ${fmt(d.croustySauce,2)} × ${config.sauce.croustySauce} g (paramètre à préciser)</li>
      <li><strong>Total sauce : ${fmt(d.grams/1000,3)} kg</strong></li>
    </ul></div></div>`;
    container.innerHTML=html;
  }

  function renderActualTable(){
    const tb=$('actualTable').querySelector('tbody'); tb.innerHTML='';
    currentDay.details.forEach(d=>{
      const tr=document.createElement('tr'); tr.dataset.key=d.key;
      tr.innerHTML=`<td><strong>${esc(d.label)}</strong></td>
        <td class="num">${fmt(d.prepMidi,2)}</td>
        <td><input class="actual-input launch-midi" type="number" min="0" step="0.25" value="0"></td>
        <td><input class="actual-input remain-midi" type="number" min="0" step="0.25" value="0"></td>
        <td class="num actual-midi">${fmt(d.prepMidi,2)}</td>
        <td class="num">${fmt(d.prepSoir,2)}</td>
        <td><input class="actual-input launch-soir" type="number" min="0" step="0.25" value="0"></td>
        <td><input class="actual-input remain-soir" type="number" min="0" step="0.25" value="0"></td>
        <td class="num actual-soir">${fmt(d.prepSoir,2)}</td>
        <td class="num actual-total">${fmt(d.prepMidi+d.prepSoir,2)}</td>
        <td class="num theoretical-ca">—</td><td class="num variance">—</td>`;
      tr.querySelectorAll('input').forEach(i=>i.addEventListener('input',recalcActuals)); tb.appendChild(tr);
    });
    recalcActuals();
  }

  function recalcActuals(){
    if(!currentDay) return;
    const fca=num($('forecastCA').value || currentDay.forecastCA);
    const aca=num($('actualCA').value);
    const caRatio=fca>0 && aca>0 ? aca/fca : null;
    $$('#actualTable tbody tr').forEach(tr=>{
      const d=currentDay.details.find(x=>x.key===tr.dataset.key);
      const lm=num(tr.querySelector('.launch-midi').value), rm=num(tr.querySelector('.remain-midi').value);
      const ls=num(tr.querySelector('.launch-soir').value), rs=num(tr.querySelector('.remain-soir').value);
      const am=Math.max(0,d.prepMidi+lm-rm), as=Math.max(0,d.prepSoir+ls-rs), total=am+as;
      const theo=caRatio===null ? null : (d.midiForecast+d.soirForecast)*caRatio;
      const variance=theo===null ? null : total-theo;
      tr.querySelector('.actual-midi').textContent=fmt(am,2); tr.querySelector('.actual-soir').textContent=fmt(as,2); tr.querySelector('.actual-total').textContent=fmt(total,2);
      tr.querySelector('.theoretical-ca').textContent=theo===null?'—':fmt(theo,2);
      const v=tr.querySelector('.variance'); v.textContent=variance===null?'—':signed(variance); v.className='num variance '+(variance>0.001?'positive':variance<-0.001?'negative':'');
    });
  }

  function collectActuals(){
    const actuals={};
    $$('#actualTable tbody tr').forEach(tr=>{
      const d=currentDay.details.find(x=>x.key===tr.dataset.key);
      const launchMidi=num(tr.querySelector('.launch-midi').value), remainMidi=num(tr.querySelector('.remain-midi').value);
      const launchSoir=num(tr.querySelector('.launch-soir').value), remainSoir=num(tr.querySelector('.remain-soir').value);
      const actualMidi=Math.max(0,d.prepMidi+launchMidi-remainMidi), actualSoir=Math.max(0,d.prepSoir+launchSoir-remainSoir);
      actuals[d.key]={launchMidi,remainMidi,actualMidi,launchSoir,remainSoir,actualSoir,actualTotal:actualMidi+actualSoir};
    });
    return actuals;
  }

  async function saveForecast(){
    if(!currentDay) return showStatus('Importe d’abord un fichier Inpulse.', true);
    currentDay.forecastCA=num($('forecastCA').value);
    currentDay.status='FORECAST';
    await saveDay(currentDay);
    showStatus('Prévision enregistrée.');
    await refreshHistory();
  }

  async function closeDay(){
    if(!currentDay) return;
    currentDay.forecastCA=num($('forecastCA').value);
    currentDay.actualCA=num($('actualCA').value);
    currentDay.comment=$('comment').value || '';
    currentDay.actuals=collectActuals();
    currentDay.status='CLOSED';
    currentDay.closedAt=new Date().toISOString();
    await saveDay(currentDay);
    showStatus('Journée clôturée. Les écarts alimenteront les prochaines prévisions.');
    await refreshHistory();
  }

  async function saveDay(day){
    if(remoteEnabled){
      const r=await api({action:'saveDay',day}); if(!r.ok) throw new Error(r.error||'Erreur sauvegarde');
    }else{
      const arr=JSON.parse(localStorage.getItem('otacos_days_v1')||'[]');
      const i=arr.findIndex(x=>x.id===day.id); const copy=JSON.parse(JSON.stringify(day));
      if(i>=0) arr[i]=copy; else arr.push(copy);
      localStorage.setItem('otacos_days_v1',JSON.stringify(arr));
    }
  }

  async function refreshHistory(){
    try{
      if(remoteEnabled){ const r=await api({action:'listDays'}); history=r.days||[]; }
      else history=JSON.parse(localStorage.getItem('otacos_days_v1')||'[]');
      history.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
      renderHistory();
    }catch(e){ showStatus('Impossible de lire l’historique : '+e.message,true); }
  }

  function renderHistory(){
    const c=$('historyList');
    if(!history.length){ c.className='history-list empty'; c.textContent='Aucune journée enregistrée.'; return; }
    c.className='history-list'; c.innerHTML=history.slice(0,50).map(h=>{
      const caGap=(num(h.forecastCA)>0&&num(h.actualCA)>0)?(num(h.actualCA)/num(h.forecastCA)-1)*100:null;
      return `<div class="history-item"><strong>${formatDateFR(h.date)}</strong><span>${h.restaurant==='BSM'?"Boulogne-sur-Mer":"Armentières"}</span><span>${h.status==='CLOSED'?'Clôturée':'Prévision'}</span><span>CA prév. ${money(h.forecastCA)}</span><span>${caGap===null?'CA réel —':'CA '+pct(caGap)}</span></div>`;
    }).join('');
  }

  function renderParams(){
    const p=$('paramsPanel');
    let html=`<div class="params-group"><h3>Produits / sachets / prépa</h3><div class="table-wrap"><table class="params-table"><thead><tr><th>Produit</th><th>Portion g</th><th>Kg / sachet</th><th>Pas</th><th>Prépa matin</th><th>Prépa soir</th></tr></thead><tbody>`;
    config.products.forEach(x=>{ html+=`<tr data-pkey="${x.key}"><td>${esc(x.label)}</td><td><input data-f="portionG" type="number" step="1" value="${x.portionG??''}" ${x.key==='fromagere'?'disabled':''}></td><td><input data-f="kgPerBag" type="number" step="0.01" value="${x.kgPerBag}"></td><td><input data-f="step" type="number" step="0.25" value="${x.step}"></td><td><input data-f="prepMidi" type="number" step="0.25" value="${x.prepMidi}"></td><td><input data-f="prepSoir" type="number" step="0.25" value="${x.prepSoir}"></td></tr>`; });
    html+=`</tbody></table></div></div>`;
    html+=`<div class="params-group"><h3>Sauce fromagère (grammes)</h3><div class="table-wrap"><table class="params-table"><thead><tr><th>M</th><th>L</th><th>XL</th><th>Supplément</th><th>O'Mini</th><th>Frit'Otacos</th><th>Frites fromagère</th><th>Beaucoup +</th><th>Sans Obowl -</th><th>CrO'usty sauce</th></tr></thead><tbody><tr>${Object.keys(config.sauce).map(k=>`<td><input data-skey="${k}" type="number" step="1" value="${config.sauce[k]}"></td>`).join('')}</tr></tbody></table></div></div>`;
    const g=config.general;
    html+=`<div class="params-group"><h3>Moteur de prévision</h3><div class="table-wrap"><table class="params-table"><thead><tr><th>MIDI %</th><th>SOIR %</th><th>Correction max %</th><th>Historique jours</th><th>Nb journées pour pleine confiance</th><th>Poids réel %</th><th>Poids CA-normalisé %</th></tr></thead><tbody><tr>
      <td><input data-gkey="midiShare" type="number" value="${g.midiShare}"></td><td><input data-gkey="soirShare" type="number" value="${g.soirShare}"></td><td><input data-gkey="maxCorrectionPct" type="number" value="${g.maxCorrectionPct}"></td><td><input data-gkey="historyDays" type="number" value="${g.historyDays}"></td><td><input data-gkey="minHistory" type="number" value="${g.minHistory}"></td><td><input data-gkey="productionWeight" type="number" value="${g.productionWeight}"></td><td><input data-gkey="caWeight" type="number" value="${g.caWeight}"></td></tr></tbody></table></div></div>`;
    p.innerHTML=html;
  }

  async function saveParamsFromUI(){
    $$('#paramsPanel tr[data-pkey]').forEach(tr=>{ const p=config.products.find(x=>x.key===tr.dataset.pkey); tr.querySelectorAll('input[data-f]').forEach(i=>{ if(!i.disabled) p[i.dataset.f]=num(i.value); }); });
    $$('#paramsPanel input[data-skey]').forEach(i=>config.sauce[i.dataset.skey]=num(i.value));
    $$('#paramsPanel input[data-gkey]').forEach(i=>config.general[i.dataset.gkey]=num(i.value));
    if(Math.abs(config.general.midiShare+config.general.soirShare-100)>.01) return showStatus('MIDI % + SOIR % doivent faire 100 %.',true);
    const w=config.general.productionWeight+config.general.caWeight;
    if(Math.abs(w-100)>.01) return showStatus('Poids réel % + poids CA-normalisé % doivent faire 100 %.',true);
    localStorage.setItem('otacos_config_v1',JSON.stringify(config));
    if(remoteEnabled){ const r=await api({action:'saveConfig',config}); if(!r.ok) return showStatus(r.error||'Erreur paramètres',true); }
    showStatus('Paramètres enregistrés.');
    if(currentImport) await recomputeForecast();
  }

  async function createAndStorePdf(kind){
    if(!currentDay) return showStatus('Aucune prévision à exporter.',true);
    if(kind==='closure'){
      currentDay.actualCA=num($('actualCA').value); currentDay.comment=$('comment').value||''; currentDay.actuals=collectActuals();
    }
    const doc=buildPdf(currentDay,kind);
    const fileName=`${currentDay.date}_${currentDay.restaurant}_${kind==='closure'?'CLOTURE':'PREVISION'}.pdf`;
    if(remoteEnabled){
      const dataUri=doc.output('datauristring'); const base64=dataUri.split(',')[1];
      const r=await api({action:'uploadPdf', dayId:currentDay.id, date:currentDay.date, restaurant:currentDay.restaurant, kind, fileName, base64});
      if(!r.ok) return showStatus(r.error||'Erreur Drive',true);
      showStatus(`PDF enregistré dans Google Drive : ${fileName}`);
      await refreshHistory();
    }else{
      doc.save(fileName);
      showStatus(`PDF généré localement : ${fileName}. Configure Google Apps Script pour le stocker dans Drive.`);
    }
  }

  function buildPdf(day,kind){
    const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'}); const W=doc.internal.pageSize.getWidth(); let y=10;
    doc.setFillColor(255,242,0); doc.rect(10,y,W-20,18,'F'); doc.setTextColor(215,25,32); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text('!! Qté en sachet !!',W/2,y+11,{align:'center'}); y+=22;
    doc.setTextColor(30,30,30); doc.setFontSize(10); doc.text(`Restaurant : ${day.restaurant==='BSM'?"O'TACOS BOULOGNE-SUR-MER":"O'TACOS ARMENTIÈRES"}`,10,y); doc.text(`Date : ${formatDateFR(day.date)}`,W-10,y,{align:'right'}); y+=5;
    doc.setFont('helvetica','normal'); doc.text(`Source : ${day.source}   |   CA prévisionnel : ${money(day.forecastCA)}`,10,y); y+=5;

    y=pdfSection(doc,'Production total prévisionnel',y);
    y=pdfTable(doc,y,['Produit','Service MIDI','Service SOIR'],day.details.map(d=>[d.label,fmt(d.midiForecast,2),fmt(d.soirForecast,2)]));
    y=pdfSection(doc,'Qté pour la préparation de service',y+2);
    y=pdfTable(doc,y,['Produit','10H','16H'],day.details.map(d=>[d.label,fmt(d.prepMidi,2),fmt(d.prepSoir,2)]));
    y=pdfSection(doc,'Marge responsable ajustée en fonction de la fin de service',y+2);
    y=pdfTable(doc,y,['Produit','Midi / après midi','SOIR'],day.details.map(d=>[d.label,fmt(d.marginMidi,2),fmt(d.marginSoir,2)]));

    if(kind==='closure'){
      y=pdfSection(doc,'Qté réellement lancé - Hors prépas',y+2,true);
      const a=day.actuals||{};
      y=pdfTable(doc,y,['Produit','Cuisson MIDI','Cuisson SOIR','Reste MIDI','Reste SOIR','Réel total'],day.details.map(d=>{
        const x=a[d.key]||{}; return [d.label,fmt(x.launchMidi||0,2),fmt(x.launchSoir||0,2),fmt(x.remainMidi||0,2),fmt(x.remainSoir||0,2),fmt(x.actualTotal||0,2)];
      }));
      const ratio=day.forecastCA>0&&day.actualCA>0?day.actualCA/day.forecastCA:null;
      y=pdfSection(doc,'Analyse clôture',y+2);
      const analysis=day.details.map(d=>{ const x=a[d.key]||{}; const theo=ratio===null?null:(d.midiForecast+d.soirForecast)*ratio; return [d.label,fmt(d.midiForecast+d.soirForecast,2),theo===null?'—':fmt(theo,2),fmt(x.actualTotal||0,2),theo===null?'—':signed((x.actualTotal||0)-theo)]; });
      y=pdfTable(doc,y,['Produit','Prévu','Théorique CA','Réel','Écart'],analysis);
      if(y>250){doc.addPage();y=15;}
      doc.setFont('helvetica','bold');doc.text(`CA réel : ${money(day.actualCA)}   |   Écart CA : ${day.forecastCA>0?signed((day.actualCA/day.forecastCA-1)*100)+' %':'—'}`,10,y+5); y+=11;
    }
    y=pdfSection(doc,'Commentaire',y+2,true);
    doc.setTextColor(30,30,30);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text((day.comment||'').slice(0,800),12,y+7,{maxWidth:W-24});
    return doc;
  }

  function pdfSection(doc,title,y,yellow=false){
    const W=doc.internal.pageSize.getWidth(); if(y>270){doc.addPage();y=12;}
    doc.setFillColor(yellow?255:246,yellow?242:226,yellow?0:218); doc.rect(10,y,W-20,7,'F'); doc.setTextColor(215,25,32); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text(title,W/2,y+4.8,{align:'center'}); return y+7;
  }
  function pdfTable(doc,y,head,body){
    doc.autoTable({startY:y,head:[head],body,theme:'grid',styles:{fontSize:8,cellPadding:1.8,textColor:[30,30,30]},headStyles:{fillColor:[244,222,212],textColor:[30,30,30],fontStyle:'bold'},margin:{left:10,right:10}}); return doc.lastAutoTable.finalY;
  }

  async function api(payload){
    const res=await fetch(gasUrl,{method:'POST',body:JSON.stringify(payload),redirect:'follow'});
    const text=await res.text();
    let json; try{json=JSON.parse(text);}catch(e){throw new Error('Réponse Apps Script invalide. Vérifie le déploiement Web App.');}
    if(json.error) throw new Error(json.error); return json;
  }

  function loadLocalConfig(){ try{return mergeConfig(DEFAULT_CONFIG,JSON.parse(localStorage.getItem('otacos_config_v1')||'null'));}catch(e){return JSON.parse(JSON.stringify(DEFAULT_CONFIG));} }
  function mergeConfig(base,over){ const out=JSON.parse(JSON.stringify(base)); if(!over)return out; out.general={...out.general,...over.general}; out.sauce={...out.sauce,...over.sauce}; if(Array.isArray(over.products)) out.products=out.products.map(p=>({...p,...(over.products.find(x=>x.key===p.key)||{})})); return out; }
  function showStatus(msg,error=false){const b=$('statusBox');b.textContent=msg;b.classList.remove('hidden');b.classList.toggle('error',error)}
  function parseDateValue(v){ if(!v)return null; if(v instanceof Date) return v.toISOString().slice(0,10); const s=String(v).trim(); let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m?`${m[1]}-${m[2]}-${m[3]}`:null; }
  function num(v){ if(v===null||v===undefined||v==='')return 0; const n=Number(String(v).replace(/\s/g,'').replace(',','.')); return Number.isFinite(n)?n:0; }
  function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/’/g,"'").trim().toLowerCase(); }
  function sum(a){return a.reduce((x,y)=>x+y,0)} function ceilStep(v,s=.25){return Math.ceil((v-1e-9)/s)*s} function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function fmt(v,d=2){return Number(v||0).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d})} function money(v){return num(v).toLocaleString('fr-FR',{style:'currency',currency:'EUR'})}
  function signed(v){const n=num(v);return `${n>0?'+':''}${fmt(n,2)}`} function pct(v){const n=num(v);return `${n>0?'+':''}${fmt(n,1)} %`} function formatDateFR(iso){if(!iso)return'—';const [y,m,d]=iso.split('-');return`${d}/${m}/${y}`}
  function slimRow(r){return{category:r['Catégorie'],name:r['Nom'],qty:num(r["Nombre d'unités"])}} function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  function $$(sel){return [...document.querySelectorAll(sel)]}
})();
