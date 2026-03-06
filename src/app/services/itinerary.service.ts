import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { FlightLeg, Itinerary } from '../models/itinerary.model';

interface SearchParams {
  originAirportCode: string;
  destinationAirportCode: string;
  searchStartDate: string;
  searchEndDate: string;
  stop1AirportCode?: string;
  stop2AirportCode?: string;
}

interface RankedItinerary {
  itinerary: Itinerary;
  score: number;
}

@Injectable({ providedIn: 'root' })
export class ItineraryService {
  async createItinerary(itinerary: Itinerary, userId: string): Promise<{ error: string | null; warning: string | null }> {
    try {
      const header = {
      owner_id: userId,
      origin_airport_code: itinerary.origin_airport_code,
      destination_airport_code: itinerary.destination_airport_code,
      start_date: itinerary.start_date,
      end_date: itinerary.end_date ?? itinerary.start_date,
      destination: itinerary.destination ?? null,
      notes: itinerary.notes ?? null,
      // backward-compat writes
      origin_airport: itinerary.origin_airport_code,
      destination_airport: itinerary.destination_airport_code,
      depart_date: itinerary.start_date,
      return_date: itinerary.end_date ?? null
    };

      const created = await supabase.from('itineraries').insert(header).select('id').single();
      if (created.error) {
        return { error: `Failed to save itinerary: ${created.error.message}`, warning: null };
      }

      const itineraryId = created.data.id as string;
      const legs = (itinerary.legs ?? []).map((leg, index) => ({
      itinerary_id: itineraryId,
      leg_order: index + 1,
      origin_airport_code: leg.origin_airport_code,
      destination_airport_code: leg.destination_airport_code,
      flight_number: leg.flight_number,
      departure_at: leg.departure_at ?? null,
      arrival_at: leg.arrival_at ?? null,
      // backward-compat writes
      origin_airport: leg.origin_airport_code,
      destination_airport: leg.destination_airport_code
    }));

      if (legs.length) {
        const { error } = await supabase.from('itinerary_legs').insert(legs);
        if (error) {
          return { error: `Trip header saved but failed to save legs: ${error.message}`, warning: null };
        }
      }

      const contactDetails = itinerary.contact_details;
      const hasContactDetails = !!(
      contactDetails?.contact_name?.trim() ||
      contactDetails?.contact_phone?.trim() ||
      contactDetails?.contact_email?.trim() ||
      contactDetails?.notes?.trim()
    );

      if (hasContactDetails) {
        const { error } = await supabase.from('itinerary_contact_details').upsert(
        {
          itinerary_id: itineraryId,
          owner_id: userId,
          contact_name: contactDetails?.contact_name?.trim() || null,
          contact_phone: contactDetails?.contact_phone?.trim() || null,
          contact_email: contactDetails?.contact_email?.trim() || null,
          notes: contactDetails?.notes?.trim() || null
        },
        { onConflict: 'itinerary_id' }
      );

        if (error) {
          return { error: `Trip saved, but contact details failed to save: ${error.message}`, warning: null };
        }
      }

      return { error: null, warning: null };
    } catch {
      return { error: 'Unexpected error while saving itinerary. Please try again.', warning: null };
    }
  }

  async listMyTrips(userId: string): Promise<{ data: Itinerary[]; error: string | null }> {
    const { data, error } = await supabase
      .from('itineraries')
      .select('*')
      .eq('owner_id', userId)
      .order('start_date', { ascending: false });

    return { data: (data as Itinerary[]) ?? [], error: error?.message ?? null };
  }

  async search(params: SearchParams): Promise<{ data: Itinerary[]; error: string | null }> {
    const originCode = this.normalizeAirportCode(params.originAirportCode);
    const destinationCode = this.normalizeAirportCode(params.destinationAirportCode);
    const stop1 = this.normalizeAirportCode(params.stop1AirportCode ?? '');
    const stop2 = this.normalizeAirportCode(params.stop2AirportCode ?? '');

    const { data, error } = await supabase
      .from('public_itinerary_search')
      .select('*')
      .eq('origin_airport_code', originCode)
      .eq('destination_airport_code', destinationCode)
      .gte('end_date', new Date().toISOString().slice(0, 10))
      .lte('start_date', params.searchEndDate)
      .gte('end_date', params.searchStartDate)
      .limit(300);

    if (error) return { data: [], error: error.message };

    const itineraries = ((data ?? []) as any[]).map((row) => ({ ...row, legs: (row.legs ?? []) as FlightLeg[] })) as Itinerary[];

    const withStops = itineraries.filter((trip) => {
      const legs = (trip.legs ?? []).sort((a, b) => (a.leg_order ?? 0) - (b.leg_order ?? 0));
      if (stop1 && legs[0]?.destination_airport_code?.toUpperCase() !== stop1) return false;
      if (stop2 && legs[1]?.destination_airport_code?.toUpperCase() !== stop2) return false;
      return true;
    });

    const ranked = withStops.map((itinerary) => this.rankItinerary(itinerary));
    const distinct = new Map<string, RankedItinerary>();
    for (const item of ranked) {
      const key = item.itinerary.id!;
      const existing = distinct.get(key);
      if (!existing || item.score > existing.score) distinct.set(key, item);
    }

    return {
      data: [...distinct.values()].sort((a, b) => b.score - a.score).map((v) => v.itinerary),
      error: null
    };
  }

  async findById(id: string): Promise<{ data: Itinerary | null; error: string | null }> {
    const header = await supabase.from('itineraries').select('*').eq('id', id).maybeSingle();
    if (header.error) return { data: null, error: header.error.message };
    if (!header.data) return { data: null, error: null };

    const legs = await supabase
      .from('itinerary_legs')
      .select('*')
      .eq('itinerary_id', id)
      .order('leg_order', { ascending: true });

    if (legs.error) return { data: null, error: legs.error.message };

    return { data: { ...(header.data as Itinerary), legs: (legs.data ?? []) as FlightLeg[] }, error: null };
  }

  async deleteItinerary(itineraryId: string, ownerId: string): Promise<string | null> {
    const contactDelete = await supabase.from('itinerary_contact_details').delete().eq('itinerary_id', itineraryId).eq('owner_id', ownerId);
    if (contactDelete.error) return contactDelete.error.message;

    const legsDelete = await supabase.from('itinerary_legs').delete().eq('itinerary_id', itineraryId);
    if (legsDelete.error) return legsDelete.error.message;

    const requestsDelete = await supabase.from('requests').delete().eq('itinerary_id', itineraryId).eq('owner_id', ownerId);
    if (requestsDelete.error) return requestsDelete.error.message;

    const itineraryDelete = await supabase.from('itineraries').delete().eq('id', itineraryId).eq('owner_id', ownerId);
    return itineraryDelete.error?.message ?? null;
  }

  private rankItinerary(itinerary: Itinerary): RankedItinerary {
    return { itinerary, score: (itinerary.legs ?? []).length + 1 };
  }

  private normalizeAirportCode(input: string): string {
    return (input || '').replace(/\s+/g, '').toUpperCase();
  }

}
