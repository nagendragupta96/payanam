import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { FlightLeg, Itinerary } from '../models/itinerary.model';

interface SearchParams {
  destination: string;
  userStart: string;
  userEnd: string;
  airport?: string;
  flightCode?: string;
}

interface RankedItinerary {
  itinerary: Itinerary;
  score: number;
}

@Injectable({ providedIn: 'root' })
export class ItineraryService {
  async createItinerary(itinerary: Itinerary, userId: string): Promise<string | null> {
    const header = {
      owner_id: userId,
      origin_airport: itinerary.origin_airport,
      destination_airport: itinerary.destination_airport,
      destination: itinerary.destination ?? null,
      depart_date: itinerary.depart_date,
      return_date: itinerary.return_date ?? null,
      notes: itinerary.notes ?? null
    };

    const created = await supabase.from('itineraries').insert(header).select('id').single();
    if (created.error) return created.error.message;

    const itineraryId = created.data.id as string;
    const legs = (itinerary.legs ?? []).map((leg, index) => ({
      itinerary_id: itineraryId,
      leg_order: index + 1,
      origin_airport: leg.origin_airport,
      destination_airport: leg.destination_airport,
      carrier: leg.carrier,
      flight_number: leg.flight_number,
      departure_at: leg.departure_at ?? null,
      arrival_at: leg.arrival_at ?? null
    }));

    if (legs.length) {
      const { error } = await supabase.from('itinerary_legs').insert(legs);
      if (error) return error.message;
    }

    return null;
  }

  async listMyTrips(userId: string): Promise<{ data: Itinerary[]; error: string | null }> {
    const { data, error } = await supabase
      .from('itineraries')
      .select('*')
      .eq('owner_id', userId)
      .order('depart_date', { ascending: false });

    return { data: (data as Itinerary[]) ?? [], error: error?.message ?? null };
  }

  async search(params: SearchParams): Promise<{ data: Itinerary[]; error: string | null }> {
    const destination = params.destination.trim();
    const airport = params.airport?.trim().toUpperCase();
    const flightCode = this.normalizeFlightCode(params.flightCode ?? '');

    const { data, error } = await supabase
      .from('public_itinerary_search')
      .select('*')
      .ilike('destination', `%${destination}%`)
      .limit(200);

    if (error) return { data: [], error: error.message };

    const itineraries = ((data ?? []) as any[]).map((row) => ({ ...row, legs: (row.legs ?? []) as FlightLeg[] })) as Itinerary[];

    const start = this.toDateOnly(params.userStart);
    const end = this.toDateOnly(params.userEnd);

    const withOverlap = itineraries.filter((it) => {
      const tripStart = this.toDateOnly(it.depart_date);
      const tripEnd = this.toDateOnly(it.return_date || it.depart_date);
      return tripStart <= end && tripEnd >= start;
    });

    const ranked = withOverlap.map((itinerary) => this.rankItinerary(itinerary, airport, flightCode));
    const filtered = ranked.filter((item) => {
      if (flightCode) return item.score >= 3;
      if (airport) return item.score >= 2;
      return item.score >= 1;
    });

    const distinct = new Map<string, RankedItinerary>();
    for (const item of filtered) {
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

  private rankItinerary(itinerary: Itinerary, airport?: string, flightCode?: string): RankedItinerary {
    const legs = itinerary.legs ?? [];
    const hasFlightCode = Boolean(flightCode && legs.some((l) => this.normalizeFlightCode(l.flight_code ?? '') === flightCode));
    const hasAirport = Boolean(airport && legs.some((l) => l.origin_airport?.toUpperCase() === airport || l.destination_airport?.toUpperCase() === airport));

    if (hasFlightCode) return { itinerary, score: 3 };
    if (hasAirport) return { itinerary, score: 2 };
    return { itinerary, score: 1 };
  }

  private toDateOnly(input: string): string {
    return (input || '').slice(0, 10);
  }

  private normalizeFlightCode(input: string): string {
    return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }
}
