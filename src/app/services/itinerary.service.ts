import { Injectable } from '@angular/core';
import { dataFetchErrorMessage, runSupabaseQuery, supabase } from './supabase-client';
import { FlightLeg, Itinerary } from '../models/itinerary.model';
import { AuthService } from './auth.service';

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
  private readonly queryTimeoutMs = 12000;

  constructor(private authService: AuthService) {}

  async createItinerary(itinerary: Itinerary, userId: string): Promise<{ error: string | null; warning: string | null }> {
    try {
      let warning: string | null = null;
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

      const created: any = await this.withTimeout('itinerary.create.header', supabase.from('itineraries').insert(header).select('id').single());
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
        const { error } = (await this.withTimeout('itinerary.create.legs', supabase.from('itinerary_legs').insert(legs))) as any;
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
        const contactUpsert = supabase.from('itinerary_contact_details').upsert(
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
        const { error } = (await this.withTimeout('itinerary.create.contact', contactUpsert)) as any;

        if (error) {
          warning = `Trip saved, but contact details failed to save: ${error.message}`;
        }
      }

      return { error: null, warning };
    } catch (error: any) {
      if (error?.message === 'timeout') {
        return { error: 'Saving itinerary timed out. Please try again.', warning: null };
      }
      return { error: 'Unexpected error while saving itinerary. Please try again.', warning: null };
    }
  }

  async updateItinerary(itineraryId: string, itinerary: Itinerary, ownerId: string): Promise<{ error: string | null; warning: string | null }> {
    try {
      let warning: string | null = null;

      const headerUpdate = await this.withTimeout(
        'itinerary.update.header',
        supabase
          .from('itineraries')
          .update({
            origin_airport_code: itinerary.origin_airport_code,
            destination_airport_code: itinerary.destination_airport_code,
            start_date: itinerary.start_date,
            end_date: itinerary.end_date ?? itinerary.start_date,
            destination: itinerary.destination ?? null,
            notes: itinerary.notes ?? null,
            origin_airport: itinerary.origin_airport_code,
            destination_airport: itinerary.destination_airport_code,
            depart_date: itinerary.start_date,
            return_date: itinerary.end_date ?? null,
            updated_at: new Date().toISOString()
          })
          .eq('id', itineraryId)
          .eq('owner_id', ownerId)
          .select('id')
          .maybeSingle()
      );

      if (headerUpdate.error || !headerUpdate.data?.id) {
        return { error: headerUpdate.error?.message ?? 'Unable to update itinerary.', warning: null };
      }

      const removeLegs = await this.withTimeout(
        'itinerary.update.removeLegs',
        supabase.from('itinerary_legs').delete().eq('itinerary_id', itineraryId)
      );
      if (removeLegs.error) {
        return { error: `Itinerary updated, but old legs cleanup failed: ${removeLegs.error.message}`, warning: null };
      }

      const legs = (itinerary.legs ?? []).map((leg, index) => ({
        itinerary_id: itineraryId,
        leg_order: index + 1,
        origin_airport_code: leg.origin_airport_code,
        destination_airport_code: leg.destination_airport_code,
        flight_number: leg.flight_number,
        departure_at: leg.departure_at ?? null,
        arrival_at: leg.arrival_at ?? null,
        origin_airport: leg.origin_airport_code,
        destination_airport: leg.destination_airport_code
      }));

      if (legs.length) {
        const insertedLegs = await this.withTimeout('itinerary.update.insertLegs', supabase.from('itinerary_legs').insert(legs));
        if (insertedLegs.error) {
          return { error: `Itinerary updated, but saving legs failed: ${insertedLegs.error.message}`, warning: null };
        }
      }

      const contact = itinerary.contact_details;
      const hasContactDetails = !!(
        contact?.contact_name?.trim() ||
        contact?.contact_phone?.trim() ||
        contact?.contact_email?.trim() ||
        contact?.notes?.trim()
      );

      if (hasContactDetails) {
        const upsertContact = await this.withTimeout(
          'itinerary.update.contact',
          supabase.from('itinerary_contact_details').upsert(
            {
              itinerary_id: itineraryId,
              owner_id: ownerId,
              contact_name: contact?.contact_name?.trim() || null,
              contact_phone: contact?.contact_phone?.trim() || null,
              contact_email: contact?.contact_email?.trim() || null,
              notes: contact?.notes?.trim() || null
            },
            { onConflict: 'itinerary_id' }
          )
        );

        if (upsertContact.error) {
          warning = `Itinerary updated, but contact details failed to update: ${upsertContact.error.message}`;
        }
      } else {
        const removeContact = await this.withTimeout(
          'itinerary.update.removeContact',
          supabase.from('itinerary_contact_details').delete().eq('itinerary_id', itineraryId).eq('owner_id', ownerId)
        );
        if (removeContact.error) {
          warning = `Itinerary updated, but clearing contact details failed: ${removeContact.error.message}`;
        }
      }

      return { error: null, warning };
    } catch {
      return { error: 'Unexpected error while updating itinerary. Please try again.', warning: null };
    }
  }

  private withTimeout<T>(operation: string, promise: PromiseLike<T>, timeoutMs = this.queryTimeoutMs): Promise<T> {
    return runSupabaseQuery(operation, promise, timeoutMs);
  }

  async listMyTrips(userId: string): Promise<{ data: Itinerary[]; error: string | null }> {
    console.debug('[itinerary] listMyTrips start', { userId });
    const runQuery = () => supabase
      .from('itineraries')
      .select('*')
      .eq('owner_id', userId)
      .order('start_date', { ascending: false });

    let data: any[] | null = null;
    let error: { message: string } | null = null;

    try {
      const result = await this.withTimeout('itinerary.listMyTrips', runQuery());
      data = result.data as any[] | null;
      error = result.error;
    } catch (caught) {
      const message = dataFetchErrorMessage('Loading trips', caught);
      this.logQueryError('listMyTrips', message);
      return { data: [], error: message };
    }

    if (error) {
      this.logQueryError('listMyTrips', error.message);
      const recovered = await this.authService.recoverSessionForDataQuery('itinerary.listMyTrips', error.message);
      if (recovered) {
        try {
          const retry = await this.withTimeout('itinerary.listMyTrips.retry', runQuery());
          data = retry.data as any[] | null;
          error = retry.error;
        } catch (caught) {
          const message = dataFetchErrorMessage('Loading trips', caught);
          this.logQueryError('listMyTrips.retry', message);
          return { data: [], error: message };
        }
      }
    }

    console.debug('[itinerary] listMyTrips end', { count: (data as Itinerary[] | null)?.length ?? 0, hasError: !!error });
    return { data: (data as Itinerary[]) ?? [], error: error?.message ?? null };
  }

  async search(params: SearchParams): Promise<{ data: Itinerary[]; error: string | null }> {
    console.debug('[itinerary] search start', params);
    const originCode = this.normalizeAirportCode(params.originAirportCode);
    const destinationCode = this.normalizeAirportCode(params.destinationAirportCode);
    const stop1 = this.normalizeAirportCode(params.stop1AirportCode ?? '');
    const stop2 = this.normalizeAirportCode(params.stop2AirportCode ?? '');

    const runQuery = () => supabase
      .from('public_itinerary_search')
      .select('*')
      .eq('origin_airport_code', originCode)
      .eq('destination_airport_code', destinationCode)
      .gte('end_date', new Date().toISOString().slice(0, 10))
      .lte('start_date', params.searchEndDate)
      .gte('end_date', params.searchStartDate)
      .limit(300);

    let data: any[] | null = null;
    let error: { message: string } | null = null;

    try {
      const result = await this.withTimeout('itinerary.search', runQuery());
      data = result.data as any[] | null;
      error = result.error;
    } catch (caught) {
      const message = dataFetchErrorMessage('Search', caught);
      this.logQueryError('search', message);
      return { data: [], error: message };
    }

    if (error) {
      this.logQueryError('search', error.message);
      const recovered = await this.authService.recoverSessionForDataQuery('itinerary.search', error.message);
      if (recovered) {
        try {
          const retry = await this.withTimeout('itinerary.search.retry', runQuery());
          data = retry.data as any[] | null;
          error = retry.error;
        } catch (caught) {
          const message = dataFetchErrorMessage('Search', caught);
          this.logQueryError('search.retry', message);
          return { data: [], error: message };
        }
      }
    }

    console.debug('[itinerary] search end', { count: (data as Itinerary[] | null)?.length ?? 0, hasError: !!error });
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
    const header = await this.withTimeout('itinerary.findById.header', supabase.from('itineraries').select('*').eq('id', id).maybeSingle());
    if (header.error) this.logQueryError('findById.header', header.error.message);
    if (header.error) return { data: null, error: header.error.message };
    if (!header.data) return { data: null, error: null };

    const legs = await this.withTimeout(
      'itinerary.findById.legs',
      supabase
        .from('itinerary_legs')
        .select('*')
        .eq('itinerary_id', id)
        .order('leg_order', { ascending: true })
    );

    if (legs.error) this.logQueryError('findById.legs', legs.error.message);

    if (legs.error) return { data: null, error: legs.error.message };

    return { data: { ...(header.data as Itinerary), legs: (legs.data ?? []) as FlightLeg[] }, error: null };
  }

  async deleteItinerary(itineraryId: string, ownerId: string): Promise<string | null> {
    const contactDelete = await this.withTimeout(
      'itinerary.delete.contact',
      supabase.from('itinerary_contact_details').delete().eq('itinerary_id', itineraryId).eq('owner_id', ownerId)
    );
    if (contactDelete.error) return contactDelete.error.message;

    const legsDelete = await this.withTimeout('itinerary.delete.legs', supabase.from('itinerary_legs').delete().eq('itinerary_id', itineraryId));
    if (legsDelete.error) return legsDelete.error.message;

    const requestsDelete = await this.withTimeout(
      'itinerary.delete.requests',
      supabase.from('requests').delete().eq('itinerary_id', itineraryId).eq('owner_id', ownerId)
    );
    if (requestsDelete.error) return requestsDelete.error.message;

    const itineraryDelete = await this.withTimeout(
      'itinerary.delete.itinerary',
      supabase.from('itineraries').delete().eq('id', itineraryId).eq('owner_id', ownerId)
    );
    return itineraryDelete.error?.message ?? null;
  }

  private rankItinerary(itinerary: Itinerary): RankedItinerary {
    return { itinerary, score: (itinerary.legs ?? []).length + 1 };
  }

  private normalizeAirportCode(input: string): string {
    return (input || '').replace(/\s+/g, '').toUpperCase();
  }

  private logQueryError(operation: string, message: string): void {
    console.error('[itinerary]', `${operation} failed`, { message });
    this.authService.reportAuthFailure(`itinerary.${operation}`, message);
  }

}
