import { describe, expect, it } from 'vitest';
import { computeCoverage } from './compute-coverage';
import { packShifts } from './pack-shifts';
import { runEngine } from './run-engine';
import { operatingHours } from './operating-hours';
import type { LaborEngineSettings } from './types';

/** Golden-case settings: 8 AM .. 7 PM, 12 buckets. */
const GOLDEN_SETTINGS: LaborEngineSettings = {
  wage: 20,
  minCov: 1,
  maxCov: 6,
  inc: 1.0,
  minShift: 3,
  maxShift: 6,
  openHour: 8,
  closeHour: 19, // inclusive → 8..19 = 12 buckets
};

// 8A..7P sales curve from the brief.
const GOLDEN_S = [100, 150, 200, 250, 300, 350, 300, 250, 200, 150, 100, 50];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

describe('computeCoverage — C1 golden case', () => {
  const res = computeCoverage(GOLDEN_S, 600, GOLDEN_SETTINGS);

  it('reports 30 affordable hours (600 / 20)', () => {
    expect(res.affordableHrs).toBe(30);
    expect(res.status).toBe('OK');
  });

  it('produces the deterministic coverage curve', () => {
    // Computed by applying the C1 rule exactly (integer-unit largest-remainder
    // with the documented tie-breaks). The 12 baseline units + 18 distributed
    // units = 30, so the curve sums to 30 and costs exactly the fee (600).
    expect(res.cov).toEqual([2, 2, 3, 3, 3, 4, 3, 3, 2, 2, 2, 1]);
    expect(res.cov.reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('never costs more than the PT labor fee', () => {
    const cost = res.cov.reduce((a, b) => a + b, 0) * GOLDEN_SETTINGS.wage;
    expect(cost).toBeLessThanOrEqual(600);
  });

  it('keeps every hour within [min_cov, max_cov]', () => {
    for (const c of res.cov) {
      expect(c).toBeGreaterThanOrEqual(GOLDEN_SETTINGS.minCov);
      expect(c).toBeLessThanOrEqual(GOLDEN_SETTINGS.maxCov);
    }
  });
});

describe('packShifts — C2 golden case', () => {
  const res = computeCoverage(GOLDEN_S, 600, GOLDEN_SETTINGS);
  const shifts = packShifts(res.cov, GOLDEN_S, GOLDEN_SETTINGS);

  it('emits continuous shifts within [min_shift, max_shift]', () => {
    expect(shifts.length).toBeGreaterThan(0);
    for (const sh of shifts) {
      const len = sh.endHour - sh.startHour;
      expect(len).toBeGreaterThanOrEqual(GOLDEN_SETTINGS.minShift);
      expect(len).toBeLessThanOrEqual(GOLDEN_SETTINGS.maxShift);
    }
  });

  it('realizes coverage within one increment of the C1 target', () => {
    const O = operatingHours(GOLDEN_SETTINGS);
    const realized = O.map((h) =>
      shifts.reduce(
        (sum, sh) => sum + (h >= sh.startHour && h < sh.endHour ? 1 : 0),
        0,
      ),
    );
    for (let i = 0; i < O.length; i++) {
      expect(Math.abs(realized[i] - res.cov[i])).toBeLessThanOrEqual(
        GOLDEN_SETTINGS.inc,
      );
    }
    // The narrow peak (target 4 at 1 PM) is flattened to 3 — no real-length
    // shift fits a single-bucket layer — so realized sums to 29, costing 580.
    expect(realized.reduce((a, b) => a + b, 0)).toBe(29);
  });
});

describe('runEngine — acceptance invariants', () => {
  // A spread of realistic and adversarial inputs. Determinism + invariants must
  // hold for all of them.
  // `expectCorrelation` is true only in the normal budget regime, where there is
  // meaningful discretionary budget above the baseline and the curve does not
  // saturate at max_cov. Invariant #5 (Pearson >= 0.7) is mathematically vacuous
  // otherwise: a near-baseline budget pins the curve flat, and a saturating
  // budget caps every hour — in both, coverage has too little variance to track
  // sales. Those regimes are exercised here for the other six invariants.
  const cases: Array<{
    name: string;
    s: number[];
    fee: number;
    settings: LaborEngineSettings;
    expectCorrelation: boolean;
  }> = [
    {
      name: 'golden',
      s: GOLDEN_S,
      fee: 600,
      settings: GOLDEN_SETTINGS,
      expectCorrelation: true,
    },
    {
      name: 'bimodal cafe day (5A-10P)',
      s: [
        20, 80, 160, 220, 180, 140, 120, 110, 130, 200, 260, 240, 180, 120, 90,
        70, 50, 30,
      ],
      fee: 900,
      settings: { ...GOLDEN_SETTINGS, openHour: 5, closeHour: 22 },
      expectCorrelation: true,
    },
    {
      name: 'tight budget (near baseline, curve pinned flat)',
      s: GOLDEN_S,
      fee: 280,
      settings: GOLDEN_SETTINGS,
      expectCorrelation: false,
    },
    {
      name: 'generous budget saturates max_cov',
      s: GOLDEN_S,
      fee: 5000,
      settings: GOLDEN_SETTINGS,
      expectCorrelation: false,
    },
    {
      name: 'flat sales',
      s: new Array(12).fill(100),
      fee: 600,
      settings: GOLDEN_SETTINGS,
      expectCorrelation: false,
    },
  ];

  for (const tc of cases) {
    describe(tc.name, () => {
      const plan = runEngine(tc.s, tc.fee, tc.settings);
      const { wage, minCov, maxCov, minShift, maxShift } = tc.settings;

      it('status is OK (above baseline)', () => {
        expect(plan.status).toBe('OK');
      });

      it('#1 scheduled cost does not exceed the PT labor fee', () => {
        expect(plan.table.footer.totalPtCost).toBeLessThanOrEqual(tc.fee);
      });

      it('#2 every shift length is within [min_shift, max_shift]', () => {
        for (const sh of plan.shifts) {
          const len = sh.endHour - sh.startHour;
          expect(len).toBeGreaterThanOrEqual(minShift);
          expect(len).toBeLessThanOrEqual(maxShift);
        }
      });

      it('#3 per-hour shift cells equal coverage within one increment', () => {
        for (let i = 0; i < plan.table.hours.length; i++) {
          expect(
            Math.abs(plan.table.totalPerHour[i] - plan.coverage.cov[i]),
          ).toBeLessThanOrEqual(tc.settings.inc);
        }
      });

      it('#4 coverage stays within [min_cov, max_cov]', () => {
        for (const c of plan.coverage.cov) {
          expect(c).toBeGreaterThanOrEqual(minCov);
          expect(c).toBeLessThanOrEqual(maxCov);
        }
      });

      it('#5 coverage correlates with sales (Pearson >= 0.7)', () => {
        if (!tc.expectCorrelation) return; // see the comment on the case list
        expect(pearson(plan.coverage.cov, tc.s)).toBeGreaterThanOrEqual(0.7);
      });

      it('#6 store is never below min_cov while open', () => {
        for (const c of plan.coverage.cov) {
          expect(c).toBeGreaterThanOrEqual(minCov);
        }
        void maxCov;
        void wage;
      });

      it('#7 identical inputs produce an identical table', () => {
        const again = runEngine(tc.s, tc.fee, tc.settings);
        expect(again.table).toEqual(plan.table);
        expect(again.shifts).toEqual(plan.shifts);
        expect(again.coverage.cov).toEqual(plan.coverage.cov);
      });
    });
  }
});

describe('runEngine — edge cases', () => {
  it('marks OVER_BUDGET when the baseline cannot be afforded', () => {
    // baseline = 12 hrs * $20 = $240; fee below that.
    const plan = runEngine(GOLDEN_S, 100, GOLDEN_SETTINGS);
    expect(plan.status).toBe('OVER_BUDGET');
    // Baseline coverage is still emitted (store must be staffed).
    expect(plan.coverage.cov).toEqual(new Array(12).fill(1));
    expect(plan.coverage.overage).toBe(240 - 100);
  });

  it('falls back to uniform weights when there is no sales history', () => {
    const plan = runEngine(new Array(12).fill(0), 600, GOLDEN_SETTINGS);
    expect(plan.coverage.weightsFallback).toBe(true);
    expect(plan.status).toBe('OK');
    expect(plan.table.footer.totalPtCost).toBeLessThanOrEqual(600);
  });
});
