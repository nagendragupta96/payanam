import { Injectable } from '@angular/core';
import { dataFetchErrorMessage, runSupabaseQuery, supabase } from './supabase-client';
import { AuthService } from './auth.service';

export type RequestType = 'COMPANION' | 'ASSISTANCE' | 'CONTACT_DETAILS';

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
  private readonly queryTimeoutMs = 12000;

  constructor(private authService: AuthService) {}

  private runQuery<T>(operation: string, query: PromiseLike<T>): Promise<T> {
    return runSupabaseQuery(`request.${operation}`, query, this.queryTimeoutMs);
  }

  async createOrGetRequest(
    itineraryId: string,
    requesterId: string,
    requestType: RequestType,
    message: string | null = null
  ): Promise<{ data: RequestRecord | null; existing: boolean; error: string | null }> {
    if (requesterId !== this.authService.currentSession?.user.id) {
      return { data: null, existing: false, error: 'Sign in required.' };
    }
    try {
      const { data, error } = await this.runQuery('createOrGetRequest', supabase.rpc('create_itinerary_request', {
        p_itinerary: itineraryId, p_type: requestType, p_message: message
      }));
      if (error) {
        this.handleAuthFailure('createOrGetRequest', error.message);
        return { data: null, existing: false, error: error.message };
      }
      return { data: data?.data ?? null, existing: data?.existing === true, error: data?.data ? null : 'Unable to create request.' };
    } catch (error) {
      return { data: null, existing: false, error: dataFetchErrorMessage('Creating request', error) };
    }
  }

  async findLatestRequestByType(itineraryId: string, requesterId: string, ownerId: string, requestType: RequestType) {
    const { data, error } = await this.runQuery(
      'findLatestRequestByType',
      supabase
        .from('requests')
        .select('*')
        .eq('itinerary_id', itineraryId)
        .eq('requester_id', requesterId)
        .eq('owner_id', ownerId)
        .eq('request_type', requestType)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    this.handleAuthFailure('findLatestRequestByType', error?.message ?? '');
    return { data: (data as RequestRecord) ?? null, error: error?.message ?? null };
  }

  async findActiveRequest(itineraryId: string, requesterId: string, ownerId: string, requestType: RequestType) {
    const { data, error } = await this.runQuery(
      'findActiveRequest',
      supabase
        .from('requests')
        .select('*')
        .eq('itinerary_id', itineraryId)
        .eq('requester_id', requesterId)
        .eq('owner_id', ownerId)
        .eq('request_type', requestType)
        .in('status', ['PENDING', 'ACCEPTED'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    this.handleAuthFailure('findActiveRequest', error?.message ?? '');
    return { data: (data as RequestRecord) ?? null, error: error?.message ?? null };
  }

  async getRequestByIdForUser(requestId: string, userId: string) {
    const { data, error } = await this.runQuery(
      'getRequestByIdForUser',
      supabase
        .from('requests')
        .select('*, itineraries(*)')
        .eq('id', requestId)
        .or(`requester_id.eq.${userId},owner_id.eq.${userId}`)
        .maybeSingle()
    );

    this.handleAuthFailure('getRequestByIdForUser', error?.message ?? '');
    return { data: (data as RequestRecord) ?? null, error: error?.message ?? null };
  }

  async updateRequestMessage(requestId: string, requesterId: string, message: string | null): Promise<string | null> {
    const { error } = await this.runQuery(
      'updateRequestMessage',
      supabase
        .from('requests')
        .update({ message, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('requester_id', requesterId)
    );

    this.handleAuthFailure('updateRequestMessage', error?.message ?? '');
    return error?.message ?? null;
  }

  async cancelRequest(requestId: string, requesterId: string): Promise<string | null> {
    const { error } = await this.runQuery(
      'cancelRequest',
      supabase
        .from('requests')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('requester_id', requesterId)
        .eq('status', 'PENDING')
    );

    this.handleAuthFailure('cancelRequest', error?.message ?? '');
    return error?.message ?? null;
  }

  async inbox(userId: string) {
    console.debug('[requests] inbox start', { userId });
    const runIncoming = () => supabase
      .from('requests')
      .select('*, itineraries(*)')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    const runOutgoing = () => supabase
      .from('requests')
      .select('*, itineraries(*)')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false });

    let incoming;
    let outgoing;
    try {
      [incoming, outgoing] = await Promise.all([
        this.runQuery('inbox.incoming', runIncoming()),
        this.runQuery('inbox.outgoing', runOutgoing())
      ]);
    } catch (caught) {
      const message = dataFetchErrorMessage('Loading requests', caught);
      this.handleAuthFailure('inbox', message);
      console.debug('[requests] inbox end', { incoming: 0, outgoing: 0, hasError: true });
      return { incoming: [], outgoing: [], error: message };
    }

    const queryError = incoming.error?.message || outgoing.error?.message || '';
    if (queryError) {
      this.handleAuthFailure('inbox', queryError);
      const recovered = await this.authService.recoverSessionForDataQuery('request.inbox', queryError);
      if (recovered) {
        try {
          [incoming, outgoing] = await Promise.all([
            this.runQuery('inbox.incoming.retry', runIncoming()),
            this.runQuery('inbox.outgoing.retry', runOutgoing())
          ]);
        } catch (caught) {
          const message = dataFetchErrorMessage('Loading requests', caught);
          this.handleAuthFailure('inbox.retry', message);
          return { incoming: [], outgoing: [], error: message };
        }
      }
    }

    const result = {
      incoming: (incoming.data ?? []) as RequestRecord[],
      outgoing: (outgoing.data ?? []) as RequestRecord[],
      error: incoming.error?.message || outgoing.error?.message || null
    };
    console.debug('[requests] inbox end', {
      incoming: result.incoming.length,
      outgoing: result.outgoing.length,
      hasError: !!result.error
    });
    return result;
  }

  async acceptRequest(requestId: string): Promise<{ threadId: string | null; error: string | null }> {
    const request = await this.runQuery(
      'acceptRequest.load',
      supabase.from('requests').select('id, request_type').eq('id', requestId).maybeSingle()
    );
    if (request.error || !request.data) {
      this.handleAuthFailure('acceptRequest.load', request.error?.message ?? '');
      return { threadId: null, error: request.error?.message ?? 'Request not found.' };
    }

    if ((request.data as RequestRecord).request_type === 'CONTACT_DETAILS') {
      const { error } = await this.runQuery(
        'acceptRequest.contact',
        supabase
          .from('requests')
          .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
          .eq('id', requestId)
          .eq('status', 'PENDING')
      );
      this.handleAuthFailure('acceptRequest.contact', error?.message ?? '');
      return { threadId: null, error: error?.message ?? null };
    }

    const { data, error } = await this.runQuery(
      'acceptRequest.rpc',
      supabase.rpc('accept_request_and_create_thread', { p_request_id: requestId })
    );
    this.handleAuthFailure('acceptRequest.rpc', error?.message ?? '');
    return { threadId: (data as string) ?? null, error: error?.message ?? null };
  }

  async getUserRequestForItinerary(itineraryId: string, userId: string) {
    const { data, error } = await this.runQuery(
      'getUserRequestForItinerary',
      supabase
        .from('requests')
        .select('id, status, owner_id, requester_id')
        .eq('itinerary_id', itineraryId)
        .eq('requester_id', userId)
        .order('created_at', { ascending: false })
        .maybeSingle()
    );

    this.handleAuthFailure('getUserRequestForItinerary', error?.message ?? '');
    return { data, error: error?.message ?? null };
  }

  async updateRequestStatus(requestId: string, ownerId: string, status: 'REJECTED' | 'CANCELLED'): Promise<string | null> {
    const { error } = await this.runQuery(
      'updateRequestStatus',
      supabase
        .from('requests')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('owner_id', ownerId)
        .eq('status', 'PENDING')
    );

    this.handleAuthFailure('updateRequestStatus', error?.message ?? '');
    return error?.message ?? null;
  }

  async getUserLatestRequestForItineraryByType(itineraryId: string, userId: string, requestType: RequestType) {
    const { data, error } = await this.runQuery(
      'getUserLatestRequestForItineraryByType',
      supabase
        .from('requests')
        .select('id, status, owner_id, requester_id, request_type')
        .eq('itinerary_id', itineraryId)
        .eq('requester_id', userId)
        .eq('request_type', requestType)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    this.handleAuthFailure('getUserLatestRequestForItineraryByType', error?.message ?? '');
    return { data: (data as RequestRecord | null) ?? null, error: error?.message ?? null };
  }


  async getCountsForItineraries(itineraryIds: string[]): Promise<{ counts: Record<string, number>; error: string | null }> {
    const ids = [...new Set(itineraryIds.filter(Boolean))];
    if (!ids.length) return { counts: {}, error: null };

    const { data, error } = await this.runQuery(
      'getCountsForItineraries',
      supabase
        .from('requests')
        .select('itinerary_id')
        .in('itinerary_id', ids)
    );

    this.handleAuthFailure('getCountsForItineraries', error?.message ?? '');
    if (error) return { counts: {}, error: error.message };

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const itineraryId = (row as { itinerary_id?: string }).itinerary_id;
      if (!itineraryId) continue;
      counts[itineraryId] = (counts[itineraryId] ?? 0) + 1;
    }

    return { counts, error: null };
  }

  private handleAuthFailure(operation: string, message: string): void {
    if (!message) return;
    this.authService.reportAuthFailure(`request.${operation}`, message);
  }
}
