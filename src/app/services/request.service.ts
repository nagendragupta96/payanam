import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class RequestService {
  async createRequest(itineraryId: string, requesterId: string, message: string | null = null): Promise<string | null> {
    const itinerary = await supabase
      .from('itineraries')
      .select('owner_id')
      .eq('id', itineraryId)
      .single();

    if (itinerary.error) return itinerary.error.message;

    const { error } = await supabase.from('requests').insert({
      itinerary_id: itineraryId,
      requester_id: requesterId,
      owner_id: itinerary.data.owner_id,
      status: 'PENDING',
      message
    });

    return error?.message ?? null;
  }

  async inbox(userId: string) {
    const incoming = await supabase
      .from('requests')
      .select('*, itineraries(destination, origin_airport, destination_airport)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    const outgoing = await supabase
      .from('requests')
      .select('*, itineraries(destination, origin_airport, destination_airport)')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false });

    return {
      incoming: incoming.data ?? [],
      outgoing: outgoing.data ?? [],
      error: incoming.error?.message || outgoing.error?.message || null
    };
  }
}
