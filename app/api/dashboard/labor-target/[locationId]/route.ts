// PATCH — upsert labor target for location + month (office/admin). Independent of Cost budget.

import { NextRequest, NextResponse } from 'next/server';
import { laborTargetPatchSchema, parseBody } from '@/lib/api/schemas';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { upsertLaborTarget } from '@/features/dashboard/labor/utils/labor-target-repository';
import { toApiErrorResponse } from '@/lib/core/errors';
import { getCurrentYearMonth, isValidYearMonth } from '@/lib/utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ locationId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
    if (!getOfficeOrAdmin(session.user.role)) {
      return NextResponse.json(
        { error: 'Only office or admin can update labor target' },
        { status: 403 },
      );
    }

    const { locationId } = await params;
    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId required' },
        { status: 400 },
      );
    }

    const parsed = await parseBody(request, laborTargetPatchSchema);
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;

    const yearMonth = body.yearMonth ?? getCurrentYearMonth();
    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json(
        { error: 'Invalid yearMonth; use YYYY-MM' },
        { status: 400 },
      );
    }

    const rate = body.laborBudgetRate;
    const months = body.laborReferencePeriodMonths;
    if (rate === undefined || months === undefined) {
      return NextResponse.json(
        {
          error:
            'laborBudgetRate and laborReferencePeriodMonths are required',
        },
        { status: 400 },
      );
    }
    if (rate <= 0 || months < 0) {
      return NextResponse.json(
        {
          error:
            'laborBudgetRate must be positive; laborReferencePeriodMonths must be 0–24',
        },
        { status: 400 },
      );
    }

    const laborTarget = await upsertLaborTarget(locationId, yearMonth, {
      rate,
      referencePeriodMonths: months,
    });
    return NextResponse.json({ ok: true, yearMonth, laborTarget });
  } catch (err: unknown) {
    return toApiErrorResponse(
      err,
      'PATCH /api/dashboard/labor-target/[locationId] error:',
    );
  }
}
