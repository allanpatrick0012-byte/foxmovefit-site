// Painel da equipe. Sem bibliotecas de terceiros: fala direto com a API do Supabase.
// A segurança está no banco (admin_overview): só admin com verificação em duas etapas recebe dados.
// Os tokens ficam só na memória desta aba (nada em localStorage/cookies).
'use strict';
(() => {
  const URL_BASE = 'https://pqiustlomkfjwhdruaqz.supabase.co';
  const KEY = 'sb_publishable_dDTRdi7HphTW5OUhcaLa3Q_Lz6czhAx'; // chave pública (publishable), a mesma do app
  const IDLE_MS = 15 * 60 * 1000;
  let token = null, refresh = null, factorId = null, idle = null;

  const $ = (id) => document.getElementById(id);
  const show = (...ids) => ['entrar', 'cadastrar-2fa', 'verificar-2fa', 'painel'].forEach((s) => { $(s).hidden = !ids.includes(s); });
  const fail = (msg) => { $('erro').textContent = msg; $('erro').hidden = !msg; };

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { apikey: KEY, 'content-type': 'application/json' };
    if (auth && token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(URL_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || 'Erro ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setSession(d) { token = d.access_token; refresh = d.refresh_token; }

  function logout() {
    if (token) api('/auth/v1/logout', { method: 'POST' }).catch(() => {});
    token = refresh = factorId = null;
    $('senha').value = ''; $('codigo').value = ''; $('codigo-novo').value = '';
    $('sair').hidden = true;
    show('entrar');
  }

  function touch() {
    clearTimeout(idle);
    idle = setTimeout(() => { logout(); fail('Sessão encerrada por inatividade.'); }, IDLE_MS);
  }
  ['click', 'keydown', 'pointermove'].forEach((e) => document.addEventListener(e, touch, { passive: true }));

  async function signIn() {
    fail('');
    const email = $('email').value.trim(), password = $('senha').value;
    if (!email || !password) return fail('Preencha e-mail e senha.');
    try {
      setSession(await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }));
    } catch (e) {
      return fail(e.status === 400 ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + e.message);
    }
    $('senha').value = '';
    $('sair').hidden = false;
    touch();
    const user = await api('/auth/v1/user');
    const totp = (user.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
    if (totp) {
      factorId = totp.id;
      show('verificar-2fa');
      $('codigo').focus();
      return;
    }
    // Ainda sem 2 etapas: cadastra agora (fatores pendentes antigos são descartados).
    for (const f of user.factors || []) if (f.status !== 'verified') await api('/auth/v1/factors/' + f.id, { method: 'DELETE' }).catch(() => {});
    const f = await api('/auth/v1/factors', { method: 'POST', body: { factor_type: 'totp', friendly_name: 'Painel ' + new Date().toISOString().slice(0, 10) } });
    factorId = f.id;
    $('qr').src = f.totp.qr_code;
    $('segredo').textContent = f.totp.secret;
    show('cadastrar-2fa');
  }

  async function verify(code) {
    fail('');
    if (!/^\d{6}$/.test(code)) return fail('O código tem 6 dígitos.');
    try {
      const ch = await api('/auth/v1/factors/' + factorId + '/challenge', { method: 'POST', body: {} });
      setSession(await api('/auth/v1/factors/' + factorId + '/verify', { method: 'POST', body: { challenge_id: ch.id, code } }));
    } catch (e) {
      return fail('Código inválido ou vencido. Tente o próximo código.');
    }
    $('segredo').textContent = '';
    $('qr').removeAttribute('src');
    await load();
  }

  const fmtDate = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const td = (text, cls) => { const c = document.createElement('td'); c.textContent = text == null || text === '' ? '—' : String(text); if (cls) c.className = cls; return c; };
  const PLACE = { home: 'Casa', gym: 'Academia', both: 'Casa e academia' };
  const SUB = { active: 'Ativa', trial: 'Teste grátis', grace: 'Pagamento pendente', canceled: 'Cancelada', expired: 'Vencida' };
  const subLabel = (s) => (s || '').replace(/^(\w+)/, (m) => SUB[m] || m).replace('(encerrada)', '(encerrada)');

  async function load() {
    fail('');
    let o;
    try {
      o = await api('/rest/v1/rpc/admin_overview', { method: 'POST', body: {} });
    } catch (e) {
      if (/mfa_required/.test(e.message)) return fail('Falta a verificação em duas etapas.');
      if (/forbidden/.test(e.message)) { logout(); return fail('Esta conta não tem acesso ao painel.'); }
      if (e.status === 401) { logout(); return fail('Sessão expirada. Entre de novo.'); }
      return fail('Não foi possível carregar: ' + e.message);
    }
    const t = o.totals;
    const kpis = [
      ['Usuários', t.users], ['Novos hoje', t.new_today], ['Novos em 7 dias', t.new_7d], ['Novos em 30 dias', t.new_30d],
      ['Ativos em 7 dias', t.active_7d], ['Fizeram o questionário', t.onboarding_done],
      ['Assinantes ativos', t.subscribers], ['Em teste grátis', t.trials], ['Cancelados ou vencidos', t.canceled_or_expired],
    ];
    const box = $('kpis'); box.replaceChildren();
    for (const [label, value] of kpis) {
      const d = document.createElement('div'); d.className = 'kpi';
      const v = document.createElement('b'); v.textContent = String(value);
      const l = document.createElement('span'); l.textContent = label;
      d.append(v, l); box.append(d);
    }
    const bars = $('barras'); bars.replaceChildren();
    const max = Math.max(1, ...o.signups_by_day.map((d) => d.count));
    for (const d of o.signups_by_day) {
      const b = document.createElement('div'); b.className = 'bar';
      b.style.setProperty('--h', (d.count / max * 100).toFixed(1) + '%');
      b.title = new Date(d.day + 'T12:00').toLocaleDateString('pt-BR') + ': ' + d.count;
      const n = document.createElement('span'); n.textContent = d.count ? String(d.count) : '';
      b.append(n); bars.append(b);
    }
    const body = $('usuarios'); body.replaceChildren();
    for (const u of o.recent_users) {
      const tr = document.createElement('tr');
      tr.append(td(fmtDate(u.created_at)), td(u.name), td(u.email), td(u.provider === 'google' ? 'Google' : 'E-mail'),
        td(u.onboarding ? 'Sim' : 'Não'), td(PLACE[u.location] || u.location), td(fmtDate(u.last_activity)),
        td(subLabel(u.subscription), u.subscription === 'active' || u.subscription === 'trial' ? 'ok' : ''));
      body.append(tr);
    }
    $('atualizado').textContent = 'Atualizado em ' + fmtDate(o.generated_at);
    show('painel');
  }

  $('btn-entrar').addEventListener('click', signIn);
  $('senha').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
  $('btn-ativar').addEventListener('click', () => verify($('codigo-novo').value.trim()));
  $('btn-verificar').addEventListener('click', () => verify($('codigo').value.trim()));
  $('codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') verify($('codigo').value.trim()); });
  $('btn-atualizar').addEventListener('click', load);
  $('sair').addEventListener('click', logout);
  show('entrar');
})();
