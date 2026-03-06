import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
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
        <button class="btn btn-outline-primary btn-sm mb-3" (click)="load()">Refresh</button>

        <div class="table-responsive" *ngIf="trips.length; else empty">
          <table class="table table-striped align-middle">
            <thead>
              <tr>
                <th>Route</th>
                <th>Destination</th>
                <th>Dates</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let trip of trips">
                <td>{{ trip.origin_airport_code }} → {{ trip.destination_airport_code }}</td>
                <td>{{ trip.destination || '-' }}</td>
                <td>{{ trip.start_date }} → {{ trip.end_date || 'One way' }}</td>
                <td>
                  <a class="btn btn-sm btn-outline-primary me-2" [routerLink]="['/itinerary', trip.id]">View</a>
                  <button class="btn btn-sm btn-outline-danger" (click)="deleteTrip(trip.id!)">Delete</button>
                </td>
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

  constructor(private authService: AuthService, private itineraryService: ItineraryService) {
    this.load();
  }

  async load() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;
    const { data } = await this.itineraryService.listMyTrips(userId);
    this.trips = data;
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
