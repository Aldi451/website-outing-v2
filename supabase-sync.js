/* Optional Supabase synchronization layer for the static app. */
(() => {
  const config = window.OUTING_CONFIG || {};
  if (!window.supabase || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return;

  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const key = 'outing-hub-v1';
  let syncing = false;
  let timer;

  const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const makeId = (value) => {
    if (isUuid(value)) return value;
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.random() * 16 | 0;
      const value = character === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  };

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  };

  const toRemote = (data) => {
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

    return {
      local: {
        ...data,
        participants: participants.map(({ id, name, phone, status, payment }) => ({ id, name, phone, status, payment })),
        rundown: rundown.map(({ id, schedule_time, activity, location, pic, notes }) => ({ id, time: schedule_time, activity, location, pic, notes })),
        expenses: expenses.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' })),
        consumption: consumption.map(({ photo_url, ...item }) => ({ ...item, photo: photo_url || '' }))
      },
      participants,
      rundown,
      expenses,
      consumption
    };
  };

  async function saveRemote() {
    if (syncing) return;
    const data = toRemote(readLocal());
    syncing = true;
    try {
      const jobs = [
        client.from('participants').upsert(data.participants),
        client.from('rundown').upsert(data.rundown),
        client.from('expenses').upsert(data.expenses),
        client.from('consumption').upsert(data.consumption)
      ];
      const outing = readLocal().outing || {};
      if (outing.destination || outing.date || outing.description) {
        jobs.push(client.from('outing').upsert({
          id: isUuid(outing.id) ? outing.id : undefined,
          destination: outing.destination || '',
          outing_date: outing.date || null,
          description: outing.description || ''
        }));
      }
      const results = await Promise.all(jobs);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;

      // Keep generated UUIDs locally so later edits update instead of duplicating rows.
      localStorage.setItem(key, JSON.stringify(data.local));
    } catch (error) {
      console.error('Supabase save failed:', error);
      if (typeof showToast === 'function') showToast('Gagal menyimpan ke Supabase. Cek RLS/policy.');
    } finally {
      syncing = false;
    }
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
    try {
      const [participants, outing, rundown, expenses, consumption] = await Promise.all([
        client.from('participants').select('*').order('created_at'),
        client.from('outing').select('*').order('created_at').limit(1),
        client.from('rundown').select('*').order('schedule_time'),
        client.from('expenses').select('*').order('date'),
        client.from('consumption').select('*').order('date')
      ]);
      const failed = [participants, outing, rundown, expenses, consumption].find((result) => result.error);
      if (failed) throw failed.error;

      const hasRemote = participants.data?.length || outing.data?.length || rundown.data?.length || expenses.data?.length || consumption.data?.length;
      if (!hasRemote) {
        await saveRemote();
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
