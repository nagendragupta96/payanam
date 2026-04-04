import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { Itinerary } from '../../models/itinerary.model';
import { ItineraryService } from '../../services/itinerary.service';
import { RequestService } from '../../services/request.service';

@Component({
  selector: 'app-my-trips',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4 mb-3">My Trips</h2>
        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>
        <button class="btn btn-outline-primary btn-sm mb-3" (click)="refresh()">Refresh</button>
        <div *ngIf="loading" class="text-center py-2"><div class="spinner-border spinner-border-sm me-2"></div>Loading trips...</div>

        <div class="table-scroll-hint d-md-none">↔ Scroll sideways to see more columns</div>
        <div class="table-responsive has-scroll-hint" *ngIf="trips.length; else empty">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Actions</th>
                <th>Route</th>
                <th>Destination</th>
                <th>Dates</th>
                <th>Request Count</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let trip of trips">
                <td><div class="d-flex flex-wrap gap-2">
                  <a class="btn btn-sm btn-outline-primary" [routerLink]="['/itinerary', trip.id]">View</a>
                  <a class="btn btn-sm btn-outline-secondary" [routerLink]="['/edit-itinerary', trip.id]">Edit Itinerary</a>
                  <button class="btn btn-sm btn-outline-danger" (click)="deleteTrip(trip.id!)">Delete</button>
                </div></td>
                <td class="route-cell">{{ trip.origin_airport_code }} → {{ trip.destination_airport_code }}</td>
                <td>{{ trip.destination || '-' }}</td>
                <td class="date-cell">{{ trip.start_date }} → {{ trip.end_date || 'One way' }}</td>
                <td>{{ requestCount(trip.id) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #empty><p class="text-muted">No trips posted yet.</p></ng-template>
      </div>
    </div>
  `
})
export class MyTripsComponent implements OnDestroy {
  trips: Itinerary[] = [];
  errorMessage = '';
  infoMessage = '';
  loading = false;
  requestCounts: Record<string, number> = {};
  private readonly subscriptions = new Subscription();

  constructor(
    private authService: AuthService,
    private itineraryService: ItineraryService,
    private requestService: RequestService,
    private route: ActivatedRoute
  ) {
    this.subscriptions.add(this.route.queryParamMap.subscribe((params) => {
      this.infoMessage = params.get('info') ?? this.infoMessage;
    }));

    this.subscriptions.add(this.authService.appForeground$.subscribe(() => {
      console.debug('[my-trips] foreground event -> refreshing trips');
      void this.load();
    }));

    this.load();
  }

  requestCount(itineraryId?: string): number {
    if (!itineraryId) return 0;
    return this.requestCounts[itineraryId] ?? 0;
  }

  async refresh() {
    this.errorMessage = '';
    this.infoMessage = '';
    await this.load();
  }

  async load() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.loading) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      const { data, error } = await this.itineraryService.listMyTrips(userId);
      this.trips = data;
      const itineraryIds = this.trips.map((trip) => trip.id!).filter(Boolean);
      const countResult = await this.requestService.getCountsForItineraries(itineraryIds);
      this.requestCounts = countResult.counts;
      if (error) this.errorMessage = error;
      if (countResult.error) this.errorMessage = this.errorMessage || countResult.error;
    } finally {
      this.loading = false;
    }
  }

  async deleteTrip(itineraryId: string) {
    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId || !itineraryId) return;

    const confirmed = window.confirm('Delete this itinerary and related data? This action cannot be undone.');
    if (!confirmed) return;

    this.errorMessage = '';
    this.infoMessage = '';

    const error = await this.itineraryService.deleteItinerary(itineraryId, ownerId);
    if (error) {
      this.errorMessage = error;
      return;
    }

    this.infoMessage = 'Itinerary deleted successfully.';
    await this.load();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
