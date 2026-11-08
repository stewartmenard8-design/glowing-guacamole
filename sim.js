// Mode simulation : même API que netlify/functions/api.js, données stockées dans localStorage du navigateur.
(function () {
  const K = 'wcm_sim_v1';
  const seed = () => ({
    user: { id: 100000001, first_name: 'Demo', username: 'demo' }, plan: 'premium', points: 120, tz: 'UTC',
    channels: { '-1001': { id: '-1001', name: 'Walker News', username: 'walker_news', type: 'Public', active: true }, '-1002': { id: '-1002', name: 'Community Hub', username: '', type: 'Group', active: true }, '-1003': { id: '-1003', name: 'Private VIP', username: '', type: 'Private', active: true } },
    folders: {}, settings: { notifications: true, protect_content: false, keep_messages: true, speed: 1 }, stats: { total_messages_processed: 42, total_sessions: 9 },
    scheduled: [{ id: 's1', name: 'Weekly digest', channel_name: 'Walker News', datetime: '2026-11-10 09:00', status: 'scheduled' }],
    recurring: [{ id: 'r1', name: 'Morning tip', channel_name: 'Community Hub', datetime: 'Every day 08:00', status: 'active' }], random: [], deletions: [],
    saved: [{ token: 'demo1', text: 'Welcome to Walker ContentMaster (sample saved message)', media_type: 'TEXT', created_at: '2026-11-01' }],
    users: [{ id: '100000001', name: 'Demo', plan: 'premium', channels: 3 }, { id: '100000002', name: 'Alex', plan: 'free', channels: 1 }, { id: '100000003', name: 'Sam', plan: 'emperor', channels: 12 }]
  });
  const live = () => !!window.WCM_LIVE, tgu = () => window.Telegram.WebApp.initDataUnsafe.user, key = () => live() ? 'wcm_live_' + tgu().id : K;
  const seedLive = () => ({ user: tgu(), plan: 'free', points: 0, tz: 'UTC', channels: {}, folders: {}, settings: { notifications: true, protect_content: false, keep_messages: true, speed: 1 }, stats: { total_messages_processed: 0, total_sessions: 1 }, scheduled: [], recurring: [], random: [], deletions: [], saved: [], users: [] });
  const fresh = () => live() ? seedLive() : seed();
  const load = () => { try { return JSON.parse(localStorage.getItem(key())) || fresh(); } catch { return fresh(); } };
  const save = d => { try { localStorage.setItem(key(), JSON.stringify(d)); } catch {} };
  const LIM = { free: [30, 3, 2], basic: [60, 10, 5], premium: [100, 20, 10], emperor: ['∞', '∞', '∞'] };
  const fail = (m, c = 400) => { const e = new Error(m); e.status = c; throw e; };
  const tgc = async (m, b) => { const r = await fetch('https://api.telegram.org/bot' + WCM_CFG.BOT_TOKEN + '/' + m, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (!j.ok) fail(j.description || 'Telegram error'); return j.result; };
  window.simApi = async function (path, opts = {}) {
    const d = load(), m = (opts.method || 'GET').toUpperCase(), b = opts.body ? JSON.parse(opts.body) : {}, [p, qs] = path.split('?'), q = new URLSearchParams(qs || '');
    const chans = () => Object.values(d.channels);
    if (live() && !window.WCM_BOT) { try { window.WCM_BOT = (await tgc('getMe')).username; } catch {} }
    let r;
    if (p === '/me') { const l = LIM[d.plan]; r = { user: d.user, bot_username: window.WCM_BOT || 'WalkerContentMasterBot', plan: d.plan, points: d.plan === 'emperor' ? '∞' : d.points, channels: chans().length, limits: { channels: l[0], saved: l[1], tasks: l[2] }, timezone: d.tz, is_staff: live() ? (WCM_CFG.STAFF_IDS || []).map(String).includes(String(d.user.id)) : true, sim: !live() }; }
    else if (p === '/dashboard') r = { channels: chans(), folders: Object.values(d.folders), scheduled: d.scheduled, stats: d.stats, settings: d.settings, plan: d.plan };
    else if (p === '/channels' && m === 'GET') r = { items: chans() };
    else if (p === '/channels' && m === 'POST' && live()) {
      const ident = String(b.identifier || '').trim().replace(/^https?:\/\/t\.me\//, '@');
      const chat = await tgc('getChat', { chat_id: /^-?\d+$/.test(ident) ? Number(ident) : ident }), me = await tgc('getMe'), mem = await tgc('getChatMember', { chat_id: chat.id, user_id: me.id });
      if (chat.type === 'channel' && !['administrator', 'creator'].includes(mem.status)) fail('The bot must be an administrator in this channel');
      const cid = String(chat.id);
      if (d.channels[cid]) r = { ok: true, already_exists: true };
      else { const l = LIM[d.plan][0]; if (l !== '∞' && chans().length >= l) fail('Your plan channel limit has been reached', 403); d.channels[cid] = { id: cid, name: chat.title || cid, username: chat.username || '', type: ['group', 'supergroup'].includes(chat.type) ? 'Group' : chat.username ? 'Public' : 'Private', active: true }; r = { ok: true, channel: d.channels[cid] }; }
    }
    else if (p === '/channels' && m === 'POST') {
      const id = String(b.identifier || '').trim(); if (id.length < 2) fail('Enter a valid @username, link or ID');
      const l = LIM[d.plan][0]; if (l !== '∞' && chans().length >= l) fail('Your plan channel limit has been reached', 403);
      const num = /^-?\d+$/.test(id), cid = num ? id : '-100' + Math.floor(Math.random() * 1e9), uname = id.replace(/^(https?:\/\/t\.me\/|@)/, '');
      if (d.channels[cid]) r = { ok: true, already_exists: true }; else { d.channels[cid] = { id: cid, name: num ? 'Space ' + id : uname, username: num ? '' : uname, type: 'Public', active: true }; r = { ok: true, channel: d.channels[cid] }; }
    }
    else if (p.startsWith('/channels/') && m === 'DELETE') { const id = decodeURIComponent(p.slice(10)); if (!d.channels[id]) fail('Space not found', 404); delete d.channels[id]; r = { ok: true }; }
    else if (p === '/publish' && m === 'POST' && live()) {
      if (!d.channels[b.chat_id]) fail('Destination is not registered', 404);
      const msg = await tgc('sendMessage', { chat_id: Number(b.chat_id), text: String(b.text || '').slice(0, 4096), parse_mode: ['HTML', 'Markdown', 'MarkdownV2'].includes(b.parse_mode) ? b.parse_mode : 'HTML', disable_web_page_preview: !!b.disable_web_page_preview });
      d.stats.total_messages_processed++; r = { ok: true, message_id: msg.message_id, chat_id: b.chat_id };
    }
    else if (p === '/publish' && m === 'POST') { if (!d.channels[b.chat_id]) fail('Destination is not registered', 404); d.stats.total_messages_processed++; r = { ok: true, message_id: Math.floor(Math.random() * 9000) + 1000, chat_id: b.chat_id, simulated: true }; }
    else if (p === '/folders' && m === 'GET') r = { items: Object.values(d.folders) };
    else if (p === '/folders' && m === 'POST') {
      const name = String(b.name || '').trim(); if (!name) fail('Folder name required');
      if (Object.values(d.folders).some(f => f.name.toLowerCase() === name.toLowerCase())) fail('A folder with this name already exists', 409);
      const id = Math.random().toString(16).slice(2, 14); d.folders[id] = { id, name, channels: (b.channel_ids || []).filter(x => d.channels[x]) }; r = { ok: true, folder: d.folders[id] };
    }
    else if (p.startsWith('/folders/') && m === 'DELETE') { delete d.folders[p.slice(9)]; r = { ok: true }; }
    else if (p === '/scheduled') r = { items: d.scheduled, recurring: d.recurring, random: d.random, deletions: d.deletions };
    else if (p === '/saved') r = { items: d.saved };
    else if (p === '/settings' && m === 'GET') r = { settings: d.settings, timezone: d.tz };
    else if (p === '/settings' && m === 'PATCH') { Object.entries(b.values || {}).forEach(([k, v]) => { if (['notifications', 'protect_content', 'keep_messages', 'speed'].includes(k)) d.settings[k] = k === 'speed' ? Math.max(1, Math.min(+v || 1, 5)) : v; }); r = { ok: true, settings: d.settings }; }
    else if (p === '/stats') r = { statistics: d.stats, channel_count: chans().length, scheduled_count: d.scheduled.length };
    else if (p === '/capabilities') r = { modules: [] };
    else if (p === '/staff/overview') r = { stats: {}, staff_ids: ['100000001'], users_count: d.users.length, scheduled_count: d.scheduled.length };
    else if (p === '/staff/users') { const s = (q.get('q') || '').toLowerCase(); r = { items: d.users.filter(u => !s || (u.id + u.name).toLowerCase().includes(s)) }; }
    else fail('Not found', 404);
    save(d); return r;
  };
  window.simReset = () => { localStorage.removeItem(K); location.reload(); };
})();
