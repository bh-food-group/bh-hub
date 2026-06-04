'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type {
  CostDetailApiResponse,
  CostEditorState,
  CostTag,
  IngredientEditorItem,
  LaborEditorItem,
  OtherEditorItem,
  PriceEditorItem,
} from '../types/cost';
import {
  buildSavePayload,
  defaultCostState,
  deserializeCost,
  remapStateForDuplicate,
} from '../utils/cost-api-helpers';
import {
  calcIngredientTotal,
  calcLaborTotal,
  calcOtherTotal,
  calcPackagingTotal,
  calcMarginValue,
  calcPricePerProduct,
  calcTotalCost,
  recalcPrices,
} from '../utils/calculations';
import {
  createNewIngredient,
  createNewLabor,
  createNewOther,
  createNewPackaging,
  createNewPrice,
} from '../utils/item-factories';
import { reorderRanks } from '../utils/rank-utils';

export function useCostEditor(initialCost?: CostDetailApiResponse) {
  const router = useRouter();
  const [state, setState] = useState<CostEditorState>(() =>
    initialCost ? deserializeCost(initialCost) : defaultCostState(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const pendingMemosRef = useRef<string[]>([]);

  // ── Dirty tracking ──────────────────────────────────────────────────────────
  const markDirty = useCallback(() => setIsDirty(true), []);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const ingredientCost = useMemo(() => calcIngredientTotal(state.ingredients), [state.ingredients]);
  const packagingCost = useMemo(() => calcPackagingTotal(state.packagings), [state.packagings]);
  const laborCost = useMemo(() => calcLaborTotal(state.labors), [state.labors]);
  const otherCost = useMemo(() => calcOtherTotal(state.others), [state.others]);
  const totalCost = useMemo(
    () => calcTotalCost(ingredientCost, packagingCost, laborCost, otherCost),
    [ingredientCost, packagingCost, laborCost, otherCost],
  );
  const pricePerProduct = useMemo(
    () => calcPricePerProduct(totalCost, state.totalCount),
    [totalCost, state.totalCount],
  );

  // ── Top-level field setters ─────────────────────────────────────────────────
  const setTitle = useCallback((title: string) => {
    setState((s) => ({ ...s, title }));
    markDirty();
  }, [markDirty]);

  const setTotalCount = useCallback((totalCount: number) => {
    setState((s) => ({ ...s, totalCount }));
    markDirty();
  }, [markDirty]);

  const setLossAmount = useCallback((lossAmount: number | null) => {
    setState((s) => ({ ...s, lossAmount }));
    markDirty();
  }, [markDirty]);

  const setFinalWeight = useCallback((finalWeight: number | null) => {
    setState((s) => ({ ...s, finalWeight }));
    markDirty();
  }, [markDirty]);

  const setTags = useCallback((tags: CostTag[]) => {
    setState((s) => ({ ...s, tags }));
    markDirty();
  }, [markDirty]);

  // ── Ingredient handlers ─────────────────────────────────────────────────────
  const addIngredient = useCallback(() => {
    setState((s) => ({
      ...s,
      ingredients: [
        ...s.ingredients,
        createNewIngredient(s.id, s.ingredients.map((i) => i.rank)),
      ],
    }));
    markDirty();
  }, [markDirty]);

  const updateIngredient = useCallback((id: string, patch: Partial<IngredientEditorItem>) => {
    setState((s) => ({
      ...s,
      ingredients: s.ingredients.map((i) => (i.id === id ? { ...i, ...patch, isNew: false } : i)),
    }));
    markDirty();
  }, [markDirty]);

  const removeIngredient = useCallback((id: string) => {
    setState((s) => ({ ...s, ingredients: s.ingredients.filter((i) => i.id !== id) }));
    markDirty();
  }, [markDirty]);

  const reorderIngredients = useCallback((fromIndex: number, toIndex: number) => {
    setState((s) => ({ ...s, ingredients: reorderRanks(s.ingredients, fromIndex, toIndex) }));
    markDirty();
  }, [markDirty]);

  // ── Packaging handlers ──────────────────────────────────────────────────────
  const addPackaging = useCallback(() => {
    setState((s) => ({
      ...s,
      packagings: [
        ...s.packagings,
        createNewPackaging(s.id, s.packagings.map((p) => p.rank)),
      ],
    }));
    markDirty();
  }, [markDirty]);

  const updatePackaging = useCallback((id: string, patch: Partial<IngredientEditorItem>) => {
    setState((s) => ({
      ...s,
      packagings: s.packagings.map((p) => (p.id === id ? { ...p, ...patch, isNew: false } : p)),
    }));
    markDirty();
  }, [markDirty]);

  const removePackaging = useCallback((id: string) => {
    setState((s) => ({ ...s, packagings: s.packagings.filter((p) => p.id !== id) }));
    markDirty();
  }, [markDirty]);

  const reorderPackagings = useCallback((fromIndex: number, toIndex: number) => {
    setState((s) => ({ ...s, packagings: reorderRanks(s.packagings, fromIndex, toIndex) }));
    markDirty();
  }, [markDirty]);

  // ── Labor handlers ──────────────────────────────────────────────────────────
  const addLabor = useCallback(() => {
    setState((s) => ({
      ...s,
      labors: [...s.labors, createNewLabor(s.id, s.labors.map((l) => l.rank))],
    }));
    markDirty();
  }, [markDirty]);

  const updateLabor = useCallback((id: string, patch: Partial<LaborEditorItem>) => {
    setState((s) => ({
      ...s,
      labors: s.labors.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
    markDirty();
  }, [markDirty]);

  const removeLabor = useCallback((id: string) => {
    setState((s) => ({ ...s, labors: s.labors.filter((l) => l.id !== id) }));
    markDirty();
  }, [markDirty]);

  // ── Other handlers ──────────────────────────────────────────────────────────
  const addOther = useCallback(() => {
    setState((s) => ({
      ...s,
      others: [...s.others, createNewOther(s.id, s.others.map((o) => o.rank))],
    }));
    markDirty();
  }, [markDirty]);

  const updateOther = useCallback((id: string, patch: Partial<OtherEditorItem>) => {
    setState((s) => ({
      ...s,
      others: s.others.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
    markDirty();
  }, [markDirty]);

  const removeOther = useCallback((id: string) => {
    setState((s) => ({ ...s, others: s.others.filter((o) => o.id !== id) }));
    markDirty();
  }, [markDirty]);

  // ── Price handlers ──────────────────────────────────────────────────────────
  const addPrice = useCallback(() => {
    setState((s) => ({
      ...s,
      prices: [...s.prices, createNewPrice(s.id, s.prices.map((p) => p.rank), pricePerProduct)],
    }));
    markDirty();
  }, [markDirty, pricePerProduct]);

  const updatePrice = useCallback((id: string, patch: Partial<PriceEditorItem>) => {
    setState((s) => {
      const ppp = calcPricePerProduct(
        calcTotalCost(
          calcIngredientTotal(s.ingredients),
          calcPackagingTotal(s.packagings),
          calcLaborTotal(s.labors),
          calcOtherTotal(s.others),
        ),
        s.totalCount,
      );
      let updated = s.prices.map((p) => (p.id === id ? { ...p, ...patch } : p));
      // Price edited directly → derive the margin that produces it (inverse binding).
      if (patch.price != null && patch.margin == null) {
        updated = updated.map((p) =>
          p.id === id
            ? { ...p, margin: calcMarginValue(p, ppp, updated, patch.price!) }
            : p,
        );
      }
      return { ...s, prices: recalcPrices(updated, ppp) };
    });
    markDirty();
  }, [markDirty]);

  const removePrice = useCallback((id: string) => {
    setState((s) => ({ ...s, prices: s.prices.filter((p) => p.id !== id) }));
    markDirty();
  }, [markDirty]);

  // Recalc prices when pricePerProduct changes
  useEffect(() => {
    setState((s) => ({ ...s, prices: recalcPrices(s.prices, pricePerProduct) }));
  }, [pricePerProduct]);

  // ── Save / Delete / Duplicate ───────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!state.title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    if (state.totalCount <= 0) {
      toast.error('총 갯수를 입력해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const payload = buildSavePayload(state);
      const pendingMemos = pendingMemosRef.current;

      let savedId: string;
      if (state.id) {
        const res = await fetch(`/api/cost/${state.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
        const data = await res.json();
        savedId = data.cost.id;
        setState(deserializeCost(data.cost));
      } else {
        const res = await fetch('/api/cost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
        const data = await res.json();
        savedId = data.cost.id;
        setState(deserializeCost(data.cost));
      }

      // Save pending memos
      if (pendingMemos.length > 0) {
        await Promise.allSettled(
          pendingMemos.map((memo) =>
            fetch(`/api/cost/${savedId}/memo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ memo }),
            }),
          ),
        );
        pendingMemosRef.current = [];
      }

      setIsDirty(false);
      toast.success('저장되었습니다.');

      if (!state.id) {
        router.replace(`/cost/edit/${savedId}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  }, [state, router]);

  const handleDelete = useCallback(async () => {
    if (!state.id) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/cost/${state.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      toast.success('삭제되었습니다.');
      router.push('/cost/list');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  }, [state.id, router]);

  const handleDuplicate = useCallback(async () => {
    if (!state.id) return;
    try {
      const payload = buildSavePayload({
        ...remapStateForDuplicate(state),
        title: `${state.title} (복사본)`,
      });
      const res = await fetch('/api/cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Duplicate failed');
      const data = await res.json();
      toast.success('복제되었습니다.');
      router.push(`/cost/edit/${data.cost.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '복제에 실패했습니다.');
    }
  }, [state, router]);

  const handleLockToggle = useCallback(async () => {
    if (!state.id) return;
    const newLocked = !state.locked;
    setState((s) => ({ ...s, locked: newLocked }));
    try {
      const payload = buildSavePayload({ ...state, locked: newLocked });
      const res = await fetch(`/api/cost/${state.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast.success(newLocked ? '잠금되었습니다.' : '잠금이 해제되었습니다.');
    } catch {
      setState((s) => ({ ...s, locked: !newLocked }));
      toast.error('잠금 상태 변경에 실패했습니다.');
    }
  }, [state]);

  return {
    state,
    isSaving,
    isDeleting,
    isDirty,
    pendingMemosRef,
    // derived
    ingredientCost,
    packagingCost,
    laborCost,
    otherCost,
    totalCost,
    pricePerProduct,
    // setters
    setTitle,
    setTotalCount,
    setLossAmount,
    setFinalWeight,
    setTags,
    // ingredient
    addIngredient,
    updateIngredient,
    removeIngredient,
    reorderIngredients,
    // packaging
    addPackaging,
    updatePackaging,
    removePackaging,
    reorderPackagings,
    // labor
    addLabor,
    updateLabor,
    removeLabor,
    // other
    addOther,
    updateOther,
    removeOther,
    // prices
    addPrice,
    updatePrice,
    removePrice,
    // actions
    handleSave,
    handleDelete,
    handleDuplicate,
    handleLockToggle,
  };
}
