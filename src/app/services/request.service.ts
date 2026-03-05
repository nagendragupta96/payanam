import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

export type RequestType = 'COMPANION' | 'ASSISTANCE';

@Injectable({ providedIn: 'root' })
export class RequestService {
  async createRequest(
    itineraryId: string,
    requesterId: string,
    requestType: RequestType,
    message: string | null = null
  ): Promise<string | null> {
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
      request_type: requestType,
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

  async acceptRequest(requestId: string): Promise<{ threadId: string | null; error: string | null }> {
    const { data, error } = await supabase.rpc('accept_request_and_create_thread', { p_request_id: requestId });
    return { threadId: (data as string) ?? null, error: error?.message ?? null };
  }

  async getUserRequestForItinerary(itineraryId: string, userId: string) {
    const { data, error } = await supabase
      .from('requests')
      .select('id, status, owner_id, requester_id')
      .eq('itinerary_id', itineraryId)
      .eq('requester_id', userId)
      .order('created_at', { ascending: false })
      .maybeSingle();

    return { data, error: error?.message ?? null };
  }
}
