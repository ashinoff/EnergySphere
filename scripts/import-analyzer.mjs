// Импорт портативного «Анализатора ПУ · ТП» (один HTML-файл) в модуль 01
// «Анализ потребления». Анализатор работает целиком в браузере и ничего не
// хранит в базе — его движок переносим как есть, меняем только обёртку:
//   • инлайн-скрипты и стили → отдельные файлы (CSP Сферы запрещает инлайн-JS);
//   • SheetJS — локальный файл, без CDN;
//   • вкладка «Карта тепла» убрана (решение владельца 2026-11-12);
//   • собственные шапка и вкладки скрываются темой es-theme.css, вкладки
//     переключает меню Сферы через es-bridge.js.
// Новая версия анализатора: node scripts/import-analyzer.mjs "<путь к .html>"
// Каждая правка обязана найтись ровно один раз — иначе импорт останавливается.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('Укажите путь к HTML анализатора'); process.exit(1); }
const out = 'apps/web/public/analysis';
mkdirSync(out, { recursive: true });

let html = readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
const version = html.match(/<title>[^<]*v(\d+(?:\.\d+)*)<\/title>/)?.[1] ?? '?';

function once(text, pattern, replacement, what) {
  const hits = typeof pattern === 'string' ? text.split(pattern).length - 1 : (text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? []).length;
  if (hits !== 1) throw new Error(`Правка «${what}»: найдено ${hits} совпадений вместо одного`);
  return text.replace(pattern, replacement);
}

// ── Разбор на части ───────────────────────────────────────────────────
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
if (styles.length !== 1) throw new Error(`Ожидался один <style>, найдено ${styles.length}`);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// 1-й — CDN-подстраховка SheetJS (не нужна), дальше демо-данные, ядро, интерфейс.
const [cdnFallback, ...code] = scripts;
if (!cdnFallback.includes('cdn.sheetjs.com')) throw new Error('Первый скрипт — не подстраховка SheetJS, формат файла изменился');
if (code.length !== 3) throw new Error(`Ожидалось 3 блока кода (демо, ядро, интерфейс), найдено ${code.length}`);
let [demo, engine, ui] = code;

// ── Карта тепла: убрать вкладку, панель и отрисовку ────────────────────
let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>', html.indexOf('<body>')));
body = once(body, /\n\s*<button class="tab" data-tab="heat">.*?<\/button>/, '', 'вкладка «Карта тепла»');
body = once(body, /\n\s*<div class="pane" id="pane-heat"><div id="heat"><\/div><\/div>/, '', 'панель «Карта тепла»');
ui = once(ui, "['#kpi','#balance','#rank','#heat','#bal','#review']", "['#kpi','#balance','#rank','#bal','#review']", 'сброс панелей');
ui = once(ui, /\n\s*renderHeat\(\);/, '', 'вызов renderHeat');

// ── Сборка страницы ───────────────────────────────────────────────────
writeFileSync(join(out, 'analyzer.css'), styles[0][1].trim() + '\n');
writeFileSync(join(out, 'demo-data.js'), demo.trim() + '\n');
writeFileSync(join(out, 'engine.js'), engine.trim() + '\n');
writeFileSync(join(out, 'ui.js'), ui.trim() + '\n');

const page = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Анализ потребления · v${version}</title>
<!-- Сгенерировано scripts/import-analyzer.mjs из портативного анализатора v${version}. Не править вручную. -->
<link rel="stylesheet" href="analyzer.css?v=${version}">
<link rel="stylesheet" href="es-theme.css?v=${version}">
<script src="xlsx.full.min.js"></script>
</head>
<body>
${body.trim()}
<script src="demo-data.js?v=${version}"></script>
<script src="engine.js?v=${version}"></script>
<script src="ui.js?v=${version}"></script>
<script src="es-bridge.js?v=${version}"></script>
</body>
</html>
`;
writeFileSync(join(out, 'index.html'), page);

const xlsx = 'scripts/vendor/xlsx.full.min.js';
if (!existsSync(join(out, 'xlsx.full.min.js'))) {
  if (!existsSync(xlsx)) throw new Error(`Нет ${xlsx} (SheetJS 0.20.3)`);
  copyFileSync(xlsx, join(out, 'xlsx.full.min.js'));
}
console.log(`Анализатор v${version} импортирован в ${out}`);
