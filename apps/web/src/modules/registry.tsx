import type { ReactNode } from 'react';
import type { ModuleId, Permission } from '../../../api/src/core/access.js';
import {
  IconBars, IconCheckCircle, IconCpu, IconPie, IconScale, IconSliders, IconBook, IconCalendar, IconCamera, IconClock, IconDocCheck, IconFolder,
  IconInbox, IconLayers, IconList, IconNetwork, IconPlus, IconSearch, IconShield, IconTarget,
  IconUpload, IconUser, IconUsers, IconWrench,
} from '../ui/icons.js';

export interface MenuItem {
  id: string;
  title: string;
  icon: ReactNode;
  // Пункт виден только при этом праве (кроме права на сам раздел).
  perm?: Permission;
  // Что будет в разделе — показывается, пока раздел в разработке.
  about: string;
}

export interface ModuleMeta {
  id: ModuleId;
  num: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  image: string;
  // Цвета берутся с колонок дашборда и лепестков логотипа.
  tint: string;      // фон колонки и меню модуля
  accent: string;    // заливка основной кнопки
  strong: string;    // текст/обводка акцента
  view: Permission;
  menu: MenuItem[];
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'analysis', num: '01', title: 'Анализ потребления', subtitle: 'Балансы, динамика и отклонения',
    icon: <IconBars />, image: '/img/analysis.png', tint: '#b6d1c8', accent: '#9fcab6', strong: '#2f6f58', view: 'analysis.view',
    // Пункты = вкладки анализатора (id совпадают с data-tab в public/analysis).
    menu: [
      { id: 'rank', title: 'Рейтинг риска', icon: <IconBars />, about: 'Приборы учёта по риску недоучёта: признаки, график и оценка объёма.' },
      { id: 'bal', title: 'Баланс ТП', icon: <IconScale />, about: 'Отпуск в сеть, полезный отпуск, нормативные и сверхнормативные потери.' },
      { id: 'check', title: 'Контроль выборки', icon: <IconCheckCircle />, about: 'Сверка результатов проверок с рейтингом.' },
      { id: 'context', title: 'Состав ТП', icon: <IconPie />, about: 'Доли физ. и юр. лиц, пресеты анализа по ТП.' },
      { id: 'settings', title: 'Настройки', icon: <IconSliders />, about: 'Пресеты, чувствительность алгоритмов и приоритеты проверки.' },
      { id: 'algs', title: 'Алгоритмы', icon: <IconCpu />, about: 'Какие признаки сработали и сколько раз.' },
      { id: 'doc', title: 'Методика', icon: <IconList />, about: 'Порядок работы: от кабинетного анализа до оформления акта.' },
    ],
  },
  {
    id: 'consumers', num: '02', title: 'Поиск потребителя', subtitle: 'Карточка потребителя\nМонтёр ↔ инженер реализации',
    icon: <IconUser />, image: '/img/consumers.png', tint: '#b5c4dc', accent: '#a3b8d8', strong: '#34548a', view: 'consumers.view',
    menu: [
      { id: 'search', title: 'Поиск', icon: <IconSearch />, about: 'Поиск по номеру ПУ или лицевому счёту — карточка потребителя.' },
      { id: 'field', title: 'Мои выезды', icon: <IconCamera />, perm: 'consumers.field', about: 'Фото, ПСУ и геоточка по карточке — уходят инженеру своего РЭС.' },
      { id: 'inbox', title: 'Входящие от монтёров', icon: <IconInbox />, perm: 'consumers.complete', about: 'Новые фото, ПСУ и геоточки: скачать и отметить «Выполнено».' },
      { id: 'registry', title: 'Реестр РЭС', icon: <IconUpload />, perm: 'consumers.registry', about: 'Загрузка расширенного списка потребителей своего РЭС.' },
    ],
  },
  {
    id: 'riru', num: '03', title: 'Инструкция начальника РИРУ', subtitle: 'Порядок работы\nи необходимые действия',
    icon: <IconBook />, image: '/img/riru.png', tint: '#e4ccaa', accent: '#e2c391', strong: '#8a5a12', view: 'riru.view',
    menu: [
      { id: 'strategic', title: 'Стратегический план', icon: <IconTarget />, about: 'Годовой план: ключевые направления работы РИРУ и задачи по ним.' },
      { id: 'tactical', title: 'Тактический план', icon: <IconLayers />, about: 'Ежемесячный план работ по направлениям: сроки и нормативная основа.' },
      { id: 'operational', title: 'Оперативный план', icon: <IconCalendar />, about: 'Ежедневная последовательность действий: утро, день, вечер.' },
      { id: 'technology', title: 'Технология работ', icon: <IconWrench />, about: 'Технологические карты по установке, замене и проверке приборов учёта.' },
      { id: 'docs', title: 'Нормативные документы', icon: <IconFolder />, about: 'Регламенты, законы и постановления в PDF.' },
    ],
  },
  {
    id: 'tp', num: '04', title: 'Акты ТП', subtitle: 'Подготовка\nи согласование',
    icon: <IconDocCheck />, image: '/img/tp.png', tint: '#c4b9d7', accent: '#bba9d6', strong: '#5e4387', view: 'tp.view',
    menu: [
      // Перенос TP_Approval (проверка и согласование актов) + новое: создание акта по ТУ.
      { id: 'registry', title: 'Реестр актов', icon: <IconList />, about: 'Все договоры ТП: акты, АВТУ и уведомления с текущим этапом согласования.' },
      { id: 'approval', title: 'На согласовании', icon: <IconClock />, perm: 'tp.approve', about: 'Документы, ожидающие вашего решения: сверка с ТУ, замечания, согласование.' },
      { id: 'upload', title: 'Загрузка на проверку', icon: <IconUpload />, perm: 'tp.create', about: 'ТУ и акт ТП (АВТУ, уведомление) в PDF — сверка с ТУ и проверки акта до отправки.' },
      { id: 'create', title: 'Создание акта по ТУ', icon: <IconPlus />, perm: 'tp.create', about: 'Черновик акта ТП по данным технических условий — в разработке.' },
      { id: 'books', title: 'Справочники', icon: <IconBook />, about: 'Номиналы ВА и ТТ, сечения ВЛ и КЛ, tg φ, доверенности.' },
    ],
  },
];

export const ADMIN_MENU: MenuItem[] = [
  { id: 'users', title: 'Пользователи', icon: <IconUsers />, perm: 'admin.users', about: '' },
  { id: 'roles', title: 'Права ролей', icon: <IconShield />, perm: 'admin.permissions', about: '' },
  { id: 'res', title: 'Список РЭС', icon: <IconNetwork />, perm: 'admin.users', about: '' },
];

export const moduleById = (id: string) => MODULES.find(m => m.id === id);
