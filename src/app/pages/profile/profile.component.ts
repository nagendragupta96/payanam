import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { supabase } from '../../services/supabase-client';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <h2>Profile</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <input formControlName="fullName" placeholder="Full name" />
      <input formControlName="homeAirport" placeholder="Home airport" />
      <textarea formControlName="bio" placeholder="Travel style and assistance needs"></textarea>
      <button>Save Profile</button>
    </form>
    <p>{{ message }}</p>
  `
})
export class ProfileComponent {
  message = '';

  form = this.fb.group({
    fullName: [''],
    homeAirport: [''],
    bio: ['']
  });

  constructor(private fb: FormBuilder, private authService: AuthService) {}

  async save() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: this.form.value.fullName,
      home_airport: this.form.value.homeAirport,
      bio: this.form.value.bio
    });

    this.message = error?.message ?? 'Profile saved.';
  }
}
