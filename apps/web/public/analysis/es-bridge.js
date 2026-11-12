// Связь анализатора с оболочкой ЭнергоСферы. Страница открыта во фрейме того
// же сайта: меню модуля присылает нужную вкладку, а анализатор сообщает, если
// вкладку переключил сам (например, клик по строке баланса ведёт в рейтинг).
// Пишется вручную, импортом не перезаписывается.
(function () {
  var host = window.parent !== window ? window.parent : null;
  var tabs = document.querySelector('.tabs');
  if (!host || !tabs) return;

  function current() {
    var on = document.querySelector('.tab.on');
    return on ? on.dataset.tab : 'rank';
  }
  function tell(type) { host.postMessage({ type: type, tab: current() }, location.origin); }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'es-analysis-tab') return;
    var button = document.querySelector('.tab[data-tab="' + e.data.tab + '"]');
    if (button && !button.classList.contains('on')) { button.click(); window.scrollTo(0, 0); }
  });

  var last = current();
  new MutationObserver(function () {
    var now = current();
    if (now !== last) { last = now; tell('es-analysis-tab-changed'); }
  }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });

  tell('es-analysis-ready');
})();
