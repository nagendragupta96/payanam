import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';
import { ItineraryService } from '../../services/itinerary.service';
import { Itinerary } from '../../models/itinerary.model';

@Component({
  selector: 'app-itinerary-detail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4">Trip Detail</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <div *ngIf="loading" class="text-center py-3"><div class="spinner-border"></div></div>

        <div *ngIf="!loading && itinerary">
          <p><strong>Route:</strong> {{ itinerary.origin_airport_code }} → {{ itinerary.destination_airport_code }}</p>
          <p><strong>Travel:</strong> {{ itinerary.start_date }} → {{ itinerary.end_date || 'One way' }}</p>
          <p><strong>Destination:</strong> {{ itinerary.destination || '-' }}</p>

          <div class="alert alert-secondary" *ngIf="isSelfTrip">This is your trip.</div>

          <button class="btn btn-primary" *ngIf="!isSelfTrip" [disabled]="loadingSend" (click)="send()">
            <span *ngIf="loadingSend" class="spinner-border spinner-border-sm me-2"></span>
            Send Request
          </button>
        </div>
      </div>
    </div>
  `
})
export class ItineraryDetailComponent {
  itineraryId = this.route.snapshot.paramMap.get('id') ?? '';
  itinerary: Itinerary | null = null;
  errorMessage = '';
  infoMessage = '';
  loading = false;
  loadingSend = false;

  constructor(
    private route: ActivatedRoute,
    private requestService: RequestService,
    private authService: AuthService,
    private itineraryService: ItineraryService
  ) {
    this.load();
  }

  get isSelfTrip(): boolean {
    return !!this.itinerary && this.itinerary.owner_id === this.authService.currentSession?.user.id;
  }

  async load() {
    if (!this.itineraryId) return;
    this.loading = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const result = await this.itineraryService.findById(this.itineraryId);
      if (result.error || !result.data) {
        this.errorMessage = result.error ?? 'Unable to load trip.';
        return;
      }
      this.itinerary = result.data;
    } finally {
      this.loading = false;
    }
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) {
      this.errorMessage = 'Login required to send request.';
      return;
    }

    if (!this.itinerary || this.isSelfTrip) {
      this.errorMessage = 'You cannot request your own trip.';
      return;
    }

    this.loadingSend = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const error = await this.requestService.createRequest(this.itineraryId, userId, 'COMPANION');
      if (error) {
        this.errorMessage = error;
        return;
      }
      this.infoMessage = 'Request sent.';
    } finally {
      this.loadingSend = false;
    }
  }
}
