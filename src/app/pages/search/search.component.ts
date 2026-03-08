import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Itinerary } from '../../models/itinerary.model';
import { AuthService } from '../../services/auth.service';
import { ItineraryService } from '../../services/itinerary.service';
import { RequestService, RequestType } from '../../services/request.service';
import { ItineraryContactService } from '../../services/itinerary-contact.service';
import { ChatService } from '../../services/chat.service';
import { AirportAutocompleteService, AirportEntry } from '../../services/airport-autocomplete.service';
import { HelpIconComponent } from '../../shared/help-icon.component';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterLink, HelpIconComponent],
  template: `
    <h2 class="mb-3">Search Trips</h2>

    <div #errorAlert tabindex="-1" class="alert alert-danger" *ngIf="errorMessage" role="alert">{{ errorMessage }}</div>
    <div class="alert alert-info" *ngIf="infoMessage">{{ infoMessage }}</div>

    <form [formGroup]="form" (ngSubmit)="search()" class="card card-body mb-4">
      <div class="row g-3">
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Origin Airport Code * <app-help-icon [text]=\"'Enter departure airport code, for example JFK.'\" ariaLabel=\"Origin help\"></app-help-icon></label>
          <input class="form-control text-uppercase" formControlName="originAirportCode" maxlength="4" list="airportSuggestions" (input)="onAirportInput('originAirportCode', $event); uppercaseSearchControl('originAirportCode')" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Destination Airport Code * <app-help-icon [text]=\"'Enter arrival airport code, for example HYD.'\" ariaLabel=\"Destination help\"></app-help-icon></label>
          <input class="form-control text-uppercase" formControlName="destinationAirportCode" maxlength="4" list="airportSuggestions" (input)="onAirportInput('destinationAirportCode', $event); uppercaseSearchControl('destinationAirportCode')" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">Start Date * <app-help-icon [text]=\"'Trips starting on or after this date will be returned.'\" ariaLabel=\"Start date help\"></app-help-icon></label>
          <input type="date" class="form-control date-input" formControlName="searchStartDate" (change)="closeNativePicker($event)" />
        </div>
        <div class="col-md-6 col-lg-3">
          <label class="form-label">End Date * <app-help-icon [text]=\"'Trips ending on or before this date will be returned.'\" ariaLabel=\"End date help\"></app-help-icon></label>
          <input type="date" class="form-control date-input" formControlName="searchEndDate" (change)="closeNativePicker($event)" />
        </div>

        <div class="col-md-6">
          <label class="form-label">Stop1 Airport Code (optional) <app-help-icon [text]=\"'Optional first layover airport code.'\" ariaLabel=\"Stop1 help\"></app-help-icon></label>
          <input class="form-control text-uppercase" formControlName="stop1AirportCode" maxlength="4" list="airportSuggestions" (input)="onAirportInput('stop1AirportCode', $event); uppercaseSearchControl('stop1AirportCode')" />
        </div>
        <div class="col-md-6">
          <label class="form-label">Stop2 Airport Code (optional) <app-help-icon [text]=\"'Optional second layover airport code.'\" ariaLabel=\"Stop2 help\"></app-help-icon></label>
          <input class="form-control text-uppercase" formControlName="stop2AirportCode" maxlength="4" list="airportSuggestions" (input)="onAirportInput('stop2AirportCode', $event); uppercaseSearchControl('stop2AirportCode')" />
        </div>
      </div>

      <div class="mt-3">
        <button class="btn btn-primary" [disabled]="loadingSearch" type="submit">
          <span *ngIf="loadingSearch" class="spinner-border spinner-border-sm me-2"></span>
          Search
        </button>
      </div>
    </form>

    <datalist id="airportSuggestions">
      <option *ngFor="let airport of airportSuggestions" [value]="airport.code">{{ airportOptionLabel(airport) }}</option>
    </datalist>

    <div class="card shadow-sm" *ngIf="results.length; else noResults">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-hover table-striped align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th>Actions</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Stop1</th>
                <th>Stop2</th>
                <th>Flight Number(s)</th>
                <th>Posted By</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let item of results">
                <td>
                  <button class="btn btn-outline-primary btn-sm" [disabled]="loadingTripId === item.id" (click)="openTrip(item)">
                    <span *ngIf="loadingTripId === item.id" class="spinner-border spinner-border-sm me-1"></span>
                    View
                  </button>
                </td>
                <td class="route-cell">{{ item.origin_airport_code }}</td>
                <td class="route-cell">{{ item.destination_airport_code }}</td>
                <td class="date-cell">{{ item.start_date }}</td>
                <td class="date-cell">{{ item.end_date || 'One way' }}</td>
                <td>{{ stopAirport(item, 0) }}</td>
                <td>{{ stopAirport(item, 1) }}</td>
                <td>{{ flightNumbers(item) }}</td>
                <td>{{ ownerLabel(item.owner_id) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <ng-template #noResults>
      <div class="alert alert-secondary" *ngIf="!hasSearched && !loadingSearch">Enter search criteria to find trips.</div>
      <div class="alert alert-secondary" *ngIf="hasSearched && !loadingSearch">No trips found for the selected criteria. Try adjusting airport codes or dates.</div>
    </ng-template>

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
                  ({{ leg.flight_number || '-' }})
                </li>
              </ul>

              <div *ngIf="!isLoggedIn" class="alert alert-info mb-3 d-flex justify-content-between align-items-center">
                <span>Logged-out users can search, but cannot request/chat.</span>
                <a class="btn btn-sm btn-primary" routerLink="/auth" (click)="closeTrip()">Login to request companion/assistance</a>
              </div>

              <div *ngIf="isLoggedIn && isSelfTrip" class="alert alert-secondary mb-3">This is your trip.</div>

              <div *ngIf="isLoggedIn && !isSelfTrip" class="d-flex flex-wrap gap-2 mb-2">
                <button class="btn btn-primary" [disabled]="requestLoading" (click)="sendRequest('COMPANION')">
                  <span *ngIf="requestLoading" class="spinner-border spinner-border-sm me-2"></span>
                  {{ requestButtonLabel('COMPANION') }}
                </button>
                <button class="btn btn-outline-primary" [disabled]="requestLoading" (click)="sendRequest('ASSISTANCE')">
                  {{ requestButtonLabel('ASSISTANCE') }}
                </button>
                <button
                  class="btn btn-outline-secondary"
                  [disabled]="requestLoading || !hasContactDetails || contactDetailsRequestStatus === 'PENDING' || contactDetailsRequestStatus === 'ACCEPTED'"
                  (click)="sendRequest('CONTACT_DETAILS')"
                >
                  Request for Contact Details
                </button>
              </div>
              <div *ngIf="isLoggedIn && !isSelfTrip && !hasContactDetails" class="alert alert-secondary py-2 mb-3">
                This trip owner has not added contact details yet.
              </div>

              <h6>Contact Details</h6>
              <div *ngIf="isSelfTrip; else requesterContactBlock">
                <div class="row g-2">
                  <div class="col-md-6"><label class="form-label">Contact Name <app-help-icon [text]=\"'Name shared after contact details request is approved.'\" ariaLabel=\"Contact name help\"></app-help-icon></label><input class="form-control" [(ngModel)]="contactForm.contact_name" [ngModelOptions]="{standalone: true}" /></div>
                  <div class="col-md-6"><label class="form-label">Contact Phone <app-help-icon [text]=\"'Include country code for reliable contact.'\" ariaLabel=\"Contact phone help\"></app-help-icon></label><input class="form-control" [(ngModel)]="contactForm.contact_phone" [ngModelOptions]="{standalone: true}" /></div>
                  <div class="col-md-6"><label class="form-label">Contact Email <app-help-icon [text]=\"'Email shared with approved contact requests only.'\" ariaLabel=\"Contact email help\"></app-help-icon></label><input class="form-control" [(ngModel)]="contactForm.contact_email" [ngModelOptions]="{standalone: true}" /></div>
                  <div class="col-md-12"><label class="form-label">Notes (Optional) <app-help-icon [text]=\"'Any optional directions for contacting you.'\" ariaLabel=\"Contact notes help\"></app-help-icon></label><textarea class="form-control" [(ngModel)]="contactForm.notes" [ngModelOptions]="{standalone: true}" rows="2"></textarea></div>
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
                  <div class="alert alert-warning mb-0">
                    <ng-container [ngSwitch]="contactDetailsRequestStatus">
                      <span *ngSwitchCase="'PENDING'">Contact details request pending owner approval.</span>
                      <span *ngSwitchCase="'REJECTED'">Contact details request was rejected. You can submit a new request.</span>
                      <span *ngSwitchDefault>Contact details available after request approval.</span>
                    </ng-container>
                  </div>
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
      .route-cell, .date-cell { white-space: nowrap; }
    `
  ]
})
export class SearchComponent {
  @ViewChild('errorAlert') errorAlert?: ElementRef<HTMLElement>;
  errorMessage = '';
  infoMessage = 'Use airport codes and date range to search.';
  airportSuggestions: AirportEntry[] = [];
  results: Itinerary[] = [];
  loadingSearch = false;
  hasSearched = false;
  loadingTripId = '';

