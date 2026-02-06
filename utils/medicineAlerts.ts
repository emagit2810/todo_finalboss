import { Medicine } from '../types';

const MS_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_REMAINING_DAYS = 30;
const REFILL_SOON_DAYS = 7;

export type MedicineAlertKind = 'refill-end' | 'refill-soon';

export interface MedicineAlert {
  id: string;
  medicineId: string;
  label: string;
  kind: MedicineAlertKind;
  scheduledAt: number;
}

const getRemainingDays = (med: Medicine, todayStart: number) => {
  const lastUpdated = med.lastUpdated ?? todayStart;
  const remaining = Number.isFinite(med.remaining) ? med.remaining : DEFAULT_REMAINING_DAYS;
  const daysPassed = Math.max(0, Math.floor((todayStart - lastUpdated) / MS_DAY));
  return Math.max(0, remaining - daysPassed);
};

export const getDateKeyFromTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const buildMedicineAlerts = (medicines: Medicine[], todayStart: number): MedicineAlert[] => {
  const alerts: MedicineAlert[] = [];

  medicines.forEach((med) => {
    if (!med.alarmEnabled) return;

    const remainingDays = getRemainingDays(med, todayStart);
    const endTs = todayStart + remainingDays * MS_DAY;

    alerts.push({
      id: `${med.id}-end-${endTs}`,
      medicineId: med.id,
      label: `${med.name} ends`,
      kind: 'refill-end',
      scheduledAt: endTs,
    });

    if (remainingDays >= REFILL_SOON_DAYS) {
      const soonTs = todayStart + (remainingDays - REFILL_SOON_DAYS) * MS_DAY;
      alerts.push({
        id: `${med.id}-soon-${soonTs}`,
        medicineId: med.id,
        label: `${med.name} refill soon`,
        kind: 'refill-soon',
        scheduledAt: soonTs,
      });
    }
  });

  return alerts;
};

export const groupMedicineAlertsByDate = (alerts: MedicineAlert[]) => {
  const map = new Map<string, MedicineAlert[]>();
  alerts.forEach((alert) => {
    const key = getDateKeyFromTimestamp(alert.scheduledAt);
    map.set(key, [...(map.get(key) || []), alert]);
  });
  return map;
};
