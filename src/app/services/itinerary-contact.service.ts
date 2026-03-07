import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { AuthService } from './auth.service';

export interface ItineraryContactDetails {
  itinerary_id: string;
  owner_id: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  notes?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ItineraryContactService {
  constructor(private authService: AuthService) {}

  async getByItinerary(itineraryId: string): Promise<{ data: ItineraryContactDetails | null; error: string | null }> {
    const { data, error } = await supabase
      .from('itinerary_contact_details')
      .select('*')
      .eq('itinerary_id', itineraryId)
      .maybeSingle();

    if (error?.message) {
      this.authService.reportAuthFailure('itineraryContact.getByItinerary', error.message);
    }

    return { data: (data as ItineraryContactDetails) ?? null, error: error?.message ?? null };
  }

  async upsert(details: ItineraryContactDetails): Promise<string | null> {
    const { error } = await supabase.from('itinerary_contact_details').upsert(details, { onConflict: 'itinerary_id' });
    if (error?.message) {
      this.authService.reportAuthFailure('itineraryContact.upsert', error.message);
    }
    return error?.message ?? null;
  }
}
