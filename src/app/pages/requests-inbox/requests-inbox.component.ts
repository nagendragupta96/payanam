import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';
import { RequestRecord, RequestService } from '../../services/request.service';

@Component({
  selector: 'app-requests-inbox',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h2 class="h4 mb-0">Requests</h2>
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
            <div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">
              <div>
                <div class="fw-semibold">Request received from {{ userLabel(req.requester_id) }}</div>
                <div class="small text-muted">{{ requestTypeLabel(req.request_type) }} • {{ req.status }}</div>
                <div class="small">
                  {{ req.itineraries?.origin_airport_code || '-' }} → {{ req.itineraries?.destination_airport_code || '-' }}
                  (<span class="date-cell">{{ req.itineraries?.start_date || '-' }} → {{ req.itineraries?.end_date || '-' }}</span>)
                </div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-success" *ngIf="req.status === 'PENDING' && !isContactDetailsRequest(req)" [disabled]="acceptingId === req.id" (click)="accept(req.id)">
                  <span *ngIf="acceptingId === req.id" class="spinner-border spinner-border-sm me-1"></span>
                  Accept
                </button>
                <button class="btn btn-sm btn-outline-danger" *ngIf="req.status === 'PENDING' && !isContactDetailsRequest(req)" [disabled]="rejectingId === req.id" (click)="reject(req.id)">
                  <span *ngIf="rejectingId === req.id" class="spinner-border spinner-border-sm me-1"></span>
                  Reject
                </button>
                <button class="btn btn-sm btn-success" *ngIf="req.status === 'PENDING' && isContactDetailsRequest(req)" [disabled]="acceptingId === req.id" (click)="accept(req.id)">
                  <span *ngIf="acceptingId === req.id" class="spinner-border spinner-border-sm me-1"></span>
                  Accept Contact Details
                </button>
                <button class="btn btn-sm btn-outline-danger" *ngIf="req.status === 'PENDING' && isContactDetailsRequest(req)" [disabled]="rejectingId === req.id" (click)="reject(req.id)">
                  <span *ngIf="rejectingId === req.id" class="spinner-border spinner-border-sm me-1"></span>
                  Reject Contact Details
                </button>
                <button class="btn btn-sm btn-outline-primary" (click)="openRequest(req.id)">Details</button>
                <button class="btn btn-sm btn-outline-primary" *ngIf="req.status === 'ACCEPTED' && req.request_type !== 'CONTACT_DETAILS'" (click)="openMessages(req.id)">Messages</button>
              </div>
            </div>
          </li>
        </ul>

        <h3 class="h6">Outgoing</h3>
        <ul class="list-group mb-0">
          <li class="list-group-item" *ngFor="let req of outgoing">
            <div class="d-flex justify-content-between gap-2 flex-wrap align-items-start">
              <div>
                <div class="fw-semibold">Request sent to {{ userLabel(req.owner_id) }}</div>
                <div class="small text-muted">{{ requestTypeLabel(req.request_type) }} • {{ req.status }}</div>
                <div class="small">
                  {{ req.itineraries?.origin_airport_code || '-' }} → {{ req.itineraries?.destination_airport_code || '-' }}
                  (<span class="date-cell">{{ req.itineraries?.start_date || '-' }} → {{ req.itineraries?.end_date || '-' }}</span>)
                </div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-primary" (click)="openRequest(req.id)">Details</button>
                <button class="btn btn-sm btn-outline-primary" *ngIf="req.status === 'ACCEPTED' && req.request_type !== 'CONTACT_DETAILS'" (click)="openMessages(req.id)">Messages</button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  `
})
export class RequestsInboxComponent {
  incoming: RequestRecord[] = [];
  outgoing: RequestRecord[] = [];
  loading = false;
  acceptingId = '';
  rejectingId = '';
  errorMessage = '';
  infoMessage = '';

  private labels: Record<string, string> = {};

  constructor(
    private authService: AuthService,
    private requestService: RequestService,
    private chatService: ChatService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.route.queryParamMap.subscribe((params) => {
      this.infoMessage = params.get('info') ?? '';
    });

    void this.load();
  }

  userLabel(id: string): string {
    return this.labels[id] || 'User';
  }

  requestTypeLabel(type: RequestRecord['request_type']): string {
    if (type === 'CONTACT_DETAILS') return 'Contact Details';
    if (type === 'ASSISTANCE') return 'Assistance';
    return 'Companion';
  }

  isContactDetailsRequest(request: RequestRecord): boolean {
    return request.request_type === 'CONTACT_DETAILS';
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

      const ids = [
        ...new Set([...this.incoming.map((r) => r.requester_id), ...this.outgoing.map((r) => r.owner_id), userId])
      ];
      this.labels = await this.chatService.getProfileNames(ids);
      if (!this.labels[userId]) {
        this.labels[userId] = this.authService.currentSession?.user.email || 'Me';
      }

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
      this.infoMessage = this.findRequestType(requestId) === 'CONTACT_DETAILS'
        ? 'Contact details request accepted.'
        : 'Request accepted.';
      await this.load();
      if (threadId) {
        await this.router.navigate(['/messages', threadId]);
      }
    } finally {
      this.acceptingId = '';
    }
  }

  async reject(requestId: string) {
    if (!requestId) return;
    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId) return;

    this.rejectingId = requestId;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const error = await this.requestService.updateRequestStatus(requestId, ownerId, 'REJECTED');
      if (error) {
        this.errorMessage = error;
        return;
      }

      this.infoMessage = 'Request rejected.';
      await this.load();
    } finally {
      this.rejectingId = '';
    }
  }

  async openMessages(requestId: string) {
    const thread = await this.chatService.getThreadByRequest(requestId);
    if (thread.error || !thread.data?.id) {
      this.errorMessage = thread.error ?? 'No chat thread found.';
      return;
    }
    await this.router.navigate(['/messages', thread.data.id]);
  }

  async openRequest(requestId: string) {
    await this.router.navigate(['/requests', requestId]);
  }

  private findRequestType(requestId: string): RequestRecord['request_type'] | null {
    return this.incoming.find((req) => req.id === requestId)?.request_type ?? null;
  }
}
