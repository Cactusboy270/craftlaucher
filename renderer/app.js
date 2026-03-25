/**
 * renderer/app.js — Version finale propre
 */

let session      = null;
let instances    = [];
let selectedId   = null;
let selectedIcon = '🌿';
let editingId    = null;

const ADMIN_UUIDS = ['8a501859-8fb7-443f-ab18-0909b41b3275'];
const PAGE_TITLES = {
  home: 'Accueil', instances: 'Instances', modpacks: 'Modpacks',
  stats: 'Statistiques', admin: 'Administration', profile: 'Mon profil',
};

const MC_VERSIONS = {
  'Dernières': ['1.21.4','1.21.3','1.21.2','1.21.1','1.21'],
  '1.20.x':   ['1.20.6','1.20.5','1.20.4','1.20.3','1.20.2','1.20.1','1.20'],
  '1.19.x':   ['1.19.4','1.19.3','1.19.2','1.19.1','1.19'],
  '1.18.x':   ['1.18.2','1.18.1','1.18'],
  '1.17.x':   ['1.17.1','1.17'],
  '1.16.x':   ['1.16.5','1.16.4','1.16.3','1.16.2','1.16.1','1.16'],
  '1.15.x':   ['1.15.2','1.15.1','1.15'],
  '1.14.x':   ['1.14.4','1.14.3','1.14.2','1.14.1','1.14'],
  '1.13.x':   ['1.13.2','1.13.1','1.13'],
  'Classique': ['1.12.2','1.12.1','1.12','1.11.2','1.11','1.10.2','1.10','1.9.4','1.9','1.8.9','1.8','1.7.10'],
};

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  createParticles();
  bindNav();
  bindAccountMenu();
  bindLaunch();
  bindModals();
  bindUpdateEvents();

  const res = await window.launcher.auth.getSession();
  if (res.success && res.session) { applySession(res.session); showApp(); }

  window.launcher.mc.onProgress(onMcProgress);
  window.launcher.mc.onLog(onMcLog);
  window.launcher.mc.onClose(onMcClose);
});

function createParticles() {
  const c = document.getElementById('particles');
  if (!c) return;
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `left:${Math.random()*100}%;animation-duration:${8+Math.random()*12}s;animation-delay:${Math.random()*10}s;`;
    c.appendChild(p);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
async function doLogin() {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  btn.disabled = true;
  btn.innerHTML = '<span style="opacity:0.7">Ouverture de la fenêtre Microsoft...</span>';
  err.textContent = '';
  const res = await window.launcher.auth.login();
  if (res.success) {
    applySession(res.session); showApp();
    showToast('✓ Connecté en tant que ' + res.session.username, 'green');
  } else {
    err.textContent = '⚠ ' + res.error;
    btn.disabled = false;
    btn.innerHTML = `<div class="ms-logo"><div style="background:#f25022"></div><div style="background:#7fba00"></div><div style="background:#00a4ef"></div><div style="background:#ffb900"></div></div>Se connecter avec Microsoft`;
  }
}

async function doLogout() {
  await window.launcher.auth.logout();
  session = null; instances = []; selectedId = null;
  hideAccountMenu();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').style.display = '';
  const btn = document.getElementById('login-btn');
  btn.disabled = false;
  btn.innerHTML = `<div class="ms-logo"><div style="background:#f25022"></div><div style="background:#7fba00"></div><div style="background:#00a4ef"></div><div style="background:#ffb900"></div></div>Se connecter avec Microsoft`;
  showToast('Déconnecté');
}

function applySession(s) {
  session = s;
  const isAdmin = s.isAdmin || ADMIN_UUIDS.includes(s.uuid);
  document.getElementById('account-name').textContent = s.username;
  document.getElementById('account-role').textContent = (isAdmin ? 'Admin · ' : '') + 'Microsoft';
  const av = document.getElementById('skin-avatar');
  const fb = document.getElementById('skin-fallback');
  if (s.uuid) {
    av.src = `https://crafatar.com/avatars/${s.uuid}?size=32&overlay`;
    av.style.display = 'block'; fb.style.display = 'none';
    av.onerror = () => { av.style.display='none'; fb.style.display='flex'; fb.textContent=s.username.slice(0,2).toUpperCase(); };
  } else {
    av.style.display = 'none'; fb.style.display = 'flex';
    fb.textContent = s.username.slice(0,2).toUpperCase();
  }
  if (isAdmin) {
    document.getElementById('nav-admin-group').classList.remove('hidden');
    document.getElementById('nav-admin').classList.remove('hidden');
  }
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
  instances = await window.launcher.instances.list();
  try {
    const remote = await window.launcher.shared.listPublished();
    window.__sharedPublishedInstances = remote.success ? (remote.items || []) : [];
    const sharedStatus = await window.launcher.shared.status();
    window.__sharedConfigured = Boolean(sharedStatus?.configured);
  } catch {
    window.__sharedPublishedInstances = [];
    window.__sharedConfigured = false;
  }
  navTo('home');
  if (instances.length > 0) setSelectedInstance(instances[0].id);
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
function bindNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.addEventListener('click', () => navTo(el.dataset.page))
  );
  document.getElementById('btn-new-instance').addEventListener('click', () => openModal('modal-new-instance'));
  document.getElementById('btn-upload-instance').addEventListener('click', importModpackTopBar);
}

function navTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  renderPage(page);
  hideAccountMenu();
}

