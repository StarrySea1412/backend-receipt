'use strict';
const raw = window.receiptLab;
const display = document.querySelector('#evidence');
const evidenceTitle = document.querySelector('#evidence-title');
const scene = document.querySelector('#evidence-case');
const choice = [...document.querySelectorAll('[data-case]')];
const locked = [...document.querySelectorAll('[data-action="conflict"],[data-action="newKey"]')];
let active;

function show(title, lines) {
  evidenceTitle.textContent = title;
  display.textContent = lines.join('\n');
}

function activate(id) {
  active = raw.cases.find(c => c.id === id);
  scene.textContent = `案件 ${active.id}`;
  document.querySelector('#initial-output').textContent = active.client;
  for (const control of choice) {
    control.setAttribute('aria-pressed', String(control.dataset.case === active.id));
  }
  for (const button of locked) button.disabled = true;
  show('证据台', ['等待取证。选一项，打开对应的实验记录。']);
}

function table(rows) {
  return ['job_id  idempotency_key', ...rows, `(${rows.length} 行)`];
}

function response(r) {
  return [`HTTP ${r.status}`, JSON.stringify(r.body), '', ...table(r.rows)];
}

const actions = {
  app: () => show('应用日志 · 重试前', active.app.length ? active.app : ['没有该请求入口事件。']),
  rows: () => show('数据库 · 重试前', [`SELECT ... WHERE idempotency_key = '${active.key}'`, ...table(active.before)]),
  relay: () => show('中转日志 · 重试前', active.relay),
  retry: () => {
    for (const button of locked) button.disabled = false;
    show('同键重试 · 实测', [...active.retry.app, '', ...response(active.retry)]);
  },
  conflict: () => show('同键、不同正文 · 实测', response(active.conflict)),
  newKey: () => show('换键重发 · 实测', response(active.newKey)),
};

for (const button of choice) button.addEventListener('click', () => activate(button.dataset.case));
document.querySelector('#reset').addEventListener('click', () => activate(active.id));
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => actions[button.dataset.action]());
}
activate('A');
