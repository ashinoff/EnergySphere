import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findTemplate, type ActTemplate } from './catalog.js';
import { actValues, type ActInput } from './fields.js';
import { fillTemplate } from './merge.js';
import { cableMaterial, cableSection, lineLosses, type LossesInput } from './losses.js';
import { insertLosses } from './losses-doc.js';
import { signerPhrase, signerSignature, type Attorney } from './signer.js';
import { HttpError } from '../core/db.js';

// Сборка акта / уведомления: шаблон + значения + подписант + лист расчёта потерь.

export const TEMPLATES_PATH = resolve(process.env.ACT_TEMPLATES_PATH ?? 'assets/act-templates');

export type RenderRequest = {
  templateId: string;
  input: ActInput;
  attorney?: Attorney | null;
  /** Параметры расчёта потерь (для шаблонов с приложением); по умолчанию — из кабеля и мощности анкеты */
  losses?: Partial<LossesInput> | null;
  author?: string;
};

/** Параметры расчёта потерь из анкеты; null — данных не хватает. */
export function lossesInput(input: ActInput, override?: Partial<LossesInput> | null): LossesInput | null {
  const section = override?.sectionMm2 ?? (input.cableSection ? cableSection(input.cableSection) ?? Number(input.cableSection.replace(',', '.')) : NaN);
  const material = override?.material ?? (input.cableBrand ? cableMaterial(input.cableBrand) : undefined);
  const p: Partial<LossesInput> = { ...override, powerKw: override?.powerKw ?? input.powerAllowedKw, lengthM: override?.lengthM ?? input.cableLengthM, sectionMm2: section, material };
  if (!(p.powerKw! > 0) || !(p.lengthM! > 0) || !(p.sectionMm2! > 0) || !p.material) return null;
  return { year: Number(input.actDate?.slice(0, 4)) || new Date().getFullYear(), ...p } as LossesInput;
}

/** Точка присоединения для листа потерь: «Иванов И.И. от РУ-0,4 кВ ТП-205». */
const pointName = (t: ActTemplate, a: ActInput) => {
  const from = t.point === 'ru' ? 'от РУ-0,4 кВ' : t.point === 'vu' ? 'от ВУ-0,4 кВ' : 'от опоры ВЛ-0,4 кВ';
  return [a.applicantFullName, from, a.tp ? `ТП-${a.tp.replace(/^ТП-?/i, '')}` : ''].filter(Boolean).join(' ');
};

export async function renderAct(req: RenderRequest): Promise<{ docx: Buffer; template: ActTemplate; missing: string[]; lossesIncluded: boolean }> {
  const template = findTemplate(req.templateId);
  if (!template) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден.');
  const values = actValues(req.input);
  if (req.attorney) { values.Подписант = signerPhrase(req.attorney); values.Подписант_подпись = signerSignature(req.attorney); }
  for (const k of ['Подписант', 'Подписант_подпись'] as const) if (req.input.overrides?.[k]) values[k] = req.input.overrides[k];
  const filled = await fillTemplate(await readFile(resolve(TEMPLATES_PATH, template.file)), values);
  const lossesParams = template.losses ? lossesInput(req.input, req.losses) : null;
  const docx = await insertLosses(filled.docx, lossesParams ? {
    point: pointName(template, req.input), input: lossesParams, result: lineLosses(lossesParams),
    cable: [req.input.cableBrand, req.input.cableSection].filter(Boolean).join(' '), author: req.author,
  } : null);
  return { docx, template, missing: filled.missing, lossesIncluded: !!lossesParams };
}
