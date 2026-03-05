import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Itinerary } from '../../models/itinerary.model';
import { ItineraryService } from '../../services/itinerary.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <h2 class="mb-3">Search itineraries</h2>

    <form [formGroup]="form" (ngSubmit)="search()" class="card card-body mb-4">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Destination country/city *</label>
          <input formControlName="destination" class="form-control" placeholder="e.g. Tokyo or Japan" />
        </div>

        <div class="col-md-3">
          <label class="form-label">Start date *</label>
          <input type="date" formControlName="userStart" class="form-control" />
        </div>

        <div class="col-md-3">
          <label class="form-label">End date *</label>
          <input type="date" formControlName="userEnd" class="form-control" />
        </div>

        <div class="col-md-6">
          <label class="form-label">Airport code (optional)</label>
          <input formControlName="airport" class="form-control" placeholder="e.g. DXB" />
        </div>

        <div class="col-md-6">
          <label class="form-label">Flight code (optional)</label>
          <input formControlName="flightCode" class="form-control" placeholder="e.g. EK 512" />
        </div>
      </div>

      <div class="mt-3 d-flex gap-2">
        <button type="submit" class="btn btn-primary">Search</button>
      </div>
    </form>

    <p class="mb-3">{{ message }}</p>

    <div class="table-responsive" *ngIf="results.length">
      <table class="table table-striped table-hover align-middle">
        <thead>
          <tr>
            <th>Route</th>
            <th>Destination</th>
            <th>Dates</th>
            <th>Legs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let item of results">
            <td>{{ item.origin_airport }} → {{ item.destination_airport }}</td>
            <td>{{ item.destination || '-' }}</td>
            <td>{{ item.depart_date }} → {{ item.return_date || 'One way' }}</td>
            <td>{{ item.legs.length }}</td>
            <td>
              <a class="btn btn-sm btn-outline-primary" [routerLink]="['/itinerary', item.id]">View</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class SearchComponent {
  message = 'Enter destination + date window to search.';
  results: Itinerary[] = [];

  form = this.fb.group({
    destination: ['', Validators.required],
    userStart: ['', Validators.required],
    userEnd: ['', Validators.required],
    airport: [''],
    flightCode: ['']
  });

  constructor(private fb: FormBuilder, private itineraryService: ItineraryService) {}

  async search() {
    if (this.form.invalid) {
      this.message = 'Destination, start date, and end date are required.';
      return;
    }

    const value = this.form.getRawValue();
    const { data, error } = await this.itineraryService.search({
      destination: value.destination ?? '',
      userStart: value.userStart ?? '',
      userEnd: value.userEnd ?? '',
      airport: value.airport ?? undefined,
      flightCode: value.flightCode ?? undefined
    });

    this.results = data;
    this.message = error ?? `${data.length} itinerary(ies) found. Sorted by strongest match.`;
  }
}
