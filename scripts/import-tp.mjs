// Импорт TP_Approval (согласование актов ТП) в модуль 04 «Акты ТП».
// Переносится как есть, меняется только обвязка:
//   • схема app → tp (миграции, SQL в коде, параметр сеанса app.user_id → tp.user_id);
//   • модель доступа TP сохраняется: владелец схемы (у нас — владелец базы) создаёт
//     объекты, его SECURITY DEFINER-функции обходят защиту строк; модуль работает под
//     служебной ролью tp_runtime (её права — из миграций), для неё политики действуют.
//     В TP владельцем был суперпользователь, поэтому FORCE ROW LEVEL SECURITY ни на что
//     не влиял; у нас владелец обычный, и FORCE сломал бы функции TP — FORCE → ENABLE;
//   • вход: вместо своих учёток — мост к пользователям и ролям Сферы (modules/tp/bridge.ts,
//     пишется вручную, импортом не трогается).
// Запуск: node scripts/import-tp.mjs "<путь к репозиторию TP_Approval>" [migrations|api|web|all]
// Каждое правило обязано сработать там, где ожидается, — иначе импорт останавливается.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const src = process.argv[2];
const what = process.argv[3] ?? 'all';
if (!src || !existsSync(join(src, 'db', 'migrations'))) { console.error('Укажите путь к TP_Approval'); process.exit(1); }
const read = p => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ── SQL ───────────────────────────────────────────────────────────────
export function sqlToTp(sql, name) {
  let s = sql
    .replace(/CREATE SCHEMA app;/g, 'CREATE SCHEMA IF NOT EXISTS tp;')
    .replace(/\bapp\./g, 'tp.')
    .replace(/search_path=pg_catalog,app\b/g, 'search_path=pg_catalog,tp')
    .replace(/SCHEMA app\b/g, 'SCHEMA tp')
    .replace(/table_schema='app'/g, "table_schema='tp'")
    .replace(/FORCE ROW LEVEL SECURITY/g, 'ENABLE ROW LEVEL SECURITY');
  if (/\bapp\b(?!lic|ly|ear|roved|rove|ointed|end)/i.test(s.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''"))) {
    const hit = s.split('\n').find(l => /\bapp\b/.test(l.replace(/--.*$/, '').replace(/'[^']*'/g, "''")));
    if (hit) throw new Error(`${name}: осталось слово app: ${hit.slice(0, 120)}`);
  }
  return s;
}

function migrations() {
  const from = join(src, 'db', 'migrations');
  const to = join('db', 'migrations', 'tp');
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(to)) if (/^0\d\d_/.test(f)) rmSync(join(to, f));
  const files = readdirSync(from).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const out = `-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.\n` + sqlToTp(read(join(from, f)), f);
    writeFileSync(join(to, f), out);
  }
  console.log(`миграции: ${files.length} → ${to}`);
}

// ── Код API ───────────────────────────────────────────────────────────
// В TS «app.» — это и SQL (app.acts), и код (app.get у Express, переменная app в
// разборе PDF). Меняем только app.<имя>, где <имя> — объект схемы (таблица или
// функция из миграций), плюс параметр сеанса app.user_id.
let schemaNames = null;
function namesInSchema() {
  if (schemaNames) return schemaNames;
  const all = readdirSync(join(src, 'db', 'migrations')).filter(f => f.endsWith('.sql')).map(f => read(join(src, 'db', 'migrations', f))).join('\n');
  schemaNames = new Set([...all.matchAll(/\bapp\.([a-z_][a-z0-9_]*)/g)].map(m => m[1]));
  schemaNames.add('user_id');
  return schemaNames;
}
export function tsToTp(code, name) {
  const names = namesInSchema();
  let s = code
    .replace(/\bapp\.([a-z_][a-z0-9_]*)\b/g, (whole, id) => (names.has(id) ? `tp.${id}` : whole))
    // Имя объекта подставляется динамически: `SELECT app.${fn}(…)` (сервис TP).
    .replace(/\bapp\.\$\{/g, 'tp.${')
    .replace(/search_path=pg_catalog,app\b/g, 'search_path=pg_catalog,tp')
    .replace(/table_schema='app'/g, "table_schema='tp'");
  for (const bad of ['get', 'post', 'use', 'set', 'listen', 'locals', 'y', 'x0', 'x1']) {
    if (names.has(bad)) throw new Error(`имя схемы «${bad}» совпадает с кодом — правило неоднозначно`);
  }
  if (/['"`]app\.user_id/.test(s)) throw new Error(`${name}: осталось app.user_id`);
  return s;
}

const API_SKIP = new Set(['server.ts']); // local-auth и auth остаются: в режиме keycloak не используются
function api() {
  const from = join(src, 'apps', 'api', 'src');
  const to = join('apps', 'api', 'src', 'modules', 'tp', 'core');
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const f of readdirSync(from).filter(f => f.endsWith('.ts') && !API_SKIP.has(f))) {
    writeFileSync(join(to, f), `// Импортировано из TP_Approval (scripts/import-tp.mjs). Не править вручную.\n` + tsToTp(read(join(from, f)), f));
    n++;
  }
  console.log(`API: ${n} файлов → ${to}`);
}

// ── Палитра ───────────────────────────────────────────────────────────
// Синий цвет TP зашит в сотни правил — перекрашиваем по оттенку прямо в его CSS/TSX
// (docs/STYLE.md: цвет модуля 04 — лиловый, серые — тёплые серые Сферы):
//   • синие и бирюзовые (оттенок 165–255°) → лиловый модуля (≈268°), светлота та же;
//   • почти серые (холодные рамки и подписи) → тёплые серые Сферы;
//   • красные, зелёные, охра (смысл: замечание, согласовано, исправлено) — не трогаем.
const MODULE_HUE = 268;
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map(v => Math.round((v + m) * 255));
}
function recolorRgb(r, g, b) {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const [h, s, l] = hsl(r, g, b);
  if (s < 0.2 || chroma < 12) return rgb(48, Math.min(s, 0.1), l);  // холодный серый → тёплый
  if (h >= 165 && h <= 255) return rgb(MODULE_HUE, s * 0.8, l);      // синий/бирюзовый → лиловый
  return [r, g, b];
}
const hex2 = n => n.toString(16).padStart(2, '0');
export function recolor(text) {
  return text
    .replace(/#([0-9a-fA-F]{6})\b/g, (whole, h) => {
      const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      const [R, G, B] = recolorRgb(r, g, b);
      return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
    })
    .replace(/#([0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g, (whole, h) => {
      const [r, g, b] = [...h].map(c => parseInt(c + c, 16));
      const [R, G, B] = recolorRgb(r, g, b);
      return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
    })
    .replace(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(\s*(?:[,/][^)]*)?)\)/g, (whole, r, g, b, rest) => {
      const [R, G, B] = recolorRgb(+r, +g, +b);
      return whole.startsWith('rgba') ? `rgba(${R},${G},${B}${rest})` : `rgb(${R} ${G} ${B}${rest})`;
    });
}

