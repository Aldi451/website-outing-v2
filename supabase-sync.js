/* Supabase synchronization layer for the static app. */
(() => {
  const config = window.OUTING_CONFIG || {};
  if (!window.supabase || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return;

  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const storageKey = 'outing-hub-v1';
  const categoriesTable = 'outing_categories';
  let activeSync = null;
  let pendingSnapshot = null;

  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const makeId = (value) => {
    if (isUuid(value)) return value;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      const result = character === 'x' ? random : (random & 0x3 | 0x8);
      return result.toString(16);
    });
  };

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  };

  const setStatus = (text, tone = '') => {
    const status = document.querySelector('#connection-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const notifyRemoteReady = () => {
    window.OUTING_REMOTE_READY = true;
    document.dispatchEvent(new CustomEvent('outing:remote-ready'));
  };

  function toRemote(data) {
    const participants = (data.participants || []).map((participant) => ({
      id: makeId(participant.id),
      name: participant.name || '',
      phone: participant.phone || participant.member_id || '',
      status: participant.status || 'Ikut',
      payment: participant.payment || 'Belum bayar'
    }));
    const rundown = (data.rundown || []).map((item) => ({
      id: makeId(item.id),
      schedule_time: item.time || '',
      activity: item.activity || '',
      location: item.location || '',
      pic: item.pic || '',
      notes: item.notes || ''
    }));
    const expenses = (data.expenses || []).map((item) => ({
      id: makeId(item.id),
      date: item.date || null,
      item: item.item || '',
      category: item.category || '',
      amount: Number(item.amount || 0),
      photo_url: item.photo || null
    }));
    const consumption = (data.consumption || []).map((item) => ({
      id: makeId(item.id),
      date: item.date || null,
      item: item.item || '',
      category: item.category || '',
      amount: Number(item.amount || 0),
      photo_url: item.photo || null
    }));
    const categories = [...new Set((data.categories || []).filter(Boolean).map((name) => String(name).trim()))]
      .map((name) => ({ name }));
    const outing = data.outing || {};
    const remoteOuting = {
      id: makeId(outing.id),
      destination: outing.destination || '',
      outing_date: outing.date || null,
      description: outing.description || ''
    };

    return {
      local: {
        ...data,
        outing: { ...outing, id: remoteOuting.id },
        participants: participants.map(({ id, name, phone, status, payment }) => ({ id, name, phone, status, payment })),
        rundown: rundown.map(({ id, schedule_time, activity, location, pic, notes }) => ({ id, time: schedule_time, activity, location, pic, notes })),
        expenses: expenses.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' })),
        consumption: consumption.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' })),
        categories: categories.map(({ name }) => name)
      },
      participants,
      rundown,
      expenses,
      consumption,
      categories,
      outing: remoteOuting
    };
  }

  async function syncTable(tableName, rows, conflictColumn = 'id') {
    if (rows.length) {
      const { error } = await client.from(tableName).upsert(rows, { onConflict: conflictColumn });
      if (error) throw new Error(`${tableName} upsert: ${error.message}`);
    }

    // Upsert alone cannot remove rows deleted in the app. Reconcile the table so
    // Supabase remains an exact copy of the browser data.
    const { data: existing, error: readError } = await client.from(tableName).select(conflictColumn);
    if (readError) throw new Error(`${tableName} read: ${readError.message}`);
    const keep = new Set(rows.map((row) => String(row[conflictColumn])));
    const stale = (existing || [])
      .map((row) => row[conflictColumn])
      .filter((value) => !keep.has(String(value)));
    if (stale.length) {
      const { error } = await client.from(tableName).delete().in(conflictColumn, stale);
      if (error) throw new Error(`${tableName} delete: ${error.message}`);
    }
  }

  async function syncSnapshot(snapshot) {
    const remote = toRemote(snapshot);
    setStatus('☁ Menyimpan...', 'syncing');

    try {
      await Promise.all([
        syncTable('participants', remote.participants),
        syncTable('rundown', remote.rundown),
        syncTable('expenses', remote.expenses),
        syncTable('consumption', remote.consumption),
        syncTable(categoriesTable, remote.categories, 'name'),
        syncTable('outing', [remote.outing])
      ]);

      // Keep generated UUIDs locally so later edits update the same remote rows.
      localStorage.setItem(storageKey, JSON.stringify(remote.local));
      setStatus('☁ Supabase', 'connected');
      return { ok: true };
    } catch (error) {
      console.error('Supabase sync failed:', error);
      setStatus('⚠ Gagal sinkronisasi', 'error');
      return { ok: false, error };
    }
  }

  async function flushQueue() {
    let result = { ok: true };
    while (pendingSnapshot) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      result = await syncSnapshot(snapshot);
    }
    return result;
  }

  function queueSync(snapshot) {
    pendingSnapshot = JSON.parse(JSON.stringify(snapshot));
    if (!activeSync) {
      activeSync = flushQueue().finally(() => {
        activeSync = null;
      });
    }
    return activeSync;
  }

  const mapParticipant = (participant) => ({
    id: participant.id,
    name: participant.name || '',
    phone: participant.phone || participant.member_id || '',
    status: participant.status || 'Ikut',
    payment: participant.payment || 'Belum bayar'
  });
  const mapRundown = (item) => ({
    id: item.id,
    time: item.schedule_time || item.time || '',
    activity: item.activity || '',
    location: item.location || '',
    pic: item.pic || '',
    notes: item.notes || ''
  });
  const mapLedger = (item) => ({
    id: item.id,
    date: item.date || '',
    item: item.item || '',
    category: item.category || '',
    amount: Number(item.amount || 0),
    photo: item.photo_url || ''
  });

  async function loadRemote() {
    setStatus('☁ Memuat...', 'syncing');
    try {
      const [participants, outing, rundown, expenses, consumption, categories] = await Promise.all([
        client.from('participants').select('*').order('created_at'),
        client.from('outing').select('*').order('created_at').limit(1),
        client.from('rundown').select('*').order('schedule_time'),
        client.from('expenses').select('*').order('date'),
        client.from('consumption').select('*').order('date'),
        client.from(categoriesTable).select('name').order('name')
      ]);
      const failed = [participants, outing, rundown, expenses, consumption, categories].find((result) => result.error);
      if (failed) throw new Error(failed.error.message);

      const hasRemote = participants.data?.length || outing.data?.length || rundown.data?.length || expenses.data?.length || consumption.data?.length || categories.data?.length;
      if (!hasRemote) {
        const result = await queueSync(readLocal());
        if (!result.ok) throw result.error;
        notifyRemoteReady();
        return;
      }

      const current = readLocal();
      const remote = {
        participants: (participants.data || []).map(mapParticipant),
        outing: outing.data?.[0]
          ? {
              id: outing.data[0].id,
              destination: outing.data[0].destination || '',
              date: outing.data[0].outing_date || '',
              description: outing.data[0].description || ''
            }
          : current.outing,
        rundown: (rundown.data || []).map(mapRundown),
        expenses: (expenses.data || []).map(mapLedger),
        consumption: (consumption.data || []).map(mapLedger),
        categories: categories.data?.length
          ? categories.data.map((item) => item.name).filter(Boolean)
          : (current.categories || [])
      };
      localStorage.setItem(storageKey, JSON.stringify(remote));
      setStatus('☁ Supabase', 'connected');
      notifyRemoteReady();
    } catch (error) {
      console.error('Supabase load failed:', error);
      setStatus('⚠ Gagal sinkronisasi', 'error');
      window.OUTING_SYNC_ERROR = error;
    }
  }

  // app.js calls this after every local create, edit, delete, and import.
  window.OUTING_SYNC = {
    client,
    queue: queueSync,
    load: loadRemote
  };
  window.OUTING_SYNC_READY = loadRemote();
})();
