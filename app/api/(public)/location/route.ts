import { auth, getOfficeOrAdmin } from '@/lib/auth';
import { parseBody, locationPostSchema } from '@/lib/api/schemas';
import { prisma } from '@/lib/core/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getOfficeOrAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseBody(request, locationPostSchema);
  if ('error' in parsed) return parsed.error;
  const { code, name, realmId, classId, startYearMonth, showBudget } = parsed.data;

  const existing = await prisma.location.findUnique({
    where: { code },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'A location with this code already exists' },
      { status: 400 },
    );
  }

  const realm = await prisma.realm.findUnique({
    where: { id: realmId },
    select: { id: true },
  });
  if (!realm) {
    return NextResponse.json({ error: 'Realm not found' }, { status: 400 });
  }

  const location = await prisma.location.create({
    data: {
      code,
      name,
      realmId,
      classId: classId ?? null,
      startYearMonth: startYearMonth ?? null,
      showBudget: showBudget ?? true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      classId: true,
      realmId: true,
      startYearMonth: true,
      showBudget: true,
      realm: { select: { id: true, name: true } },
    },
  });

  const row = {
    id: location.id,
    code: location.code,
    name: location.name,
    classId: location.classId,
    realmId: location.realmId,
    realmName: location.realm?.name ?? null,
    startYearMonth: location.startYearMonth,
    showBudget: location.showBudget,
  };

  return NextResponse.json(row, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getOfficeOrAdmin(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const locations = await prisma.location.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      classId: true,
      realmId: true,
      startYearMonth: true,
      showBudget: true,
      cloverMerchantId: true,
      cloverToken: true,
      orderEmail: true,
      realm: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = locations.map((loc) => ({
    id: loc.id,
    code: loc.code,
    name: loc.name,
    classId: loc.classId,
    realmId: loc.realmId,
    realmName: loc.realm?.name ?? null,
    startYearMonth: loc.startYearMonth,
    showBudget: loc.showBudget,
    cloverMerchantId: loc.cloverMerchantId,
    cloverToken: loc.cloverToken,
    orderEmail: loc.orderEmail,
  }));

  return NextResponse.json(rows);
}
