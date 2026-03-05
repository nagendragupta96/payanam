import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ItineraryService } from '../../services/itinerary.service';

@Component({
  selector: 'app-create-itinerary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4 mb-3">Post Trip</h2>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <input class="form-control mb-2" formControlName="origin_airport" placeholder="Origin airport" />
          <input class="form-control mb-2" formControlName="destination_airport" placeholder="Destination airport" />
          <input class="form-control mb-2" formControlName="destination" placeholder="Destination city/country" />
          <div class="row g-2 mb-2">
            <div class="col-md-6"><input class="form-control" type="date" formControlName="depart_date" /></div>
            <div class="col-md-6"><input class="form-control" type="date" formControlName="return_date" /></div>
          </div>

          <div formArrayName="legs">
            <div *ngFor="let leg of legs.controls; index as i" [formGroupName]="i" class="border rounded p-3 mb-2 bg-light">
              <h6>Leg {{ i + 1 }}</h6>
              <input class="form-control mb-2" formControlName="origin_airport" placeholder="Origin airport" />
              <input class="form-control mb-2" formControlName="destination_airport" placeholder="Destination airport" />
              <input class="form-control mb-2" formControlName="carrier" placeholder="Carrier" />
              <input class="form-control mb-2" formControlName="flight_number" placeholder="Flight Number" />
              <div class="row g-2">
                <div class="col-md-6"><input class="form-control" type="datetime-local" formControlName="departure_at" /></div>
                <div class="col-md-6"><input class="form-control" type="datetime-local" formControlName="arrival_at" /></div>
              </div>
            </div>
          </div>

          <button class="btn btn-outline-secondary me-2" type="button" (click)="addLeg()">Add leg</button>
          <button class="btn btn-primary" [disabled]="loading" type="submit">
            <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>Publish itinerary
          </button>
        </form>
        <p class="mt-3 mb-0">{{ message }}</p>
      </div>
    </div>
  `
})
export class CreateItineraryComponent {
  message = '';
  loading = false;

  form = this.fb.group({
    origin_airport: ['', Validators.required],
    destination_airport: ['', Validators.required],
    destination: [''],
    depart_date: ['', Validators.required],
    return_date: [''],
    notes: [''],
    legs: this.fb.array([this.createLegGroup()])
  });

  get legs(): FormArray {
    return this.form.get('legs') as FormArray;
  }

  constructor(
    private fb: FormBuilder,
    private itineraryService: ItineraryService,
    private authService: AuthService,
    private router: Router
  ) {}

  createLegGroup() {
    return this.fb.group({
      origin_airport: ['', Validators.required],
      destination_airport: ['', Validators.required],
      carrier: ['', Validators.required],
      flight_number: ['', Validators.required],
      departure_at: [''],
      arrival_at: ['']
    });
  }

  addLeg() {
    this.legs.push(this.createLegGroup());
  }

  async submit() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.form.invalid || this.loading) return;

    this.loading = true;

    const value = this.form.getRawValue();
    const itinerary = {
      origin_airport: value.origin_airport ?? '',
      destination_airport: value.destination_airport ?? '',
      destination: value.destination ?? null,
      depart_date: value.depart_date ?? '',
      return_date: value.return_date ?? null,
      notes: value.notes ?? null,
      legs: (value.legs ?? []).map((leg, index) => ({
        leg_order: index + 1,
        origin_airport: leg.origin_airport ?? '',
        destination_airport: leg.destination_airport ?? '',
        carrier: leg.carrier ?? '',
        flight_number: leg.flight_number ?? '',
        departure_at: leg.departure_at || null,
        arrival_at: leg.arrival_at || null
      }))
    };

    try {
      const error = await this.itineraryService.createItinerary(itinerary, userId);
      this.message = error ?? 'Itinerary published.';

      if (!error) {
        await this.router.navigate(['/my-trips']);
      }
    } finally {
      this.loading = false;
    }
  }
}
