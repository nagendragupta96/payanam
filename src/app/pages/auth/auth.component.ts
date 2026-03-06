import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
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

            <form [formGroup]="form" (ngSubmit)="submit()">
              <input class="form-control mb-2" placeholder="Email" formControlName="email" />
              <input class="form-control mb-2" placeholder="Password" type="password" formControlName="password" />
              <input *ngIf="mode === 'signup'" class="form-control mb-3" placeholder="Display Name" formControlName="displayName" />

              <button class="btn btn-primary" [disabled]="loading" type="submit">
                <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
                {{ mode === 'login' ? 'Login' : 'Create account' }}
              </button>
              <button class="btn btn-link" [disabled]="loading" type="button" (click)="toggleMode()">
                {{ mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Login' }}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AuthComponent {
  mode: 'login' | 'signup' = 'login';
  errorMessage = '';
  infoMessage = '';
  loading = false;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    displayName: ['']
  });

  constructor(private fb: FormBuilder, private authService: AuthService, private router: Router) {}

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
        this.infoMessage = 'Login successful.';
        await this.router.navigate(['/home']);
        return;
      }

      this.infoMessage = 'Signup successful. Please verify your email before login.';
    } finally {
      this.loading = false;
    }
  }
}
