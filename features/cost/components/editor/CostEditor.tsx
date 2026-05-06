'use client';

import { useCostEditor } from '../../hooks/useCostEditor';
import type { CostDetailApiResponse } from '../../types/cost';
import CostEditorHeader from './CostEditorHeader';
import IngredientSection from './IngredientSection';
import LaborSection from './LaborSection';
import OtherSection from './OtherSection';
import CostSummary from './CostSummary';
import PriceSection from './PriceSection';
import CostMemoSection from './CostMemoSection';
import CostHistorySection from './CostHistorySection';
import { useTranslations } from 'next-intl';

interface Props {
  initialCost?: CostDetailApiResponse;
}

export default function CostEditor({ initialCost }: Props) {
  const t = useTranslations('Cost');
  const editor = useCostEditor(initialCost);
  const disabled = editor.state.locked;

  return (
    <div className="space-y-6 pb-16">
      <CostEditorHeader
        title={editor.state.title}
        tags={editor.state.tags}
        locked={editor.state.locked}
        isExisting={!!editor.state.id}
        costId={editor.state.id}
        isSaving={editor.isSaving}
        isDeleting={editor.isDeleting}
        isDirty={editor.isDirty}
        onTitleChange={editor.setTitle}
        onTagsChange={editor.setTags}
        onSave={editor.handleSave}
        onDelete={editor.handleDelete}
        onDuplicate={editor.handleDuplicate}
        onLockToggle={editor.handleLockToggle}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left column: ingredient / packaging / labor / other sections */}
        <div className="space-y-8">
          <IngredientSection
            title={t('ingredients')}
            items={editor.state.ingredients}
            disabled={disabled}
            onAdd={editor.addIngredient}
            onUpdate={editor.updateIngredient}
            onRemove={editor.removeIngredient}
            onReorder={editor.reorderIngredients}
          />

          <IngredientSection
            title={t('packaging')}
            items={editor.state.packagings}
            disabled={disabled}
            onAdd={editor.addPackaging}
            onUpdate={editor.updatePackaging}
            onRemove={editor.removePackaging}
            onReorder={editor.reorderPackagings}
          />

          <LaborSection
            labors={editor.state.labors}
            disabled={disabled}
            onAdd={editor.addLabor}
            onUpdate={editor.updateLabor}
            onRemove={editor.removeLabor}
          />

          <OtherSection
            others={editor.state.others}
            disabled={disabled}
            onAdd={editor.addOther}
            onUpdate={editor.updateOther}
            onRemove={editor.removeOther}
          />
        </div>

        {/* Right column: summary + prices */}
        <div className="space-y-4">
          <CostSummary
            state={editor.state}
            ingredientCost={editor.ingredientCost}
            packagingCost={editor.packagingCost}
            laborCost={editor.laborCost}
            otherCost={editor.otherCost}
            totalCost={editor.totalCost}
            pricePerProduct={editor.pricePerProduct}
            disabled={disabled}
            onTotalCountChange={editor.setTotalCount}
            onLossAmountChange={editor.setLossAmount}
            onFinalWeightChange={editor.setFinalWeight}
          />

          <PriceSection
            prices={editor.state.prices}
            pricePerProduct={editor.pricePerProduct}
            disabled={disabled}
            onAdd={editor.addPrice}
            onUpdate={editor.updatePrice}
            onRemove={editor.removePrice}
          />
        </div>
      </div>

      {/* Bottom: history (left) + memo (right) */}
      <div className="border-t pt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {editor.state.id && (
          <CostHistorySection costId={editor.state.id} />
        )}

        <CostMemoSection
          costId={editor.state.id}
          pendingMemosRef={editor.pendingMemosRef}
        />
      </div>
    </div>
  );
}