// ── Интерфейс ─────────────────────────────────────────────────────────
// Отдельная страница /tp/ (фрейм внутри модуля 04). API — под /tp, вход —
// токен Сферы через тот же протокол platform-auth, что и у платформы.
function web() {
  const from = join(src, 'apps', 'web');
  const to = join('apps', 'tp-web');
  // Очищаем содержимое (саму папку может держать открытой редактор или оболочка).
  if (existsSync(join(to, 'src'))) for (const f of readdirSync(join(to, 'src'))) rmSync(join(to, 'src', f), { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(join(from, 'src'), join(to, 'src'), { recursive: true });
  for (const f of readdirSync(join(to, 'src')).filter(f => /\.(tsx?|css)$/.test(f))) {
    const p = join(to, 'src', f);
    let s = read(p);
    if (/\.(tsx?)$/.test(f)) {
      s = s.replace(/(['"`])\/api\/v1\//g, '$1/tp/api/v1/').replace(/(['"`])\/auth\//g, '$1/tp/auth/');
    }
    writeFileSync(p, recolor(s));
  }
  // Родитель — сама Сфера (тот же сайт), а не платформа.
  const appPath = join(to, 'src', 'App.tsx');
  const app = read(appPath);
  const marker = 'const platformOrigin=env.VITE_PLATFORM_ORIGIN;';
  if (!app.includes(marker)) throw new Error('App.tsx: не найден приём токена от платформы');
  writeFileSync(appPath, app.replace(marker, 'const platformOrigin=location.origin;'));
  let html = read(join(from, 'index.html'));
  if (!html.includes('</head>')) throw new Error('index.html без </head>');
  html = html.replace('</head>', '<link rel="stylesheet" href="/tp-theme.css">\n</head>');
  if (!html.includes('</body>')) throw new Error('index.html без </body>');
  html = html.replace('</body>', '<script src="/es-tp-bridge.js"></script></body>');
  writeFileSync(join(to, 'index.html'), html);
  console.log(`интерфейс → ${to}`);
}

// ── Сквозные сценарии TP (прогоняются на сервере Сферы: tests/tp-route.test.ts) ──
const TESTS = ['riru-review.integration.ts', 'zip.ts'];
function tests() {
  const to = join('tests', 'tp');
  mkdirSync(to, { recursive: true });
  for (const f of TESTS) {
    let s = tsToTp(read(join(src, 'tests', f)), f).replace(/(['"`])\/api\/v1\//g, '$1/tp/api/v1/');
    writeFileSync(join(to, f), `// Импортировано из TP_Approval (scripts/import-tp.mjs). Не править вручную.\n` + s);
  }
  console.log(`сценарии: ${TESTS.length} → ${to}`);
}

if (what === 'tests' || what === 'all') tests();
if (what === 'migrations' || what === 'all') migrations();
if (what === 'api' || what === 'all') api();
if (what === 'web' || what === 'all') web();
