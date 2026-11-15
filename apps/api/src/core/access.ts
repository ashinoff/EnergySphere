// Каталог ролей и прав ЭнергоСферы — ЕДИНСТВЕННЫЙ источник и для сервера,
// и для интерфейса (web импортирует этот файл напрямую, поэтому здесь нет
// зависимостей от Node).
//
// Роль задаёт ОБЛАСТЬ видимости (свой РЭС или все РЭС), права — разрешённые
// ДЕЙСТВИЯ. Права роли настраиваются в админке (матрица «роль × право»),
// поверх них конкретному человеку можно выдать дополнительные права.
// Новое право: ключ сюда → requirePermission('ключ') на роут → can('ключ') в UI.

export type Scope = 'all' | 'res';

export const ROLES = {
  admin:           { title: 'Администратор',       scope: 'all' },
  nach_res:        { title: 'Начальник РЭС',        scope: 'res' },
  nach_riru:       { title: 'Начальник РИРУ',       scope: 'res' },
  eng_realization: { title: 'Инженер реализации',   scope: 'res' },
  eng_development: { title: 'Инженер развития',     scope: 'res' },
  monter:          { title: 'Монтёр',               scope: 'res' },
  nach_sue:        { title: 'Начальник СУЭ',        scope: 'all' },
  eng_sue:         { title: 'Инженер СУЭ',          scope: 'all' },
  nach_stp:        { title: 'Начальник СТП',        scope: 'all' },
  eng_stp:         { title: 'Инженер СТП',          scope: 'all' },
  // ТЕХБЛОК (в маршруте актов ТП): Главный инженер, СРС, ПТС.
  glav_ing:        { title: 'Главный инженер',      scope: 'all' },
  nach_srs:        { title: 'Начальник СРС',        scope: 'all' },
  eng_srs:         { title: 'Инженер СРС',          scope: 'all' },
  nach_pts:        { title: 'Начальник ПТС',        scope: 'all' },
  eng_pts:         { title: 'Инженер ПТС',          scope: 'all' },
} as const satisfies Record<string, { title: string; scope: Scope }>;

export type Role = keyof typeof ROLES;
export const ROLE_IDS = Object.keys(ROLES) as Role[];
export const isRole = (value: unknown): value is Role => typeof value === 'string' && value in ROLES;

export type ModuleId = 'analysis' | 'consumers' | 'riru' | 'tp';
export type PermissionGroup = ModuleId | 'admin';

export const PERMISSION_GROUPS: Record<PermissionGroup, string> = {
  analysis: 'Анализ потребления',
  consumers: 'Поиск потребителя',
  riru: 'Инструкция начальника РИРУ',
  tp: 'Акты ТП',
  admin: 'Администрирование',
};

export const PERMISSIONS = {
  // Анализ идёт целиком в браузере и ничего не хранит на сервере — других прав
  // у раздела нет: проверить их было бы нечем.
  'analysis.view':            { group: 'analysis',  title: 'Открывать раздел (анализ идёт в браузере, данные не сохраняются)' },
  'consumers.view':           { group: 'consumers', title: 'Открывать раздел и искать по № ПУ / ЛС' },
  'consumers.registry':       { group: 'consumers', title: 'Обновлять реестр потребителей своего РЭС' },
  'consumers.field':          { group: 'consumers', title: 'Ставить геометку, прикладывать фото объекта и ПСУ' },
  'consumers.inbox':          { group: 'consumers', title: 'Видеть отметки монтёров, скачивать фото и ПСУ' },
  'consumers.complete':       { group: 'consumers', title: 'Завершать отметки монтёров' },
  'riru.view':                { group: 'riru',      title: 'Открывать раздел' },
  'riru.edit':                { group: 'riru',      title: 'Редактировать планы и технологию работ' },
  'riru.docs':                { group: 'riru',      title: 'Загружать нормативные документы' },
  'tp.view':                  { group: 'tp',        title: 'Открывать раздел' },
  'tp.create':                { group: 'tp',        title: 'Готовить акты ТП' },
  'tp.approve':               { group: 'tp',        title: 'Согласовывать акты ТП' },
  'admin.users':              { group: 'admin',     title: 'Управлять пользователями и списком РЭС' },
  'admin.permissions':        { group: 'admin',     title: 'Настраивать права ролей' },
} as const satisfies Record<string, { group: PermissionGroup; title: string }>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_IDS = Object.keys(PERMISSIONS) as Permission[];
export const isPermission = (value: unknown): value is Permission => typeof value === 'string' && value in PERMISSIONS;

// Стартовые права ролей — применяются один раз на роль (core.seeded_roles),
// в том числе для ролей, добавленных позже. Дальше всё правится в админке.
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: PERMISSION_IDS,
  nach_res: ['analysis.view', 'consumers.view', 'riru.view', 'tp.view', 'tp.approve'],
  // Поиск потребителя: монтёр отмечает на месте, инженер РИРУ (= инженер
  // реализации) обновляет реестр своего РЭС и завершает отметки, начальник
  // РИРУ и СУЭ — смотрят.
  nach_riru: ['analysis.view', 'consumers.view', 'consumers.inbox', 'riru.view', 'riru.edit', 'tp.view', 'tp.approve'],
  eng_realization: ['analysis.view', 'consumers.view', 'consumers.registry', 'consumers.inbox', 'consumers.complete', 'riru.view', 'tp.view', 'tp.create'],
  eng_development: ['consumers.view', 'riru.view', 'tp.view', 'tp.create'],
  monter: ['consumers.view', 'consumers.field'],
  nach_sue: ['analysis.view', 'consumers.view', 'consumers.inbox', 'riru.view', 'riru.docs', 'tp.view', 'tp.approve'],
  eng_sue: ['analysis.view', 'consumers.view', 'consumers.inbox', 'riru.view', 'tp.view'],
  nach_stp: ['analysis.view', 'tp.view', 'tp.approve'],
  eng_stp: ['analysis.view', 'tp.view', 'tp.create'],
  glav_ing: ['analysis.view', 'tp.view', 'tp.approve'],
  nach_srs: ['tp.view', 'tp.approve'],
  eng_srs: ['tp.view'],
  nach_pts: ['tp.view', 'tp.approve'],
  eng_pts: ['tp.view'],
};

// Администратор всегда имеет все права — его строку в матрице не редактируют,
// чтобы нельзя было случайно отобрать у всех доступ к админке.
export const LOCKED_ROLE: Role = 'admin';
