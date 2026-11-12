/* MI-IVV online: stands in for the Claude artifact's window.claude (db + user) and stores everything in
   Ivan's Supabase project. Row Level Security lets each login see only its own rows; sign-ups are off,
   so only Ivan's account exists. Changes from the Mac (Jarvis, `mi`) arrive over Supabase Realtime. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://uhqjekecsbtppfmjrnce.supabase.co";
  const SUPABASE_KEY = "sb_publishable_JZFHU7bT57m_55gSBwx34A_Qlz7bpBn";   // publishable: meant to ship in the page
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const unavailable = () => Object.assign(new Error("unavailable"), { code: "unavailable" });

  let signedIn;
  const session = new Promise(r => { signedIn = r; });
  if (location.hash === "#abmelden") sb.auth.signOut().then(() => { location.hash = ""; location.reload(); });
  else sb.auth.getSession().then(({ data }) => data.session ? signedIn(data.session) : login());

  function login() {
    const box = document.createElement("div");
    box.innerHTML = `
      <form style="max-width:320px;margin:18vh auto 0;padding:24px;font:16px -apple-system,system-ui,sans-serif;display:grid;gap:12px">
        <div style="font-size:22px;font-weight:700">MI-IVV</div>
        <div style="opacity:.7">Anmelden, um deine Daten zu sehen.</div>
        <input name="email" type="email" autocomplete="username" placeholder="E-Mail" required style="padding:12px;font-size:16px;border:1px solid #ccc;border-radius:10px">
        <input name="password" type="password" autocomplete="current-password" placeholder="Passwort" required style="padding:12px;font-size:16px;border:1px solid #ccc;border-radius:10px">
        <button style="padding:12px;font-size:16px;border:0;border-radius:10px;background:#111;color:#fff">Anmelden</button>
        <div class="err" style="color:#c00;min-height:1.2em"></div>
      </form>`;
    Object.assign(box.style, { position: "fixed", inset: "0", background: "#fff", color: "#111", zIndex: "99999" });
    document.body.appendChild(box);
    box.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const { data, error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
      if (error) { box.querySelector(".err").textContent = "Anmeldung fehlgeschlagen."; return; }
      box.remove(); signedIn(data.session);
    });
  }

  async function run(query) {
    await session;
    const { data, error } = await query;
    if (error) throw unavailable();
    return data;
  }
  const copy = v => v == null ? v : JSON.parse(JSON.stringify(v));
  function merge(old, add) {   // same rule as local/server.py: nested objects merge, null removes a key
    const out = { ...old };
    for (const [k, v] of Object.entries(add)) {
      if (v === null) delete out[k];
      else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = v;
    }
    return out;
  }

  const listeners = new Set();
  const notify = () => { for (const l of [...listeners]) l(); };
  session.then(() => {
    sb.channel("docs").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, notify).subscribe();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) notify(); });   // phone back from the lock screen
    setInterval(notify, 30000);
  });
  function listen(load, cb, err) {
    let last = null;
    const go = async () => {
      try { const snap = await load(); const sig = JSON.stringify(snap.raw); if (sig !== last) { last = sig; cb(snap); } }
      catch (e) { err && err(e); }
    };
    listeners.add(go); go();
    return () => listeners.delete(go);
  }

  const readDoc = async path => (await run(sb.from("docs").select("data").eq("path", path).maybeSingle()))?.data ?? null;
  const writeDoc = (path, data) => {
    const parent = path.slice(0, path.lastIndexOf("/")), id = path.split("/").pop();
    return run(sb.from("docs").upsert({ path, parent, id, data, upd: new Date().toISOString() }, { onConflict: "owner,path" }));
  };
  function docRef(path) {
    const snap = data => ({ id: path.split("/").pop(), exists: data != null, data: () => copy(data), raw: data, metadata: { fromCache: false } });
    return {
      id: path.split("/").pop(), path,
      collection: name => colRef(path + "/" + name),
      async get() { return snap(await readDoc(path)); },
      async set(data) { await writeDoc(path, copy(data)); notify(); },
      async update(data) { await writeDoc(path, merge((await readDoc(path)) || {}, copy(data))); notify(); },
      async delete() { await run(sb.from("docs").delete().eq("path", path)); notify(); },
      onSnapshot(cb, err) { return listen(async () => snap(await readDoc(path)), cb, err); }
    };
  }
  function colRef(path, limit) {
    const load = async () => {
      const rows = await run(sb.from("docs").select("id,data").eq("parent", path).order("id").limit(limit || 1000));
      const docs = rows.map(d => ({ id: d.id, exists: true, data: () => copy(d.data) }));
      return { docs, size: docs.length, empty: !docs.length, raw: rows, metadata: { fromCache: false } };
    };
    return { path, doc: id => docRef(path + "/" + id), limit: n => colRef(path, n), get: load, onSnapshot(cb, err) { return listen(load, cb, err); } };
  }

  const db = { doc: docRef, collection: colRef };
  const user = { id: async () => "local", name: async () => "Ivan" };   // same paths as on the Mac: data/users/local/...
  window.claude = { use: name => Promise.resolve(name === "db" ? db : name === "user" ? user : null) };
})();
