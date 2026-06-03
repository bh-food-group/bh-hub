# 포스트모템: Revenue 카드 8초 스켈레톤 — 이벤트 루프 블로킹

> 2026-06-03 · 대시보드 month-nav 시 Revenue/Cost 카드가 8~15초간 스켈레톤.
> 근본 원인은 DB도 인프라도 아닌 **`Intl.DateTimeFormat` 생성 폭발에 의한 동기 이벤트 루프 블로킹**이었다.
> 이 문서는 *결론*보다 **진단 과정(틀린 가설 4개를 어떻게 배제했는가)** 에 무게를 둔다 — 같은 함정을 다시 밟지 않기 위해.

관련: [dashboard-performance-optimization.md](./dashboard-performance-optimization.md) (선행 작업). 그 문서 §6에서 `getRevenueTargetSnapshot`에 추가했던 `unstable_cache`는 **이 버그를 가리고 있었을 뿐**이며, 본 작업에서 제거되었다(아래 참조).

---

## TL;DR

| | |
|---|---|
| **증상** | month-nav 시 Revenue/Cost 카드 8~15초 스켈레톤. `revenueSnapshot=8057ms` |
| **근본 원인** | `buildYearDailyGoals`가 3년 ×365일을 돌며 날짜당 `new Intl.DateTimeFormat`을 ~40개 생성 → **~44,000개 생성 = ~7초 동기 CPU 블로킹** |
| **결정적 증거** | `[event-loop-lag] blocked ~7394ms`가 `revenueSnapshot=8057ms`와 정확히 일치 + 동시에 `pool idle:4 waiting:0` |
| **수정** | `Intl.DateTimeFormat`을 timeZone별로 캐시 + bucket-key를 isoDate별로 메모이즈 |
| **결과** | 8057ms → 첫 cold 2084ms(인스턴스당 1회) → 이후 **137ms**. 전체 nav 4초 이내 |

---

## Situation (증상)

선행 성능 작업 이후에도, **다음 달(미처리 월)로 이동**하면 Revenue/Cost 카드가 8초 이상 스켈레톤으로 멈췄다. 프로덕션 로그의 전형적 패턴:

```
[location-cards] budget-db=137ms          ← 빠름
[location-cards] laborTarget=63ms         ← 빠름
[location-cards] savedRefMonths=74ms      ← 빠름
[location-cards] revenueSnapshot=8057ms   ← 혼자만 8초
```

같은 `Promise.all` 안에서 다른 DB 조회는 전부 수십 ms인데 `revenueSnapshot`만 8초. `revenueSnapshot`은 phase-1(`fetchBaseData`)에 있고, phase-1이 phase-2(Revenue/Cost QB 렌더)를 게이트하므로 카드 전체가 묶였다.

---

## 진단 여정 — 틀린 가설 4개

> 교훈: "특정 쿼리만 느리다"는 신호는 직관적으로 DB/캐시/커넥션을 가리키지만, **전부 틀렸다.** 각 가설을 데이터로 반증하기 전까지 3~4번 잘못된 수정을 배포했다.

### ❌ 가설 1 — Vercel Data Cache(`unstable_cache`) tail latency

`revenueSnapshot`과 `laborTarget`은 `unstable_cache`를 거쳤고, 직접 Postgres를 치는 `savedRefMonths`는 빨랐다. → "L2(Data Cache)가 느리다"고 판단, `unstable_cache` 제거.

**반증**: 제거 후에도 `revenueSnapshot`은 여전히 8초. (단, `laborTarget`은 직접 PG로 바뀌며 빨라짐 — 이건 우연히 맞은 부분.)

### ❌ 가설 2 — Postgres / PgBouncer 커넥션 풀 고갈

L2 제거 후 `prisma:error Connection terminated due to connection timeout`가 등장. → "월 nav burst가 풀을 고갈시킨다"고 판단.

**반증**: `pg_stat_activity = 20` (Supavisor pool 15 + 내부, 한참 여유). 풀은 고갈되지 않았다.

### ❌ 가설 3 — 커넥션 establish 지연 (네트워크/IPv6)

`revenueSnapshot`이 새 커넥션을 establish할 때만 느린 듯 보였고, "dedicated pooler는 IPv6 기본" 문구가 의심을 키웠다. → "Vercel(IPv4) → IPv6 풀러 establish가 hang한다"고 판단.

**반증 (두 갈래)**:
- `dig AAAA aws-1-us-west-1.pooler.supabase.com` → **AAAA 레코드 없음** (IPv4 전용). IPv6 불가능.
- **격리 진단 엔드포인트**(`new Pool({max:1})`로 establish만 측정)를 5회 실행 → **매번 ~245ms, 동시 4개도 동일.** 풀러 establish는 완벽히 건강.

### ❌ 가설 4 — 커넥션 fan-out / 동시 establish

