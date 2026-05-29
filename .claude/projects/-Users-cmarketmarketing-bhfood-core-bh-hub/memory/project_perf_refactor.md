---
name: perf-refactor-2026-05
description: Dashboard/Order 성능 및 네비게이션 개선 — 구현된 변경사항 요약
metadata:
  type: project
---

2026-05-29에 완료된 P0/P1 성능 리팩토링.

**Why:** Dashboard와 Order 페이지가 구조적으로 느렸음. 불필요한 쿼리, 직렬 워터폴, 페이지 이탈 시 in-flight 요청 미취소가 주 원인.

**How to apply:** 추가 SOLID 리팩토링 (P2)은 아직 미구현. OrderManagementView 분리, build-inbox-data 분리가 남아있음.

## 구현된 변경사항

### P0 — 네비게이션/fetch abort
- `WeeklyRevenueCard.tsx`: 초기 load useEffect에 `return () => abortRef.current?.abort()` cleanup 추가
- `LocationDashboardCards.tsx`: phase 2 시작 전 `controller.signal.aborted` 체크 추가

### P0 — Order 페이지 쿼리 최적화 (`app/(main)/order/office/page.tsx`)
- 테이블뷰 4개 쿼리 (fetchShopifyOrdersForOfficeTableView, fetchPurchaseOrdersForOfficeTableView, 2× count) 제거 → OfficeTableSplitView에서 mount 시 client lazy fetch로 전환
- `loadVariantOfficeNotesMap` + `fetchLegacyOrphanPoLinesForInbox` 순차 실행 → `Promise.all` 병렬화
- `purchaseOrderLineItem.findMany` 전체 스캔 → `$queryRaw` GROUP BY 집계 쿼리로 교체 (done_by_qty + shopify_linked_undone 컬럼)

### P0 — OfficeTableSplitView (`features/order/office/components/OfficeTableSplitView.tsx`)
- `initialShopifyRows`, `initialPoRows`, `shopifyTotal`, `poTotal` props를 optional로 변경
- 서버 데이터 없을 때 mount 시 `/api/shopify/table-view` + `/api/order/table-view/po` 병렬 fetch

### P1 — Dashboard location-cards (`app/api/dashboard/location-cards/route.ts`)
- `fetchBaseData` 결과를 10초 TTL globalThis 캐시로 공유
- Phase 1, Phase 2가 `laborTarget`, `revenueSnapshot`, `savedRefMonths` 쿼리를 중복 실행하던 문제 해소

### P1 — 레이아웃 캐싱
- `(main)/layout.tsx`: `getPendingApprovals` → `unstable_cache` 60초 TTL
- `lib/dashboard/default-location.ts`: `getDefaultDashboardLocationId` → `unstable_cache` 300초 TTL

## 미구현 P2 (SOLID)
- `OrderManagementView.tsx` (3,066줄) 분리: hooks/usePoMutations, hooks/useOptimisticState, views/GroupedView, views/TableView, views/RefundsView
- `build-inbox-data.ts` (1,278줄) 분리: customer-identity, vendor-supplier-map, legacy-po-allocation, supplier-entry-builder
