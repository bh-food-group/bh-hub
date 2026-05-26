# 대시보드 로딩 속도 개선 작업

---

## Situation (상황)

로케이션 대시보드(`/dashboard/location/[id]`) 진입 시 Revenue·Cost·Labor 카드와 Clover Weekly Net Sales 카드의 로딩이 비정상적으로 느렸다.

| 측정 항목 | 개선 전 |
|-----------|---------|
| `location-cards` API 전체 | **7–9초** |
| Clover Weekly Net Sales 첫 렌더 | **10초 이상** |
| `dow-averages` (노동 분석) | **12–15초** |
| `prev-month-summary` (전월 노동) | **12–15초** |
| 주차 내비게이션 시 데이터 갱신 | 이전 요청이 완료되면 최신 주차를 덮어쓰는 버그 |

사용자 체감 흐름: 페이지에 들어오면 8–10초간 스켈레톤이 표시되고, Clover 차트도 별도로 10초 이상 대기. Revenue/Cost가 로드되기 전까지 Clover 차트 자체가 시작조차 되지 않았다.

---

## Task (과제)

1. 각 병목의 실제 원인을 계측(instrumentation)으로 특정한다.
2. 사용자가 페이지에 진입한 뒤 **핵심 카드들이 2초 이내에 렌더**되도록 개선한다.
3. 주차 내비게이션 버그를 수정한다.
4. 개선 사항이 이후 내비게이션(같은 로케이션·같은 월)에서도 지속되도록 캐시 계층을 설계한다.

---

## Action (행동)

### 1. 병목 계측 — Timing 로그 추가

`/api/dashboard/location-cards/route.ts` 의 `handleRequest` 함수에 스테이지별 `Date.now()` 계측을 삽입했다.

```
[location-cards] location-db=3906ms   ← Supabase 커넥션 콜드 스타트
[location-cards] budget-db=110ms
[location-cards] revenueSnapshot=3116ms  ← 캐시 없이 매번 DB 직접 호출
[location-cards] savedRefMonths=3286ms   ← 동일
[location-cards] stage2 QB calls = 7–8ms ← unstable_cache 이미 작동 중
```

계측 결과: **QB API는 문제없었고, 병목은 전부 DB 레이어**였다.

---

### 2. Clover Weekly 2단계 로딩 (Phase Loading)

**문제**: Clover 주간 데이터 로드가 단일 요청으로 11초 이상 소요.  
`/payments`(현재·이전 주) + `/orders?expand=lineItems`(621건) 를 순차 실행.

**해결**:

- **Phase 1** (`?phase=1`): 현재 주 `/payments` 만 호출 → **~1.4초** 만에 차트 렌더
- **Phase 2** (`?phase=2`): `prevPayments` + `orderItems` + `categories` 를 `Promise.all` 병렬 실행 → WoW 비교·메뉴 퍼포먼스 추가 로드

```typescript
// get-clover-weekly-revenue.ts
if (includeOrderItems) {
  const categoriesPromise = fetchCloverCategories(merchantId, token);
  [payments, prevPayments, orderItems] = await Promise.all([
    fetchCloverPaymentsInRange(merchantId, token, startMs, endMs),
    fetchCloverPaymentsInRange(merchantId, token, prevStartMs, prevEndMs),
    fetchCloverOrderItemsInRange(merchantId, token, startMs, endMs),
  ]);
  categories = await categoriesPromise;
} else {
  payments = await fetchCloverPaymentsInRange(merchantId, token, startMs, endMs);
  prevPayments = [];
}
```

---

### 3. 완료된 과거 주차 DB 캐시 (`CloverWeeklyCache`)

과거 주는 데이터가 변하지 않으므로 `prisma.cloverWeeklyCache`에 결과를 저장.  
Phase 1 요청 시 캐시 히트 → `partial: false` 반환으로 Phase 2 불필요.

```typescript
if (isPastWeek) {
  const cached = await prisma.cloverWeeklyCache.findUnique({ ... });
  if (cached) return NextResponse.json({ ok: true, partial: false, data: ... });
}
```

---

### 4. 주차 내비게이션 버그 수정 — AbortController

**문제**: Phase 1·2 요청이 진행 중에 다른 주차로 내비게이션하면, 느린 이전 요청이 완료되면서 새 주차 데이터를 덮어쓰는 경쟁 조건(race condition) 발생.

**해결**: `useRef<AbortController>` 를 사용해 새 `load()` 호출 시 이전 요청을 즉시 취소.

```typescript
const abortRef = useRef<AbortController | null>(null);

const load = useCallback(async (weekOffset: number) => {
  abortRef.current?.abort(); // 이전 요청 취소
  const controller = new AbortController();
  abortRef.current = controller;
  // ...
}, [locationId, yearMonth]);
```

---

### 5. Clover 카드와 QB 카드의 로딩 분리

**문제**: `WeeklyRevenueCard` 가 `location-cards` QB 데이터 로드 완료를 기다린 후 시작.  
QB 로딩(7–9초)이 Clover 카드 시작을 차단.

**해결**: `WeeklyRevenueCard` 를 `!data` 조건 밖으로 분리하고, `initialWeekOffset` 을 클라이언트에서 `useMemo` 로 즉시 계산.

```typescript
// LocationDashboardCards.tsx
const initialWeekOffset = useMemo(
  () => clampWeekOffsetForDashboard(yearMonth, getWeekOffsetContainingToday(yearMonth)),
  [yearMonth],
);

return (
  <div>
    {/* Annual + Monthly — location-cards 대기 */}
    {!data ? <RevenueSkeletons /> : <AnnualMonthlyCards />}

    {/* Weekly — 즉시 시작, QB 로딩과 무관 */}
    <WeeklyRevenueCard initialWeekOffset={initialWeekOffset} ... />
  </div>
);
```