async function renderPage(page) {
  const c = document.getElementById('content');
  c.innerHTML = '';
  switch(page) {
    case 'home':      c.innerHTML = buildHomePage();      break;
    case 'instances': renderInstancesPage(c);             break;
    case 'modpacks':  c.innerHTML = buildModpacksPage();  bindModpackActions(); break;
    case 'stats':     c.innerHTML = buildStatsPage();     break;
    case 'admin':     c.innerHTML = buildAdminPage();     bindAdminActions();   break;
    case 'profile':   c.innerHTML = buildProfilePage();   bindProfileActions(); break;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════════════
function buildHomePage() {
  const active = instances.find(i => i.id === selectedId) || instances[0];
  return `
    <div class="home-hero">
      <div class="home-hero-title">Bienvenue, ${session?.username || 'Joueur'} !</div>
      <div class="home-hero-sub">${instances.length} instance${instances.length !== 1 ? 's' : ''} configurée${instances.length !== 1 ? 's' : ''}</div>
      ${active ? `
        <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--bg2);border-radius:var(--radius);border:1px solid var(--border2);margin-top:14px;">
          <span style="font-size:24px;">${active.icon||'🌿'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="home-inst-name">${active.name}</div>
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${active.modLoader && active.modLoader !== 'vanilla' ? active.modLoader+' ' : 'Vanilla '}${active.version} · ${active.ram||'4G'} RAM</div>
          </div>
          <button class="btn-green" id="home-launch-btn">▶ Lancer</button>
        </div>
      ` : `<button class="btn-green" style="margin-top:12px;" onclick="openModal('modal-new-instance')">+ Créer votre première instance</button>`}
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Instances</div><div class="stat-value">${instances.length}</div></div>
      <div class="stat-card"><div class="stat-label">Temps total</div><div class="stat-value">142<span class="stat-unit">h</span></div></div>
      <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value">38</div></div>
    </div>
    <div class="section-title">Actualités</div>
    <div class="card">
      <div class="news-item"><div class="news-dot"></div><div><div class="news-title">Minecraft 1.21.4 — Pale Garden</div><div class="news-date">13 mars 2026</div></div></div>
      <div class="news-item"><div class="news-dot" style="background:var(--blue)"></div><div><div class="news-title">Forge 1.21.4-54.0.0 disponible</div><div class="news-date">10 mars 2026</div></div></div>
      <div class="news-item"><div class="news-dot" style="background:var(--amber)"></div><div><div class="news-title">Fabric Loader 0.16.9 mis à jour</div><div class="news-date">8 mars 2026</div></div></div>
    </div>
  `;
}

// Binder après render
function bindHomeActions() {
  const btn = document.getElementById('home-launch-btn');
  if (btn && selectedId) btn.addEventListener('click', () => launchInstance(selectedId));
}

// ══════════════════════════════════════════════════════════════════════════
// INSTANCES — rendu avec addEventListener (pas onclick inline)
// ══════════════════════════════════════════════════════════════════════════
function renderInstancesPage(container) {
  const grid = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = `${instances.length} instance${instances.length !== 1 ? 's' : ''}`;
  container.appendChild(title);

  const gridDiv = document.createElement('div');
  gridDiv.className = 'instances-grid';

  instances.forEach(inst => {
    const card = document.createElement('div');
    const loaderTag = !inst.modLoader || inst.modLoader === 'vanilla' ? 'tag-release'
      : inst.modLoader === 'forge' || inst.modLoader === 'neoforge' ? 'tag-modded' : 'tag-fabric';
    const loaderLabel = inst.modLoader && inst.modLoader !== 'vanilla' ? inst.modLoader + ' ' : '';

    card.className = 'instance-card' + (inst.id === selectedId ? ' selected' : '');
    card.innerHTML = `
      ${inst.id === selectedId ? '<div class="inst-active-dot"></div>' : ''}
      <div class="inst-icon">${inst.icon||'🌿'}</div>
      <div class="tag ${loaderTag}" style="margin-bottom:8px;">${loaderLabel}${inst.version}</div>
      <div class="inst-name">${inst.name}</div>
      <div class="inst-meta">${inst.ram||'4G'} RAM${inst.importedFrom ? ' · 📦 importé' : ''}</div>
      <div class="inst-actions">
        <button class="btn-green btn-launch-inst" style="font-size:11px;padding:5px 10px;">▶ Lancer</button>
        <button class="btn-outline btn-edit-inst" style="font-size:11px;padding:5px 10px;">⚙ Éditer</button>
        <button class="btn-outline btn-danger-outline btn-delete-inst" style="font-size:11px;padding:5px 8px;">🗑</button>
      </div>
    `;

    // Selectionner en cliquant sur la carte
    card.addEventListener('click', () => {
      setSelectedInstance(inst.id);
      document.querySelectorAll('.instance-card').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.inst-active-dot').forEach(d => d.remove());
      card.classList.add('selected');
      const dot = document.createElement('div');
      dot.className = 'inst-active-dot';
      card.prepend(dot);
    });

    const launchBtn = card.querySelector('.btn-launch-inst');
    const editBtn = card.querySelector('.btn-edit-inst');
    const deleteBtn = card.querySelector('.btn-delete-inst');

    [launchBtn, editBtn, deleteBtn].forEach(btn => {
      if (btn) btn.type = 'button';
    });

    if (deleteBtn) {
      deleteBtn.textContent = 'Suppr.';
      deleteBtn.setAttribute('aria-label', 'Supprimer ' + inst.name);
      deleteBtn.setAttribute('title', 'Supprimer ' + inst.name);
    }

    launchBtn.addEventListener('click', e => {
      e.stopPropagation();
      launchInstance(inst.id);
    });

    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      openEditInstance(inst.id);
    });

    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteInstanceWithConfirm(inst.id, inst.name);
    });

    gridDiv.appendChild(card);
  });

  // Bouton ajouter
  const addCard = document.createElement('div');
  addCard.className = 'add-instance-card';
  addCard.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Nouvelle instance`;
  addCard.addEventListener('click', () => openModal('modal-new-instance'));
  gridDiv.appendChild(addCard);

  container.appendChild(gridDiv);
}

// ══════════════════════════════════════════════════════════════════════════
// MODPACKS
// ══════════════════════════════════════════════════════════════════════════
function buildModpacksPage() {
  const published = instances.filter(i => i.importedFrom);
  return `
    <div class="modpack-search">
      <input class="search-input" id="modpack-search-input" placeholder="Rechercher sur Modrinth..."/>
      <select class="search-source" id="modpack-type" style="min-width:150px;">
        <option value="modpack">Modpacks</option>
        <option value="mod">Mods</option>
        <option value="shader">Shaders</option>
        <option value="resourcepack">Resource Packs</option>
      </select>
      <button class="btn-green" id="btn-search-modrinth">Rechercher</button>
    </div>
    ${published.length ? `
      <div class="section-title">Modpacks publiés par l'admin</div>
      <div class="modpacks-grid" style="margin-bottom:20px;" id="admin-modpacks-grid"></div>
      <div class="section-title">Découvrir sur Modrinth</div>
    ` : '<div class="section-title">Découvrir sur Modrinth</div>'}
    <div class="modpacks-grid" id="modpacks-grid">
      ${buildModpackCard('All the Mods 9','Forge 1.20.1','Un modpack complet avec plus de 300 mods.','⚙️','12.4M','modpack')}
      ${buildModpackCard('RLCraft','Forge 1.12.2','Le modpack hardcore le plus difficile.','⚔️','28.1M','modpack')}
      ${buildModpackCard('Complementary Shaders','Shader','Shaders magnifiques pour toutes les configs.','✨','8.2M','shader')}
      ${buildModpackCard('Faithful 32x','Resource Pack','Vanilla en résolution 32x.','🎨','15.3M','resourcepack')}
      ${buildModpackCard('Create','Forge 1.20.1','Automatisation mécanique avancée.','⚙️','45.2M','mod')}
      ${buildModpackCard('Better MC','Fabric 1.20.1','Améliore vanilla sans tout changer.','🌿','15.6M','modpack')}
    </div>
  `;
}

function buildModpackCard(name, version, desc, icon, downloads, type) {
  const tagClass = version.includes('Forge') ? 'tag-modded'
    : version.includes('Fabric') ? 'tag-fabric'
    : type === 'shader' ? 'tag-snapshot' : 'tag-release';
  return `
    <div class="modpack-card" data-name="${name}" data-version="${version}" data-type="${type}">
      <div class="modpack-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;">${icon}</div>
      <div class="modpack-info">
        <div class="modpack-name">${name}</div>
        <div class="modpack-desc">${desc}</div>
        <div class="modpack-meta">
          <span class="modpack-downloads">⬇ ${downloads}</span>
          <span class="tag ${tagClass}">${version}</span>
        </div>
      </div>
    </div>
  `;
}

function bindModpackActions() {
  // Bind les cartes modpack via addEventListener
  document.querySelectorAll('.modpack-card[data-name]').forEach(card => {
    card.addEventListener('click', () => installModpack(card.dataset.name, card.dataset.version, card.dataset.type));
  });

  // Remplir la grille admin
  const adminGrid = document.getElementById('admin-modpacks-grid');
  if (adminGrid) {
    instances.filter(i => i.importedFrom).forEach(inst => {
      const card = document.createElement('div');
      card.className = 'modpack-card';
      card.innerHTML = `
        <div class="modpack-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;">${inst.icon||'📦'}</div>
        <div class="modpack-info">
          <div class="modpack-name">${inst.name}</div>
          <div class="modpack-desc">Importé · ${inst.modLoader||'Vanilla'} ${inst.version}</div>
          <div class="modpack-meta"><span class="tag tag-modded">admin</span></div>
        </div>
      `;
      card.addEventListener('click', () => { setSelectedInstance(inst.id); navTo('instances'); });
      adminGrid.appendChild(card);
    });
  }

  document.getElementById('btn-search-modrinth')?.addEventListener('click', () => {
    searchModrinth(document.getElementById('modpack-search-input').value, document.getElementById('modpack-type').value);
  });
  document.getElementById('modpack-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchModrinth(e.target.value, document.getElementById('modpack-type').value);
  });
}

async function searchModrinth(query, type = 'modpack') {
  const grid = document.getElementById('modpacks-grid');
  if (!grid || !query?.trim()) return;
  grid.innerHTML = `<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Recherche en cours...</div>`;
  try {
    const facets = `[["project_type:${type}"]]`;
    const res  = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&limit=8`);
    const data = await res.json();
    if (!data.hits?.length) { grid.innerHTML = `<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Aucun résultat.</div>`; return; }
    const icon = type === 'shader' ? '✨' : type === 'resourcepack' ? '🎨' : type === 'mod' ? '⚙️' : '📦';
    grid.innerHTML = data.hits.map(h => buildModpackCard(h.title, h.latest_version||'Latest', h.description||'', icon, formatDownloads(h.downloads), type)).join('');
    // Re-bind les nouveaux cards
    grid.querySelectorAll('.modpack-card[data-name]').forEach(card => {
      card.addEventListener('click', () => installModpack(card.dataset.name, card.dataset.version, card.dataset.type));
    });
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--red);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Erreur : ${e.message}</div>`;
  }
}

function formatDownloads(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

function installModpack(name, version, type) {
  if (type === 'shader' || type === 'resourcepack') {
    showToast(`Importez votre ${type === 'shader' ? 'shader' : 'resource pack'} via ↑ Importer`, 'green');
    return;
  }
  openModal('modal-new-instance');
  setTimeout(() => {
    document.getElementById('ni-name').value = name;
    const mcVer = version.replace(/^(Forge|Fabric|NeoForge|Quilt)\s/i, '');
    const sel = document.getElementById('ni-version');
    for (let o of sel.options) { if (o.value === mcVer) { o.selected = true; break; } }
    const lo = version.toLowerCase();
    if (lo.includes('neoforge'))   document.getElementById('ni-loader').value = 'neoforge';
    else if (lo.includes('forge')) document.getElementById('ni-loader').value = 'forge';
    else if (lo.includes('fabric')) document.getElementById('ni-loader').value = 'fabric';
    else if (lo.includes('quilt'))  document.getElementById('ni-loader').value = 'quilt';
    showToast(`"${name}" prêt à configurer`, 'green');
  }, 100);
}

// ══════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════
function buildStatsPage() {
  const bars = instances.map(inst => {
    const h   = Math.floor(Math.random()*80+10);
    const pct = Math.min(Math.round(h/150*100), 100);
    const color = !inst.modLoader || inst.modLoader === 'vanilla' ? 'var(--green)'
      : inst.modLoader === 'forge' || inst.modLoader === 'neoforge' ? 'var(--amber)' : 'var(--blue)';
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;color:var(--text);">${inst.icon||'🌿'} ${inst.name}</span>
          <span style="font-size:12px;color:${color};font-family:var(--mono);">${h}h</span>
        </div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:4px;">${inst.modLoader && inst.modLoader !== 'vanilla' ? inst.modLoader+' ' : 'Vanilla '}${inst.version}</div>
      </div>
    `;
  }).join('') || '<div style="color:var(--text3);font-size:13px;">Aucune instance pour le moment.</div>';
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Temps total</div><div class="stat-value">142<span class="stat-unit">h</span></div></div>
      <div class="stat-card"><div class="stat-label">Cette semaine</div><div class="stat-value">8<span class="stat-unit">h</span></div></div>
      <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value">38</div></div>
    </div>
    <div class="section-title">Temps par instance</div>${bars}
  `;
}

// ══════════════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════════════
function buildAdminPage() {
  const published = instances.filter(i => i.importedFrom);
  return `
    <div class="admin-card">
      <div class="admin-card-title">✦ Compte admin connecté</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
        <div><span style="color:var(--text3);">Pseudo</span><br><span style="color:var(--text);font-weight:600;">${session?.username}</span></div>
        <div><span style="color:var(--text3);">Rôle</span><br><span class="tag tag-release">ADMIN</span></div>
        <div style="grid-column:span 2;"><span style="color:var(--text3);">UUID</span><br><span style="color:var(--green);font-family:var(--mono);font-size:10px;">${session?.uuid}</span></div>
      </div>
    </div>
    <div class="section-title">Publier un modpack</div>
    <div class="admin-card">
      <div class="admin-card-title">📦 Importer depuis vos fichiers</div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6;">
        Formats : <strong style="color:var(--text);">.zip</strong> (CurseForge) et <strong style="color:var(--text);">.mrpack</strong> (Modrinth). Mods, shaders et resource packs extraits automatiquement.
      </p>
      <div class="form-group">
        <label>Nom du modpack (optionnel)</label>
        <input class="form-input" id="admin-mp-name" placeholder="Laissez vide pour utiliser le nom du fichier"/>
      </div>
      <button class="btn-green" id="btn-import-modpack" style="width:100%;padding:12px;font-size:13px;">📂 Choisir un fichier modpack (.zip / .mrpack)</button>
      <div id="import-status" style="margin-top:10px;font-size:11px;font-family:var(--mono);min-height:16px;"></div>
    </div>
    <div class="section-title">Modpacks publiés (${published.length})</div>
    <div id="admin-list">
      ${published.length ? published.map(i => `
        <div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
          <span style="font-size:24px;">${i.icon||'📦'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);">${i.name}</div>
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${i.modLoader||'Vanilla'} ${i.version} · ${i.importedFrom}</div>
          </div>
          <button class="btn-outline btn-danger-outline btn-remove-mp" data-id="${i.id}" style="font-size:11px;flex-shrink:0;">Retirer</button>
        </div>
      `).join('') : '<div style="color:var(--text3);font-size:12px;font-family:var(--mono);">Aucun modpack publié.</div>'}
    </div>
    <div class="section-title" style="margin-top:20px;">Promouvoir un admin</div>
    <div class="admin-card">
      <div class="form-row">
        <div class="form-group" style="flex:2;">
          <label>UUID Minecraft du joueur</label>
          <input class="form-input" id="admin-uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/>
        </div>
        <div class="form-group" style="align-self:flex-end;">
          <button class="btn-green" id="btn-promote" style="width:100%;">Promouvoir</button>
        </div>
      </div>
    </div>
  `;
}

function bindAdminActions() {
  document.getElementById('btn-import-modpack')?.addEventListener('click', async () => {
    const name   = document.getElementById('admin-mp-name').value.trim();
    const status = document.getElementById('import-status');
    const btn    = document.getElementById('btn-import-modpack');
    btn.disabled = true; btn.textContent = '⏳ Sélection du fichier...';
    status.textContent = '';
    const res = await window.launcher.modpack.import(name || null);
    btn.disabled = false; btn.textContent = '📂 Choisir un fichier modpack (.zip / .mrpack)';
    if (res.success) {
      instances.push(res.instance);
      status.style.color = 'var(--green)';
      status.textContent = `✓ "${res.instance.name}" importé — ${res.instance.modLoader||'Vanilla'} ${res.instance.version}`;
      document.getElementById('admin-mp-name').value = '';
      showToast(`✓ "${res.instance.name}" publié pour tous`, 'green');
      navTo('admin');
    } else if (res.error && res.error !== 'Annulé') {
      status.style.color = 'var(--red)';
      status.textContent = '⚠ ' + res.error;
      showToast('Erreur : ' + res.error, 'red');
    }
  });
  document.getElementById('btn-promote')?.addEventListener('click', () => {
    const uuid = document.getElementById('admin-uuid').value.trim();
    if (!uuid) return showToast('Entrez un UUID', 'red');
    document.getElementById('admin-uuid').value = '';
    showToast('✓ Admin ajouté : ' + uuid.slice(0,8) + '...', 'green');
  });
  // Boutons retirer
  document.querySelectorAll('.btn-remove-mp').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await window.launcher.instances.delete(id);
      instances = instances.filter(i => i.id !== id);
      if (selectedId === id) { selectedId = instances[0]?.id || null; updateLaunchBar(); }
      navTo('admin');
      showToast('Modpack retiré');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════════════════
function buildProfilePage() {
  const isAdmin = session?.isAdmin || ADMIN_UUIDS.includes(session?.uuid);
  return `
    <div class="profile-header">
      ${session?.uuid ? `<img class="profile-skin" src="https://crafatar.com/renders/body/${session.uuid}?size=80&overlay" alt="skin" style="image-rendering:pixelated;"/>` : '<div style="width:80px;height:80px;background:var(--bg3);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;font-size:32px;">?</div>'}
      <div>
        <div class="profile-name">${session?.username||'—'}</div>
        <div class="profile-uuid">${session?.uuid||'—'}</div>
        <div style="margin-top:8px;">${isAdmin ? '<span class="tag tag-release">ADMIN</span>' : '<span class="tag tag-snapshot">Joueur</span>'}</div>
      </div>
    </div>
    <div class="section-title">Paramètres</div>
    <div class="card" style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div><div style="font-size:13px;font-weight:500;color:var(--text);">RAM par défaut</div><div style="font-size:11px;color:var(--text3);font-family:var(--mono);">Pour les nouvelles instances</div></div>
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="range" min="1" max="32" value="4" id="default-ram" style="width:120px;accent-color:var(--green);" oninput="document.getElementById('ram-val').textContent=this.value+'Go'"/>
          <span id="ram-val" style="font-size:12px;color:var(--green);font-family:var(--mono);min-width:36px;">4Go</span>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-size:13px;font-weight:500;color:var(--text);">Masquer le launcher au lancement</div><div style="font-size:11px;color:var(--text3);font-family:var(--mono);">Réduit quand MC démarre</div></div>
        <div class="toggle on" onclick="this.classList.toggle('on')"></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn-outline" id="btn-change-account-profile">Changer de compte</button>
      <button class="btn-outline btn-danger-outline" id="btn-logout-profile">Se déconnecter</button>
    </div>
  `;
}
function bindProfileActions() {
  document.getElementById('btn-change-account-profile')?.addEventListener('click', doLogout);
  document.getElementById('btn-logout-profile')?.addEventListener('click', doLogout);
}

// ══════════════════════════════════════════════════════════════════════════
// INSTANCES CRUD
// ══════════════════════════════════════════════════════════════════════════
function buildVersionOptions() {
  return Object.entries(MC_VERSIONS).map(([group, versions]) =>
    `<optgroup label="${group}">${versions.map(v => `<option value="${v}">${v}</option>`).join('')}</optgroup>`
  ).join('');
}

function bindModals() {
  document.querySelectorAll('.icon-opt').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      selectedIcon = el.dataset.icon;
    });
  });
  const verSelect = document.getElementById('ni-version');
  if (verSelect) verSelect.innerHTML = buildVersionOptions();

  document.getElementById('btn-create-instance')?.addEventListener('click', createInstance);
  document.getElementById('btn-save-instance')?.addEventListener('click', saveInstance);
  document.getElementById('btn-delete-instance')?.addEventListener('click', () => {
    if (editingId) deleteInstanceWithConfirm(editingId, instances.find(i=>i.id===editingId)?.name||'');
  });
}

async function createInstance() {
  const name    = document.getElementById('ni-name').value.trim() || 'Nouvelle instance';
  const version = document.getElementById('ni-version').value;
  const loader  = document.getElementById('ni-loader').value;
  const ram     = parseInt(document.getElementById('ni-ram').value) || 4;
  const jvm     = document.getElementById('ni-jvm').value;
  const inst = await window.launcher.instances.create({
    name, version,
    modLoader:     loader === 'vanilla' ? null : loader,
    releaseType:   'release',
    ram:           ram + 'G',
    icon:          selectedIcon,
    customJVMArgs: jvm,
  });
  instances.push(inst);
  setSelectedInstance(inst.id);
  closeModal('modal-new-instance');
  document.getElementById('ni-name').value = '';
  navTo('instances');
  showToast('✓ Instance "' + name + '" créée', 'green');
}

function openEditInstance(id) {
  const inst = instances.find(i => i.id === id);
  if (!inst) return;
  editingId = id;
  document.getElementById('edit-name').value   = inst.name;
  document.getElementById('edit-ram').value    = parseInt(inst.ram) || 4;
  document.getElementById('edit-jvm').value    = inst.customJVMArgs || '';
  document.getElementById('edit-width').value  = inst.windowWidth  || 1280;
  document.getElementById('edit-height').value = inst.windowHeight || 720;
  openModal('modal-edit-instance');
}

async function saveInstance() {
  if (!editingId) return;
  const current = instances.find(i => i.id === editingId);
  if (!current) return;

  const data = {
    name:          document.getElementById('edit-name').value.trim() || current.name,
    ram:           (parseInt(document.getElementById('edit-ram').value, 10) || parseInt(current.ram, 10) || 4) + 'G',
    customJVMArgs: document.getElementById('edit-jvm').value,
    windowWidth:   parseInt(document.getElementById('edit-width').value, 10) || current.windowWidth || 1280,
    windowHeight:  parseInt(document.getElementById('edit-height').value, 10) || current.windowHeight || 720,
  };

  try {
    const updated = await window.launcher.instances.update(editingId, data);
    if (!updated) throw new Error('Instance introuvable');

    instances = instances.map(i => i.id === editingId ? updated : i);
    if (selectedId === editingId) setSelectedInstance(editingId);

    closeModal('modal-edit-instance');
    navTo('instances');
    showToast('Instance mise a jour', 'green');
    editingId = null;
  } catch (err) {
    showToast('Erreur edition : ' + err.message, 'red');
  }
}

async function deleteInstanceWithConfirm(id, name) {
  const confirmed = confirm(`Supprimer "${name}" ?

