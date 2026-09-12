const COOKIE = "ichimon_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"}
  });
}

function htmlEscape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function randomBytes(n = 16) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function hashPassword(password, saltB64) {
  const salt = unb64(saltB64);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password),
    {name:"PBKDF2"}, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {name:"PBKDF2", salt, iterations:120000, hash:"SHA-256"},
    key, 256
  );
  return b64(new Uint8Array(bits));
}

async function makeSession(memberId, env) {
  const payload = `${memberId}.${Date.now()}.${b64(randomBytes(24))}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode("ichimon-session-v1:" + env.SESSION_SECRET),
    {name:"HMAC", hash:"SHA-256"}, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${btoa(payload)}.${b64(new Uint8Array(sig))}`;
}

/*
  Note: This first version keeps sessions stateless.
  The signed cookie expires at the browser level and the payload contains
  the member id. Before public production, rotate the signing secret into
  a Cloudflare secret and use a server-side/session table if revocation
  is required.
*/
async function sessionMember(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  try {
    const [p64, sigB64] = m[1].split(".");
    const payload = atob(p64);
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode("ichimon-session-v1:" + env.SESSION_SECRET),
      {name:"HMAC", hash:"SHA-256"}, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "HMAC", key, unb64(sigB64), new TextEncoder().encode(payload)
    );
    if (!ok) return null;
    const [id, ts] = payload.split(".");
    if (Date.now() - Number(ts) > SESSION_MAX_AGE * 1000) return null;
    return await env.DB.prepare(
      "SELECT id, game_name, role FROM members WHERE id=?"
    ).bind(Number(id)).first();
  } catch {
    return null;
  }
}

function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const member = await sessionMember(request, env);

  if (request.method === "POST" && path === "/api/register") {
    const body = await request.json();
    const gameName = String(body.gameName || "").trim();
    const password = String(body.password || "");
    if (gameName.length < 1 || gameName.length > 30) return json({error:"ゲーム名は1〜30文字で入力してください"},400);
    if (password.length < 8 || password.length > 100) return json({error:"パスワードは8〜100文字で入力してください"},400);
    const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first();
    if (Number(countRow?.count || 0) >= 150) {
      return json({error:"一門員の登録上限（150人）に達しています"},403);
    }
    const salt = b64(randomBytes(16));
    const hash = await hashPassword(password, salt);
    try {
      const r = await env.DB.prepare(
        "INSERT INTO members (game_name,password_hash,password_salt) VALUES (?,?,?)"
      ).bind(gameName, hash, salt).run();
      const id = r.meta.last_row_id;
      const token = await makeSession(id, env);
      return new Response(JSON.stringify({ok:true}), {
        headers: {"content-type":"application/json; charset=utf-8", "Set-Cookie":sessionCookie(token)}
      });
    } catch (e) {
      return json({error:"そのゲーム名はすでに登録されています"},409);
    }
  }

  if (request.method === "POST" && path === "/api/login") {
    const body = await request.json();
    const gameName = String(body.gameName || "").trim();
    const password = String(body.password || "");
    const row = await env.DB.prepare(
      "SELECT id, game_name, role, password_hash, password_salt FROM members WHERE game_name=?"
    ).bind(gameName).first();
    if (!row) return json({error:"ゲーム名またはパスワードが違います"},401);
    const hash = await hashPassword(password, row.password_salt);
    if (hash !== row.password_hash) return json({error:"ゲーム名またはパスワードが違います"},401);
    const token = await makeSession(row.id, env);
    return new Response(JSON.stringify({ok:true}), {
      headers: {"content-type":"application/json; charset=utf-8", "Set-Cookie":sessionCookie(token)}
    });
  }

  if (request.method === "POST" && path === "/api/logout") {
    return new Response(JSON.stringify({ok:true}), {
      headers: {"content-type":"application/json; charset=utf-8", "Set-Cookie":clearCookie()}
    });
  }

  if (path === "/api/me") {
    return json({loggedIn:!!member, member: member ? {
      id:member.id, gameName:member.game_name, role:member.role
    }:null});
  }

  if (!member) return json({error:"ログインが必要です"},401);

  if (request.method === "GET" && path === "/api/members") {
    const rows = await env.DB.prepare(
      "SELECT id, game_name, role, created_at FROM members ORDER BY game_name COLLATE NOCASE"
    ).all();
    return json({members:rows.results});
  }

  if (request.method === "GET" && path === "/api/units") {
    const rows = await env.DB.prepare(
      "SELECT id, unit_name, sort_order FROM units WHERE active=1 ORDER BY sort_order, id"
    ).all();
    return json({units:rows.results});
  }

  if (request.method === "GET" && path === "/api/my-units") {
    const rows = await env.DB.prepare(
      `SELECT u.id, u.unit_name, COALESCE(mu.level, 1) AS level, COALESCE(mu.troop_type, '馬') AS troop_type
       FROM units u
       LEFT JOIN member_units mu ON mu.unit_id=u.id AND mu.member_id=?
       WHERE u.active=1 ORDER BY u.sort_order,u.id`
    ).bind(member.id).all();
    return json({units:rows.results});
  }

  if (request.method === "PUT" && path === "/api/my-units") {
    const body = await request.json();
    const unitId = Number(body.unitId);
    const level = Number(body.level);
    if (!Number.isInteger(unitId) || !Number.isInteger(level) || level < 1 || level > 50)
      return json({error:"部隊Lvは1〜50で指定してください"},400);
    await env.DB.prepare(
      `INSERT INTO member_units(member_id,unit_id,level) VALUES(?,?,?)
       ON CONFLICT(member_id,unit_id) DO UPDATE SET level=excluded.level,updated_at=CURRENT_TIMESTAMP`
    ).bind(member.id, unitId, level).run();
    return json({ok:true});
  }

  if (request.method === "GET" && path === "/api/progress") {
    const rows = await env.DB.prepare(
      `SELECT m.id AS member_id, m.game_name, u.id AS unit_id, u.unit_name,
              COALESCE(mu.level,1) AS level, COALESCE(mu.troop_type,'馬') AS troop_type
       FROM members m CROSS JOIN units u
       LEFT JOIN member_units mu ON mu.member_id=m.id AND mu.unit_id=u.id
       WHERE u.active=1
       ORDER BY m.game_name COLLATE NOCASE, u.sort_order, u.id`
    ).all();
    return json({rows:rows.results});
  }

  if (request.method === "GET" && path === "/api/schedules") {
    const rows = await env.DB.prepare(
      `SELECT id,title,description,start_at FROM schedules ORDER BY start_at LIMIT 100`
    ).all();
    return json({schedules:rows.results});
  }

  if (request.method === "POST" && path === "/api/schedules") {
    if (member.role === "member") return json({error:"幹部以上のみ予定を追加できます"},403);
    const body = await request.json();
    const title = String(body.title||"").trim();
    const description = String(body.description||"").trim();
    const startAt = String(body.startAt||"").trim();
    if (!title || !startAt) return json({error:"タイトルと日時は必須です"},400);
    await env.DB.prepare(
      "INSERT INTO schedules(title,description,start_at,created_by) VALUES(?,?,?,?)"
    ).bind(title,description,startAt,member.id).run();
    return json({ok:true});
  }

  return json({error:"Not Found"},404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  }
};
