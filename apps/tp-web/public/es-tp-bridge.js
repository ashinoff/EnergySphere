// Связь интерфейса TP_Approval с оболочкой ЭнергоСферы (тот же сайт, страница во фрейме).
// Меню модуля 04 присылает подпись нужного раздела — мост нажимает такую кнопку в
// (скрытой темой) панели TP, чтобы сработала его собственная логика переходов.
// Обратно сообщает подпись выбранного раздела — для подсветки меню Сферы.
// Пишется вручную, импорт scripts/import-tp.mjs его не трогает.
(function () {
  var host = window.parent !== window ? window.parent : null;
  if (!host) return;
  var send = function (data) { host.postMessage(data, location.origin); };
  var buttons = function () { return Array.prototype.slice.call(document.querySelectorAll('.main-sidebar button')); };
  var label = function (b) { return (b.getAttribute('aria-label') || b.textContent || '').trim(); };

  // Нажать первую найденную кнопку из списка подписей (у разных ролей разные разделы).
  // Панель появляется после входа — до 15 с ждём её.
  var pending = null;
  function go(labels) {
    pending = { labels: labels, until: Date.now() + 15000 };
    attempt();
  }
  function attempt() {
    if (!pending) return;
    var list = buttons();
    for (var i = 0; i < pending.labels.length; i++) {
      var wanted = pending.labels[i];
      var hit = list.find(function (b) { return label(b).indexOf(wanted) === 0; });
      if (hit) {
        pending = null;
        if (!hit.classList.contains('selected')) hit.click();
        window.scrollTo(0, 0);
        return;
      }
    }
    if (Date.now() < pending.until) setTimeout(attempt, 300); else pending = null;
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== host || !e.data || e.data.type !== 'es-tp-go') return;
    if (Array.isArray(e.data.labels)) go(e.data.labels);
  });

  // Какие разделы есть у этого человека (у инженера, согласующего и админа — разные):
  // по ним меню модуля в Сфере показывает только существующие пункты.
  var lastList = '';
  function reportAvailable() {
    var labels = buttons().map(label).filter(Boolean);
    var key = labels.join('|');
    if (key && key !== lastList) { lastList = key; send({ type: 'es-tp-available', labels: labels }); }
  }

  var last = '';
  function report() {
    reportAvailable();
    // Пока выполняется переход по меню Сферы, промежуточные разделы (например,
    // раздел по умолчанию сразу после входа) не сообщаем — иначе меню «дёрнется».
    if (pending) return;
    var selected = buttons().find(function (b) { return b.classList.contains('selected'); });
    var now = selected ? label(selected) : '';
    if (now && now !== last) { last = now; send({ type: 'es-tp-section', label: now }); }
  }
  new MutationObserver(report).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
})();
