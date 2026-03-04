import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

export type RequestType = 'COMPANION' | 'ASSISTANCE';

@Injectable({ providedIn: 'root' })
export class RequestService {
  async createRequest(itineraryId: string, type: RequestType, toUserId: string): Promise<string | null> {
    const { error } = await supabase.from('travel_requests').insert({
      itinerary_id: itineraryId,
      type,
      to_user_id: toUserId,
      status: 'PENDING'
    });
    return error?.message ?? null;
  }

  async inbox(userId: string) {
    const incoming = await supabase.from('travel_requests').select('*').eq('to_user_id', userId);
    const outgoing = await supabase.from('travel_requests').select('*').eq('from_user_id', userId);
    return {
      incoming: incoming.data ?? [],
      outgoing: outgoing.data ?? [],
      error: incoming.error?.message || outgoing.error?.message || null
    };
  }
}
