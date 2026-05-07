'use client';

import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus, X, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DEFAULT_REASON_OPTIONS, type ReasonCategory, type ReasonSubcategory } from './ReasonSelector';

type ManagedSub = ReasonSubcategory & { _id: string };
type ManagedCat = Omit<ReasonCategory, 'subs'> & { _id: string; subs: ManagedSub[] };

type Props = {
  initialOptions: ReasonCategory[];
  onSaved: (options: ReasonCategory[]) => void;
  onCancel: () => void;
};

let _uid = 0;
function uid() { return `_${++_uid}`; }

function toSnakeCase(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toManaged(options: ReasonCategory[]): ManagedCat[] {
  return options.map((c) => ({
    ...c,
    _id: uid(),
    subs: c.subs.map((s) => ({ ...s, _id: uid() })),
  }));
}

function fromManaged(cats: ManagedCat[]): ReasonCategory[] {
  return cats.map(({ _id: _c, subs, ...c }) => ({
    ...c,
    subs: subs.map(({ _id: _s, ...s }) => s),
  }));
}

export function ReasonOptionsManager({ initialOptions, onSaved, onCancel }: Props) {
  const [cats, setCats] = useState<ManagedCat[]>(() => toManaged(initialOptions?.length ? initialOptions : DEFAULT_REASON_OPTIONS));
  const [saving, setSaving] = useState(false);

  // Editing state: "cat:{_id}" or "sub:{_id}"
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(cats.map((c) => c._id)),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingKey) inputRef.current?.focus();
  }, [editingKey]);

  function startEdit(key: string, currentLabel: string) {
    setEditingKey(key);
    setEditDraft(currentLabel);
  }

  function commitEdit() {
    if (!editingKey || !editDraft.trim()) { setEditingKey(null); return; }
    const label = editDraft.trim();

    if (editingKey.startsWith('cat:')) {
      const _id = editingKey.slice(4);
      setCats((prev) =>
        prev.map((c) => (c._id === _id ? { ...c, label } : c)),
      );
    } else if (editingKey.startsWith('sub:')) {
      const _id = editingKey.slice(4);
      setCats((prev) =>
        prev.map((c) => ({
          ...c,
          subs: c.subs.map((s) => (s._id === _id ? { ...s, label } : s)),
        })),
      );
    }
    setEditingKey(null);
    setEditDraft('');
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditDraft('');
  }

  function deleteCat(_id: string) {
    setCats((prev) => prev.filter((c) => c._id !== _id));
  }

  function deleteSub(cat_id: string, sub_id: string) {
    setCats((prev) =>
      prev.map((c) => (c._id === cat_id ? { ...c, subs: c.subs.filter((s) => s._id !== sub_id) } : c)),
    );
  }

  function addCat() {
    const _id = uid();
    setCats((prev) => [
      ...prev,
      { _id, value: '', label: 'New Category', subs: [] },
    ]);
    setExpandedCats((prev) => new Set([...prev, _id]));
    setEditingKey(`cat:${_id}`);
    setEditDraft('New Category');
  }

  function addSub(cat_id: string) {
    const _id = uid();
    setCats((prev) =>
      prev.map((c) =>
        c._id === cat_id
          ? { ...c, subs: [...c.subs, { _id, value: '', label: 'New Detail' }] }
          : c,
      ),
    );
    setExpandedCats((prev) => new Set([...prev, cat_id]));
    setEditingKey(`sub:${_id}`);
    setEditDraft('New Detail');
  }

  function toggleExpand(_id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(_id)) next.delete(_id); else next.add(_id);
      return next;
    });
  }

  async function handleSave() {
    // Finalize any in-progress edit
    if (editingKey && editDraft.trim()) commitEdit();

    // Assign values (snake_case from label) for items with empty value
    const finalCats = cats.map((c) => ({
      ...c,
      value: c.value || toSnakeCase(c.label),
      subs: c.subs.map((s) => ({ ...s, value: s.value || toSnakeCase(s.label) })),
    }));

    const options = fromManaged(finalCats);

    setSaving(true);
    try {
      const res = await fetch('/api/order/reason-options', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? 'Failed to save');
      }
      toast.success('Reason options saved');
      onSaved(options);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save options');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground pb-1 border-b">
        Manage Reason Options
      </div>

      <div className="space-y-1 max-h-[360px] overflow-y-auto pr-0.5">
        {cats.map((cat) => (
          <div key={cat._id} className="rounded-md border bg-background overflow-hidden">
            {/* Category row */}
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => toggleExpand(cat._id)}
              >
                {expandedCats.has(cat._id)
                  ? <ChevronDown className="size-3" />
                  : <ChevronRight className="size-3" />}
              </button>

              {editingKey === `cat:${cat._id}` ? (
                <Input
                  ref={inputRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  className="h-6 text-xs flex-1"
                />
              ) : (
                <span className="flex-1 text-[12px] font-medium">{cat.label}</span>
              )}

              <div className="flex items-center gap-0.5">
                {editingKey === `cat:${cat._id}` ? (
                  <>
                    <Button variant="ghost" size="xs" className="h-5 w-5 p-0 text-green-600" onClick={commitEdit}><Check className="size-3" /></Button>
                    <Button variant="ghost" size="xs" className="h-5 w-5 p-0" onClick={cancelEdit}><X className="size-3" /></Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="xs" className="h-5 w-5 p-0" onClick={() => startEdit(`cat:${cat._id}`, cat.label)} title="Rename"><Pencil className="size-3" /></Button>
                    <Button variant="ghost" size="xs" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteCat(cat._id)} title="Delete category"><Trash2 className="size-3" /></Button>
                  </>
                )}
              </div>
            </div>

            {/* Subcategories */}
            {expandedCats.has(cat._id) && (
              <div className="border-t bg-muted/20 px-2 pb-1.5 pt-1 space-y-0.5">
                {cat.subs.map((sub) => (
                  <div key={sub._id} className="flex items-center gap-1 pl-4">
                    <span className="text-muted-foreground text-[10px]">↳</span>

                    {editingKey === `sub:${sub._id}` ? (
                      <Input
                        ref={inputRef}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        className="h-6 text-xs flex-1"
                      />
                    ) : (
                      <span className="flex-1 text-[11px]">{sub.label}</span>
                    )}

                    <div className="flex items-center gap-0.5">
                      {editingKey === `sub:${sub._id}` ? (
                        <>
                          <Button variant="ghost" size="xs" className="h-5 w-5 p-0 text-green-600" onClick={commitEdit}><Check className="size-3" /></Button>
                          <Button variant="ghost" size="xs" className="h-5 w-5 p-0" onClick={cancelEdit}><X className="size-3" /></Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="xs" className="h-5 w-5 p-0" onClick={() => startEdit(`sub:${sub._id}`, sub.label)} title="Rename"><Pencil className="size-3" /></Button>
                          <Button variant="ghost" size="xs" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteSub(cat._id, sub._id)} title="Delete"><Trash2 className="size-3" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="flex items-center gap-1 pl-4 text-[10px] text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                  onClick={() => addSub(cat._id)}
                >
                  <Plus className="size-3" /> Add detail
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        className={cn(
          'flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors',
          'border border-dashed rounded-md w-full px-2 py-1.5 justify-center',
        )}
        onClick={addCat}
      >
        <Plus className="size-3" /> Add category
      </button>

      <div className="flex justify-end gap-2 pt-1 border-t">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="size-3 animate-spin mr-1" />Saving…</> : 'Save'}
        </Button>
      </div>
    </div>
  );
}