---

### 6. Revenue Target 캐시 추가 (`unstable_cache` + `React.cache`)

**문제**: `getRevenueTargetSnapshot` 이 매 요청마다 DB를 직접 호출 (캐시 없음).  
내부에서 `annualGoal` 조회 → `resolveRevenueMonthTargetRow` 를 순차 실행 (최대 4회 순차 쿼리).  
Supabase 커넥션 풀 경합 상황에서 **3초 이상** 대기.

**해결**:

1. `annualGoal` 과 `resolveRevenueMonthTargetRow` 를 `Promise.all` 병렬 실행
2. `resolveRevenueMonthTargetRow` 내부 최대 3회 순차 쿼리 → 최대 2회로 단순화
3. `unstable_cache(300s)` + `React.cache()` 이중 캐시 적용

```typescript
// revenue-target-snapshot.ts
const [annualRow, monthRow] = await Promise.all([
  prisma.revenueAnnualGoal.findUnique({ ... }),
  resolveRevenueMonthTargetRow(locationId, yearMonth),
]);

const _getRevenueTargetSnapshotPersisted = unstable_cache(
  _getRevenueTargetSnapshotUncached,
  ['revenue-target-snapshot'],
  { revalidate: 300 },
);

export const getRevenueTargetSnapshot = cache(_getRevenueTargetSnapshotPersisted);
```

`getRevenueMonthTargetRefMonths` 에도 동일한 캐시 패턴 적용.

---

### 7. `getCloverDowAverages` 24시간 캐시 추가

**문제**: 이전 달 Clover 결제 데이터를 매 요청마다 전체 재조회 (캐시 없음).  
한 달치 결제(`~3,000건` = 3페이지)를 순차 페이징 → **12–13초**.  
이전 달 데이터는 **불변(immutable)** 이므로 캐시 무효화 불필요.

**해결**: `unstable_cache(86400s = 24h)` + `React.cache()` 적용.

```typescript
const _getCloverDowAveragesPersisted = unstable_cache(
  _getCloverDowAveragesUncached,
  ['clover-dow-averages'],
  { revalidate: 86400 },
);

export const getCloverDowAverages = cache(_getCloverDowAveragesPersisted);
```

---

### 8. `prev-month-summary` 24시간 캐시 추가

**문제**: 전월 QB P&L을 `fetchQbPnlCached`(5분 TTL)로 가져오는데,  
이전 달은 불변임에도 5분마다 캐시가 만료되어 재요청 시 12초 소요.

**해결**: 라우트 레벨에서 `getLaborDashboardData` 호출 전체를 `unstable_cache(86400s)` 로 감쌈.  
내부 QB P&L 캐시(5분)보다 상위에서 최종 결과를 캐시.

```typescript
const _getPrevMonthLaborPersisted = unstable_cache(
  (locationId, prevYearMonth) =>
    getLaborDashboardData(locationId, prevYearMonth, { baseUrl: '', cookie: null }, {
      referenceIncomeTotal: undefined,
      laborTarget: null,
    }),
  ['prev-month-labor'],
  { revalidate: 86400 },
);

export const getPrevMonthLabor = cache(_getPrevMonthLaborPersisted);
```

---

### 9. 메뉴 퍼포먼스 카테고리 필터링

메뉴 퍼포먼스 항목을 카테고리명에 **DRINK, FOOD, KIDS, BAKERY** 가 포함된 제품만 표시.

- `findMenuCategories()` 추가: 정규식 `/drink|food|kids|bakery/i` 로 해당 카테고리 선별
- 시즈널 카테고리 item ID 조회와 메뉴 카테고리 item ID 조회를 `Promise.all` 병렬 실행
- `buildMenuStats` 에 `menuItemIds: Set<string>` 파라미터 추가, `eligibleItems` 필터링

---

## Result (결과)

### 계측 비교

| 항목 | 개선 전 | 개선 후 (워밍) |
|------|---------|---------------|
| `location-cards` 전체 render | **7.3s** | **237ms** |
| `revenueSnapshot` DB 조회 | 3,116ms | **1ms** |
| `savedRefMonths` DB 조회 | 3,286ms | **3ms** |
| Stage 2 QB 호출 전체 | 7–8ms (이미 캐시) | 9–19ms (유지) |
| Clover 차트 첫 렌더 (Phase 1) | **10초+** | **~1.4초** |
| Clover 메뉴 퍼포먼스 (Phase 2) | 10초+ (차트와 동시) | **차트 후 비동기** |
| `dow-averages` | **12–13초** | **<5ms** (캐시 후) |
| `prev-month-summary` | **12–15초** | **<5ms** (캐시 후) |

### 캐시 계층 요약

```
unstable_cache (24h)   ← dow-averages, prev-month-summary  (불변 데이터)
unstable_cache (5min)  ← QB P&L, revenueTargetSnapshot, refMonths
React.cache            ← 동일 요청 내 중복 호출 제거 (dedup)
DB cache               ← CloverWeeklyCache (과거 주차, 영구 저장)
In-memory cache        ← Clover 카테고리 목록 (1시간)
```

### 아키텍처 변화

- **병렬 분리**: Clover 카드와 QB 카드가 독립적으로 시작 — 어느 하나가 느려도 다른 카드를 차단하지 않음
- **불변 데이터 장기 캐시**: 이전 달 Clover·QB 데이터에 24시간 TTL 적용
- **경쟁 조건 제거**: AbortController 로 stale 요청을 즉시 취소, 주차 내비게이션 신뢰성 확보
- **DB 쿼리 감소**: `revenueTargetSnapshot` 내부 최대 4회 순차 쿼리 → 병렬 2회로 단축