Tous les fichiers (mods, saves, configs) seront supprimes definitivement.`);
  if (!confirmed) return;

  try {
    const deleted = await window.launcher.instances.delete(id);
    if (!deleted) throw new Error('suppression impossible');

    instances = instances.filter(i => i.id !== id);
    if (selectedId === id) { selectedId = instances[0]?.id || null; updateLaunchBar(); }
    if (editingId === id) { editingId = null; closeModal('modal-edit-instance'); }
    navTo('instances');
    showToast('"' + name + '" supprimee', 'green');
  } catch (err) {
    showToast('Erreur suppression : ' + err.message, 'red');
  }
}

async function importModpackTopBar() {
  const res = await window.launcher.modpack.import(null);
  if (res.success) {
    instances.push(res.instance);
    setSelectedInstance(res.instance.id);
    navTo('instances');
    showToast(`✓ "${res.instance.name}" importé`, 'green');
  } else if (res.error && res.error !== 'Annulé') {
    showToast('Erreur : ' + res.error, 'red');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LANCEMENT
// ══════════════════════════════════════════════════════════════════════════
function bindLaunch() {
  document.getElementById('btn-launch').addEventListener('click', () => {
    if (selectedId) launchInstance(selectedId);
    else showToast("Sélectionnez une instance d'abord");
  });
}

function setSelectedInstance(id) {
  selectedId = id;
  updateLaunchBar();
}

function updateLaunchBar() {
  const inst = instances.find(i => i.id === selectedId);
  const btn  = document.getElementById('btn-launch');
  if (inst) {
    document.getElementById('launch-name').textContent = (inst.icon||'🌿') + ' ' + inst.name;
    document.getElementById('launch-meta').textContent = (inst.modLoader && inst.modLoader !== 'vanilla' ? inst.modLoader+' ' : 'Vanilla ') + inst.version + ' · ' + (inst.ram||'4G') + ' RAM';
    btn.disabled = false;
  } else {
    document.getElementById('launch-name').textContent = 'Aucune instance sélectionnée';
    document.getElementById('launch-meta').textContent = '—';
    btn.disabled = true;
  }
}

async function launchInstance(id) {
  setSelectedInstance(id);
  const btn      = document.getElementById('btn-launch');
  const progress = document.getElementById('launch-progress');
  btn.classList.add('launching');
  btn.innerHTML = '⏳ Lancement...';
  btn.disabled  = true;
  progress.classList.remove('hidden');
  const res = await window.launcher.mc.launch(id);
  if (!res.success) { resetLaunchBtn(); showToast('Erreur : ' + res.error, 'red'); }
}

function onMcProgress(data) {
  document.getElementById('progress-fill').style.width  = data.percent + '%';
  document.getElementById('progress-label').textContent = data.type + '... ' + data.percent + '%';
}
function onMcLog(data) { if (data.type === 'error') console.error('[MC]', data.msg); }
function onMcClose(code) {
  resetLaunchBtn();
  showToast(code === 0 ? '✓ Minecraft fermé normalement' : `Minecraft fermé (code ${code})`);
}
function resetLaunchBtn() {
  const btn = document.getElementById('btn-launch');
  btn.classList.remove('launching');
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 2l10 6-10 6V2z" fill="currentColor"/></svg>Lancer Minecraft';
  btn.disabled  = false;
  document.getElementById('launch-progress').classList.add('hidden');
  document.getElementById('progress-fill').style.width = '0%';
}

// ══════════════════════════════════════════════════════════════════════════
// ACCOUNT MENU
// ══════════════════════════════════════════════════════════════════════════
function bindAccountMenu() {
  document.getElementById('account-widget').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('account-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', hideAccountMenu);
  document.getElementById('btn-change-account').addEventListener('click', doLogout);
  document.getElementById('btn-profile').addEventListener('click', () => { navTo('profile'); hideAccountMenu(); });
  document.getElementById('btn-logout').addEventListener('click', doLogout);
}
function hideAccountMenu() { document.getElementById('account-dropdown')?.classList.add('hidden'); }

// ══════════════════════════════════════════════════════════════════════════
// AUTO-UPDATE
// ══════════════════════════════════════════════════════════════════════════
function bindUpdateEvents() {
  window.launcher.update?.onAvailable(data => {
    const el = document.getElementById('update-version');
    if (el) el.textContent = 'v' + data.version;
    document.getElementById('update-banner')?.classList.remove('hidden');
  });
  window.launcher.update?.onDownloaded(() => {
    const btn = document.getElementById('btn-install-update');
    if (btn) btn.textContent = '✓ Prêt — Installer maintenant';
  });
  document.getElementById('btn-install-update')?.addEventListener('click', () => window.launcher.update.install());
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
function openModal(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type === 'green' ? ' toast-green' : type === 'red' ? ' toast-red' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 3200);
}

// Runtime overrides for dynamic versions and content installation
let dynamicMinecraftVersions = {
  releaseGroups: [
    { label: '1.21.x', versions: ['1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21'] },
    { label: '1.20.x', versions: ['1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1'] },
  ],
  snapshots: [],
};
window.__sharedPublishedInstances = window.__sharedPublishedInstances || [];
window.__sharedConfigured = window.__sharedConfigured || false;

function getPublishedInstances() {
  const local = instances.filter(inst => inst.publishedByAdmin);
  const remote = (window.__sharedPublishedInstances || []).filter(remoteItem => !local.some(localItem => localItem.id === remoteItem.id));
  return [...local, ...remote];
}

function typeLabel(type) {
  if (type === 'mod') return 'Mods';
  if (type === 'shader') return 'Shaders';
  return 'Resource packs';
}

async function loadMinecraftVersions() {
  try {
    const res = await window.launcher.mc.versions();
    if (res.success && res.data) {
      dynamicMinecraftVersions = res.data;
      const selector = document.getElementById('ni-version');
      if (selector) selector.innerHTML = buildVersionOptions();
    }
  } catch {}
}

const originalBindModals = bindModals;
bindModals = function bindModalsOverride() {
  originalBindModals();
  loadMinecraftVersions();
};

buildVersionOptions = function buildVersionOptionsOverride() {
  const releases = (dynamicMinecraftVersions.releaseGroups || []).map(group => {
    const options = group.versions.map(version => `<option value="${version}">${version}</option>`).join('');
    return `<optgroup label="${group.label}">${options}</optgroup>`;
  }).join('');

  const snapshots = (dynamicMinecraftVersions.snapshots || []).length
    ? `<optgroup label="Snapshots">${dynamicMinecraftVersions.snapshots.map(version => `<option value="${version}">${version}</option>`).join('')}</optgroup>`
    : '';

  return releases + snapshots;
};

renderInstancesPage = function renderInstancesPageOverride(container) {
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = `${instances.length} instance${instances.length !== 1 ? 's' : ''}`;
  container.appendChild(title);

  const gridDiv = document.createElement('div');
  gridDiv.className = 'instances-grid';

  instances.forEach(inst => {
    const card = document.createElement('div');
    const loaderTag = !inst.modLoader || inst.modLoader === 'vanilla' ? 'tag-release'
      : inst.modLoader === 'forge' || inst.modLoader === 'neoforge' ? 'tag-modded' : 'tag-fabric';
    const loaderLabel = inst.modLoader && inst.modLoader !== 'vanilla' ? inst.modLoader + ' ' : '';

    card.className = 'instance-card' + (inst.id === selectedId ? ' selected' : '');
    card.innerHTML = `
      ${inst.id === selectedId ? '<div class="inst-active-dot"></div>' : ''}
      <div class="inst-icon">${inst.icon || '🌿'}</div>
      <div class="tag ${loaderTag}" style="margin-bottom:8px;">${loaderLabel}${inst.version}</div>
      <div class="inst-name">${inst.name}</div>
      <div class="inst-meta">${inst.ram || '4G'} RAM${inst.importedFrom ? ' · importe' : ''}</div>
      <div class="inst-actions">
        <button type="button" class="btn-green btn-launch-inst" style="font-size:11px;padding:5px 10px;">Lancer</button>
        <button type="button" class="btn-outline btn-edit-inst" style="font-size:11px;padding:5px 10px;">Editer</button>
        <button type="button" class="btn-outline btn-danger-outline btn-delete-inst" aria-label="Supprimer ${inst.name}" title="Supprimer ${inst.name}" style="font-size:11px;padding:5px 8px;">Suppr.</button>
      </div>
    `;

    card.addEventListener('click', () => {
      setSelectedInstance(inst.id);
      navTo('instances');
    });

    card.querySelector('.btn-launch-inst').addEventListener('click', event => {
      event.stopPropagation();
      launchInstance(inst.id);
    });

    card.querySelector('.btn-edit-inst').addEventListener('click', event => {
      event.stopPropagation();
      openEditInstance(inst.id);
    });

    card.querySelector('.btn-delete-inst').addEventListener('click', event => {
      event.stopPropagation();
      deleteInstanceWithConfirm(inst.id, inst.name);
    });

    gridDiv.appendChild(card);
  });

  const addCard = document.createElement('div');
  addCard.className = 'add-instance-card';
  addCard.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Nouvelle instance';
  addCard.addEventListener('click', () => openModal('modal-new-instance'));
  gridDiv.appendChild(addCard);
  container.appendChild(gridDiv);

  const active = instances.find(i => i.id === selectedId) || instances[0];
  if (!active) return;

  const contentCard = document.createElement('div');
  contentCard.className = 'card';
  contentCard.style.marginTop = '18px';
  contentCard.innerHTML = `
    <div class="section-title" style="margin-bottom:10px;">Contenu de l instance selectionnee</div>
    <div style="font-size:13px;color:var(--text);margin-bottom:12px;">${active.icon || '🌿'} ${active.name} · ${active.modLoader || 'vanilla'} ${active.version}</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
      <button type="button" class="btn-outline content-import-btn" data-type="mod">Importer des mods</button>
      <button type="button" class="btn-outline content-import-btn" data-type="shader">Importer des shaders</button>
      <button type="button" class="btn-outline content-import-btn" data-type="resourcepack">Importer des resource packs</button>
    </div>
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:10px;">Les fichiers seront copies directement dans cette instance.</div>
  `;
  container.appendChild(contentCard);

  contentCard.querySelectorAll('.content-import-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const type = button.dataset.type;
      const baseLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Import...';
      const res = await window.launcher.content.importLocal(active.id, type);
      button.disabled = false;
      button.textContent = baseLabel;

      if (res.success) {
        showToast(`${typeLabel(type)} importes : ${res.copied.join(', ')}`, 'green');
      } else if (res.error && res.error !== 'Annule') {
        showToast('Erreur import : ' + res.error, 'red');
      }
    });
  });
};

function buildCatalogCard(item) {
  const version = item.version || 'Latest';
  const tagClass = version.includes('Forge') ? 'tag-modded'
    : version.includes('Fabric') ? 'tag-fabric'
    : item.type === 'shader' ? 'tag-snapshot' : 'tag-release';

  return `
    <div class="modpack-card" data-name="${item.name}" data-version="${version}" data-type="${item.type}" data-project-id="${item.projectId || ''}">
      <div class="modpack-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;">${item.icon || '📦'}</div>
      <div class="modpack-info">
        <div class="modpack-name">${item.name}</div>
        <div class="modpack-desc">${item.description || ''}</div>
        <div class="modpack-meta">
          <span class="modpack-downloads">⬇ ${item.downloads || '-'}</span>
          <span class="tag ${tagClass}">${version}</span>
        </div>
      </div>
    </div>
  `;
}

buildModpacksPage = function buildModpacksPageOverride() {
  const published = getPublishedInstances();
  const active = instances.find(i => i.id === selectedId) || null;
  return `
    <div class="card" style="margin-bottom:14px;">
      <div style="font-size:13px;color:var(--text);margin-bottom:6px;">Instance cible : <strong>${active ? active.name : 'aucune instance selectionnee'}</strong></div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">Selectionne une instance avant d installer des mods, shaders ou resource packs depuis Modrinth.</div>
      <div style="font-size:11px;color:${window.__sharedConfigured ? 'var(--green)' : 'var(--amber)'};font-family:var(--mono);margin-top:8px;">Sync multi-PC : ${window.__sharedConfigured ? 'activee via Supabase' : 'non configuree, affichage local uniquement'}</div>
    </div>
    <div class="modpack-search">
      <input class="search-input" id="modpack-search-input" placeholder="Rechercher sur Modrinth..."/>
      <select class="search-source" id="modpack-type" style="min-width:150px;">
        <option value="modpack">Modpacks</option>
        <option value="mod">Mods</option>
        <option value="shader">Shaders</option>
        <option value="resourcepack">Resource Packs</option>
      </select>
      <button class="btn-green" id="btn-search-modrinth">Rechercher</button>
    </div>
    ${published.length ? `
      <div class="section-title">Modpacks publies par l admin</div>
      <div class="modpacks-grid" style="margin-bottom:20px;" id="admin-modpacks-grid"></div>
      <div class="section-title">Decouvrir sur Modrinth</div>
    ` : '<div class="section-title">Decouvrir sur Modrinth</div>'}
    <div class="modpacks-grid" id="modpacks-grid">
      ${buildCatalogCard({ name: 'All the Mods 9', version: 'Forge 1.20.1', description: 'Un modpack complet avec plus de 300 mods.', icon: '📦', downloads: '12.4M', type: 'modpack' })}
      ${buildCatalogCard({ name: 'Create', version: 'Forge 1.20.1', description: 'Automatisation mecanique avancee.', icon: '⚙️', downloads: '45.2M', type: 'mod' })}
      ${buildCatalogCard({ name: 'Complementary Shaders', version: 'Shader', description: 'Shaders magnifiques pour toutes les configs.', icon: '✨', downloads: '8.2M', type: 'shader' })}
      ${buildCatalogCard({ name: 'Faithful 32x', version: 'Resource Pack', description: 'Vanilla en resolution 32x.', icon: '🎨', downloads: '15.3M', type: 'resourcepack' })}
    </div>
  `;
};

bindModpackActions = function bindModpackActionsOverride() {
  document.querySelectorAll('.modpack-card[data-name]').forEach(card => {
    card.addEventListener('click', () => installModpack(card.dataset));
  });

  const adminGrid = document.getElementById('admin-modpacks-grid');
  if (adminGrid) {
    getPublishedInstances().forEach(inst => {
      const card = document.createElement('div');
      card.className = 'modpack-card';
      card.innerHTML = `
        <div class="modpack-thumb" style="display:flex;align-items:center;justify-content:center;font-size:28px;">${inst.icon || '📦'}</div>
        <div class="modpack-info">
          <div class="modpack-name">${inst.name}</div>
          <div class="modpack-desc">Publie par l admin · ${inst.modLoader || 'Vanilla'} ${inst.version}</div>
          <div class="modpack-meta"><span class="tag tag-modded">admin</span></div>
        </div>
      `;
      card.addEventListener('click', () => {
        setSelectedInstance(inst.id);
        navTo('instances');
      });
      adminGrid.appendChild(card);
    });
  }

  document.getElementById('btn-search-modrinth')?.addEventListener('click', () => {
    searchModrinth(document.getElementById('modpack-search-input').value, document.getElementById('modpack-type').value);
  });

  document.getElementById('modpack-search-input')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      searchModrinth(event.target.value, document.getElementById('modpack-type').value);
    }
  });
};

searchModrinth = async function searchModrinthOverride(query, type = 'modpack') {
  const grid = document.getElementById('modpacks-grid');
  if (!grid || !query?.trim()) return;

  grid.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Recherche en cours...</div>';
  try {
    const facets = JSON.stringify([[`project_type:${type}`]]);
    const res = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&limit=8`);
    const data = await res.json();
    if (!data.hits?.length) {
      grid.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Aucun resultat.</div>';
      return;
    }

    const icon = type === 'shader' ? '✨' : type === 'resourcepack' ? '🎨' : type === 'mod' ? '⚙️' : '📦';
    grid.innerHTML = data.hits.map(hit => buildCatalogCard({
      name: hit.title,
      version: hit.latest_version || 'Latest',
      description: hit.description || '',
      icon,
      downloads: formatDownloads(hit.downloads),
      type,
      projectId: hit.project_id,
    })).join('');

    grid.querySelectorAll('.modpack-card[data-name]').forEach(card => {
      card.addEventListener('click', () => installModpack(card.dataset));
    });
  } catch (error) {
    grid.innerHTML = `<div style="color:var(--red);font-family:var(--mono);font-size:12px;padding:20px;grid-column:span 2;">Erreur : ${error.message}</div>`;
  }
};

