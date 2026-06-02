import { parseBody, locationPatchSchema } from '@/lib/api/schemas';
import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { NextResponse } from 'next/server';

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getOfficeOrAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const parsed = await parseBody(_request, locationPatchSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const existing = await prisma.location.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 });
  }

  const updateData: {
    code?: string;
    name?: string;
    classId?: string | null;
    realmId?: string;
    startYearMonth?: string | null;
    showBudget?: boolean;
    cloverMerchantId?: string | null;
    cloverToken?: string | null;
    orderEmail?: string | null;
  } = {};
  if (body.code !== undefined) updateData.code = body.code;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.classId !== undefined) updateData.classId = body.classId ?? null;
  if (body.realmId !== undefined) updateData.realmId = body.realmId;
  if (body.startYearMonth !== undefined) updateData.startYearMonth = body.startYearMonth ?? null;
  if (body.showBudget !== undefined) updateData.showBudget = body.showBudget;
  if (body.cloverMerchantId !== undefined) updateData.cloverMerchantId = body.cloverMerchantId ?? null;
  if (body.cloverToken !== undefined) updateData.cloverToken = body.cloverToken ?? null;
  if (body.orderEmail !== undefined) updateData.orderEmail = body.orderEmail ?? null;

  await prisma.location.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ ok: true });
}
