import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ItineraryService } from '../../services/itinerary.service';

@Component({
  selector: 'app-create-itinerary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <h2>Create Itinerary</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="origin_airport" placeholder="Origin airport" />
      <input formControlName="destination_airport" placeholder="Destination airport" />
      <input formControlName="destination" placeholder="Destination city/country" />
      <input type="date" formControlName="depart_date" />
      <input type="date" formControlName="return_date" />

      <div formArrayName="legs">
        <div *ngFor="let leg of legs.controls; index as i" [formGroupName]="i">
          <h4>Leg {{ i + 1 }}</h4>
          <input formControlName="origin_airport" placeholder="Origin airport" />
          <input formControlName="destination_airport" placeholder="Destination airport" />
          <input formControlName="carrier" placeholder="Carrier" />
          <input formControlName="flight_number" placeholder="Flight Number" />
          <input type="datetime-local" formControlName="departure_at" />
          <input type="datetime-local" formControlName="arrival_at" />
        </div>
      </div>

      <button type="button" (click)="addLeg()">Add leg</button>
      <button type="submit">Publish itinerary</button>
    </form>
    <p>{{ message }}</p>
  `
})
export class CreateItineraryComponent {
  message = '';

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
    private authService: AuthService
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
    if (!userId || this.form.invalid) return;

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

    const error = await this.itineraryService.createItinerary(itinerary, userId);
    this.message = error ?? 'Itinerary published.';
  }
}