installModpack = async function installModpackOverride(dataset) {
  const { name, version, type, projectId } = dataset;

  if (type === 'modpack') {
    openModal('modal-new-instance');
    setTimeout(() => {
      document.getElementById('ni-name').value = name;
      const mcVer = version.replace(/^(Forge|Fabric|NeoForge|Quilt)\s/i, '');
      const selector = document.getElementById('ni-version');
      for (const option of selector.options) {
        if (option.value === mcVer) {
          option.selected = true;
          break;
        }
      }

      const lower = version.toLowerCase();
      if (lower.includes('neoforge')) document.getElementById('ni-loader').value = 'neoforge';
      else if (lower.includes('forge')) document.getElementById('ni-loader').value = 'forge';
      else if (lower.includes('fabric')) document.getElementById('ni-loader').value = 'fabric';
      else if (lower.includes('quilt')) document.getElementById('ni-loader').value = 'quilt';
      showToast(`"${name}" pret a configurer`, 'green');
    }, 100);
    return;
  }

  if (!selectedId) {
    showToast('Selectionne d abord une instance', 'red');
    return;
  }

  if (!projectId) {
    showToast('Ce projet de demonstration n a pas d identifiant Modrinth', 'red');
    return;
  }

  showToast('Installation de ' + name + '...', 'green');
  const res = await window.launcher.content.installModrinth(selectedId, projectId, type);
  if (res.success) {
    showToast(`${typeLabel(type)} installe : ${res.fileName}`, 'green');
  } else {
    showToast('Erreur installation : ' + res.error, 'red');
  }
};

