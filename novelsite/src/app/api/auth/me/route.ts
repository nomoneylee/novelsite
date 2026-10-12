import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';
import { usersRepo } from '@/lib/repositories';
import type { Role } from '@/lib/auth/sessionToken';

/** 契約見 contracts/http-api.md §4 —— role 取自資料庫而非快照 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE.name)?.value;
  const session = await readSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: '尚未登入' } },
      { status: 401 }
    );
  }

  const user = await usersRepo.findById(session.uid);
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: '尚未登入' } },
      { status: 401 }
    );
  }

  return NextResponse.json({
    data: {
      user: { id: user.id, name: user.name, email: user.email, role: user.role as Role },
    },
  });
}
