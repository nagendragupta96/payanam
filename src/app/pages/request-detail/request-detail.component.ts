import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestRecord, RequestService } from '../../services/request.service';

@Component({
  selector: 'app-request-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <button class="btn btn-link p-0 mb-2" type="button" (click)="goBack()">← Back to Requests</button>
        <h2 class="h4 mb-3">Request Details</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>
            <div class="alert alert-info" *ngIf="helpMessage">{{ helpMessage }}</div>

        <div *ngIf="loading" class="text-center py-4"><div class="spinner-border"></div></div>

        <div *ngIf="!loading && request">
          <p class="mb-1"><strong>Status:</strong> {{ request.status }}</p>
          <p class="mb-1"><strong>Type:</strong> {{ requestTypeLabel(request.request_type) }}</p>
          <p class="mb-3"><strong>Route:</strong>
            {{ request.itineraries?.origin_airport_code || '-' }} → {{ request.itineraries?.destination_airport_code || '-' }}
            ({{ request.itineraries?.start_date || '-' }} → {{ request.itineraries?.end_date || '-' }})
          </p>

          <form *ngIf="isRequester" [formGroup]="form" (ngSubmit)="saveMessage()" class="mb-3">
            <label class="form-label">Message (Optional) <button type="button" class="info-icon" (click)="showHelp('Add context for the trip owner, such as baggage size or travel preferences.')" aria-label="Request message help">ⓘ</button></label>
            <textarea rows="3" class="form-control mb-2" formControlName="message"></textarea>
            <button class="btn btn-primary btn-sm" [disabled]="savingMessage">
              <span *ngIf="savingMessage" class="spinner-border spinner-border-sm me-2"></span>
              Save Request
            </button>
          </form>

          <div class="d-flex gap-2 flex-wrap">
            <button *ngIf="isRequester && request.status === 'PENDING'" class="btn btn-outline-danger btn-sm" [disabled]="cancelling" (click)="cancelRequest()">
              <span *ngIf="cancelling" class="spinner-border spinner-border-sm me-2"></span>
              Cancel Request
            </button>
            <button *ngIf="isOwner && request.status === 'PENDING'" class="btn btn-success btn-sm" [disabled]="deciding" (click)="decide('ACCEPTED')">
              <span *ngIf="deciding" class="spinner-border spinner-border-sm me-2"></span>
              Accept
            </button>
            <button *ngIf="isOwner && request.status === 'PENDING'" class="btn btn-outline-danger btn-sm" [disabled]="deciding" (click)="decide('REJECTED')">
              Reject
            </button>
            <a *ngIf="request.status === 'ACCEPTED' && request.request_type !== 'CONTACT_DETAILS'" class="btn btn-outline-primary btn-sm" [routerLink]="['/messages']">Open Messages</a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .info-icon {
        display: inline-block;
        margin-left: 0.35rem;
        font-size: 0.85rem;
        color: #0d6efd;
        cursor: pointer;
        border: 1px solid #0d6efd;
        border-radius: 999px;
        background: #fff;
        width: 1.5rem;
        height: 1.5rem;
        line-height: 1;
        text-align: center;
        padding: 0;
      }
    `
  ]
})
export class RequestDetailComponent {
  loading = false;
  savingMessage = false;
  cancelling = false;
  deciding = false;
  errorMessage = '';
  infoMessage = '';
  helpMessage = '';

  request: RequestRecord | null = null;

  form = this.fb.group({ message: [''] });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private fb: FormBuilder,
    private authService: AuthService,
    private requestService: RequestService
  ) {
    this.load();
  }

  get isRequester(): boolean {
    return !!this.request && this.request.requester_id === this.authService.currentSession?.user.id;
  }

  get isOwner(): boolean {
    return !!this.request && this.request.owner_id === this.authService.currentSession?.user.id;
  }

  requestTypeLabel(type: RequestRecord['request_type']): string {
    if (type === 'CONTACT_DETAILS') return 'Contact Details';
    if (type === 'ASSISTANCE') return 'Assistance';
    return 'Companion';
  }

  async load() {
    const requestId = this.route.snapshot.paramMap.get('id') ?? '';
    const userId = this.authService.currentSession?.user.id;
    if (!requestId || !userId) return;

    this.loading = true;
    this.errorMessage = '';
    this.infoMessage = '';
    this.helpMessage = '';

    try {
      const result = await this.requestService.getRequestByIdForUser(requestId, userId);
      if (result.error || !result.data) {
        this.errorMessage = result.error ?? 'Request not found.';
        return;
      }

      this.request = result.data;
      this.form.patchValue({ message: this.request.message ?? '' });
    } finally {
      this.loading = false;
    }
  }

  async saveMessage() {
    if (!this.request || !this.isRequester || this.savingMessage) return;
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    this.savingMessage = true;
    this.errorMessage = '';
    this.infoMessage = '';
    this.helpMessage = '';

    try {
      const error = await this.requestService.updateRequestMessage(this.request.id, userId, this.form.value.message ?? null);
      if (error) {
        this.errorMessage = error;
        return;
      }

      await this.router.navigate(['/requests'], {
        queryParams: { info: 'Request saved successfully.' }
      });
    } finally {
      this.savingMessage = false;
    }
  }

  async goBack() {
    if (window.history.length > 1) {
      this.location.back();
      return;
    }

    await this.router.navigate(['/requests']);
  }

  async cancelRequest() {
    if (!this.request || !this.isRequester || this.cancelling) return;
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;

    this.cancelling = true;
    this.errorMessage = '';
    this.infoMessage = '';
    this.helpMessage = '';

    try {
      const error = await this.requestService.cancelRequest(this.request.id, userId);
      if (error) {
        this.errorMessage = error;
        return;
      }
      this.infoMessage = 'Request cancelled.';
      await this.load();
    } finally {
      this.cancelling = false;
    }
  }

  async decide(status: 'ACCEPTED' | 'REJECTED') {
    if (!this.request || !this.isOwner || this.deciding || this.request.status !== 'PENDING') return;

    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId) return;

    this.deciding = true;
    this.errorMessage = '';
    this.infoMessage = '';
    this.helpMessage = '';

    try {
      if (status === 'ACCEPTED') {
        const { error } = await this.requestService.acceptRequest(this.request.id);
        if (error) {
          this.errorMessage = error;
          return;
        }
        this.infoMessage = this.request.request_type === 'CONTACT_DETAILS'
          ? 'Contact details request accepted.'
          : 'Request accepted.';
      } else {
        const error = await this.requestService.updateRequestStatus(this.request.id, ownerId, 'REJECTED');
        if (error) {
          this.errorMessage = error;
          return;
        }
        this.infoMessage = 'Request rejected.';
      }

      await this.load();
    } finally {
      this.deciding = false;
    }
  }

  showHelp(message: string): void {
    this.helpMessage = message;
  }
}
