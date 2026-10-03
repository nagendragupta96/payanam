import { Injectable } from '@angular/core';
import { CommunityComment, CommunityFilters, CommunityPage, CommunityPost, PostInput, Reaction } from '../models/community.model';
import { runSupabaseQuery, supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class CommunityService {
  private async run<T>(name: string, query: any, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    try {
      const result: any = await runSupabaseQuery(`community.${name}`, query.abortSignal(controller.signal), 12000);
      if (result.error) throw new Error(result.error.code === '23505' ? 'You have already submitted a report for this content.' : result.error.message);
      return result.data as T;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  feed(filters: CommunityFilters, offset: number, signal?: AbortSignal) {
    return this.run<CommunityPage<CommunityPost>>('feed', supabase.rpc('community_feed', {
      p_search: filters.search.trim(), p_airport: filters.airport.trim().toUpperCase(), p_category: filters.category,
      p_origin: filters.origin.trim().toUpperCase(), p_destination: filters.destination.trim().toUpperCase(),
      p_date: filters.date || null, p_sort: filters.sort, p_mine: filters.mine, p_offset: offset
    }), signal);
  }
  async post(id: string, signal?: AbortSignal): Promise<CommunityPost> {
    const page = await this.run<CommunityPage<CommunityPost>>('post', supabase.rpc('community_feed', { p_id: id }), signal);
    if (!page.rows.length) throw new Error('This post no longer exists.');
    return page.rows[0];
  }
  async save(input: PostInput, id?: string): Promise<string> {
    const query = id ? supabase.from('community_posts').update(input).eq('id', id) : supabase.from('community_posts').insert(input);
    const result = await this.run<{ id: string }>('save', query.select('id').single());
    return result.id;
  }
  async deletePost(id: string) {
    const rows = await this.run<{id: string}[]>('delete', supabase.from('community_posts').delete().eq('id', id).select('id'));
    if (!rows.length) throw new Error('The post could not be deleted.');
  }
  comments(post: string, parent: string | null, offset: number, signal?: AbortSignal) {
    return this.run<CommunityPage<CommunityComment>>('comments', supabase.rpc('community_comment_page', { p_post: post, p_parent: parent, p_offset: offset }), signal);
  }
  async saveComment(post: string, content: string, parent: string | null = null, id?: string) {
    const query = id ? supabase.from('community_comments').update({ content }).eq('id', id)
      : supabase.from('community_comments').insert({ post_id: post, parent_comment_id: parent, content });
    return this.run<CommunityComment>('comment.save', query.select('*').single());
  }
  async deleteComment(id: string) {
    // A tombstone preserves other travelers' replies and their original context.
    return this.run('comment.delete', supabase.from('community_comments').update({ is_deleted: true }).eq('id', id).select('id').single());
  }
  react(id: string, comment: boolean, type: Reaction) {
    return this.run('react', supabase.rpc('community_toggle_reaction', { p_post: comment ? null : id, p_comment: comment ? id : null, p_type: type }));
  }
  report(id: string, comment: boolean, reason: string, details: string) {
    return this.run('report', supabase.from('community_reports').insert({ post_id: comment ? null : id, comment_id: comment ? id : null, reason, details }));
  }
}
