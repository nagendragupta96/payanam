import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <h2>Auth</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <input placeholder="Email" formControlName="email" />
      <input placeholder="Password" type="password" formControlName="password" />
      <button type="submit">{{ mode === 'login' ? 'Login' : 'Sign up' }}</button>
    </form>
    <button (click)="toggleMode()">Switch to {{ mode === 'login' ? 'Signup' : 'Login' }}</button>
    <p>{{ message }}</p>
  `
})
export class AuthComponent {
  mode: 'login' | 'signup' = 'login';
  message = '';

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  constructor(private fb: FormBuilder, private authService: AuthService) {}

  toggleMode() {
    this.mode = this.mode === 'login' ? 'signup' : 'login';
  }

  async submit() {
    if (this.form.invalid) return;
    const { email, password } = this.form.getRawValue();
    const error = this.mode === 'login'
      ? await this.authService.login(email!, password!)
      : await this.authService.signup(email!, password!);

    this.message = error ?? 'Success. Check your email if confirmation is enabled.';
  }
}
