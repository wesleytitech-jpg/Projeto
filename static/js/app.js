/* ═══════════════════════════════════════════════════════
   NETWORK SENTINEL — Frontend Logic
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────

let lastHostResults = [];

// Hostname/RACF/nome em espera para o modal de reinício
let _rebootPending = { hostname: '', racf: '', nome: '' };

// ── TEMA (DARK MODE) ──────────────────────────────────────────────────────────

/**
 * Inicializa o tema a partir do localStorage, aplicando antes do paint.
 * Chamado imediatamente via IIFE para evitar flash.
 */
(function initTheme() {
  const saved = localStorage.getItem('ns_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

/**
 * Alterna entre modo claro e modo escuro, persistindo a escolha.
 */
function toggleTheme() {
  const html    = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next    = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('ns_theme', next);
}

// ── NAVEGAÇÃO ─────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');

  const titles = { cadastro: 'Cadastrar', hosts: 'Hosts', historico: 'Histórico' };
  document.getElementById('breadcrumbCurrent').textContent = titles[name] || name;

  if (name === 'historico') {
    carregarHistorico();
  }
}

// ── UTILITÁRIOS ───────────────────────────────────────────────────────────────

/**
 * Escapa caracteres HTML para prevenir XSS.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Exibe toast de notificação.
 * @param {string} msg - Mensagem a exibir
 * @param {'success'|'error'} type - Tipo do toast
 */
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ''; }, 3800);
}

/**
 * Marca um campo de input como erro e remove após timeout.
 */
function marcarInputErro(inputId, duracaoMs = 3500) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.classList.add('input-error');
  el.select();
  setTimeout(() => el.classList.remove('input-error'), duracaoMs);
}

// ── FORMULÁRIO DE CADASTRO ────────────────────────────────────────────────────

function limparForm() {
  ['nome', 'racf', 'hostname', 'funcional'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('input-error'); }
  });
}

