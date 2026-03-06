import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Itinerary } from '../../models/itinerary.model';
import { AuthService } from '../../services/auth.service';
import { ItineraryService } from '../../services/itinerary.service';
import { RequestService, RequestType } from '../../services/request.service';
import { ItineraryContactService } from '../../services/itinerary-contact.service';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink],
  template: `
    <h2 class="mb-3">Search Trips</h2>

    <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
    <div class="alert alert-info" *ngIf="infoMessage">{{ infoMessage }}</div>

    <form [formGroup]="form" (ngSubmit)="search()" class="card card-body mb-4">
      <div class="row g-3">
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Origin Airport Code *</label>
          <input class="form-control" formControlName="originAirportCode" placeholder="e.g. DXB" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Destination Airport Code *</label>
          <input class="form-control" formControlName="destinationAirportCode" placeholder="e.g. HND" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Start Date *</label>
          <input type="date" class="form-control" formControlName="searchStartDate" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">End Date *</label>
          <input type="date" class="form-control" formControlName="searchEndDate" />
        </div>

        <div class="col-md-6">
          <label class="form-label">Stop1 Airport Code (optional)</label>
          <input class="form-control" formControlName="stop1AirportCode" placeholder="Matches leg_order=1 destination" />
        </div>
        <div class="col-md-6">
          <label class="form-label">Stop2 Airport Code (optional)</label>
          <input class="form-control" formControlName="stop2AirportCode" placeholder="Matches leg_order=2 destination" />
        </div>
      </div>

      <div class="mt-3">
        <button class="btn btn-primary" [disabled]="loadingSearch" type="submit">
          <span *ngIf="loadingSearch" class="spinner-border spinner-border-sm me-2"></span>
          Search
        </button>
      </div>
    </form>

    <div class="row g-3" *ngIf="results.length">
      <div class="col-md-6 col-lg-4" *ngFor="let item of results">
        <div class="card h-100 shadow-sm">
          <div class="card-body">
            <h5 class="card-title">{{ item.origin_airport_code }} → {{ item.destination_airport_code }}</h5>
            <p class="card-text mb-1"><strong>Dates:</strong> {{ item.start_date }} → {{ item.end_date || 'One way' }}</p>
            <p class="card-text mb-1"><strong>Posted by:</strong> {{ ownerLabel(item.owner_id) }}</p>
            <p class="card-text"><strong>Legs:</strong> {{ item.legs.length }}</p>
            <button class="btn btn-outline-primary btn-sm" [disabled]="loadingTripId === item.id" (click)="openTrip(item)">
              <span *ngIf="loadingTripId === item.id" class="spinner-border spinner-border-sm me-1"></span>
              View Trip
            </button>
          </div>
        </div>
      </div>
    </div>

    <ng-container *ngIf="selectedTrip">
      <div class="modal-backdrop fade show trip-modal-backdrop" (click)="closeTrip()"></div>
      <div class="modal fade show d-block trip-modal" tabindex="-1" role="dialog" aria-modal="true">
        <div class="modal-dialog modal-lg modal-dialog-scrollable" role="document" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Trip details</h5>
              <button type="button" class="btn-close" (click)="closeTrip()"></button>
            </div>
            <div class="modal-body">
              <div class="alert alert-danger" *ngIf="tripError">{{ tripError }}</div>
              <div class="alert alert-success" *ngIf="tripInfo">{{ tripInfo }}</div>

              <p><strong>Route:</strong> {{ selectedTrip.origin_airport_code }} → {{ selectedTrip.destination_airport_code }}</p>
              <p><strong>Travel:</strong> {{ selectedTrip.start_date }} → {{ selectedTrip.end_date || 'One way' }}</p>
              <p><strong>Posted by:</strong> {{ ownerLabel(selectedTrip.owner_id) }}</p>

              <h6>Legs</h6>
              <ul class="list-group mb-3">
                <li class="list-group-item" *ngFor="let leg of selectedTrip.legs">
                  #{{ leg.leg_order }} {{ leg.origin_airport_code }} → {{ leg.destination_airport_code }}
                  ({{ leg.carrier }} {{ leg.flight_number }}{{ leg.flight_code ? ' / ' + leg.flight_code : '' }})
                </li>
              </ul>

              <div *ngIf="!isLoggedIn" class="alert alert-info mb-3 d-flex justify-content-between align-items-center">
                <span>Logged-out users can search, but cannot request/chat.</span>
                <a class="btn btn-sm btn-primary" routerLink="/auth" (click)="closeTrip()">Login to request companion/assistance</a>
              </div>

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
      </div>
    </ng-container>
  `,
  styles: [
    `
      .trip-modal { z-index: 1060; }
      .trip-modal-backdrop { z-index: 1050; }
    `
  ]
})
export class SearchComponent {
  errorMessage = '';
  infoMessage = 'Use airport codes and date range to search.';
  results: Itinerary[] = [];
  loadingSearch = false;
  loadingTripId = '';

