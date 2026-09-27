import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AdminService } from '../services/admin.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const admin = inject(AdminService);
  const router = inject(Router);
  await auth.ensureInitialized();
  if (!auth.currentSession) return router.createUrlTree(['/auth']);
  try {
    return await admin.refreshAccess() || router.createUrlTree(['/admin-access']);
  } catch {
    return router.createUrlTree(['/admin-access'], { queryParams: { unavailable: '1' } });
  }
};
