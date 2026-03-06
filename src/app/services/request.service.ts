import { Injectable } from '@angular/core';
import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase-client';

export type RequestType = 'COMPANION' | 'ASSISTANCE';

export interface RequestRecord {
  id: string;
  itinerary_id: string;
  requester_id: string;
  owner_id: string;
  request_type: RequestType;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  message?: string | null;
  created_at?: string;
  updated_at?: string;
  itineraries?: any;
}

@Injectable({ providedIn: 'root' })
export class RequestService {
  async createOrGetRequest(
    itineraryId: string,
    requesterId: string,
    requestType: RequestType,
    message: string | null = null
  ): Promise<{ data: RequestRecord | null; existing: boolean; error: string | null }> {
    const itinerary = await supabase
      .from('itineraries')
      .select('owner_id')
      .eq('id', itineraryId)
      .single();

    if (itinerary.error) return { data: null, existing: false, error: itinerary.error.message };

    const ownerId = itinerary.data.owner_id as string;

    if (ownerId === requesterId) {
      return { data: null, existing: false, error: 'You cannot send a request for your own trip.' };
    }

    const existing = await this.findExactRequest(itineraryId, requesterId, ownerId, requestType);
    if (existing.data) return { data: existing.data, existing: true, error: null };
    if (existing.error) return { data: null, existing: false, error: existing.error };

    const inserted = await supabase
      .from('requests')
      .insert({
        itinerary_id: itineraryId,
        requester_id: requesterId,
        owner_id: ownerId,
        request_type: requestType,
        status: 'PENDING',
        message
      })
      .select('*')
      .single();

    if (!inserted.error && inserted.data) {
      return { data: inserted.data as RequestRecord, existing: false, error: null };
    }

    if (this.isUniquePairError(inserted.error)) {
      const raced = await this.findExactRequest(itineraryId, requesterId, ownerId, requestType);
      if (raced.data) return { data: raced.data, existing: true, error: null };
      return { data: null, existing: false, error: raced.error ?? 'Request already exists.' };
    }

    return { data: null, existing: false, error: inserted.error?.message ?? 'Unable to create request.' };
  }

  async findExactRequest(itineraryId: string, requesterId: string, ownerId: string, requestType: RequestType) {
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('itinerary_id', itineraryId)
      .eq('requester_id', requesterId)
      .eq('owner_id', ownerId)
      .eq('request_type', requestType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { data: (data as RequestRecord) ?? null, error: error?.message ?? null };
  }

  async getRequestByIdForUser(requestId: string, userId: string) {
    const { data, error } = await supabase
      .from('requests')
      .select('*, itineraries(*)')
      .eq('id', requestId)
      .or(`requester_id.eq.${userId},owner_id.eq.${userId}`)
      .maybeSingle();

    return { data: (data as RequestRecord) ?? null, error: error?.message ?? null };
  }

  async updateRequestMessage(requestId: string, requesterId: string, message: string | null): Promise<string | null> {
    const { error } = await supabase
      .from('requests')
      .update({ message, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('requester_id', requesterId);

    return error?.message ?? null;
  }

  async cancelRequest(requestId: string, requesterId: string): Promise<string | null> {
    const { error } = await supabase
      .from('requests')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('requester_id', requesterId)
      .eq('status', 'PENDING');

    return error?.message ?? null;
  }

  async inbox(userId: string) {
    const incoming = await supabase
      .from('requests')
      .select('*, itineraries(*)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    const outgoing = await supabase
      .from('requests')
      .select('*, itineraries(*)')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false });

    return {
      incoming: (incoming.data ?? []) as RequestRecord[],
      outgoing: (outgoing.data ?? []) as RequestRecord[],
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

  private isUniquePairError(error: PostgrestError | null): boolean {
    if (!error) return false;
    return error.message.includes('requests_unique_pair') || error.code === '23505';
  }
}