  selectedTrip: Itinerary | null = null;
  tripError = '';
  tripInfo = '';
  requestLoading = false;
  savingContact = false;
  canViewContactDetails = false;

  contactForm: any = { contact_name: '', contact_phone: '', contact_email: '', notes: '' };
  private ownerLabels: Record<string, string> = {};
  private latestRequestByType: Partial<Record<RequestType, 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED'>> = {};

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
    private airportAutocompleteService: AirportAutocompleteService,
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

  stopAirport(item: Itinerary, legIndex: number): string {
    const legs = [...(item.legs ?? [])].sort((a, b) => (a.leg_order ?? 0) - (b.leg_order ?? 0));
    return legs[legIndex]?.destination_airport_code || '-';
  }

  flightNumbers(item: Itinerary): string {
    const flights = (item.legs ?? [])
      .map((leg) => leg.flight_number)
      .filter(Boolean)
      .map((value) => value!.toUpperCase());
    return flights.length ? flights.join(', ') : '-';
  }

  get hasContactDetails(): boolean {
    return !!this.selectedTrip && !!this.selectedTrip.has_contact_details;
  }

  get contactDetailsRequestStatus(): 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | null {
    return this.latestRequestByType.CONTACT_DETAILS ?? null;
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
      this.focusTopError();
      return;
    }

