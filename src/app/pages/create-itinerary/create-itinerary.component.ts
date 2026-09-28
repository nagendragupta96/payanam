import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { HelpIconComponent } from '../../shared/help-icon.component';
import { ItineraryContactService } from '../../services/itinerary-contact.service';
import { ItineraryService } from '../../services/itinerary.service';
import { AirportAutocompleteService, AirportEntry } from '../../services/airport-autocomplete.service';

@Component({
  selector: 'app-create-itinerary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, HelpIconComponent],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <button class="btn btn-link p-0 mb-2" type="button" (click)="goBack()">← Back</button>
        <h2 class="h4 mb-3">{{ isEditMode ? 'Edit Itinerary' : 'Post Trip' }}</h2>

        <div #errorAlert tabindex="-1" class="alert alert-danger" *ngIf="errorMessage" role="alert">{{ errorMessage }}</div>
        <div class="alert alert-success" *ngIf="infoMessage">{{ infoMessage }}</div>
        <div class="alert alert-warning" *ngIf="warningMessage">{{ warningMessage }}</div>

        <form #tripFormEl [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <h3 class="h6 mb-2">Basic Trip Information</h3>

          <div class="row g-2 mb-2">
            <div class="col-md-6">
              <label class="form-label" for="originAirport">Origin Airport Code <span class="text-danger">*</span><app-help-icon [text]="'Enter the starting airport code, for example JFK or HYD.'" ariaLabel="Origin airport help"></app-help-icon></label>
              <input id="originAirport" class="form-control text-uppercase" formControlName="origin_airport_code" maxlength="4" list="airportSuggestions" (input)="onAirportInput($event); uppercaseControl('origin_airport_code')" [class.is-invalid]="isFieldInvalid('origin_airport_code')" />
              <div class="invalid-feedback" *ngIf="isFieldInvalid('origin_airport_code')">Origin airport code is required (3–4 letters).</div>
            </div>
            <div class="col-md-6">
              <label class="form-label" for="destinationAirport">Destination Airport Code <span class="text-danger">*</span><app-help-icon [text]="'Enter the destination airport code, for example DXB or SIN.'" ariaLabel="Destination airport help"></app-help-icon></label>
              <input id="destinationAirport" class="form-control text-uppercase" formControlName="destination_airport_code" maxlength="4" list="airportSuggestions" (input)="onAirportInput($event); uppercaseControl('destination_airport_code')" [class.is-invalid]="isFieldInvalid('destination_airport_code')" />
              <div class="invalid-feedback" *ngIf="isFieldInvalid('destination_airport_code')">Destination airport code is required (3–4 letters).</div>
            </div>
          </div>


          <div class="mb-2">
            <label class="form-label" for="tripNotes">Trip Notes (Optional) <app-help-icon [text]="'Share optional notes like baggage details, travel preferences, or flexibility.'" ariaLabel="Trip notes help"></app-help-icon></label>
            <textarea id="tripNotes" rows="2" class="form-control" formControlName="notes"></textarea>
          </div>

          <div class="mb-2">
            <label class="form-label" for="languagesKnown">Languages Known (Optional) <app-help-icon [text]="'List languages you can speak or understand, separated by commas. Example: English, Telugu, Hindi.'" ariaLabel="Languages known help"></app-help-icon></label>
            <input id="languagesKnown" class="form-control" formControlName="languages_known" maxlength="300" />
            <div class="form-text">Separate multiple languages with commas.</div>
          </div>

          <div class="row g-2 mb-2">
            <div class="col-md-6">
              <label class="form-label" for="startDate">Start Date <span class="text-danger">*</span><app-help-icon [text]="'Select the first date of your trip.'" ariaLabel="Start date help"></app-help-icon></label>
              <input id="startDate" class="form-control date-input" type="date" formControlName="start_date" [attr.min]="today" [class.is-invalid]="isFieldInvalid('start_date')" (change)="closeNativePicker($event)" />
              <div class="invalid-feedback" *ngIf="isFieldInvalid('start_date')">Start date is required.</div>
            </div>
            <div class="col-md-6">
              <label class="form-label" for="endDate">End Date <span class="text-danger">*</span><app-help-icon [text]="'Select the final date of your trip.'" ariaLabel="End date help"></app-help-icon></label>
              <input id="endDate" class="form-control date-input" type="date" formControlName="end_date" [attr.min]="today" [class.is-invalid]="isFieldInvalid('end_date')" (change)="closeNativePicker($event)" />
              <div class="invalid-feedback" *ngIf="isFieldInvalid('end_date')">End date is required.</div>
            </div>
          </div>

          <h3 class="h6 mt-3 mb-2">Itinerary Legs</h3>
          <p class="small text-muted mb-2">Fields marked with <span class="text-danger">*</span> are mandatory for each leg.</p>

          <div formArrayName="legs">
            <div *ngFor="let leg of legs.controls; index as i" [formGroupName]="i" class="border rounded p-3 mb-2 bg-light">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 class="mb-0">Leg {{ i + 1 }}</h6>
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  (click)="removeLeg(i)"
                  [disabled]="loading || legs.length === 1"
                >
                  Delete
                </button>
              </div>

              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label">Leg {{ i + 1 }} Origin Airport Code <span class="text-danger">*</span><app-help-icon [text]="'Enter the starting airport code, for example JFK or HYD.'" ariaLabel="Origin airport help"></app-help-icon></label>
                  <input class="form-control text-uppercase" formControlName="origin_airport_code" maxlength="4" list="airportSuggestions" (input)="onAirportInput($event); uppercaseLegControl(i, 'origin_airport_code')" [class.is-invalid]="isLegFieldInvalid(i, 'origin_airport_code')" />
                  <div class="invalid-feedback" *ngIf="isLegFieldInvalid(i, 'origin_airport_code')">Origin airport code is required.</div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Leg {{ i + 1 }} Destination Airport Code <span class="text-danger">*</span><app-help-icon [text]="'Enter the destination airport code, for example DXB or SIN.'" ariaLabel="Destination airport help"></app-help-icon></label>
                  <input class="form-control text-uppercase" formControlName="destination_airport_code" maxlength="4" list="airportSuggestions" (input)="onAirportInput($event); uppercaseLegControl(i, 'destination_airport_code')" [class.is-invalid]="isLegFieldInvalid(i, 'destination_airport_code')" />
                  <div class="invalid-feedback" *ngIf="isLegFieldInvalid(i, 'destination_airport_code')">Destination airport code is required.</div>
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-md-12">
                  <label class="form-label">Flight Number <span class="text-danger">*</span><app-help-icon [text]="'Enter the flight number exactly as on your ticket, for example EK524.'" ariaLabel="Flight number help"></app-help-icon></label>
                  <input class="form-control text-uppercase" formControlName="flight_number" [class.is-invalid]="isLegFieldInvalid(i, 'flight_number')" />
                  <div class="invalid-feedback" *ngIf="isLegFieldInvalid(i, 'flight_number')">Flight number is required.</div>
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-md-6">
                  <label class="form-label">Departure Date & Time (Optional) <app-help-icon [text]="'Optional local departure timestamp for this leg.'" ariaLabel="Departure datetime help"></app-help-icon></label>
                  <input class="form-control date-input" type="datetime-local" formControlName="departure_at" (change)="closeNativePicker($event)" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Arrival Date & Time (Optional) <app-help-icon [text]="'Optional local arrival timestamp for this leg.'" ariaLabel="Arrival datetime help"></app-help-icon></label>
                  <input class="form-control date-input" type="datetime-local" formControlName="arrival_at" (change)="closeNativePicker($event)" />
                </div>
              </div>
            </div>
          </div>

          <button class="btn btn-primary mb-3" type="button" (click)="addLeg()" [disabled]="loading">Add Leg</button>

          <div class="card border-0 bg-light mt-3">
            <div class="card-body">
              <h3 class="h6 mb-3">Contact Details (Optional) <app-help-icon [text]="'These details are shared only after your contact details request is accepted.'" ariaLabel="Contact details help"></app-help-icon></h3>
              <p class="small text-muted mb-3">These details are attached to this trip and can be shared only through approved contact details requests.</p>

              <div class="row g-2">
                <div class="col-md-6">
                  <label class="form-label">Contact Name (Optional)</label>
                  <input class="form-control" formControlName="contact_name" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Contact Phone (Optional)</label>
                  <input class="form-control" formControlName="contact_phone" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Contact Email (Optional)</label>
                  <input class="form-control" formControlName="contact_email" />
                </div>
                <div class="col-md-6">
                  <label class="form-label">Contact Notes (Optional)</label>
                  <input class="form-control" formControlName="contact_notes" />
                </div>
              </div>
            </div>
          </div>

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-primary" [disabled]="loading" type="submit">
              <span *ngIf="loading" class="spinner-border spinner-border-sm me-2"></span>
              {{ isEditMode ? 'Save Itinerary Changes' : 'Publish itinerary' }}
            </button>
            <button *ngIf="isEditMode" class="btn btn-outline-secondary" type="button" [disabled]="loading" (click)="cancelEdit()">Cancel</button>
          </div>
        </form>

        <datalist id="airportSuggestions">
          <option *ngFor="let airport of airportSuggestions" [value]="airport.code">{{ airportOptionLabel(airport) }}</option>
        </datalist>
      </div>
    </div>
  `,
  styles: [
    `
    `
  ]
})
export class CreateItineraryComponent {
  @ViewChild('errorAlert') errorAlert?: ElementRef<HTMLElement>;
  @ViewChild('tripFormEl') tripFormEl?: ElementRef<HTMLFormElement>;

  loading = false;
  errorMessage = '';
  infoMessage = '';
  airportSuggestions: AirportEntry[] = [];
  warningMessage = '';
  today = new Date().toISOString().slice(0, 10);
  itineraryId = this.route.snapshot.paramMap.get('id') ?? '';
  private initialFormSnapshot = '';

  private readonly airportCodePattern = /^[A-Z]{3,4}$/;

  get isEditMode(): boolean {
    return !!this.itineraryId;
  }

  form = this.fb.group({
    origin_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
    destination_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
    start_date: ['', Validators.required],
    end_date: ['', Validators.required],
    notes: [''],
    languages_known: [''],
    contact_name: [''],
    contact_phone: [''],
    contact_email: [''],
    contact_notes: [''],
    legs: this.fb.array([this.createLegGroup()])
  });

  get legs(): FormArray {
    return this.form.get('legs') as FormArray;
  }

  async goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    await this.router.navigate(['/my-trips']);
  }

  constructor(
    private fb: FormBuilder,
    private itineraryService: ItineraryService,
    private itineraryContactService: ItineraryContactService,
    private authService: AuthService,
    private airportAutocompleteService: AirportAutocompleteService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    if (this.isEditMode) {
      void this.loadExistingItinerary();
    }
  }

  createLegGroup() {
    return this.fb.group({
      origin_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
      destination_airport_code: ['', [Validators.required, Validators.pattern(this.airportCodePattern)]],
      flight_number: ['', Validators.required],
      departure_at: [''],
      arrival_at: ['']
    });
  }

  private async loadExistingItinerary(): Promise<void> {
    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId || !this.itineraryId) return;

    this.loading = true;
    this.errorMessage = '';

    try {
      const result = await this.itineraryService.findById(this.itineraryId);
      if (result.error || !result.data) {
        this.errorMessage = result.error ?? 'Unable to load itinerary for editing.';
        this.focusErrorAndFirstInvalidField();
        return;
      }

      if (result.data.owner_id !== ownerId) {
        this.errorMessage = 'You can only edit your own itineraries.';
        this.focusErrorAndFirstInvalidField();
        return;
      }

      const sortedLegs = [...(result.data.legs ?? [])].sort((a, b) => (a.leg_order ?? 0) - (b.leg_order ?? 0));
      const legsArray = this.fb.array(
        (sortedLegs.length ? sortedLegs : [this.createLegGroup().value]).map((leg: any) =>
          this.fb.group({
            origin_airport_code: [leg.origin_airport_code ?? '', [Validators.required, Validators.pattern(this.airportCodePattern)]],
            destination_airport_code: [leg.destination_airport_code ?? '', [Validators.required, Validators.pattern(this.airportCodePattern)]],
            flight_number: [leg.flight_number ?? '', Validators.required],
            departure_at: [this.toDatetimeLocal(leg.departure_at)],
            arrival_at: [this.toDatetimeLocal(leg.arrival_at)]
          })
        )
      );
      this.form.setControl('legs', legsArray);

      this.form.patchValue({
        origin_airport_code: result.data.origin_airport_code ?? '',
        destination_airport_code: result.data.destination_airport_code ?? '',
        start_date: result.data.start_date ?? '',
        end_date: result.data.end_date ?? result.data.start_date ?? '',
        notes: result.data.notes ?? '',
        languages_known: (result.data.languages_known ?? []).join(', ')
      });

      const contact = await this.itineraryContactService.getByItinerary(this.itineraryId);
      if (contact.data) {
        this.form.patchValue({
          contact_name: contact.data.contact_name ?? '',
          contact_phone: contact.data.contact_phone ?? '',
          contact_email: contact.data.contact_email ?? '',
          contact_notes: contact.data.notes ?? ''
        });
      }

      this.initialFormSnapshot = JSON.stringify(this.form.getRawValue());
    } finally {
      this.loading = false;
    }
  }

  addLeg() {
    this.legs.push(this.createLegGroup());
  }

  removeLeg(index: number) {
    if (this.loading || this.legs.length <= 1) return;
    this.legs.removeAt(index);
  }

  uppercaseControl(field: string): void {
    const control = this.form.get(field);
    if (!control) return;
    const value = `${control.value ?? ''}`.toUpperCase();
    if (value !== control.value) {
      control.setValue(value, { emitEvent: false });
    }
  }

  uppercaseLegControl(index: number, field: 'origin_airport_code' | 'destination_airport_code'): void {
    const group = this.legs.at(index);
    const control = group.get(field);
    if (!control) return;
    const value = `${control.value ?? ''}`.toUpperCase();
    if (value !== control.value) {
      control.setValue(value, { emitEvent: false });
    }
  }
  closeNativePicker(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    window.setTimeout(() => input?.blur(), 0);
  }

  isFieldInvalid(name: string): boolean {
    const control = this.form.get(name);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  isLegFieldInvalid(index: number, name: string): boolean {
    const control = this.legs.at(index).get(name);
    return !!control && control.invalid && (control.dirty || control.touched);
  }

  cancelEdit(): void {
    if (!this.isEditMode) {
      void this.router.navigate(['/my-trips']);
      return;
    }

    const currentSnapshot = JSON.stringify(this.form.getRawValue());
    const hasChanges = this.initialFormSnapshot && currentSnapshot !== this.initialFormSnapshot;
    if (hasChanges) {
      const confirmed = window.confirm('Discard unsaved itinerary changes?');
      if (!confirmed) return;
    }

    void this.router.navigate(['/my-trips']);
  }

  async submit() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.loading) return;

    this.errorMessage = '';
    this.infoMessage = '';
    this.warningMessage = '';

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage = 'Please fix the highlighted required fields before saving your trip.';
      this.focusErrorAndFirstInvalidField();
      return;
    }

    this.loading = true;

    const value = this.form.getRawValue();
    const normalize = (code: string | null | undefined) => (code ?? '').replace(/\s+/g, '').toUpperCase();
    const normalizeFlightNumber = (input: string | null | undefined) => (input ?? '').replace(/\s+/g, '').toUpperCase();
    if ((value.start_date ?? '') < this.today) {
      this.errorMessage = 'Start Date cannot be in the past.';
      this.focusErrorAndFirstInvalidField();
      this.loading = false;
      return;
    }

    if ((value.end_date ?? '') < this.today) {
      this.errorMessage = 'End Date cannot be in the past.';
      this.focusErrorAndFirstInvalidField();
      this.loading = false;
      return;
    }

    if ((value.end_date ?? '') < (value.start_date ?? '')) {
      this.errorMessage = 'End Date must be on or after Start Date.';
      this.focusErrorAndFirstInvalidField();
      this.loading = false;
      return;
    }

    const itineraryPayload = {
      origin_airport_code: normalize(value.origin_airport_code),
      destination_airport_code: normalize(value.destination_airport_code),
      start_date: value.start_date ?? '',
      end_date: value.end_date ?? value.start_date ?? '',
      languages_known: this.normalizeLanguages(value.languages_known),
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
        flight_number: normalizeFlightNumber(leg.flight_number),
        departure_at: leg.departure_at || null,
        arrival_at: leg.arrival_at || null
      }))
    };

    try {
      const result = this.isEditMode
        ? await this.itineraryService.updateItinerary(this.itineraryId, itineraryPayload, userId)
        : await this.itineraryService.createItinerary(itineraryPayload, userId);

      if (result.error) {
        this.errorMessage = result.error;
        this.focusErrorAndFirstInvalidField();
        return;
      }

      if (result.warning) {
        this.warningMessage = result.warning;
      }

      this.infoMessage = this.isEditMode ? 'Itinerary updated successfully.' : 'Trip saved successfully.';

      await this.router.navigate(['/my-trips'], {
        queryParams: { info: this.infoMessage }
      });
    } catch {
      this.errorMessage = this.isEditMode
        ? 'Unexpected error while updating itinerary.'
        : 'Unexpected error while saving itinerary.';
      this.focusErrorAndFirstInvalidField();
    } finally {
      this.loading = false;
    }
  }

  private toDatetimeLocal(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => `${n}`.padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }

  private normalizeLanguages(value: string | null | undefined): string[] {
    const seen = new Set<string>();
    return (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.slice(0, 40))
      .filter((item) => {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  }

  private focusErrorAndFirstInvalidField(): void {
    window.setTimeout(() => {
      this.errorAlert?.nativeElement.focus();
      this.errorAlert?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

      const firstInvalid = this.tripFormEl?.nativeElement.querySelector('.ng-invalid') as HTMLElement | null;
      firstInvalid?.focus();
    }, 0);
  }


  async onAirportInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;

    const query = input.value || '';
    if (!query.trim()) {
      this.airportSuggestions = [];
      return;
    }

    try {
      this.airportSuggestions = await this.airportAutocompleteService.search(query);
    } catch {
      this.airportSuggestions = [];
    }
  }

  airportOptionLabel(airport: AirportEntry): string {
    return this.airportAutocompleteService.optionLabel(airport);
  }

}
