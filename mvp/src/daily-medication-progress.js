import { dayKey } from './domain.js';
import { medicationSchedule } from './medications.js';

// Today's full schedule, including future times; not the due-only historical rate.
export function dailyMedicationProgress(entries, now = new Date()) {
  const rows = medicationSchedule(entries, dayKey(now));
  const total = rows.length;
  const taken = rows.filter(row => row.status === 'taken').length;
  const skipped = rows.filter(row => row.status === 'skipped').length;
  return { total, taken, skipped, unmarked: total - taken - skipped,
    fraction: total ? taken / total : 0, complete: total > 0 && taken === total };
}
