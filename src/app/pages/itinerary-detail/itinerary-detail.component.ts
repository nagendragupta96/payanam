import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { RequestService } from '../../services/request.service';
import { ItineraryService } from '../../services/itinerary.service';
import { Itinerary } from '../../models/itinerary.model';

@Component({
  selector: 'app-itinerary-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <button class="btn btn-link p-0 mb-2" type="button" (click)="goBack()">← Back</button>
        <h2 class="h4">Trip Detail</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>

        <div *ngIf="loading" class="text-center py-3"><div class="spinner-border"></div></div>

        <div *ngIf="!loading && itinerary">
          <p><strong>Route:</strong> {{ itinerary.origin_airport_code }} → {{ itinerary.destination_airport_code }}</p>
          <p><strong>Travel:</strong> {{ itinerary.start_date }} → {{ itinerary.end_date || 'One way' }}</p>
          <p><strong>Languages:</strong> {{ languageList(itinerary) }}</p>

          <div class="alert alert-secondary" *ngIf="isSelfTrip">This is your trip.</div>

          <a class="btn btn-outline-primary me-2" *ngIf="isSelfTrip" routerLink="/community/new" [queryParams]="{trip: itinerary.id}">Post to Community</a>

          <a class="btn btn-outline-secondary me-2" *ngIf="isSelfTrip" [routerLink]="['/edit-itinerary', itinerary.id]">
            Edit Itinerary
          </a>

          <button class="btn btn-outline-danger me-2" *ngIf="isSelfTrip" [disabled]="loadingSend" (click)="deleteItinerary()">
            Delete Itinerary
          </button>

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

  async goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    await this.router.navigate(['/my-trips']);
  }

  constructor(
    private route: ActivatedRoute,
    private requestService: RequestService,
    private authService: AuthService,
    private itineraryService: ItineraryService,
    private router: Router
  ) {
    this.load();
  }

  get isSelfTrip(): boolean {
    return !!this.itinerary && this.itinerary.owner_id === this.authService.currentSession?.user.id;
  }

  languageList(itinerary: Itinerary): string {
    return itinerary.languages_known?.length ? itinerary.languages_known.join(', ') : '-';
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
      const result = await this.requestService.createOrGetRequest(this.itineraryId, userId, 'COMPANION');
      if (result.error || !result.data) {
        this.errorMessage = result.error ?? 'Unable to create request.';
        return;
      }
      this.infoMessage = result.existing ? 'Request already exists.' : 'Request sent.';
      await this.router.navigate(['/requests', result.data.id]);
    } finally {
      this.loadingSend = false;
    }
  }

  async deleteItinerary() {
    if (!this.itinerary || !this.isSelfTrip) return;
    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId) return;

    const confirmed = window.confirm('Delete this itinerary and related requests/contact data?');
    if (!confirmed) return;

    this.loadingSend = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const error = await this.itineraryService.deleteItinerary(this.itinerary.id!, ownerId);
      if (error) {
        this.errorMessage = error;
        return;
      }

      this.infoMessage = 'Itinerary deleted successfully.';
      await this.router.navigate(['/my-trips']);
    } finally {
      this.loadingSend = false;
    }
  }
}
