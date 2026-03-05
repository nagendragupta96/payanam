import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Itinerary } from '../../models/itinerary.model';
import { AuthService } from '../../services/auth.service';
import { ItineraryService } from '../../services/itinerary.service';
import { RequestService, RequestType } from '../../services/request.service';
import { ItineraryContactService } from '../../services/itinerary-contact.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink],
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
        <button type="submit" class="btn btn-primary" [disabled]="loadingSearch">
          <span *ngIf="loadingSearch" class="spinner-border spinner-border-sm me-2"></span>
          Search
        </button>
      </div>
    </form>

    <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
    <p class="mb-3">{{ message }}</p>

    <div class="row g-3" *ngIf="results.length">
      <div class="col-md-6 col-lg-4" *ngFor="let item of results">
        <div class="card h-100 shadow-sm">
          <div class="card-body">
            <h5 class="card-title">{{ item.origin_airport }} → {{ item.destination_airport }}</h5>
            <p class="card-text mb-1"><strong>Destination:</strong> {{ item.destination || '-' }}</p>
            <p class="card-text mb-1"><strong>Dates:</strong> {{ item.depart_date }} → {{ item.return_date || 'One way' }}</p>
            <p class="card-text"><strong>Legs:</strong> {{ item.legs.length }}</p>
            <button class="btn btn-outline-primary btn-sm" (click)="openTrip(item)">View Trip</button>
          </div>
        </div>
      </div>
    </div>

    <div *ngIf="selectedTrip" class="modal d-block" tabindex="-1" role="dialog">
      <div class="modal-dialog modal-lg modal-dialog-scrollable" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Trip details</h5>
            <button type="button" class="btn-close" (click)="closeTrip()"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-danger" *ngIf="tripError">{{ tripError }}</div>
            <p><strong>Route:</strong> {{ selectedTrip.origin_airport }} → {{ selectedTrip.destination_airport }}</p>
            <p><strong>Destination:</strong> {{ selectedTrip.destination || '-' }}</p>
            <p><strong>Travel:</strong> {{ selectedTrip.depart_date }} → {{ selectedTrip.return_date || 'One way' }}</p>

            <h6>Legs</h6>
            <ul class="list-group mb-3">
              <li class="list-group-item" *ngFor="let leg of selectedTrip.legs">
                #{{ leg.leg_order }} {{ leg.origin_airport }} → {{ leg.destination_airport }}
                ({{ leg.carrier }} {{ leg.flight_number }}{{ leg.flight_code ? ' / ' + leg.flight_code : '' }})
              </li>
            </ul>

            <div *ngIf="!isLoggedIn" class="alert alert-info mb-3">Login to request this trip.</div>

            <div *ngIf="isLoggedIn && isSelfTrip" class="alert alert-secondary mb-3">This is your trip.</div>

            <div *ngIf="isLoggedIn && !isSelfTrip" class="d-flex flex-wrap gap-2 mb-3">
              <button class="btn btn-primary" [disabled]="requestLoading" (click)="sendRequest('COMPANION')">
                <span *ngIf="requestLoading" class="spinner-border spinner-border-sm me-2"></span>
                Request Companion
              </button>
              <button class="btn btn-outline-primary" [disabled]="requestLoading" (click)="sendRequest('ASSISTANCE')">
                Request Assistance
              </button>
            </div>

            <h6>Contact Details</h6>
            <div *ngIf="isSelfTrip; else requesterContactBlock">
              <div class="row g-2">
                <div class="col-md-6"><input class="form-control" [(ngModel)]="contactForm.contact_name" [ngModelOptions]="{standalone: true}" placeholder="Contact name" /></div>
                <div class="col-md-6"><input class="form-control" [(ngModel)]="contactForm.contact_phone" [ngModelOptions]="{standalone: true}" placeholder="Contact phone" /></div>
                <div class="col-md-6"><input class="form-control" [(ngModel)]="contactForm.contact_email" [ngModelOptions]="{standalone: true}" placeholder="Contact email" /></div>
                <div class="col-md-12"><textarea class="form-control" [(ngModel)]="contactForm.notes" [ngModelOptions]="{standalone: true}" rows="2" placeholder="Notes"></textarea></div>
              </div>
              <button class="btn btn-sm btn-success mt-2" [disabled]="savingContact" (click)="saveContactDetails()">
                <span *ngIf="savingContact" class="spinner-border spinner-border-sm me-2"></span>
                Save Contact Details
              </button>
            </div>
            <ng-template #requesterContactBlock>
              <div *ngIf="canViewContactDetails; else lockedContact">
                <p class="mb-1"><strong>Name:</strong> {{ contactForm.contact_name || '-' }}</p>
                <p class="mb-1"><strong>Phone:</strong> {{ contactForm.contact_phone || '-' }}</p>
                <p class="mb-1"><strong>Email:</strong> {{ contactForm.contact_email || '-' }}</p>
                <p class="mb-0"><strong>Notes:</strong> {{ contactForm.notes || '-' }}</p>
              </div>
              <ng-template #lockedContact>
                <div class="alert alert-warning mb-0">Contact details available after request approval.</div>
              </ng-template>
            </ng-template>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="closeTrip()">Close</button>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    </div>
  `
})
export class SearchComponent {
  message = 'Enter destination + date window to search.';
  errorMessage = '';
  results: Itinerary[] = [];
  loadingSearch = false;

  selectedTrip: Itinerary | null = null;
  tripError = '';
  requestLoading = false;
  savingContact = false;
  canViewContactDetails = false;

  contactForm: any = {
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    notes: ''
  };

  form = this.fb.group({
    destination: ['', Validators.required],
    userStart: ['', Validators.required],
    userEnd: ['', Validators.required],
    airport: [''],
    flightCode: ['']
  });

  constructor(
    private fb: FormBuilder,
    private itineraryService: ItineraryService,
    private authService: AuthService,
    private requestService: RequestService,
    private itineraryContactService: ItineraryContactService
  ) {}

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  get isSelfTrip(): boolean {
    return !!this.selectedTrip && this.selectedTrip.owner_id === this.authService.currentSession?.user.id;
  }

  async search() {
    if (this.form.invalid || this.loadingSearch) {
      this.message = 'Destination, start date, and end date are required.';
      return;
    }

    this.loadingSearch = true;
    this.errorMessage = '';

    try {
      const value = this.form.getRawValue();
      const { data, error } = await this.itineraryService.search({
        destination: value.destination ?? '',
        userStart: value.userStart ?? '',
        userEnd: value.userEnd ?? '',
        airport: value.airport ?? undefined,
        flightCode: value.flightCode ?? undefined
      });

      this.results = data;
      if (error) {
        this.errorMessage = error;
      }
      this.message = error ?? `${data.length} itinerary(ies) found. Sorted by strongest match.`;
    } finally {
      this.loadingSearch = false;
    }
  }

  async openTrip(item: Itinerary) {
    this.selectedTrip = null;
    this.tripError = '';
    this.canViewContactDetails = false;
    this.contactForm = { contact_name: '', contact_phone: '', contact_email: '', notes: '' };

    const { data, error } = await this.itineraryService.findById(item.id!);
    if (error || !data) {
      this.tripError = error ?? 'Unable to load trip details.';
      this.selectedTrip = item;
      return;
    }

    this.selectedTrip = data;
    await this.loadContactDetails();
  }

  closeTrip() {
    this.selectedTrip = null;
    this.tripError = '';
  }

  async sendRequest(type: RequestType) {
    if (!this.selectedTrip || this.requestLoading) return;

    const userId = this.authService.currentSession?.user.id;
    if (!userId) {
      this.tripError = 'Login required to request a trip.';
      return;
    }

    this.requestLoading = true;
    this.tripError = '';

    try {
      const error = await this.requestService.createRequest(this.selectedTrip.id!, userId, type);
      if (error) {
        this.tripError = error;
        return;
      }
      this.tripError = `${type} request sent.`;
      await this.loadContactDetails();
    } finally {
      this.requestLoading = false;
    }
  }

  async loadContactDetails() {
    if (!this.selectedTrip) return;

    const userId = this.authService.currentSession?.user.id;
    const isOwner = userId && this.selectedTrip.owner_id === userId;

    if (isOwner) {
      this.canViewContactDetails = true;
    } else if (userId) {
      const req = await this.requestService.getUserRequestForItinerary(this.selectedTrip.id!, userId);
      this.canViewContactDetails = req.data?.status === 'ACCEPTED';
    } else {
      this.canViewContactDetails = false;
    }

    const details = await this.itineraryContactService.getByItinerary(this.selectedTrip.id!);
    if (details.error) {
      if (this.canViewContactDetails || isOwner) this.tripError = details.error;
      return;
    }

    if (details.data) {
      this.contactForm = {
        contact_name: details.data.contact_name ?? '',
        contact_phone: details.data.contact_phone ?? '',
        contact_email: details.data.contact_email ?? '',
        notes: details.data.notes ?? ''
      };
    }
  }

  async saveContactDetails() {
    if (!this.selectedTrip || !this.isSelfTrip || this.savingContact) return;

    const ownerId = this.authService.currentSession?.user.id;
    if (!ownerId) return;

    this.savingContact = true;
    this.tripError = '';

    try {
      const error = await this.itineraryContactService.upsert({
        itinerary_id: this.selectedTrip.id!,
        owner_id: ownerId,
        contact_name: this.contactForm.contact_name || null,
        contact_phone: this.contactForm.contact_phone || null,
        contact_email: this.contactForm.contact_email || null,
        notes: this.contactForm.notes || null
      });

      if (error) {
        this.tripError = error;
        return;
      }

      this.tripError = 'Contact details saved.';
    } finally {
      this.savingContact = false;
    }
  }
}
