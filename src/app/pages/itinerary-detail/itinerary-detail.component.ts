import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';

@Component({
  selector: 'app-itinerary-detail',
  standalone: true,
  template: `
    <h2>Itinerary Detail</h2>
    <p>Itinerary ID: {{ itineraryId }}</p>
    <button (click)="send()">Send Request</button>
    <p>{{ message }}</p>
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

    const error = await this.requestService.createRequest(this.itineraryId, userId);
    this.message = error ?? 'Request sent.';
  }
}
