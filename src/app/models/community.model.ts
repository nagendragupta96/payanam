export const COMMUNITY_CATEGORIES = ['Airport Update', 'Trip Experience', 'Travel Question', 'Travel Tip',
  'Delay / Disruption', 'Layover', 'Immigration / Security', 'Baggage', 'Transportation', 'Companion / Assistance', 'Other'] as const;
export const REPORT_REASONS = ['Spam', 'Harassment', 'False / Misleading Information', 'Inappropriate Content', 'Privacy / Personal Information', 'Other'] as const;
export type Reaction = 'like' | 'support' | 'thanks' | 'helpful';
export interface CommunityAuthor { user_id: string; display_name: string; avatar_url: string | null; }
export interface ReactionSummary { reactions: Partial<Record<Reaction, number>>; my_reaction: Reaction | null; }
export interface PostInput {
  category: string; title: string; content: string; airport_code: string | null;
  origin_airport: string | null; destination_airport: string | null; flight_number: string | null; travel_date: string | null;
}
export interface CommunityPost extends PostInput, CommunityAuthor, ReactionSummary {
  id: string; created_at: string; updated_at: string; comment_count: number;
}
export interface CommunityComment extends CommunityAuthor, ReactionSummary {
  id: string; post_id: string; parent_comment_id: string | null; content: string;
  is_deleted: boolean; created_at: string; updated_at: string; reply_count: number;
}
export interface CommunityPage<T> { rows: T[]; has_more: boolean; }
export interface CommunityFilters {
  search: string; airport: string; category: string; origin: string; destination: string; date: string;
  sort: 'latest' | 'discussed'; mine: boolean;
}
export const COMMUNITY_PRIVACY_NOTICE = 'Do not post phone numbers, email addresses, home addresses, passport details, booking references, or other sensitive personal information.';
export const COMMUNITY_UPDATE_NOTICE = 'Community update — verify time-sensitive information with the airport or airline.';
