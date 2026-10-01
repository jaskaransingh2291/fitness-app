/* Taakat — all the body maths in one place, so it can be checked on its own.
   Works in the browser (window.TaakatCalc) and in Node tests (module.exports). */
(function (root) {
  'use strict';

  var ACTIVITY = {
    sedentary: { factor: 1.2,   label: 'Mostly sitting',  example: 'Desk job, little or no exercise' },
    light:     { factor: 1.375, label: 'Lightly active',  example: 'Workouts 1–3 times a week' },
    moderate:  { factor: 1.55,  label: 'Active',          example: 'Workouts 3–5 times a week' },
    very:      { factor: 1.725, label: 'Very active',     example: 'Hard workouts 6–7 times a week' },
    extreme:   { factor: 1.9,   label: 'Athlete level',   example: 'Twice a day, or a physical job plus training' }
  };
  var GOAL_ADJUST = { cut: -500, maintain: 0, bulk: 300 };
  var SAFE_FLOOR = { female: 1200, male: 1500 };
  var DB_MIN = 800, DB_MAX = 6000;               // what the database accepts
  var LIMITS = {
    age: [13, 100], height_cm: [100, 250], weight_kg: [30, 300],
    neck_cm: [20, 80], waist_cm: [40, 250], hip_cm: [50, 250], name: [1, 40]
  };

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function round10(x) { return Math.round(x / 10) * 10; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* Parse what a person typed into a number (accepts "72,5", spaces). Returns null if not a number. */
  function parseNumber(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function inRange(key, n) {
    var r = LIMITS[key];
    return isNum(n) && n >= r[0] && n <= r[1];
  }

  /* US Navy body-fat estimate (all in cm). Returns % with 1 decimal, or null if the measurements can't work. */
  function navyBodyFat(sex, heightCm, neckCm, waistCm, hipCm) {
    if (!isNum(heightCm) || !isNum(neckCm) || !isNum(waistCm)) return null;
    var bf;
    if (sex === 'male') {
      if (waistCm - neckCm <= 0) return null;
      bf = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
    } else if (sex === 'female') {
      if (!isNum(hipCm) || waistCm + hipCm - neckCm <= 0) return null;
      bf = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
    } else {
      return null;
    }
    if (!isFinite(bf) || bf < 2 || bf > 60) return null;   // outside believable range: measurements are probably off
    return round1(bf);
  }

  function bmi(weightKg, heightCm) {
    if (!isNum(weightKg) || !isNum(heightCm) || heightCm <= 0) return null;
    var m = heightCm / 100;
    var value = round1(weightKg / (m * m));
    var category = value < 18.5 ? 'Underweight' : value < 25 ? 'Healthy range' : value < 30 ? 'Overweight' : 'Obese range';
    return { value: value, category: category };
  }

  /* Everything the "Your numbers" screen shows. p = profile object. */
  function numbers(p) {
    var out = { ok: false, notes: [] };
    if (!p || (p.sex !== 'male' && p.sex !== 'female') || !inRange('age', p.age) || !inRange('height_cm', p.height_cm) ||
        !inRange('weight_kg', p.weight_kg) || !ACTIVITY[p.activity_level] || !(p.goal in GOAL_ADJUST)) {
      return out;
    }
    var bf = (p.neck_cm != null && p.waist_cm != null) ? navyBodyFat(p.sex, p.height_cm, p.neck_cm, p.waist_cm, p.hip_cm) : null;
    var bmr, formula;
    if (bf !== null) {
      var lean = p.weight_kg * (1 - bf / 100);
      bmr = 370 + 21.6 * lean;
      formula = 'Katch-McArdle (uses your body fat)';
    } else {
      bmr = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
      formula = 'Mifflin-St Jeor';
    }
    var maintenanceRaw = bmr * ACTIVITY[p.activity_level].factor;
    var maintenance = round10(maintenanceRaw);
    var target = maintenance + GOAL_ADJUST[p.goal];
    var floor = SAFE_FLOOR[p.sex];
    var belowFloor = false;
    if (target < floor) {
      belowFloor = true;
      out.notes.push(p.goal === 'cut'
        ? 'A full cut would drop below ' + floor.toLocaleString('en-CA') + ' kcal, the usual safe minimum, so your target is set to ' + floor.toLocaleString('en-CA') + '. Check with a doctor before eating less.'
        : 'Your target is below ' + floor.toLocaleString('en-CA') + ' kcal, the usual safe minimum, so it is set to ' + floor.toLocaleString('en-CA') + '. Check with a doctor.');
      target = floor;
    }
    var outOfRange = false;
    if (maintenance < DB_MIN || maintenance > DB_MAX || target > DB_MAX) {
      outOfRange = true;
      out.notes.push('These numbers are outside the range Taakat can plan for. Please check your details, or talk to a doctor or dietitian.');
    }
    out.ok = true;
    out.formula = formula;
    out.bmr = Math.round(bmr);
    out.maintenance = maintenance;
    out.target = target;
    out.difference = target - maintenance;              // negative = deficit, positive = surplus
    out.belowFloor = belowFloor;
    out.outOfRange = outOfRange;
    out.storeMaintenance = clamp(maintenance, DB_MIN, DB_MAX);   // always acceptable to the database
    out.storeTarget = clamp(target, DB_MIN, DB_MAX);
    out.protein = {
      min: Math.round(p.weight_kg * 0.8),
      rec: Math.round(p.weight_kg * 1.6),
      perfect: p.goal === 'cut' ? Math.round(p.weight_kg * 2.0) : null
    };
    out.bmi = bmi(p.weight_kg, p.height_cm);
    out.bodyFat = bf;
    return out;
  }

  function cmToFeetInches(cm) {
    if (!isNum(cm)) return '';
    var totalIn = Math.round(cm / 2.54);
    return Math.floor(totalIn / 12) + '′' + (totalIn % 12) + '″';
  }
  function kgToLb(kg) { return isNum(kg) ? Math.round(kg * 2.20462) : null; }

  /* Today's date on THIS device (Toronto time for you two), as YYYY-MM-DD. */
  function localDate(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* Calendar days as 'YYYY-MM-DD' text. Maths is done at noon UTC so clock changes (DST) can't skip or repeat a day. */
  function isoOk(iso) { return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso); }
  function isoToDate(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function dateToIso(d) {
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function addDays(iso, n) { var d = isoToDate(iso); d.setUTCDate(d.getUTCDate() + n); return dateToIso(d); }
  function daysBetween(a, b) { return Math.round((isoToDate(b) - isoToDate(a)) / 86400000); }   // b − a
  function dayName(iso, today) {
    var diff = daysBetween(iso, today || localDate());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    try { return isoToDate(iso).toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' }); } catch (e) { return iso; }
  }
  function longDate(iso) {
    try { return isoToDate(iso).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return iso; }
  }
  function shortDate(iso) {
    try { return isoToDate(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return iso; }
  }

  /* Past 7 days estimate.
     days: [{ date, eaten (kcal or null if nothing logged), maintenance, savedTarget (bool) }]
     Each logged day counts (eaten − maintenance). The total ÷ 7,700 kcal ≈ kg of body weight. */
  var KCAL_PER_KG = 7700, WEEK_MIN_DAYS = 3;
  function weekEstimate(days) {
    var logged = days.filter(function (d) { return d.eaten !== null && d.eaten !== undefined && d.maintenance > 0; });
    var total = 0;
    logged.forEach(function (d) { total += d.eaten - d.maintenance; });
    total = Math.round(total);
    var out = { loggedDays: logged.length, totalDiff: total, ready: logged.length >= WEEK_MIN_DAYS, kg: null, direction: null };
    if (!out.ready) return out;
    var kg = Math.round(Math.abs(total) / KCAL_PER_KG * 10) / 10;
    out.kg = kg;
    out.direction = kg === 0 ? 'same' : (total < 0 ? 'lost' : 'gained');
    return out;
  }

  var api = {
    ACTIVITY: ACTIVITY, GOAL_ADJUST: GOAL_ADJUST, SAFE_FLOOR: SAFE_FLOOR, LIMITS: LIMITS,
    parseNumber: parseNumber, inRange: inRange, navyBodyFat: navyBodyFat, bmi: bmi, numbers: numbers,
    cmToFeetInches: cmToFeetInches, kgToLb: kgToLb, localDate: localDate,
    isoOk: isoOk, addDays: addDays, daysBetween: daysBetween, dayName: dayName, longDate: longDate, shortDate: shortDate,
    weekEstimate: weekEstimate, KCAL_PER_KG: KCAL_PER_KG, WEEK_MIN_DAYS: WEEK_MIN_DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaakatCalc = api;
})(this);
