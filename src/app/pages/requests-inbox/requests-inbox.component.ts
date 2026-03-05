import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';

@Component({
  selector: 'app-requests-inbox',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Requests Inbox</h2>
    <button (click)="load()">Refresh</button>

    <h3>Incoming</h3>
    <ul><li *ngFor="let req of incoming">{{ req.status }} - {{ req.message || 'No message' }}</li></ul>

    <h3>Outgoing</h3>
    <ul><li *ngFor="let req of outgoing">{{ req.status }} - {{ req.message || 'No message' }}</li></ul>

    <p>{{ message }}</p>
  `
})
export class RequestsInboxComponent {
  incoming: any[] = [];
  outgoing: any[] = [];
  message = '';

  constructor(private authService: AuthService, private requestService: RequestService) {}

  async load() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;
    const data = await this.requestService.inbox(userId);
    this.incoming = data.incoming;
    this.outgoing = data.outgoing;
    this.message = data.error ?? 'Inbox loaded.';
  }
}
