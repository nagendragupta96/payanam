import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

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
  async getByItinerary(itineraryId: string): Promise<{ data: ItineraryContactDetails | null; error: string | null }> {
    const { data, error } = await supabase
      .from('itinerary_contact_details')
      .select('*')
      .eq('itinerary_id', itineraryId)
      .maybeSingle();

    return { data: (data as ItineraryContactDetails) ?? null, error: error?.message ?? null };
  }

  async upsert(details: ItineraryContactDetails): Promise<string | null> {
    const { error } = await supabase.from('itinerary_contact_details').upsert(details, { onConflict: 'itinerary_id' });
    return error?.message ?? null;
  }
}
