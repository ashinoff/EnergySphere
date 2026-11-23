// Расчёт потерь электроэнергии в линии — как лист «Потери» в «Список — ТП.xlsx».
// ΔW = W² / (U² · T · cos²φ) · Rл · Кл · Кк · Кф² · 0,001,  Rл = ρ · L / S,
// W = Pм · Тс · Д (реактивная составляющая 0), T = 24 · Д.

export type LossesInput = {
  powerKw: number;            // максимальная мощность Рм
  lengthM: number;            // протяжённость линии Lл
  sectionMm2: number;         // сечение фазной жилы S
  material: 'Al' | 'Cu';      // ρ: алюминий 0,029, медь 0,0185 мкОм·м
  voltageKv?: number;         // 0,4
  cosPhi?: number;            // 0,94
  formFactor?: number;        // Кф 1,15
  hoursPerDay?: number;       // Тс 24
  year?: number;              // для дней февраля
};
export type LossesMonth = { month: number; days: number; energyKwh: number; lossesKwh: number; percent: number };
export type LossesResult = { months: LossesMonth[]; yearKwh: number; yearPercent: number; monthAvgKwh: number; resistanceOhm: number };

export const RESISTIVITY = { Al: 0.029, Cu: 0.0185 } as const;

/** Материал жил по марке кабеля: АВВГ, АПвБбШп, СИП — алюминий; ВВГ, КГ — медь. */
export const cableMaterial = (brand: string): 'Al' | 'Cu' => /^\s*(а|сип)/i.test(brand) ? 'Al' : 'Cu';
/** Сечение фазной жилы из записи «4х120», «4×16», «3х95+1х50». */
export function cableSection(spec: string): number | null {
  const m = /\d+\s*[хx×*]\s*(\d+(?:[.,]\d+)?)/i.exec(spec);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function lineLosses(p: LossesInput): LossesResult {
  const U = p.voltageKv ?? 0.4, cos = p.cosPhi ?? 0.94, kf = p.formFactor ?? 1.15, tc = p.hoursPerDay ?? 24;
  const year = p.year ?? new Date().getFullYear();
  const R = RESISTIVITY[p.material] * p.lengthM / p.sectionMm2;
  const months: LossesMonth[] = [];
  for (let m = 0; m < 12; m++) {
    const days = new Date(year, m + 1, 0).getDate();
    const energy = p.powerKw * tc * days;
    const hours = 24 * days;
    const losses = energy ** 2 / (U ** 2 * hours * cos ** 2) * R * kf ** 2 * 0.001;
    months.push({ month: m + 1, days, energyKwh: energy, lossesKwh: losses, percent: energy ? losses / energy * 100 : 0 });
  }
  const yearKwh = months.reduce((a, x) => a + x.lossesKwh, 0);
  const energy = months.reduce((a, x) => a + x.energyKwh, 0);
  return { months, yearKwh, yearPercent: energy ? yearKwh / energy * 100 : 0, monthAvgKwh: yearKwh / 12, resistanceOhm: R };
}