buildAdminPage = function buildAdminPageOverride() {
  const published = getPublishedInstances();
  return `
    <div class="admin-card">
      <div class="admin-card-title">Compte admin connecte</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
        <div><span style="color:var(--text3);">Pseudo</span><br><span style="color:var(--text);font-weight:600;">${session?.username}</span></div>
        <div><span style="color:var(--text3);">Role</span><br><span class="tag tag-release">ADMIN</span></div>
        <div style="grid-column:span 2;"><span style="color:var(--text3);">UUID</span><br><span style="color:var(--green);font-family:var(--mono);font-size:10px;">${session?.uuid}</span></div>
      </div>
    </div>
    <div class="section-title">Publier un modpack pour tout le monde</div>
    <div class="admin-card">
      <div class="admin-card-title">Importer depuis vos fichiers</div>
      <p style="font-size:12px;color:var(--text2);margin-bottom:14px;line-height:1.6;">${window.__sharedConfigured ? 'Les modpacks importes ici sont publies pour tous les autres PC relies a ton Supabase.' : 'La synchro distante n est pas configuree : la publication restera locale tant que Supabase n est pas renseigne.'}</p>
      <div class="form-group">
        <label>Nom du modpack (optionnel)</label>
        <input class="form-input" id="admin-mp-name" placeholder="Laissez vide pour utiliser le nom du fichier"/>
      </div>
      <button class="btn-green" id="btn-import-modpack" style="width:100%;padding:12px;font-size:13px;">Choisir un fichier modpack (.zip / .mrpack)</button>
      <div id="import-status" style="margin-top:10px;font-size:11px;font-family:var(--mono);min-height:16px;"></div>
    </div>
    <div class="section-title">Modpacks publies (${published.length})</div>
    <div id="admin-list">
      ${published.length ? published.map(item => `
        <div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:8px;">
          <span style="font-size:24px;">${item.icon || '📦'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);">${item.name}</div>
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono);">${item.modLoader || 'Vanilla'} ${item.version} · ${item.importedFrom || 'import local'}</div>
          </div>
          <button class="btn-outline btn-danger-outline btn-remove-mp" data-id="${item.id}" style="font-size:11px;flex-shrink:0;">Retirer</button>
        </div>
      `).join('') : '<div style="color:var(--text3);font-size:12px;font-family:var(--mono);">Aucun modpack publie.</div>'}
    </div>
  `;
};

