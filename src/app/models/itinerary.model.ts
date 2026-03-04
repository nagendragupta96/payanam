export interface FlightLeg {
  originAirport: string;
  destinationAirport: string;
  departureDate: string;
  arrivalDate: string;
  carrier: string;
  flightNumber: string;
  flightCode: string;
}

export interface Itinerary {
  id?: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  legs: FlightLeg[];
  notes?: string;
  userId?: string;
}