async function cadastrar(evt) {
  const btn = evt.currentTarget;
  const nome      = document.getElementById('nome').value.trim();
  const racf      = document.getElementById('racf').value.trim();
  const hostname  = document.getElementById('hostname').value.trim();
  const funcional = document.getElementById('funcional').value.trim();

  if (!nome || !racf || !hostname || !funcional) {
    showToast('Preencha todos os campos obrigatórios.', 'error');
    return;
  }

  if (racf.length > 7) {
    showToast('A RACF deve ter no máximo 7 caracteres.', 'error');
    marcarInputErro('racf');
    return;
  }

  if (!/^\d{1,9}$/.test(funcional)) {
    showToast('O Funcional deve conter apenas números (máximo 9 dígitos).', 'error');
    marcarInputErro('funcional');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    const res = await fetch('/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, racf, hostname, funcional })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(data.mensagem);
      limparForm();
      document.getElementById('nome').focus();
    } else {
      tratarErroValidacao(data, 'cadastro');
    }
  } catch (err) {
    console.error('Erro ao cadastrar:', err);
    showToast('Erro de conexão com o servidor.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✓ Cadastrar';
  }
}

/**
 * Trata erros de validação (RACF ou Hostname duplicado) para cadastro e edição.
 */
function tratarErroValidacao(data, contexto) {
  const prefixo = contexto === 'edicao' ? 'edit' : '';

  const mapaIds = {
    RACF_DUPLICADA:     prefixo ? 'editRacf'      : 'racf',
    HOSTNAME_DUPLICADO: prefixo ? 'editHostname'  : 'hostname',
    RACF_TAMANHO:       prefixo ? 'editRacf'      : 'racf',
    FUNCIONAL_INVALIDO: prefixo ? 'editFuncional' : 'funcional',
  };

  const campoId = mapaIds[data.codigo];
  if (campoId) {
    marcarInputErro(campoId);
  }

  showToast(data.erro, 'error');
}

// ── BUSCA DE HOSTS ────────────────────────────────────────────────────────────

async function buscarHosts() {
  const q = document.getElementById('searchHostInput').value.trim();
  const area = document.getElementById('hostsResultsArea');

  if (!q) {
    area.innerHTML = `<div class="panel"><div class="empty-state">Digite um nome, RACF ou hostname para pesquisar.</div></div>`;
    return;
  }

  area.innerHTML = `<div class="panel"><div class="empty-state"><span class="spinner"></span> Pesquisando registros...</div></div>`;

  try {
    const res = await fetch('/buscar?q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('Erro na busca');
    lastHostResults = await res.json();
    renderHostCards(lastHostResults);
  } catch (err) {
    console.error('Erro na busca:', err);
    area.innerHTML = `<div class="panel"><div class="empty-state">Erro de conexão com o servidor.</div></div>`;
  }
}

function renderHostCards(usuarios) {
  const area = document.getElementById('hostsResultsArea');

  if (!usuarios.length) {
    area.innerHTML = `<div class="panel"><div class="empty-state">Nenhum usuário encontrado.</div></div>`;
    return;
  }

  let html = `<div class="results-meta">Exibindo <strong>${usuarios.length}</strong> resultado(s)</div>`;

  for (const user of usuarios) {
    const nome      = escapeHtml(user.Nome);
    const racf      = escapeHtml(user.RACF);
    const hostname  = escapeHtml(user.Hostname);
    const funcional = escapeHtml(user.Funcional || '—');
    const userJson  = escapeHtml(JSON.stringify(user));

    html += `
      <div class="card-host" id="card-${racf}">
        <div class="card-host-header">
          <span class="card-host-title">${nome}</span>
          <div class="card-host-actions">
            <button class="btn btn-sm btn-primary-blue"
              onclick='editarUsuario(${userJson})'>✎ Editar</button>
            <button class="btn btn-sm btn-danger-outline"
              onclick="excluirUsuario('${racf}')">🗑 Excluir</button>
            <button class="btn btn-sm btn-ping-outline"
              onclick="pingarHost('${hostname}', '${racf}', '${nome}')">▶ Ping</button>
            <button class="btn btn-sm btn-reboot"
              onclick="abrirRebootModal('${hostname}', '${racf}', '${nome}')">⚡ Reiniciar</button>
          </div>
        </div>
        <div class="card-host-body">
          <div class="info-row">
            <span class="info-label">RACF:</span>
            <span class="info-value">${racf}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Funcional:</span>
            <span class="info-value">${funcional}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Hostname:</span>
            <span class="info-value">${hostname}</span>
          </div>
          <div id="ping-result-${racf}" class="ping-result-area" style="display:none"></div>
        </div>
      </div>`;
  }

  area.innerHTML = html;
}

// ── EDITAR USUÁRIO ────────────────────────────────────────────────────────────

function editarUsuario(user) {
  document.getElementById('editRacfOriginal').value  = user.RACF;
  document.getElementById('editNome').value          = user.Nome;
  document.getElementById('editRacf').value          = user.RACF;
  document.getElementById('editHostname').value      = user.Hostname;
  document.getElementById('editFuncional').value     = user.Funcional || '';

  ['editNome','editRacf','editHostname','editFuncional'].forEach(id => {
    document.getElementById(id).classList.remove('input-error');
  });

  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
}

async function salvarEdicao(evt) {
  const btn = evt.currentTarget;
  const racf_original = document.getElementById('editRacfOriginal').value.trim();
  const nome          = document.getElementById('editNome').value.trim();
  const racf          = document.getElementById('editRacf').value.trim();
  const hostname      = document.getElementById('editHostname').value.trim();
  const funcional     = document.getElementById('editFuncional').value.trim();

  if (!nome || !racf || !hostname || !funcional) {
    showToast('Preencha todos os campos.', 'error');
    return;
  }

  if (racf.length > 7) {
    showToast('A RACF deve ter no máximo 7 caracteres.', 'error');
    marcarInputErro('editRacf');
    return;
  }

  if (!/^\d{1,9}$/.test(funcional)) {
    showToast('O Funcional deve conter apenas números (máximo 9 dígitos).', 'error');
    marcarInputErro('editFuncional');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    const res = await fetch('/editar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ racf_original, nome, racf, hostname, funcional })
    });
    const data = await res.json();

    if (res.ok) {
      closeModal();
      showToast(data.mensagem);
      if (document.getElementById('tab-hosts').classList.contains('active')) {
        buscarHosts();
      }
    } else {
      tratarErroValidacao(data, 'edicao');
    }
  } catch (err) {
    console.error('Erro ao editar:', err);
    showToast('Erro de conexão.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Salvar';
  }
}

// ── EXCLUIR USUÁRIO ───────────────────────────────────────────────────────────

async function excluirUsuario(racf) {
  if (!confirm(`Tem certeza que deseja excluir o usuário com RACF "${racf}"?`)) return;

  try {
    const res = await fetch('/excluir?racf=' + encodeURIComponent(racf), { method: 'DELETE' });
    const data = await res.json();

    if (res.ok) {
      showToast(data.mensagem);
      const card = document.getElementById('card-' + racf);
      if (card) {
        card.style.transition = 'opacity 0.3s';
        card.style.opacity = '0';
        setTimeout(() => {
          card.remove();
          lastHostResults = lastHostResults.filter(u => u.RACF !== racf);
          const meta = document.querySelector('.results-meta');
          if (meta) meta.innerHTML = `Exibindo <strong>${lastHostResults.length}</strong> resultado(s)`;
          if (lastHostResults.length === 0) {
            document.getElementById('hostsResultsArea').innerHTML =
              `<div class="panel"><div class="empty-state">Nenhum usuário encontrado.</div></div>`;
          }
        }, 300);
      }
    } else {
      showToast(data.erro, 'error');
    }
  } catch (err) {
    console.error('Erro ao excluir:', err);
    showToast('Erro ao excluir usuário.', 'error');
  }
}

// ── PING ──────────────────────────────────────────────────────────────────────

async function pingarHost(hostname, racf, nome) {
  const resultDiv = document.getElementById(`ping-result-${racf}`);
  const btn = document.querySelector(`#card-${racf} .btn-ping-outline`);

  if (!resultDiv) return;

  resultDiv.style.display = 'flex';
  resultDiv.innerHTML = `<div class="info-row"><span class="spinner"></span>&nbsp;Resolvendo IP e executando ping...</div>`;
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname, nome, racf })
    });
    const data = await res.json();

    if (data.erro) {
      resultDiv.innerHTML = `<div class="info-row"><span class="status-badge status-offline">⚠️ Erro: ${escapeHtml(data.erro)}</span></div>`;
      return;
    }

    const statusConfig = {
      'Online':              { cls: 'status-online',    label: '🟢 Online' },
      'Host não encontrado': { cls: 'status-notfound',  label: '⚠️ Host não encontrado' },
      'Offline':             { cls: 'status-offline',   label: '🔴 Offline' },
    };
    const sc = statusConfig[data.status] || { cls: 'status-offline', label: '🔴 Offline' };

    const ipHtml = (data.ip && data.ip !== 'Não resolvido')
      ? `<span class="info-value ip-highlight">${escapeHtml(data.ip)}</span>`
      : `<span class="info-value">${escapeHtml(data.ip || '—')}</span>`;

    resultDiv.innerHTML = `
      <div class="info-row">
        <span class="info-label">IP Atual:</span> ${ipHtml}
      </div>
      <div class="info-row">
        <span class="info-label">Status:</span>
        <span class="status-badge ${sc.cls}">${sc.label}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Latência:</span>
        <span class="info-value">${escapeHtml(data.tempo_resposta)}</span>
      </div>`;

    carregarHistorico();
  } catch (err) {
    console.error('Erro no ping:', err);
    resultDiv.innerHTML = `<div class="info-row"><span class="status-badge status-offline">Falha na comunicação com o servidor.</span></div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── REINICIAR EQUIPAMENTO — GERAR COMANDO ─────────────────────────────────────

/**
 * Abre o modal de geração de comando de reinicialização.
 */
function abrirRebootModal(hostname, racf, nome) {
  _rebootPending = { hostname, racf, nome };

  document.getElementById('rebootHostnameLabel').textContent = hostname;
  document.getElementById('rebootConfirmArea').style.display  = '';
  document.getElementById('rebootStatusArea').style.display   = 'none';
  document.getElementById('rebootCommandArea').style.display  = 'none';
  document.getElementById('rebootCopyFeedback').style.display = 'none';
  document.getElementById('rebootDetail').style.display       = 'none';
  document.getElementById('rebootCommandText').value          = '';
  document.getElementById('rebootFooter').style.display       = '';

  _setStep('verificando', 'idle');
  _setStep('online',      'muted');
  _setStep('reiniciando', 'muted');
  const stepFalha = document.getElementById('step-falha');
  stepFalha.style.display = 'none';
  _setStep('falha', 'muted');

  const btnConfirm = document.getElementById('btnConfirmReboot');
  btnConfirm.disabled  = false;
  btnConfirm.innerHTML = '⚡ Gerar Comando';
  btnConfirm.onclick   = confirmarReiniciar;

  document.getElementById('rebootModal').classList.add('open');
}

function closeRebootModal() {
  document.getElementById('rebootModal').classList.remove('open');
}

/**
 * Atualiza o estado visual de uma etapa no modal.
 */
function _setStep(step, state) {
  const el = document.getElementById('step-' + step);
  if (!el) return;
  el.className = 'reboot-step';
  if (state !== 'idle') el.classList.add(state);

  const iconEl = el.querySelector('.step-icon');
  if (state === 'active') {
    iconEl.innerHTML = '<span class="spinner"></span>';
  } else {
    const icons = {
      verificando: '⏳',
      online:      '🟢',
      reiniciando: '📋',
      falha:       '⚠️',
    };
    iconEl.textContent = icons[step] || '';
  }
}

/**
 * Chama /gerar-comando, resolve o IP e exibe o comando pronto para copiar.
 */
async function confirmarReiniciar() {
  const { hostname } = _rebootPending;
  const btnConfirm = document.getElementById('btnConfirmReboot');

  document.getElementById('rebootConfirmArea').style.display = 'none';
  document.getElementById('rebootStatusArea').style.display  = '';
  btnConfirm.disabled  = true;
  btnConfirm.innerHTML = '<span class="spinner"></span> Resolvendo...';

  _setStep('verificando', 'active');

  try {
    const res  = await fetch('/gerar-comando', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname })
    });
    const data = await res.json();

    if (data.erro) {
      _setStep('verificando', 'done');
      _mostrarFalhaComando(data.erro);
      _finalizarRebootUI();
      return;
    }

    _setStep('verificando', 'done');

    if (data.sucesso_ping && data.ip !== 'Não resolvido') {
      _setStep('online', 'done');
    } else {
      document.getElementById('step-falha').style.display = '';
      _setStep('falha', 'done');
    }

    await _delay(400);
    _setStep('reiniciando', 'done');

    const commandArea = document.getElementById('rebootCommandArea');
    const commandText = document.getElementById('rebootCommandText');
    const detail      = document.getElementById('rebootDetail');

    commandText.value = data.comando;
    commandArea.style.display = '';

    detail.style.display = '';
    detail.textContent   = `IP: ${data.ip}  ·  Status do ping: ${data.status_ping}`;

    showToast(`Comando gerado para ${hostname}.`);

    document.getElementById('rebootFooter').innerHTML = `
      <button class="btn btn-outline" onclick="closeRebootModal()">Fechar</button>
    `;

  } catch (err) {
    console.error('Erro ao gerar comando:', err);
    _setStep('verificando', 'done');
    _mostrarFalhaComando('Erro de conexão com o servidor.');
    _finalizarRebootUI();
  }
}

/**
 * Copia o comando gerado para a área de transferência e exibe confirmação.
 */
async function copiarComando() {
  const text = document.getElementById('rebootCommandText').value;
  const feedback = document.getElementById('rebootCopyFeedback');
  const btn = document.getElementById('btnCopyCommand');

  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.getElementById('rebootCommandText');
    ta.select();
    document.execCommand('copy');
  }

  btn.innerHTML = '✅ Copiado!';
  btn.disabled  = true;
  feedback.style.display = '';

  setTimeout(() => {
    btn.innerHTML = '📋 Copiar Código';
    btn.disabled  = false;
    feedback.style.display = 'none';
  }, 3000);
}

function _mostrarFalhaComando(msg) {
  document.getElementById('step-falha').style.display = '';
  _setStep('falha', 'active');
  showToast(msg, 'error');
}

function _finalizarRebootUI(btnLabel = 'Fechar') {
  const btnConfirm = document.getElementById('btnConfirmReboot');
  btnConfirm.disabled  = false;
  btnConfirm.innerHTML = btnLabel;
  btnConfirm.onclick   = closeRebootModal;
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────────────

async function carregarHistorico() {
  const tbody = document.getElementById('historicoTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center"><span class="spinner"></span> Carregando...</td></tr>';

  try {
    const res = await fetch('/historico');
    if (!res.ok) throw new Error('Erro ao carregar histórico');
    const historico = await res.json();

    if (!historico.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">Nenhum registro de ping realizado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = historico.map(item => {
      const statusConfig = {
        'Online':              '<span class="status-badge status-online">🟢 Online</span>',
        'Offline':             '<span class="status-badge status-offline">🔴 Offline</span>',
        'Host não encontrado': '<span class="status-badge status-notfound">⚠️ Host não encontrado</span>',
      };
      const badge = statusConfig[item.status] || `<span class="status-badge status-offline">${escapeHtml(item.status)}</span>`;

      return `<tr>
        <td>${escapeHtml(item.data_hora)}</td>
        <td>${escapeHtml(item.nome)}</td>
        <td><span class="info-value" style="font-size:12px">${escapeHtml(item.hostname)}</span></td>
        <td><span class="info-value ip-highlight" style="font-size:12px">${escapeHtml(item.ip)}</span></td>
        <td>${badge}</td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error('Erro ao carregar histórico:', err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger)">Erro ao carregar histórico. Verifique o console.</td></tr>';
  }
}

// ── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Fechar modal ao clicar no overlay
  document.getElementById('editModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  document.getElementById('rebootModal').addEventListener('click', function(e) {
    if (e.target === this) closeRebootModal();
  });

  // Tecla Escape fecha os modais
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeRebootModal();
    }
  });

  // Pré-carrega o histórico em background
  carregarHistorico();

  console.log('✅ Network Sentinel inicializado');
});
