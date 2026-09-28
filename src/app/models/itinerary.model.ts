export interface FlightLeg {
  id?: string;
  itinerary_id?: string;
  leg_order: number;
  origin_airport_code: string;
  destination_airport_code: string;
  flight_number: string;
  flight_code?: string;
  departure_at?: string | null;
  arrival_at?: string | null;
}

export interface Itinerary {
  id?: string;
  owner_id?: string;
  is_anonymous?: boolean;
  posted_by?: string;
  origin_airport_code: string;
  destination_airport_code: string;
  start_date: string;
  end_date?: string | null;
  has_contact_details?: boolean;
  languages_known?: string[];
  notes?: string | null;
  contact_details?: {
    contact_name?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    notes?: string | null;
  } | null;
  created_at?: string;
  updated_at?: string;
  legs: FlightLeg[];
}
