import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [ReactiveFormsModule],
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
            <form [formGroup]="form" (ngSubmit)="submit()">
              <input class="form-control mb-2" placeholder="Email" formControlName="email" />
              <input class="form-control mb-3" placeholder="Password" type="password" formControlName="password" />
              <button class="btn btn-primary" type="submit">{{ mode === 'login' ? 'Login' : 'Create account' }}</button>
              <button class="btn btn-link" type="button" (click)="toggleMode()">
                {{ mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Login' }}
              </button>
            </form>
            <p class="mt-3 mb-0" [class.text-danger]="isError">{{ message }}</p>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AuthComponent {
  mode: 'login' | 'signup' = 'login';
  message = '';
  isError = false;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor(private fb: FormBuilder, private authService: AuthService, private router: Router) {}

  toggleMode() {
    this.mode = this.mode === 'login' ? 'signup' : 'login';
    this.message = '';
    this.isError = false;
  }

  async submit() {
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    const error = this.mode === 'login'
      ? await this.authService.login(email!, password!)
      : await this.authService.signup(email!, password!);

    if (error) {
      this.isError = true;
      this.message = error;
      return;
    }

    this.isError = false;

    if (this.mode === 'login') {
      this.message = 'Login successful.';
      await this.router.navigate(['/home']);
      return;
    }

    this.message = 'Signup successful. Please verify your email before login.';
  }
}