`revenueSnapshot` 내부가 `Promise.all([annualGoal, resolveRow])`로 커넥션 2~3개를 동시 요구 → "동시 establish가 방아쇠"라 판단, 순차로 변경.

**반증**: 순차로 바꿔도 `revenueSnapshot=8581ms` 그대로. 그리고 같은 로그에서 establish 직후 phase-2 쿼리는 37ms로 빨랐다 — establish 자체는 문제가 아니었다.

> **공통 교훈**: 위 4개 모두 "DB/커넥션/인프라" 프레임에 갇혀 있었다. 격리 측정이 인프라를 명확히 배제한 뒤에야 *인스턴스 내부(CPU)* 로 시야가 옮겨졌다.

---

## 결정적 진단 — 두 개의 프로브

추측을 끝내기 위해 **계측을 분리**했다.

### 1. 격리 커넥션 테스트 (`/api/diag/db-connect`, 임시)

대시보드 로직과 무관한 엔드포인트가 `new Pool({max:1})`로 순수 establish 시간만 측정.

```
sequential[].connectMs : 245, 245, 244    ← 한 번에 하나씩
concurrent[].connectMs : 244, 250, 249, 245 ← 4개 동시
dnsMs                  : 0~5
```

→ **인프라/풀러/DNS 전부 건강.** 8초는 네트워크가 아니다. (단, 이 테스트는 *격리 상태*라 burst를 재현하지 못한다 → 다음 프로브 필요.)

### 2. 이벤트 루프 지연 샘플러 (`instrumentation.ts`, 임시)

```ts
let last = Date.now();
setInterval(() => {
  const drift = Date.now() - last - 1000;
  if (drift > 400) console.log(`[event-loop-lag] blocked ~${drift}ms ...`);
  last = Date.now();
}, 1000).unref();
```

프로덕션 로그(스모킹 건):

```
revenueSnapshot=8057ms pool={"total":4,"idle":4,"waiting":0}   ← 풀 놀고 있음
[event-loop-lag] blocked ~7394ms                               ← 루프가 7.4초 막힘
```

- **`pool idle:4, waiting:0`** → 커넥션 4개 유휴, 대기 0. **풀/DB 무관 확정.**
- **`blocked ~7394ms`가 8초와 정확히 일치** → **동기 CPU가 이벤트 루프를 막았다.** 245ms면 끝날 establish가 8초가 된 이유 = 그 동안 루프가 막혀 콜백이 못 돌았던 것.

> 이 프레임이 그동안의 모든 미스터리를 설명한다 — 초기 로그에서 `labor`와 `snapshot`이 5ms 차로 같이 7초였던 것도, 둘 다 막힌 루프가 풀리는 같은 순간에 콜백이 발화한 것이었다(공유 DB 자원이 아니라).

---

## Root Cause (근본 원인)

`revenueBucketKeyForIsoDate(isoDate)` 한 번이 **약 40개의 `new Intl.DateTimeFormat`** 을 생성한다:

```
revenueBucketKeyForIsoDate
├─ zonedWeekdaySun0ForIsoDate   → 48시간 스캔 루프, 매 반복 zonedCalendarDay()가 Intl 생성  (~8개)
└─ isBcPublicHoliday → zonedNoonInstantMs → 48+24 스캔 루프, 매 반복 Intl 생성            (~32개)
```

`getRevenueTargetSnapshot`의 `buildYearDailyGoals`가 이를 **3년 × 365일 ≈ 1095회** 호출:

```
1,095 dates × ~40 Intl/date ≈ 44,000개 new Intl.DateTimeFormat 생성
```

`new Intl.DateTimeFormat(...)` 생성은 ~0.1–0.5ms로 악명 높게 느리다(`.format()`은 쌈). **44,000 × ~0.15ms ≈ 7초**가 한 콜스택에서 동기로 실행되어 이벤트 루프를 막았다.

`unstable_cache`(선행 작업 §6)는 *계산 결과*(`dailyTargetsByDate`)를 캐시했기 때문에 **warm 월에는 이 7초를 건너뛰게** 해줬다 — 즉 버그를 **가리고** 있었다. month-nav로 cold 월에 진입할 때만(cache miss) 7초가 드러났다.

```ts
// lib/clover/report-timezone.ts (수정 전) — 호출마다 생성
export function zonedCalendarDay(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })
    .format(new Date(utcMs));   // ← 48회 루프 안에서 매번 new
}
```

---

## Fix (수정)

핵심: **생성은 비싸고 `.format()`은 싸다.** 포맷터를 timeZone별로 한 번만 만들어 재사용 + 순수 함수 메모이즈.

### 1. `lib/clover/report-timezone.ts` — 포맷터 캐시

