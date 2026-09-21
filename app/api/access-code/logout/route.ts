import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('openmaic_access');
  return apiSuccess({ loggedOut: true });
}