  selectedTrip: Itinerary | null = null;
  tripError = '';
  tripInfo = '';
  requestLoading = false;
  savingContact = false;
  canViewContactDetails = false;

  contactForm: any = { contact_name: '', contact_phone: '', contact_email: '', notes: '' };
  private ownerLabels: Record<string, string> = {};

  form = this.fb.group({
    originAirportCode: ['', Validators.required],
    destinationAirportCode: ['', Validators.required],
    searchStartDate: ['', Validators.required],
    searchEndDate: ['', Validators.required],
    stop1AirportCode: [''],
    stop2AirportCode: ['']
  });

  constructor(
    private fb: FormBuilder,
    private itineraryService: ItineraryService,
    private authService: AuthService,
    private requestService: RequestService,
    private itineraryContactService: ItineraryContactService,
    private chatService: ChatService,
    private router: Router
  ) {}

  get isLoggedIn(): boolean {
    return !!this.authService.currentSession;
  }

  get isSelfTrip(): boolean {
    return !!this.selectedTrip && this.selectedTrip.owner_id === this.authService.currentSession?.user.id;
  }

  ownerLabel(ownerId?: string): string {
    if (!ownerId) return 'User';
    return this.ownerLabels[ownerId] || 'User';
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.selectedTrip) this.closeTrip();
  }

  private normalizeAirport(code: string | null | undefined): string | undefined {
    const value = (code ?? '').replace(/\s+/g, '').toUpperCase();
    return value || undefined;
  }

  async search() {
    if (this.form.invalid || this.loadingSearch) {
      this.errorMessage = 'Origin, destination, start date and end date are required.';
      return;
    }

    this.loadingSearch = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const value = this.form.getRawValue();
      const { data, error } = await this.itineraryService.search({
        originAirportCode: this.normalizeAirport(value.originAirportCode)!,
        destinationAirportCode: this.normalizeAirport(value.destinationAirportCode)!,
        searchStartDate: value.searchStartDate ?? '',
        searchEndDate: value.searchEndDate ?? '',
        stop1AirportCode: this.normalizeAirport(value.stop1AirportCode),
        stop2AirportCode: this.normalizeAirport(value.stop2AirportCode)
      });

      this.results = data;
      this.infoMessage = `${data.length} itinerary(ies) found.`;
      if (error) this.errorMessage = error;

      const ownerIds = [...new Set(data.map((d) => d.owner_id).filter(Boolean))] as string[];
      this.ownerLabels = await this.chatService.getProfileNames(ownerIds);
    } finally {
      this.loadingSearch = false;
    }
  }

  async openTrip(item: Itinerary) {
    this.loadingTripId = item.id ?? '';
    this.selectedTrip = null;
    this.tripError = '';
    this.tripInfo = '';
    this.canViewContactDetails = false;
    this.contactForm = { contact_name: '', contact_phone: '', contact_email: '', notes: '' };

    const { data, error } = await this.itineraryService.findById(item.id!);
    if (error || !data) {
      this.tripError = error ?? 'Unable to load trip details.';
      this.selectedTrip = item;
      this.loadingTripId = '';
      return;
    }

    this.selectedTrip = data;
    if (data.owner_id && !this.ownerLabels[data.owner_id]) {
      const one = await this.chatService.getProfileNames([data.owner_id]);
      this.ownerLabels = { ...this.ownerLabels, ...one };
    }
    await this.loadContactDetails();
    this.loadingTripId = '';
  }

  closeTrip() {
    this.selectedTrip = null;
    this.tripError = '';
    this.tripInfo = '';
  }

  async sendRequest(type: RequestType) {
    if (!this.selectedTrip || this.requestLoading || this.isSelfTrip) return;

    const userId = this.authService.currentSession?.user.id;
    if (!userId) {
      this.tripError = 'Login required to request a trip.';
      return;
    }

    this.requestLoading = true;
    this.tripError = '';
    this.tripInfo = '';

    try {
      const result = await this.requestService.createOrGetRequest(this.selectedTrip.id!, userId, type);
      if (result.error || !result.data) {
        this.tripError = result.error ?? 'Unable to create request.';
        return;
      }

      this.tripInfo = result.existing ? 'Request already exists. Opening details.' : 'Request created. Opening details.';
      await this.router.navigate(['/requests', result.data.id]);
      this.closeTrip();
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
    this.tripInfo = '';

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

      this.tripInfo = 'Contact details saved.';
    } finally {
      this.savingContact = false;
    }
  }
}
