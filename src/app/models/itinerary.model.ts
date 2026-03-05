export interface FlightLeg {
  id?: string;
  itinerary_id?: string;
  leg_order: number;
  origin_airport: string;
  destination_airport: string;
  carrier: string;
  flight_number: string;
  flight_code?: string;
  departure_at?: string | null;
  arrival_at?: string | null;
}

export interface Itinerary {
  id?: string;
  owner_id?: string;
  origin_airport: string;
  destination_airport: string;
  destination?: string | null;
  depart_date: string;
  return_date?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  legs: FlightLeg[];
}