bindAdminActions = function bindAdminActionsOverride() {
  document.getElementById('btn-import-modpack')?.addEventListener('click', async () => {
    const name = document.getElementById('admin-mp-name').value.trim();
    const status = document.getElementById('import-status');
    const button = document.getElementById('btn-import-modpack');

    button.disabled = true;
    button.textContent = 'Selection du fichier...';
    status.textContent = '';

    const res = await window.launcher.modpack.import({ name: name || null, publish: true });

    button.disabled = false;
    button.textContent = 'Choisir un fichier modpack (.zip / .mrpack)';

    if (res.success) {
      instances.push(res.instance);
      try {
        const remote = await window.launcher.shared.listPublished();
        window.__sharedPublishedInstances = remote.success ? (remote.items || []) : window.__sharedPublishedInstances;
      } catch {}
      status.style.color = 'var(--green)';
      status.textContent = `"${res.instance.name}" publie pour tous`;
      document.getElementById('admin-mp-name').value = '';
      showToast(`"${res.instance.name}" publie pour tous`, 'green');
      navTo('admin');
    } else if (res.error && res.error !== 'Annule') {
      status.style.color = 'var(--red)';
      status.textContent = res.error;
      showToast('Erreur : ' + res.error, 'red');
    }
  });

  document.querySelectorAll('.btn-remove-mp').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.id;
      await window.launcher.instances.delete(id);
      await window.launcher.shared.removePublished(id);
      instances = instances.filter(item => item.id !== id);
      window.__sharedPublishedInstances = (window.__sharedPublishedInstances || []).filter(item => item.id !== id);
      if (selectedId === id) {
        selectedId = instances[0]?.id || null;
        updateLaunchBar();
      }
      navTo('admin');
      showToast('Modpack retire');
    });
  });
};
