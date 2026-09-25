/* Supabase synchronization layer for the static app. */
(() => {
  const config = window.OUTING_CONFIG || {};
  if (!window.supabase || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return;

  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const key = 'outing-hub-v1';
  let syncing = false;
  let timer;

  const makeId = (value) => {
    if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
    return crypto.randomUUID();
  };

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  };

  const toRemote = (data) => ({
    participants: (data.participants || []).map((p) => ({ ...p, id: makeId(p.id) })),
    outing: data.outing || {},
    expenses: (data.expenses || []).map((x) => ({ ...x, id: makeId(x.id), photo_url: x.photo || null })),
    consumption: (data.consumption || []).map((x) => ({ ...x, id: makeId(x.id), photo_url: x.photo || null }))
  });

  async function saveRemote() {
    if (syncing) return;
    const data = toRemote(readLocal());
    syncing = true;
    try {
      const jobs = [
        client.from('participants').upsert(data.participants),
        client.from('expenses').upsert(data.expenses),
        client.from('consumption').upsert(data.consumption)
      ];
      if (data.outing.destination || data.outing.date || data.outing.description) {
        jobs.push(client.from('outing').upsert({
          id: data.outing.id || undefined,
          destination: data.outing.destination || '',
          outing_date: data.outing.date || null,
          description: data.outing.description || ''
        }));
      }
      const results = await Promise.all(jobs);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
      // Keep generated UUIDs locally so subsequent edits update, rather than duplicate, rows.
      localStorage.setItem(key, JSON.stringify({ ...readLocal(), ...data,
        expenses: data.expenses.map(({ photo_url, ...x }) => ({ ...x, photo: photo_url || '' })),
        consumption: data.consumption.map(({ photo_url, ...x }) => ({ ...x, photo: photo_url || '' }))
      }));
    } catch (error) {
      console.error('Supabase save failed:', error);
      if (typeof showToast === 'function') showToast('Gagal menyimpan ke Supabase. Cek RLS/policy.');
    } finally { syncing = false; }
  }

  async function loadRemote() {
    try {
      const [participants, outing, expenses, consumption] = await Promise.all([
        client.from('participants').select('*').order('created_at'),
        client.from('outing').select('*').order('created_at').limit(1),
        client.from('expenses').select('*').order('date'),
        client.from('consumption').select('*').order('date')
      ]);
      const failed = [participants, outing, expenses, consumption].find((r) => r.error);
      if (failed) throw failed.error;
      const hasRemote = participants.data?.length || outing.data?.length || expenses.data?.length || consumption.data?.length;
      if (!hasRemote) { await saveRemote(); return; }
      const current = readLocal();
      const remote = {
        participants: participants.data || [],
        outing: outing.data?.[0] ? { id: outing.data[0].id, destination: outing.data[0].destination || '', date: outing.data[0].outing_date || '', description: outing.data[0].description || '' } : current.outing,
        expenses: (expenses.data || []).map(({ photo_url, ...x }) => ({ ...x, photo: photo_url || '' })),
        consumption: (consumption.data || []).map(({ photo_url, ...x }) => ({ ...x, photo: photo_url || '' })),
        categories: current.categories
      };
      syncing = true;
      localStorage.setItem(key, JSON.stringify(remote));
      syncing = false;
      location.reload();
    } catch (error) {
      console.error('Supabase load failed:', error);
      const status = document.querySelector('#connection-status');
      if (status) status.textContent = '⚠ Supabase error';
    }
  }

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    originalSetItem.call(this, name, value);
    if (this === localStorage && name === key && !syncing) {
      clearTimeout(timer);
      timer = setTimeout(saveRemote, 250);
    }
  };

  const status = document.querySelector('#connection-status');
  if (status) status.textContent = '☁ Supabase';
  loadRemote();
})();
