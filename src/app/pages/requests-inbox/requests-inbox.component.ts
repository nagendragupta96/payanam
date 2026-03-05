import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';

@Component({
  selector: 'app-requests-inbox',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h2 class="h4 mb-0">Requests & Messages</h2>
          <button class="btn btn-outline-primary btn-sm" (click)="load()" [disabled]="loading">
            <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
            Refresh
          </button>
        </div>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <h3 class="h6">Incoming</h3>
        <ul class="list-group mb-3">
          <li class="list-group-item" *ngFor="let req of incoming">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <span>{{ req.status }} - {{ req.request_type || 'COMPANION' }} - {{ req.message || 'No message' }}</span>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-success" *ngIf="req.status === 'PENDING'" [disabled]="acceptingId === req.id" (click)="accept(req.id)">
                  <span *ngIf="acceptingId === req.id" class="spinner-border spinner-border-sm me-1"></span>
                  Accept
                </button>
                <button class="btn btn-sm btn-outline-primary" *ngIf="req.status === 'ACCEPTED'" (click)="openMessages(req.id)">Messages</button>
              </div>
            </div>
          </li>
        </ul>

        <h3 class="h6">Outgoing</h3>
        <ul class="list-group mb-0">
          <li class="list-group-item" *ngFor="let req of outgoing">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
              <span>{{ req.status }} - {{ req.request_type || 'COMPANION' }} - {{ req.message || 'No message' }}</span>
              <button class="btn btn-sm btn-outline-primary" *ngIf="req.status === 'ACCEPTED'" (click)="openMessages(req.id)">Messages</button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  `
})
export class RequestsInboxComponent {
  incoming: any[] = [];
  outgoing: any[] = [];
  loading = false;
  acceptingId = '';
  errorMessage = '';
  infoMessage = '';

  constructor(private authService: AuthService, private requestService: RequestService, private router: Router) {
    this.load();
  }

  async load() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.loading) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      const data = await this.requestService.inbox(userId);
      this.incoming = data.incoming;
      this.outgoing = data.outgoing;
      if (data.error) this.errorMessage = data.error;
    } finally {
      this.loading = false;
    }
  }

  async accept(requestId: string) {
    if (!requestId) return;
    this.acceptingId = requestId;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const { threadId, error } = await this.requestService.acceptRequest(requestId);
      if (error) {
        this.errorMessage = error;
        return;
      }
      this.infoMessage = 'Request accepted.';
      await this.load();
      if (threadId) {
        await this.router.navigate(['/messages', requestId]);
      }
    } finally {
      this.acceptingId = '';
    }
  }

  async openMessages(requestId: string) {
    await this.router.navigate(['/messages', requestId]);
  }
}
