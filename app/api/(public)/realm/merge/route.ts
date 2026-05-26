/**
 * POST /api/realm/merge
 * Admin only. Merges an orphan realm (no linked locations) into its canonical counterpart.
 * Copies the orphan's tokens → target realm, then deletes the orphan.
 * Body: { orphanId: string, targetId: string }
 */
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/core/prisma';
import { decryptRefreshToken, isEncrypted } from '@/lib/core/encryption';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    orphanId?: string;
    targetId?: string;
  } | null;

  if (!body?.orphanId || !body?.targetId) {
    return NextResponse.json({ error: 'orphanId and targetId are required' }, { status: 400 });
  }

  const { orphanId, targetId } = body;

  if (orphanId === targetId) {
    return NextResponse.json({ error: 'orphanId and targetId must be different' }, { status: 400 });
  }

  const [orphan, target] = await Promise.all([
    prisma.realm.findUnique({
      where: { id: orphanId },
      select: {
        id: true,
        realmId: true,
        accessToken: true,
        refreshToken: true,
        expiresAt: true,
        refreshExpiresAt: true,
        _count: { select: { locations: true } },
      },
    }),
    prisma.realm.findUnique({
      where: { id: targetId },
      select: { id: true, realmId: true },
    }),
  ]);

  if (!orphan) return NextResponse.json({ error: 'Orphan realm not found' }, { status: 404 });
  if (!target) return NextResponse.json({ error: 'Target realm not found' }, { status: 404 });
  if (orphan._count.locations > 0) {
    return NextResponse.json(
      { error: 'Orphan realm still has linked locations — re-check before merging' },
      { status: 400 },
    );
  }

  // Verify both realms belong to the same QB company.
  const orphanPlain = isEncrypted(orphan.realmId)
    ? decryptRefreshToken(orphan.realmId)
    : orphan.realmId;
  const targetPlain = isEncrypted(target.realmId)
    ? decryptRefreshToken(target.realmId)
    : target.realmId;

  if (orphanPlain !== targetPlain) {
    return NextResponse.json(
      { error: 'Realms do not belong to the same QB company' },
      { status: 400 },
    );
  }

  // Delete orphan first (releases the plain-text realmId unique slot),
  // then update target so the realmId normalization doesn't hit a unique conflict.
  await prisma.$transaction([
    prisma.realm.delete({ where: { id: orphanId } }),
    prisma.realm.update({
      where: { id: targetId },
      data: {
        realmId: orphanPlain,
        accessToken: orphan.accessToken,
        refreshToken: orphan.refreshToken,
        expiresAt: orphan.expiresAt,
        refreshExpiresAt: orphan.refreshExpiresAt,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, mergedIntoId: targetId });
}
