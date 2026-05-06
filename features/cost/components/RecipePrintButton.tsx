'use client';

import { useState } from 'react';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { openRecipePdfPrint, type RecipePdfInput } from '../utils/recipe-pdf';

interface RecipePrintButtonProps {
  costId: string;
}

export default function RecipePrintButton({ costId }: RecipePrintButtonProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      const res = await fetch(`/api/cost/${costId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const { cost } = await res.json();

      const input: RecipePdfInput = {
        title: cost.title,
        totalCount: cost.totalCount,
        lossAmount: cost.lossAmount,
        finalWeight: cost.finalWeight,
        ingredients: cost.ingredients.map((i: { title: string; amount: number; unit: string }) => ({
          title: i.title,
          amount: i.amount,
          unit: i.unit,
        })),
        packagings: cost.packagings.map((p: { title: string; amount: number; unit: string }) => ({
          title: p.title,
          amount: p.amount,
          unit: p.unit,
        })),
        memos: cost.costMemos.map((m: { id: string; memo: string }) => ({
          id: m.id,
          memo: m.memo,
        })),
      };

      await openRecipePdfPrint(input);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '레시피 출력에 실패했습니다.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handlePrint}
      isLoading={isPrinting}
      title="레시피 출력"
    >
      {!isPrinting && <Printer />}
    </Button>
  );
}
