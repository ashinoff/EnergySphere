// Связь анализатора с оболочкой ЭнергоСферы. Страница открыта во фрейме того
// же сайта: меню модуля присылает нужный раздел, а анализатор сообщает, если
// вкладку переключил сам (например, клик по строке баланса ведёт в рейтинг).
// Раздел записывается в <body data-es-page>, и тема (es-theme.css) показывает
// только его блоки: загрузка файла и заметки о нём — лишь в «Загрузке данных»,
// итоги-плитки — в рейтинге, сводка баланса — в балансе и т.д.
// Пишется вручную, импортом не перезаписывается.
(function () {
  var host = window.parent !== window ? window.parent : null;
  var tabs = document.querySelector('.tabs');
  if (!host || !tabs) return;

  // «Загрузка данных» — раздел Сферы, у самого анализатора такой вкладки нет.
  var page = 'load';
  function current() {
    var on = document.querySelector('.tab.on');
    return on ? on.dataset.tab : 'rank';
  }
  function show(name) { page = name; document.body.setAttribute('data-es-page', name); }
  function tell(type) { host.postMessage({ type: type, tab: page }, location.origin); }

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'es-analysis-tab') return;
    var tab = e.data.tab;
    if (tab !== 'load') {
      var button = document.querySelector('.tab[data-tab="' + tab + '"]');
      if (button && !button.classList.contains('on')) button.click();
    }
    show(tab);
    window.scrollTo(0, 0);
  });

  var last = current();
  new MutationObserver(function () {
    var now = current();
    if (now !== last) {
      last = now;
      // Анализатор сам сменил вкладку — показываем её и сообщаем оболочке.
      if (page !== now) { show(now); tell('es-analysis-tab-changed'); }
    }
  }).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['class'] });

  show(page);
  tell('es-analysis-ready');
})();
