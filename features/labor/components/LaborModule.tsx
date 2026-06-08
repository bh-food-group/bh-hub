'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserRole } from '@/types/user';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SchedulePanel } from './SchedulePanel';
import { BudgetPlannerPanel } from './BudgetPlannerPanel';
import { HeatmapPanel } from './HeatmapPanel';
import { SettingsPanel } from './SettingsPanel';

type LocationOption = { id: string; code: string; name: string };

type Props = {
  locationId: string;
  locationName: string;
  role: UserRole | null;
  isOfficeOrAdmin: boolean;
  locations: LocationOption[];
};

type Tab = 'schedule' | 'budget' | 'heatmap' | 'settings';

const TABS: { key: Tab; label: string; officeOnly?: boolean }[] = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'budget', label: 'Budget Planner', officeOnly: true },
  { key: 'heatmap', label: 'Sales Heatmap' },
  { key: 'settings', label: 'Settings', officeOnly: true },
];

/** Today as YYYY-MM-DD in the browser's local time (good enough for a default). */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function LaborModule({
  locationId,
  locationName,
  role,
  isOfficeOrAdmin,
  locations,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('schedule');
  // Shared selected date drives the Budget and Schedule screens.
  const [date, setDate] = useState<string>(todayIso());

  // Location users (managers) see only Schedule + Sales Heatmap; Budget Planner
  // and Settings are office/admin only.
  const visibleTabs = TABS.filter((t) => isOfficeOrAdmin || !t.officeOnly);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Labor Scheduler</h1>
          <p className="text-sm text-muted-foreground">
            {locationName} — recommended part-time shifts within budget
          </p>
        </div>

        {/* Office/admin: location selector (drives every screen). Location users
            are pinned and see no selector. */}
        {isOfficeOrAdmin && locations.length > 0 && (
          <Select
            value={locationId}
            onValueChange={(id) => router.push(`/labor/location/${id}`)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'schedule' && (
        <SchedulePanel
          locationId={locationId}
          date={date}
          onDateChange={setDate}
          isOfficeOrAdmin={isOfficeOrAdmin}
        />
      )}
      {tab === 'budget' && (
        <BudgetPlannerPanel
          locationId={locationId}
          role={role}
          isOfficeOrAdmin={isOfficeOrAdmin}
          date={date}
          onDateChange={setDate}
        />
      )}
      {tab === 'heatmap' && <HeatmapPanel locationId={locationId} />}
      {tab === 'settings' && (
        <SettingsPanel
          locationId={locationId}
          canEdit={isOfficeOrAdmin}
        />
      )}
    </div>
  );
}
