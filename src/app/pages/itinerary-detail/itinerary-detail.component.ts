import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';

@Component({
  selector: 'app-itinerary-detail',
  standalone: true,
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4">Trip Detail</h2>
        <p class="text-muted">Itinerary ID: {{ itineraryId }}</p>
        <button class="btn btn-primary" (click)="send()">Send Request</button>
        <p class="mt-3 mb-0">{{ message }}</p>
      </div>
    </div>
  `
})
export class ItineraryDetailComponent {
  itineraryId = this.route.snapshot.paramMap.get('id') ?? '';
  message = '';

  constructor(
    private route: ActivatedRoute,
    private requestService: RequestService,
    private authService: AuthService
  ) {}

  async send() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) {
      this.message = 'Login required to send request.';
      return;
    }

    const error = await this.requestService.createRequest(this.itineraryId, userId, 'COMPANION');
    this.message = error ?? 'Request sent.';
  }
}
