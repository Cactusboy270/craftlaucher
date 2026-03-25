const { BrowserWindow, shell } = require('electron');
const { Auth } = require('msmc');

const ADMIN_UUIDS = ['8a501859-8fb7-443f-ab18-0909b41b3275'];
const authManager = new Auth('select_account');

async function login(mainWindow, store) {
  const xboxManager = await authManager.launch('electron', {
    parent: mainWindow,
    modal:  true,
  });
  const token   = await xboxManager.getMinecraft();
  const session = buildSession(token);
  store.set('auth.msmc',    xboxManager.save());
  store.set('auth.session', session);
  return session;
}

async function refreshSession(store) {
  const saved = store.get('auth.msmc');
  if (!saved) return null;
  try {
    // ← authManager.restore() et non Auth.restore()
    const xboxManager = await authManager.restore(saved);
    await xboxManager.refresh();
    const token   = await xboxManager.getMinecraft();
    const session = buildSession(token);
    store.set('auth.msmc',    xboxManager.save());
    store.set('auth.session', session);
    return session;
  } catch (err) {
    console.error('Refresh failed:', err.message);
    store.delete('auth.msmc');
    store.delete('auth.session');
    return null;
  }
}

async function logout(store) {
  store.delete('auth.msmc');
  store.delete('auth.session');
}

function buildSession(token) {
  const profile = token.profile;
  const raw     = profile.id || '';
  const uuid    = raw.length === 32
    ? `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`
    : raw;

  const activeSkin = profile.skins?.find(s => s.state === 'ACTIVE');
  const activeCape = profile.capes?.find(c => c.state === 'ACTIVE');
  const mclc       = token.mclc();

  return {
    username:  profile.name,
    uuid,
    mcToken:   mclc.access_token,
    mclc,
    skinUrl:   activeSkin?.url     || null,
    skinType:  activeSkin?.variant || 'CLASSIC',
    capeUrl:   activeCape?.url     || null,
    isAdmin:   ADMIN_UUIDS.includes(uuid),
    savedAt:   Date.now(),
  };
}

module.exports = { login, logout, refreshSession };
