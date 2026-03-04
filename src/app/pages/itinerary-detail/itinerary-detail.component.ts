import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RequestService, RequestType } from '../../services/request.service';

@Component({
  selector: 'app-itinerary-detail',
  standalone: true,
  template: `
    <h2>Itinerary Detail</h2>
    <p>Itinerary ID: {{ itineraryId }}</p>
    <button (click)="send('COMPANION')">Request Companion</button>
    <button (click)="send('ASSISTANCE')">Request Assistance</button>
    <p>{{ message }}</p>
  `
})
export class ItineraryDetailComponent {
  itineraryId = this.route.snapshot.paramMap.get('id') ?? '';
  message = '';

  constructor(private route: ActivatedRoute, private requestService: RequestService) {}

  async send(type: RequestType) {
    const error = await this.requestService.createRequest(this.itineraryId, type, 'TARGET_USER_ID');
    this.message = error ?? `${type} request sent.`;
  }
}
