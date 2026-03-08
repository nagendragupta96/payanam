import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Itinerary } from '../../models/itinerary.model';
import { ItineraryService } from '../../services/itinerary.service';

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

        <div class="table-scroll-hint d-md-none">↔ Scroll sideways to see more columns</div>
        <div class="table-responsive has-scroll-hint" *ngIf="trips.length; else empty">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Actions</th>
                <th>Route</th>
                <th>Destination</th>
                <th>Dates</th>
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
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #empty><p class="text-muted">No trips posted yet.</p></ng-template>
      </div>
    </div>
  `
})
export class MyTripsComponent {
  trips: Itinerary[] = [];
  errorMessage = '';
  infoMessage = '';
  loading = false;

  constructor(private authService: AuthService, private itineraryService: ItineraryService, private route: ActivatedRoute) {
    this.route.queryParamMap.subscribe((params) => {
      this.infoMessage = params.get('info') ?? this.infoMessage;
    });

    this.load();
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
      if (error) this.errorMessage = error;
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
}
