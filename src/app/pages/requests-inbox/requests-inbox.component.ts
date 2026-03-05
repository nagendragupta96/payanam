import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
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
          <button class="btn btn-outline-primary btn-sm" (click)="load()">Refresh</button>
        </div>

        <h3 class="h6">Incoming</h3>
        <ul class="list-group mb-3">
          <li class="list-group-item" *ngFor="let req of incoming">{{ req.status }} - {{ req.message || 'No message' }}</li>
        </ul>

        <h3 class="h6">Outgoing</h3>
        <ul class="list-group mb-0">
          <li class="list-group-item" *ngFor="let req of outgoing">{{ req.status }} - {{ req.message || 'No message' }}</li>
        </ul>

        <p class="mt-3 mb-0">{{ message }}</p>
      </div>
    </div>
  `
})
export class RequestsInboxComponent {
  incoming: any[] = [];
  outgoing: any[] = [];
  message = '';

  constructor(private authService: AuthService, private requestService: RequestService) {
    this.load();
  }

  async load() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;
    const data = await this.requestService.inbox(userId);
    this.incoming = data.incoming;
    this.outgoing = data.outgoing;
    this.message = data.error ?? 'Inbox loaded.';
  }
}
