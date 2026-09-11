import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { verifyAccessToken, type AccessRole } from '@/lib/server/access-token';

export async function GET() {
  const adminCode = process.env.ACCESS_CODE;
  const learnerCode = process.env.LEARNER_ACCESS_CODE;
  const enabled = !!adminCode;

  let authenticated = false;
  let role: AccessRole | null = null;
  if (enabled) {
    const cookieStore = await cookies();
    const token = cookieStore.get('openmaic_access')?.value;
    if (token) {
      role = verifyAccessToken(token, { admin: adminCode, learner: learnerCode });
      authenticated = role !== null;
    }
  }

  return apiSuccess({ enabled, authenticated, role });
}
