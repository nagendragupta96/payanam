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

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>
        <div class="alert alert-warning" *ngIf="warningMessage">{{ warningMessage }}</div>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <div class="row g-2 mb-2">
            <div class="col-md-6">
              <label class="form-label">Origin Airport Code</label>
              <input class="form-control" formControlName="origin_airport_code" placeholder="e.g. DXB" />
            </div>
            <div class="col-md-6">
              <label class="form-label">Destination Airport Code</label>
              <input class="form-control" formControlName="destination_airport_code" placeholder="e.g. HND" />
            </div>
          </div>

          <input class="form-control mb-2" formControlName="destination" placeholder="Destination city/country" />

          <div class="row g-2 mb-2">
            <div class="col-md-6">
              <label class="form-label">Start Date</label>
              <input class="form-control" type="date" formControlName="start_date" />
            </div>
            <div class="col-md-6">
              <label class="form-label">End Date</label>
              <input class="form-control" type="date" formControlName="end_date" />
            </div>
          </div>

          <div formArrayName="legs">
            <div *ngFor="let leg of legs.controls; index as i" [formGroupName]="i" class="border rounded p-3 mb-2 bg-light">
              <h6>Leg {{ i + 1 }}</h6>
              <div class="row g-2">
                <div class="col-md-6"><input class="form-control" formControlName="origin_airport_code" placeholder="Origin airport code" /></div>
                <div class="col-md-6"><input class="form-control" formControlName="destination_airport_code" placeholder="Destination airport code" /></div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-md-6"><input class="form-control" formControlName="carrier" placeholder="Carrier" /></div>
                <div class="col-md-6"><input class="form-control" formControlName="flight_number" placeholder="Flight Number" /></div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-md-6"><input class="form-control" type="datetime-local" formControlName="departure_at" /></div>
                <div class="col-md-6"><input class="form-control" type="datetime-local" formControlName="arrival_at" /></div>
              </div>
            </div>
          </div>

          <div class="card border-0 bg-light mt-3">
            <div class="card-body">
              <h3 class="h6 mb-3">Contact Details (Optional)</h3>
              <p class="small text-muted mb-3">These details are attached to this trip and can be shared per request access rules.</p>

              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label">Contact Name</label>
                  <input class="form-control" formControlName="contact_name" placeholder="Name" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Contact Phone</label>
                  <input class="form-control" formControlName="contact_phone" placeholder="Phone" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Contact Email</label>
                  <input class="form-control" formControlName="contact_email" placeholder="Email" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Notes</label>
                  <input class="form-control" formControlName="contact_notes" placeholder="Optional notes" />
                </div>
              </div>
            </div>
          </div>

          <button class="btn btn-outline-secondary me-2 mt-3" type="button" (click)="addLeg()" [disabled]="loading">Add leg</button>
          <button class="btn btn-primary mt-3" [disabled]="loading" type="submit">
            <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
            Publish itinerary
          </button>
        </form>
      </div>
    </div>
  `
})
export class CreateItineraryComponent {
  loading = false;
  errorMessage = '';
  infoMessage = '';
  warningMessage = '';

  private readonly airportCodePattern = /^[A-Z]{3,4}$/;

  form = this.fb.group({
    origin_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
    destination_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
    destination: [''],
    start_date: ['', Validators.required],
    end_date: ['', Validators.required],
    notes: [''],
    contact_name: [''],
    contact_phone: [''],
    contact_email: [''],
    contact_notes: [''],
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
      origin_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
      destination_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
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
    this.errorMessage = '';
    this.infoMessage = '';
    this.warningMessage = '';

    const value = this.form.getRawValue();
    const normalize = (code: string | null | undefined) => (code ?? '').replace(/\s+/g, '').toUpperCase();

    const itinerary = {
      origin_airport_code: normalize(value.origin_airport_code),
      destination_airport_code: normalize(value.destination_airport_code),
      destination: value.destination ?? null,
      start_date: value.start_date ?? '',
      end_date: value.end_date ?? value.start_date ?? '',
      notes: value.notes ?? null,
      contact_details: {
        contact_name: value.contact_name ?? null,
        contact_phone: value.contact_phone ?? null,
        contact_email: value.contact_email ?? null,
        notes: value.contact_notes ?? null
      },
      legs: (value.legs ?? []).map((leg, index) => ({
        leg_order: index + 1,
        origin_airport_code: normalize(leg.origin_airport_code),
        destination_airport_code: normalize(leg.destination_airport_code),
        carrier: leg.carrier ?? '',
        flight_number: leg.flight_number ?? '',
        departure_at: leg.departure_at || null,
        arrival_at: leg.arrival_at || null
      }))
    };

    try {
      const result = await this.itineraryService.createItinerary(itinerary, userId);
      if (result.error) {
        this.errorMessage = result.error;
        return;
      }

      if (result.warning) {
        this.warningMessage = result.warning;
      }

      this.infoMessage = 'Trip saved successfully.';

      await this.router.navigate(['/my-trips']);
    } finally {
      this.loading = false;
    }
  }
}