```ts
const _calDayFmt = new Map<string, Intl.DateTimeFormat>();
function calDayFmt(timeZone: string): Intl.DateTimeFormat {
  let f = _calDayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' });
    _calDayFmt.set(timeZone, f);
  }
  return f;
}
export function zonedCalendarDay(utcMs: number, timeZone: string): string {
  return calDayFmt(timeZone).format(new Date(utcMs));  // 재사용
}
// hourFmt / weekdayFmt 도 동일 패턴. 모든 new Intl.DateTimeFormat 호출을 캐시 게터로 교체.
```

→ 48회 루프가 *생성* 48회가 아니라 *`.format()`* 48회로 바뀜(수 µs).

### 2. `revenue-target-bucket-key.ts` — isoDate별 메모이즈

```ts
const _keyCache = new Map<string, string>();
export function revenueBucketKeyForIsoDate(isoDate: string): string {
  const cached = _keyCache.get(isoDate);
  if (cached !== undefined) return cached;          // 두 번째부터 O(1)
  const tz = getCloverReportTimeZone();
  const key = `${isBcPublicHoliday(isoDate) ? 'H' : 'N'}-${zonedWeekdaySun0ForIsoDate(isoDate, tz)}`;
  _keyCache.set(isoDate, key);
  return key;
}
```

날짜의 요일·공휴일 여부는 불변이므로 영구 메모이즈 안전. `buildYearDailyGoals`(1095일)와 `recompute`(결제 건당, 같은 날짜 반복)가 distinct 날짜당 한 번만 비용을 낸다.

> 부수 효과: `report-timezone.ts` 포맷터 캐시는 Clover weekly·`recompute` 등 **모든 Clover 날짜 처리**를 가속한다.

---

## Result (결과)

실제 함수로 3년 1095일 벤치:

| | 수정 전 | 수정 후 |
|---|---|---|
| Cold (첫 계산) | ~7000ms | **540ms** (로컬) |
| Warm (메모이즈) | — | **1ms** (10,950 lookup) |

프로덕션:

| | 수정 전 | 첫 cold (인스턴스당 1회) | 이후 |
|---|---|---|---|
| `revenueSnapshot` | 8057ms | **2084ms** | **137ms** |
| event-loop block | 7394ms | **1448ms** | **0** |
| Revenue/Cost 스켈레톤 | 8~15초 | ~2초 | **<0.5초** |

> 첫 cold가 로컬 벤치(540ms)보다 큰 것(2084ms)은 Vercel 함수 CPU가 ~3–4배 느리기 때문. 메모이즈로 인스턴스당 1회만 부담하고 이후 137ms. 사용자 체감: 전체 nav **4초 이내**.

---

## Lessons (재발 방지)

1. **`new Intl.DateTimeFormat`을 hot loop에서 절대 반복 생성하지 말 것.** 반드시 모듈 레벨 캐시로 재사용. (`.format()`은 싸지만 생성자는 비싸다.) — 동일 패턴이 `report-timezone.ts`에 또 생기지 않도록 주의.
2. **"느린 쿼리"처럼 보이는 게 동기 CPU 블로킹일 수 있다.** `pool waiting:0 / idle:N`인데 특정 op만 느리면 DB가 아니라 **이벤트 루프**를 의심하라.
3. **진단은 격리로.** 대시보드 로직과 분리된 미니 측정(establish-only 엔드포인트, event-loop 샘플러)이 인프라를 명확히 배제해주기 전까지, "DB/커넥션" 프레임에서 4번 헛발질했다.
4. **캐시는 버그를 가린다.** `unstable_cache`가 Intl 비용을 warm 월에 숨겨, 근본 원인 발견을 지연시켰다. "캐시 추가"가 성능 문제의 *진단*을 대체하지 않는다.
5. event-loop 샘플러의 거대값(예: `blocked ~152857ms`)은 **Fluid freeze 아티팩트**(thaw 시 동시 종료)일 수 있으니 freeze와 실제 CPU 블로킹을 구분할 것.

## 변경 파일

- `lib/clover/report-timezone.ts` — Intl.DateTimeFormat timeZone별 캐시 **(핵심 수정)**
- `features/dashboard/revenue/utils/revenue-target-bucket-key.ts` — isoDate별 메모이즈 **(핵심 수정)**
- `features/dashboard/revenue/utils/revenue-target-snapshot.ts` — 불필요해진 `unstable_cache`(L2) 제거 (Intl 수정으로 매 계산이 빨라져 L2가 더는 필요 없음)
- `features/dashboard/labor/utils/labor-target-repository.ts` — 동일하게 `unstable_cache`(L2) 제거

진단용 임시 코드(`/api/diag/db-connect` 엔드포인트, instrumentation event-loop 샘플러, `location-cards`의 `timed()` pool 덤프)는 원인 확정 후 모두 제거됨. 탐색 과정에서 시도했던 snapshot 쿼리 sequential화는 원인이 아니었으므로 `Promise.all`로 되돌렸다.
