import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { Itinerary } from '../models/itinerary.model';

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
    const { error } = await supabase.from('itineraries').insert({ ...itinerary, user_id: userId });
    return error?.message ?? null;
  }

  async search(params: SearchParams): Promise<{ data: Itinerary[]; error: string | null }> {
    const normalizedDestination = params.destination.trim();
    const normalizedAirport = params.airport?.trim().toUpperCase();
    const normalizedFlightCode = this.normalizeFlightCode(params.flightCode ?? '');

    let query = supabase
      .from('itineraries')
      .select('*')
      .or(`destination.ilike.%${normalizedDestination}%,destination_city.ilike.%${normalizedDestination}%,destination_country.ilike.%${normalizedDestination}%`)
      .lte('start_date', params.userEnd)
      .gte('end_date', params.userStart);

    const { data, error } = await query.limit(200);
    if (error) return { data: [], error: error.message };

    const ranked = ((data ?? []) as Itinerary[])
      .map((itinerary) => this.rankItinerary(itinerary, normalizedAirport, normalizedFlightCode))
      .filter((item) => {
        if (normalizedFlightCode && item.score < 3) return false;
        if (!normalizedFlightCode && normalizedAirport && item.score < 2) return false;
        return item.score > 0;
      });

    const unique = new Map<string, RankedItinerary>();
    for (const item of ranked) {
      const key = item.itinerary.id ?? JSON.stringify(item.itinerary);
      const existing = unique.get(key);
      if (!existing || item.score > existing.score) {
        unique.set(key, item);
      }
    }

    const sorted = [...unique.values()]
      .sort((a, b) => b.score - a.score)
      .map((item) => item.itinerary);

    return { data: sorted, error: null };
  }

  private rankItinerary(itinerary: Itinerary, airport?: string, flightCode?: string): RankedItinerary {
    const legs = itinerary.legs ?? [];

    const hasFlightCodeMatch = Boolean(
      flightCode &&
      legs.some((leg) => this.normalizeFlightCode(this.readFlightCode(leg)) === flightCode)
    );

    const hasAirportMatch = Boolean(
      airport &&
      legs.some((leg) => {
        const depart = this.readAirport(leg, 'depart');
        const arrive = this.readAirport(leg, 'arrive');
        return depart === airport || arrive === airport;
      })
    );

    if (hasFlightCodeMatch) return { itinerary, score: 3 };
    if (hasAirportMatch) return { itinerary, score: 2 };
    return { itinerary, score: 1 };
  }

  private readAirport(leg: any, type: 'depart' | 'arrive'): string {
    const keys = type === 'depart'
      ? ['depart_airport_code', 'departure_airport_code', 'origin_airport', 'originAirport']
      : ['arrive_airport_code', 'arrival_airport_code', 'destination_airport', 'destinationAirport'];

    for (const key of keys) {
      const value = leg[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim().toUpperCase();
      }
    }

    return '';
  }

  private readFlightCode(leg: any): string {
    const value = leg['flight_code'] ?? leg['flightCode'];
    return typeof value === 'string' ? value : '';
  }

  private normalizeFlightCode(input: string): string {
    return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }
}
