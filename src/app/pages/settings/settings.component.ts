import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4 mb-3">Settings</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <p class="mb-2">Subscription management placeholder for future Stripe/Supabase billing integration.</p>
        <ul class="mb-4">
          <li>Free plan: basic search and requests</li>
          <li>Plus plan: priority matching and advanced filters</li>
        </ul>

        <div class="border rounded p-3 bg-light">
          <h3 class="h6 text-danger">Danger Zone</h3>
          <p class="small mb-3">Deleting your account removes profile data and app records. This cannot be undone.</p>
          <button class="btn btn-outline-danger" [disabled]="deleting" (click)="deleteAccount()">
            <span *ngIf="deleting" class="spinner-border spinner-border-sm me-2"></span>
            Delete Account
          </button>
        </div>
      </div>
    </div>
  `
})
export class SettingsComponent {
  deleting = false;
  errorMessage = '';
  infoMessage = '';

  constructor(private authService: AuthService) {}

  async deleteAccount() {
    if (this.deleting) return;

    const confirmed = window.confirm('Delete your account and all associated app data? This action cannot be undone.');
    if (!confirmed) return;

    this.deleting = true;
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
      this.deleting = false;
    }
  }
}
