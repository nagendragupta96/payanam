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
      <input formControlName="title" placeholder="Trip title" />
      <input formControlName="destination" placeholder="Destination" />
      <input type="date" formControlName="startDate" />
      <input type="date" formControlName="endDate" />
      <div formArrayName="legs">
        <div *ngFor="let leg of legs.controls; index as i" [formGroupName]="i">
          <h4>Leg {{ i + 1 }}</h4>
          <input formControlName="originAirport" placeholder="Origin airport" />
          <input formControlName="destinationAirport" placeholder="Destination airport" />
          <input type="date" formControlName="departureDate" />
          <input type="date" formControlName="arrivalDate" />
          <input formControlName="carrier" placeholder="Carrier" />
          <input formControlName="flightNumber" placeholder="Flight Number" />
          <input formControlName="flightCode" placeholder="Flight code (AA123)" />
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
    title: ['', Validators.required],
    destination: ['', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    legs: this.fb.array([this.createLegGroup()]),
    notes: ['']
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
      originAirport: ['', Validators.required],
      destinationAirport: ['', Validators.required],
      departureDate: ['', Validators.required],
      arrivalDate: ['', Validators.required],
      carrier: ['', Validators.required],
      flightNumber: ['', Validators.required],
      flightCode: ['', Validators.required]
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
      title: value.title ?? '',
      destination: value.destination ?? '',
      startDate: value.startDate ?? '',
      endDate: value.endDate ?? '',
      notes: value.notes ?? '',
      legs: (value.legs ?? []).map((leg) => ({
        originAirport: leg.originAirport ?? '',
        destinationAirport: leg.destinationAirport ?? '',
        departureDate: leg.departureDate ?? '',
        arrivalDate: leg.arrivalDate ?? '',
        carrier: leg.carrier ?? '',
        flightNumber: leg.flightNumber ?? '',
        flightCode: leg.flightCode ?? ''
      }))
    };

    const error = await this.itineraryService.createItinerary(itinerary, userId);
    this.message = error ?? 'Itinerary published.';
  }
}
