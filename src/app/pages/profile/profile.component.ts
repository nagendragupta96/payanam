import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { supabase } from '../../services/supabase-client';
import { AuthService } from '../../services/auth.service';
import { HelpIconComponent } from '../../shared/help-icon.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HelpIconComponent],
  template: `
    <div class="card shadow-sm mb-4">
      <div class="card-body">
        <h2 class="h4 mb-3">Profile</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <form [formGroup]="form" (ngSubmit)="save()" novalidate>
          <div class="mb-3">
            <label class="form-label" for="displayName">Display Name (Optional)
              <app-help-icon [text]="'This is how other users will see your name.'" ariaLabel="Display name help"></app-help-icon>
            </label>
            <input id="displayName" class="form-control" formControlName="displayName" />
          </div>

          <div class="mb-3">
            <label class="form-label" for="avatarUrl">Avatar URL (Optional)
              <app-help-icon [text]="'Paste an image URL if you want a profile picture.'" ariaLabel="Avatar URL help"></app-help-icon>
            </label>
            <input id="avatarUrl" class="form-control" formControlName="avatarUrl" />
          </div>

          <button class="btn btn-primary" [disabled]="savingProfile" type="submit">
            <span *ngIf="savingProfile" class="spinner-border spinner-border-sm me-2"></span>
            Save Profile
          </button>
        </form>
      </div>
    </div>

    <div class="card border-danger shadow-sm">
      <div class="card-body">
        <h3 class="h5 text-danger mb-2">Delete Account</h3>
        <p class="mb-3">
          This action permanently deletes your profile and account data. It cannot be undone.
        </p>

        <button class="btn btn-danger" [disabled]="deletingAccount" (click)="deleteAccount()">
          <span *ngIf="deletingAccount" class="spinner-border spinner-border-sm me-2"></span>
          Delete Account
        </button>
      </div>
    </div>
  `,
  styles: [
    `
    `
  ]
})
export class ProfileComponent {
  errorMessage = '';
  infoMessage = '';
  savingProfile = false;
  deletingAccount = false;

  form = this.fb.group({
    displayName: [''],
    avatarUrl: ['']
  });

  constructor(private fb: FormBuilder, private authService: AuthService) {
    void this.loadProfile();
  }

  async loadProfile() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      this.errorMessage = error.message;
      return;
    }

    this.form.patchValue({
      displayName: data?.display_name ?? '',
      avatarUrl: data?.avatar_url ?? ''
    });
  }

  async save() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.savingProfile) return;

    this.savingProfile = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const { error } = await supabase.from('profiles').upsert({
        id: userId,
        display_name: this.form.value.displayName,
        avatar_url: this.form.value.avatarUrl
      });

      if (error) {
        this.errorMessage = error.message;
        return;
      }

      this.infoMessage = 'Profile saved.';
    } finally {
      this.savingProfile = false;
    }
  }

  async deleteAccount() {
    if (this.deletingAccount) return;

    const confirmed = window.confirm('Delete your account permanently? This action cannot be undone.');
    if (!confirmed) return;

    this.deletingAccount = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const error = await this.authService.deleteCurrentAccount();
      if (error) {
        this.errorMessage = error;
        return;
      }

      this.infoMessage = 'Account deleted successfully.';
    } finally {
      this.deletingAccount = false;
    }
  }

}
