import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="row justify-content-center">
      <div class="col-lg-8">
        <div class="card shadow-sm mb-4">
          <div class="card-body">
            <h2 class="h4 mb-3">Welcome to Payanam</h2>
            <ul class="mb-0">
              <li>This platform helps travelers find travel companions with similar itineraries</li>
              <li>Assist elderly travelers during airport connections</li>
              <li>Match travelers based on destination and travel dates</li>
              <li>Communicate safely within the platform</li>
            </ul>
          </div>
        </div>

        <div class="card shadow-sm">
          <div class="card-body">
            <h3 class="h5 mb-3">{{ mode === 'login' ? 'Login' : 'Sign up' }}</h3>

            <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
            <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

            <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
              <div class="mb-2">
                <label class="form-label" for="authEmail">Email Address <span class="text-danger">*</span>
                  <span class="info-icon" tabindex="0" title="Use the email address for your Payanam account." aria-label="Email help">ⓘ</span>
                </label>
                <input id="authEmail" class="form-control" formControlName="email" />
              </div>

              <div class="mb-2">
                <label class="form-label" for="authPassword">Password <span class="text-danger">*</span>
                  <span class="info-icon" tabindex="0" title="Password must be at least 6 characters." aria-label="Password help">ⓘ</span>
                </label>
                <input id="authPassword" class="form-control" type="password" formControlName="password" />
              </div>

              <div class="mb-3" *ngIf="mode === 'signup'">
                <label class="form-label" for="displayName">Display Name <span class="text-danger">*</span>
                  <span class="info-icon" tabindex="0" title="This name is shown to other users in requests and chat." aria-label="Display name help">ⓘ</span>
                </label>
                <input id="displayName" class="form-control" formControlName="displayName" />
              </div>

              <button class="btn btn-primary" [disabled]="loading" type="submit">
                <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
                {{ mode === 'login' ? 'Login' : 'Create account' }}
              </button>
              <button class="btn btn-link" [disabled]="loading" type="button" (click)="toggleMode()">
                {{ mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Login' }}
              </button>
            </form>

            <div *ngIf="mode === 'login'" class="mt-3">
              <div class="text-muted small mb-2">Or continue with</div>
              <div class="d-flex gap-2 flex-wrap">
                <button class="btn btn-light border d-inline-flex align-items-center gap-2 px-3 py-2 google-btn" type="button" [disabled]="loading" (click)="oauthGoogle()">
                  <span aria-hidden="true" class="google-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.2-.9 2.2-1.9 2.9l3 2.3c1.8-1.6 2.8-4 2.8-6.9 0-.6-.1-1.2-.2-1.8H12z"/>
                      <path fill="#34A853" d="M12 22c2.6 0 4.8-.9 6.4-2.5l-3-2.3c-.8.5-1.9.9-3.4.9-2.6 0-4.8-1.7-5.6-4.1l-3.1 2.4C4.9 19.7 8.2 22 12 22z"/>
                      <path fill="#4A90E2" d="M6.4 14c-.2-.5-.3-1.2-.3-1.8s.1-1.2.3-1.8L3.3 8c-.7 1.3-1.1 2.7-1.1 4.2s.4 3 1.1 4.2L6.4 14z"/>
                      <path fill="#FBBC05" d="M12 6.3c1.4 0 2.7.5 3.7 1.4l2.8-2.8C16.8 3.3 14.6 2.4 12 2.4 8.2 2.4 4.9 4.7 3.3 8l3.1 2.4c.8-2.4 3-4.1 5.6-4.1z"/>
                    </svg>
                  </span>
                  Continue with Google
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .google-btn {
        color: #1f2937;
        font-weight: 500;
      }

      .google-btn:hover,
      .google-btn:focus {
        background-color: #f8f9fc;
        border-color: #d0d7e2;
      }

      .google-icon {
        line-height: 0;
        display: inline-flex;
      }

      .info-icon {
        display: inline-block;
        margin-left: 0.35rem;
        font-size: 0.85rem;
        color: #0d6efd;
        cursor: help;
      }
    `
  ]
})
export class AuthComponent implements OnDestroy {
  mode: 'login' | 'signup' = 'login';
  errorMessage = '';
  infoMessage = '';
  loading = false;

  private authSubscription: Subscription;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    displayName: ['']
  });

  constructor(private fb: FormBuilder, private authService: AuthService, private router: Router) {
    this.authSubscription = this.authService.session$.subscribe((session) => {
      if (session) {
        this.errorMessage = '';
        this.infoMessage = 'Login successful. Redirecting...';
        void this.router.navigate(['/home']);
      }
    });

    if (this.authService.currentSession) {
      void this.router.navigate(['/home']);
    }
  }

  ngOnDestroy(): void {
    this.authSubscription.unsubscribe();
  }

  toggleMode() {
    this.mode = this.mode === 'login' ? 'signup' : 'login';
    this.errorMessage = '';
    this.infoMessage = '';

    const displayNameCtrl = this.form.get('displayName');
    if (this.mode === 'signup') {
      displayNameCtrl?.setValidators([Validators.required, Validators.minLength(2)]);
    } else {
      displayNameCtrl?.clearValidators();
    }
    displayNameCtrl?.updateValueAndValidity();
  }

  async submit() {
    if (this.form.invalid || this.loading) return;
    this.loading = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const { email, password, displayName } = this.form.getRawValue();
      const error = this.mode === 'login'
        ? await this.authService.login(email!, password!)
        : await this.authService.signup(email!, password!, displayName ?? '');

      if (error) {
        this.errorMessage = error;
        return;
      }

      if (this.mode === 'login') {
        this.infoMessage = 'Login successful. Redirecting...';
        await this.router.navigate(['/home']);
        return;
      }

      this.infoMessage = 'Signup successful. Please check your email to confirm your account.';
    } finally {
      this.loading = false;
    }
  }

  async oauthGoogle() {
    if (this.loading) return;
    this.loading = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const error = await this.authService.loginWithOAuth('google');
      if (error) {
        this.errorMessage = error;
        return;
      }

      this.infoMessage = 'Redirecting to Google login...';
    } finally {
      this.loading = false;
    }
  }
}
