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
  'analysis.view':            { group: 'analysis',  title: 'Открывать раздел' },
  'analysis.upload':          { group: 'analysis',  title: 'Загружать файлы для анализа' },
  'analysis.reports':         { group: 'analysis',  title: 'Сохранять и выгружать отчёты' },
  'consumers.view':           { group: 'consumers', title: 'Открывать раздел и искать по № ПУ / ЛС' },
  'consumers.registry':       { group: 'consumers', title: 'Загружать расширенный реестр своего РЭС' },
  'consumers.field':          { group: 'consumers', title: 'Прикладывать фото, ПСУ и геоточку' },
  'consumers.complete':       { group: 'consumers', title: 'Скачивать вложения и отмечать «Выполнено»' },
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

// Стартовые права ролей — применяются один раз, когда матрица в базе пуста.
// Дальше всё правится в админке.
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: PERMISSION_IDS,
  nach_res: ['analysis.view', 'analysis.reports', 'consumers.view', 'consumers.complete', 'riru.view', 'tp.view', 'tp.approve'],
  nach_riru: ['analysis.view', 'analysis.upload', 'analysis.reports', 'consumers.view', 'consumers.registry', 'consumers.complete', 'riru.view', 'riru.edit'],
  eng_realization: ['analysis.view', 'analysis.upload', 'analysis.reports', 'consumers.view', 'consumers.registry', 'consumers.complete', 'riru.view'],
  eng_development: ['consumers.view', 'riru.view', 'tp.view', 'tp.create'],
  monter: ['consumers.view', 'consumers.field'],
  nach_sue: ['analysis.view', 'analysis.upload', 'analysis.reports', 'consumers.view', 'riru.view', 'riru.docs'],
  eng_sue: ['analysis.view', 'analysis.upload', 'analysis.reports', 'consumers.view', 'riru.view'],
  nach_stp: ['analysis.view', 'tp.view', 'tp.approve'],
  eng_stp: ['analysis.view', 'tp.view', 'tp.create'],
};

// Администратор всегда имеет все права — его строку в матрице не редактируют,
// чтобы нельзя было случайно отобрать у всех доступ к админке.
export const LOCKED_ROLE: Role = 'admin';
