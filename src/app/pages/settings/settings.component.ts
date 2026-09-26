import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4 mb-3">Settings</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <a routerLink="/subscription" class="btn btn-outline-primary mb-4">Manage subscription</a>

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
