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
      <input formControlName="displayName" placeholder="Display name" />
      <input formControlName="avatarUrl" placeholder="Avatar URL" />
      <button>Save Profile</button>
    </form>
    <p>{{ message }}</p>
  `
})
export class ProfileComponent {
  message = '';

  form = this.fb.group({
    displayName: [''],
    avatarUrl: ['']
  });

  constructor(private fb: FormBuilder, private authService: AuthService) {
    this.loadProfile();
  }

  async loadProfile() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    this.form.patchValue({
      displayName: data?.display_name ?? '',
      avatarUrl: data?.avatar_url ?? ''
    });
  }

  async save() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      display_name: this.form.value.displayName,
      avatar_url: this.form.value.avatarUrl
    });

    this.message = error?.message ?? 'Profile saved.';
  }
}