    this.loadingSearch = true;
    this.hasSearched = true;
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
      if (error) {
        this.errorMessage = error;
        this.focusTopError();
      }

      const ownerIds = [...new Set(data.map((d) => d.owner_id).filter(Boolean))] as string[];
      this.ownerLabels = await this.chatService.getProfileNames(ownerIds);
    } catch {
      this.errorMessage = 'Search failed. Please try again.';
      this.focusTopError();
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
    this.latestRequestByType = {};
    this.contactForm = { contact_name: '', contact_phone: '', contact_email: '', notes: '' };

    try {
      const { data, error } = await this.itineraryService.findById(item.id!);
      if (error || !data) {
        this.selectedTrip = item;
        this.tripError = ''; // Use already-loaded public card details without showing false error.
        return;
      }

      this.selectedTrip = {
        ...data,
        has_contact_details: data.has_contact_details ?? item.has_contact_details ?? false
      };
      if (data.owner_id && !this.ownerLabels[data.owner_id]) {
        const one = await this.chatService.getProfileNames([data.owner_id]);
        this.ownerLabels = { ...this.ownerLabels, ...one };
      }
      await this.loadLatestRequestStates();
      await this.loadContactDetails();
    } catch {
      this.selectedTrip = item;
      this.tripError = 'Unable to load full trip details right now.';
    } finally {
      this.loadingTripId = '';
    }
  }


  closeNativePicker(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    window.setTimeout(() => input?.blur(), 0);
  }

  closeTrip() {
    this.selectedTrip = null;
    this.tripError = '';
    this.tripInfo = '';
    this.latestRequestByType = {};
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
      if (type === 'CONTACT_DETAILS' && !this.hasContactDetails) {
        this.tripInfo = 'Contact details are not available for this trip yet.';
        return;
      }

      const result = await this.requestService.createOrGetRequest(this.selectedTrip.id!, userId, type);
      if (result.error || !result.data) {
        this.tripError = result.error ?? 'Unable to create request.';
        return;
      }

      const isContactDetails = type === 'CONTACT_DETAILS';
      if (isContactDetails) {
        this.latestRequestByType.CONTACT_DETAILS = result.data.status;
        this.tripInfo = result.existing
          ? 'Contact details request already exists.'
          : 'Contact details request submitted.';
        await this.loadContactDetails();
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
      const req = await this.requestService.getUserLatestRequestForItineraryByType(this.selectedTrip.id!, userId, 'CONTACT_DETAILS');
      this.canViewContactDetails = req.data?.status === 'ACCEPTED';
    } else {
      this.canViewContactDetails = false;
    }

    if (!isOwner && !this.canViewContactDetails) {
      return;
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

  private async loadLatestRequestStates() {
    if (!this.selectedTrip) return;

    const userId = this.authService.currentSession?.user.id;
    if (!userId || this.isSelfTrip) return;

    const [companion, assistance, contact] = await Promise.all([
      this.requestService.getUserLatestRequestForItineraryByType(this.selectedTrip.id!, userId, 'COMPANION'),
      this.requestService.getUserLatestRequestForItineraryByType(this.selectedTrip.id!, userId, 'ASSISTANCE'),
      this.requestService.getUserLatestRequestForItineraryByType(this.selectedTrip.id!, userId, 'CONTACT_DETAILS')
    ]);

    this.latestRequestByType.COMPANION = companion.data?.status;
    this.latestRequestByType.ASSISTANCE = assistance.data?.status;
    this.latestRequestByType.CONTACT_DETAILS = contact.data?.status;
  }

  requestButtonLabel(type: RequestType): string {
    if (type === 'COMPANION') return 'Companion Request';
    if (type === 'ASSISTANCE') return 'Assistance Request';
    return 'Request for Contact Details';
  }


  uppercaseSearchControl(controlName: 'originAirportCode' | 'destinationAirportCode' | 'stop1AirportCode' | 'stop2AirportCode'): void {
    const control = this.form.get(controlName);
    if (!control) return;
    const value = `${control.value ?? ''}`.toUpperCase();
    if (value !== control.value) {
      control.setValue(value, { emitEvent: false });
    }
  }

  private focusTopError(): void {
    window.setTimeout(() => {
      this.errorAlert?.nativeElement.focus();
      this.errorAlert?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
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


  async onAirportInput(_field: string, event: Event): Promise<void> {
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
