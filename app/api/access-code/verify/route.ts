import { cookies } from 'next/headers';
import { timingSafeEqual } from 'crypto';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createAccessToken, type AccessRole } from '@/lib/server/access-token';

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  return bufA.byteLength === bufB.byteLength && timingSafeEqual(bufA, bufB);
}

export async function POST(request: Request) {
  const adminCode = process.env.ACCESS_CODE;
  const learnerCode = process.env.LEARNER_ACCESS_CODE;
  if (!adminCode) {
    return apiSuccess({ valid: true, role: 'admin' as AccessRole });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  if (!body.code) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  // Check both codes with constant-time comparison. Order doesn't leak
  // anything since both branches always run the same comparison shape.
  const isAdmin = safeEqual(body.code, adminCode);
  const isLearner = !!learnerCode && safeEqual(body.code, learnerCode);

  const role: AccessRole | null = isAdmin ? 'admin' : isLearner ? 'learner' : null;
  if (!role) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  const codeForRole = role === 'admin' ? adminCode : (learnerCode as string);
  const token = createAccessToken(role, codeForRole);
  const cookieStore = await cookies();
  cookieStore.set('openmaic_access', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === 'production',
  });

  return apiSuccess({ valid: true, role });
}
