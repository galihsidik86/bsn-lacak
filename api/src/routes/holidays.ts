import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listHolidaysForYear, getAvailableHolidayYears, getHolidayOn, isWorkingDay,
} from '../lib/holidays.js';

const router = Router();
router.use(requireAuth);

// All available holiday calendars + current year's list. Cheap enough to
// return everything in one call since the table is < 100 entries total.
router.get('/', (req, res) => {
  const yearParam = Number.parseInt(String(req.query.year ?? ''), 10);
  const year = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear();
  res.json({
    year,
    availableYears: getAvailableHolidayYears(),
    holidays: listHolidaysForYear(year),
  });
});

// Lookup helper — drives the Mobile "today is a holiday" indicator without
// shipping the full calendar to the device.
router.get('/today', (_req, res) => {
  const now = new Date();
  const h = getHolidayOn(now);
  res.json({
    date: now.toISOString().slice(0, 10),
    isWorkingDay: isWorkingDay(now),
    holiday: h,
  });
});

export default router;
